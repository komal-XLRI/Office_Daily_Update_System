import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signSessionToken } from "@/lib/auth/session-token";
import { parseCloudinaryUrl, type CloudinaryResourceType } from "@/lib/cloudinary";
import { resetServerEnvCache } from "@/lib/env";
import { ServiceUnavailableError, UploadFailedError } from "@/lib/errors";
import { User } from "@/models";

import {
  createAuthorizationFixture,
  createOffice,
  registerTestDatabase,
  type AuthorizationFixture,
  type OfficeDocument,
  type UserDocument,
} from "../setup/db";
import {
  docBytes,
  docxBytes,
  exeBytes,
  gifBytes,
  jpegBytes,
  MIME,
  pdfBytes,
  pngBytes,
  toFile,
  webpBytes,
  xlsBytes,
  xlsxBytes,
  zipWithoutWordPartBytes,
} from "../setup/upload-fixtures";

// POST /api/uploads (spec §8, §9, §60): authenticated, office-scoped, every file validated before any
// upload, Cloudinary failures roll back files that were already stored.

const state = vi.hoisted(() => ({
  /** Session JWT returned by the mocked cookie store (null = signed out). */
  token: null as string | null,
  /** When true, the real uploadBufferToCloudinary runs (used for the "not configured" case). */
  passthrough: false,
  uploadCalls: 0,
  uploads: [] as { folder: string; resourceType: string; fileName: string; size: number; firstBytes: string }[],
  deleted: [] as string[][],
  failOnFileName: null as string | null,
  failWith: null as unknown,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.token ? { name, value: state.token } : undefined),
  }),
}));

vi.mock("@/lib/cloudinary", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudinary")>();
  return {
    ...actual,
    uploadBufferToCloudinary: async (
      buffer: Buffer,
      options: { folder: string; resourceType: CloudinaryResourceType; fileName: string },
    ) => {
      if (state.passthrough) return actual.uploadBufferToCloudinary(buffer, options);
      const call = state.uploadCalls++;
      // Earlier files finish later, so the response order must not depend on completion order.
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, 40 - call * 8)));
      if (state.failOnFileName && options.fileName === state.failOnFileName) throw state.failWith;
      state.uploads.push({
        ...options,
        size: buffer.length,
        firstBytes: buffer.subarray(0, 4).toString("hex"),
      });
      const cloud = process.env.CLOUDINARY_CLOUD_NAME;
      const publicId = `${options.folder}/${options.fileName}`;
      return {
        fileUrl: `https://res.cloudinary.com/${cloud}/${options.resourceType}/upload/v1757320000/${publicId}`,
        publicId,
      };
    },
    deleteCloudinaryFiles: async (fileUrls: string[]) => {
      state.deleted.push([...fileUrls]);
    },
  };
});

const { POST, runtime } = await import("@/app/api/uploads/route");

registerTestDatabase();

const CLOUD = "odums-vitest-cloud";
const ROOT = "office-daily-updates";

interface UploadResponseBody {
  data?: { files: { fileName: string; fileUrl: string }[] };
  error?: { code: string; message: string; fieldErrors?: Record<string, string[]> };
}

let xlsx: Buffer;
let fixture: AuthorizationFixture;
let inactiveOffice: OfficeDocument;

beforeAll(async () => {
  xlsx = await xlsxBytes();
});

beforeEach(async () => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", "vitest-cloudinary-secret");
  vi.stubEnv("MAX_FILE_SIZE_MB", "1");
  resetServerEnvCache();

  Object.assign(state, {
    token: null,
    passthrough: false,
    uploadCalls: 0,
    uploads: [],
    deleted: [],
    failOnFileName: null,
    failWith: null,
  });

  fixture = await createAuthorizationFixture();
  inactiveOffice = await createOffice({ name: "Closed Office", code: "CLOSED", isActive: false });
});

async function signIn(user: UserDocument): Promise<void> {
  state.token = await signSessionToken({
    userId: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    officeId: user.officeId ? String(user.officeId) : null,
  });
}

interface UploadFields {
  kind?: string;
  officeId?: string;
  files?: (File | string)[];
}

function uploadRequest(fields: UploadFields, headers: Record<string, string> = {}): NextRequest {
  const form = new FormData();
  if (fields.kind !== undefined) form.set("kind", fields.kind);
  if (fields.officeId !== undefined) form.set("officeId", fields.officeId);
  for (const entry of fields.files ?? []) form.append("files", entry);
  return new NextRequest("http://localhost:3000/api/uploads", { method: "POST", body: form, headers });
}

async function send(request: NextRequest) {
  const response = await POST(request, { params: Promise.resolve({}) });
  const body = (await response.json()) as UploadResponseBody;
  return { status: response.status, body, response };
}

const png = (name = "photo.png") => toFile(pngBytes(), name, MIME.png);
const pdf = (name = "minutes.pdf") => toFile(pdfBytes(), name, MIME.pdf);

describe("POST /api/uploads — authentication and office scope", () => {
  it("runs on the Node.js runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("rejects unauthenticated uploads with 401 and uploads nothing", async () => {
    const { status, body } = await send(uploadRequest({ kind: "photos", files: [png()] }));
    expect(status).toBe(401);
    expect(body.error?.code).toBe("UNAUTHORIZED");
    expect(state.uploadCalls).toBe(0);
  });

  it("rejects a session whose user has been deactivated (401)", async () => {
    await signIn(fixture.userADoc);
    await User.updateOne({ _id: fixture.userADoc._id }, { isActive: false });
    const { status } = await send(uploadRequest({ kind: "photos", files: [png()] }));
    expect(status).toBe(401);
    expect(state.uploadCalls).toBe(0);
  });

  it("forbids User A from uploading for Office B (403)", async () => {
    await signIn(fixture.userADoc);
    const { status, body } = await send(
      uploadRequest({ kind: "photos", officeId: String(fixture.officeB._id), files: [png()] }),
    );
    expect(status).toBe(403);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(state.uploadCalls).toBe(0);
  });

  it("uploads to User A's own office when officeId is omitted or matches", async () => {
    await signIn(fixture.userADoc);
    const implicit = await send(uploadRequest({ kind: "photos", files: [png("Team Photo.png")] }));
    expect(implicit.status).toBe(200);
    expect(implicit.body.data?.files).toEqual([
      {
        fileName: "Team Photo.png",
        fileUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/v1757320000/${ROOT}/${String(fixture.officeA._id)}/photos/Team_Photo.png`,
      },
    ]);
    expect(state.uploads[0]).toMatchObject({ folder: `${ROOT}/${String(fixture.officeA._id)}/photos`, resourceType: "image" });

    const explicit = await send(
      uploadRequest({ kind: "documents", officeId: String(fixture.officeA._id), files: [pdf()] }),
    );
    expect(explicit.status).toBe(200);
    expect(state.uploads[1]).toMatchObject({ folder: `${ROOT}/${String(fixture.officeA._id)}/documents`, resourceType: "raw" });
  });

  it("requires an admin to choose an office (400 INVALID_OFFICE)", async () => {
    await signIn(fixture.adminDoc);
    for (const officeId of [undefined, "", "all"]) {
      const { status, body } = await send(uploadRequest({ kind: "photos", officeId, files: [png()] }));
      expect(status).toBe(400);
      expect(body.error?.code).toBe("INVALID_OFFICE");
      expect(body.error?.fieldErrors?.officeId).toEqual(["Select an office."]);
    }
    expect(state.uploadCalls).toBe(0);
  });

  it("lets an admin upload for an inactive office (its records remain editable), keyed by office id", async () => {
    await signIn(fixture.adminDoc);
    const { status } = await send(uploadRequest({ kind: "photos", officeId: String(inactiveOffice._id), files: [png()] }));
    expect(status).toBe(200);
    expect(state.uploads[0]).toMatchObject({ folder: `${ROOT}/${String(inactiveOffice._id)}/photos` });
  });

  it("rejects an unknown or malformed office for admins (400 INVALID_OFFICE)", async () => {
    await signIn(fixture.adminDoc);
    for (const officeId of ["64f1a0000000000000000fff", "not-an-object-id"]) {
      const { status, body } = await send(uploadRequest({ kind: "photos", officeId, files: [png()] }));
      expect(status).toBe(400);
      expect(body.error).toMatchObject({
        code: "INVALID_OFFICE",
        message: "The selected office is invalid or inactive.",
      });
    }
    expect(state.uploadCalls).toBe(0);
  });

  it("lets an admin upload for any active office", async () => {
    await signIn(fixture.adminDoc);
    const { status, body } = await send(
      uploadRequest({ kind: "documents", officeId: String(fixture.officeB._id), files: [pdf("Budget 2026.pdf")] }),
    );
    expect(status).toBe(200);
    expect(body.data?.files[0]?.fileName).toBe("Budget 2026.pdf");
    expect(body.data?.files[0]?.fileUrl).toContain(`/raw/upload/v1757320000/${ROOT}/${String(fixture.officeB._id)}/documents/Budget_2026.pdf`);
  });

  it("rejects a foreign Origin (403) before touching the upload", async () => {
    await signIn(fixture.adminDoc);
    const { status, body } = await send(
      uploadRequest(
        { kind: "photos", officeId: String(fixture.officeA._id), files: [png()] },
        { origin: "https://evil.example", host: "localhost:3000" },
      ),
    );
    expect(status).toBe(403);
    expect(body.error).toEqual({ code: "FORBIDDEN", message: "Invalid request origin." });
    expect(state.uploadCalls).toBe(0);
  });

  it("accepts a same-origin Origin header", async () => {
    await signIn(fixture.userADoc);
    const { status } = await send(
      uploadRequest({ kind: "photos", files: [png()] }, { origin: "http://localhost:3000", host: "localhost:3000" }),
    );
    expect(status).toBe(200);
  });
});

describe("POST /api/uploads — multiple files (spec §60)", () => {
  it("uploads every spec photo type in one request and preserves order", async () => {
    await signIn(fixture.userADoc);
    const files = [
      toFile(jpegBytes(), "one.jpg", MIME.jpeg),
      toFile(pngBytes(), "two.png", MIME.png),
      toFile(webpBytes(), "three.webp", MIME.webp),
      toFile(jpegBytes(), "four.JPEG", MIME.jpeg),
      toFile(pngBytes(), "five.png", MIME.png),
    ];
    const { status, body, response } = await send(uploadRequest({ kind: "photos", files }));
    expect(status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.data?.files.map((file) => file.fileName)).toEqual(["one.jpg", "two.png", "three.webp", "four.jpeg", "five.png"]);
    expect(body.data?.files.map((file) => file.fileUrl.split("/").pop())).toEqual([
      "one.jpg",
      "two.png",
      "three.webp",
      "four.jpeg",
      "five.png",
    ]);
    // Completion order differed from request order (later files finished first).
    expect(state.uploads.map((upload) => upload.fileName)).not.toEqual(body.data?.files.map((file) => file.fileName));
    expect(state.uploads.every((upload) => upload.resourceType === "image")).toBe(true);
    for (const file of body.data?.files ?? []) expect(parseCloudinaryUrl(file.fileUrl)).not.toBeNull();
  });

  it("uploads every spec document type in one request as raw files", async () => {
    await signIn(fixture.adminDoc);
    const files = [
      toFile(pdfBytes(), "Minutes.pdf", MIME.pdf),
      toFile(docBytes(), "Letter.doc", MIME.doc),
      toFile(docxBytes(), "Report.docx", MIME.docx),
      toFile(xlsBytes(), "Budget.xls", MIME.xls),
      toFile(xlsx, "Visitors.xlsx", ""),
    ];
    const { status, body } = await send(
      uploadRequest({ kind: "documents", officeId: String(fixture.officeA._id), files }),
    );
    expect(status).toBe(200);
    expect(body.data?.files.map((file) => file.fileName)).toEqual([
      "Minutes.pdf",
      "Letter.doc",
      "Report.docx",
      "Budget.xls",
      "Visitors.xlsx",
    ]);
    expect(state.uploads).toHaveLength(5);
    expect(state.uploads.every((upload) => upload.resourceType === "raw")).toBe(true);
    // The exact bytes that were validated are the ones sent to storage.
    const byName = new Map(state.uploads.map((upload) => [upload.fileName, upload]));
    expect(byName.get("Minutes.pdf")?.firstBytes).toBe(Buffer.from("%PDF").toString("hex"));
    expect(byName.get("Report.docx")?.firstBytes).toBe("504b0304");
    expect(byName.get("Letter.doc")?.firstBytes).toBe("d0cf11e0");
  });

  it("uploads nothing when one file among valid ones is invalid (415)", async () => {
    await signIn(fixture.userADoc);
    const { status, body } = await send(
      uploadRequest({
        kind: "photos",
        files: [png("good-1.png"), toFile(pdfBytes(), "spoofed.png", MIME.png), png("good-2.png")],
      }),
    );
    expect(status).toBe(415);
    expect(body.error).toEqual({
      code: "UNSUPPORTED_FILE",
      message: "spoofed.png: file content does not match its extension.",
    });
    expect(state.uploadCalls).toBe(0);
    expect(state.deleted).toHaveLength(0);
  });

  it("uploads nothing when the last file is a ZIP pretending to be a Word document (415)", async () => {
    await signIn(fixture.userADoc);
    const { status } = await send(
      uploadRequest({ kind: "documents", files: [pdf(), toFile(zipWithoutWordPartBytes(), "fake.docx", MIME.docx)] }),
    );
    expect(status).toBe(415);
    expect(state.uploadCalls).toBe(0);
  });

  it("rejects more than ten files (400) and requests without files (400)", async () => {
    await signIn(fixture.userADoc);
    const tooMany = await send(
      uploadRequest({ kind: "photos", files: Array.from({ length: 11 }, (_, index) => png(`p${index}.png`)) }),
    );
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error).toMatchObject({ code: "INVALID_INPUT", message: "You can upload up to 10 files at a time." });

    const exactlyTen = await send(
      uploadRequest({ kind: "photos", files: Array.from({ length: 10 }, (_, index) => png(`p${index}.png`)) }),
    );
    expect(exactlyTen.status).toBe(200);
    expect(exactlyTen.body.data?.files).toHaveLength(10);

    const none = await send(uploadRequest({ kind: "photos" }));
    expect(none.status).toBe(400);
    expect(none.body.error?.message).toBe("Select at least one file to upload.");

    const textValue = await send(uploadRequest({ kind: "photos", files: ["not a file"] }));
    expect(textValue.status).toBe(400);
    expect(state.uploads).toHaveLength(10);
  });
});

describe("POST /api/uploads — file validation", () => {
  it("rejects an oversized file (413) using MAX_FILE_SIZE_MB", async () => {
    await signIn(fixture.userADoc);
    const big = toFile(pdfBytes(1024 * 1024 + 1), "big.pdf", MIME.pdf);
    const oversized = await send(uploadRequest({ kind: "documents", files: [pdf(), big] }));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toEqual({ code: "FILE_TOO_LARGE", message: '"big.pdf" exceeds the 1 MB limit.' });
    expect(state.uploadCalls).toBe(0);

    // Exactly the limit is accepted.
    const atLimit = await send(
      uploadRequest({ kind: "documents", files: [toFile(pdfBytes(1024 * 1024), "limit.pdf", MIME.pdf)] }),
    );
    expect(atLimit.status).toBe(200);
    expect(state.uploads[0]?.size).toBe(1024 * 1024);
  });

  it("rejects a declared Content-Length above the request limit (413) without reading the body", async () => {
    await signIn(fixture.userADoc);
    const request = new NextRequest("http://localhost:3000/api/uploads", {
      method: "POST",
      body: "--x--",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(50 * 1024 * 1024) },
    });
    const { status, body } = await send(request);
    expect(status).toBe(413);
    expect(body.error?.code).toBe("FILE_TOO_LARGE");
  });

  it.each([
    ["an executable", "photos", () => toFile(exeBytes(), "setup.exe", MIME.exe)],
    ["a GIF", "photos", () => toFile(gifBytes(), "animation.gif", MIME.gif)],
    ["a text file", "documents", () => toFile(Buffer.from("notes"), "notes.txt", MIME.text)],
    ["a photo under documents", "documents", () => png()],
    ["a document under photos", "photos", () => pdf()],
  ])("rejects %s as unsupported (415)", async (_label, kind, file) => {
    await signIn(fixture.userADoc);
    const { status, body } = await send(uploadRequest({ kind, files: [file()] }));
    expect(status).toBe(415);
    expect(body.error?.code).toBe("UNSUPPORTED_FILE");
    expect(body.error?.message).toMatch(/is not a supported file\. Allowed: /);
    expect(state.uploadCalls).toBe(0);
  });

  it("rejects a wrong declared MIME type (415)", async () => {
    await signIn(fixture.userADoc);
    const { status, body } = await send(
      uploadRequest({ kind: "photos", files: [toFile(pngBytes(), "chart.png", "application/pdf")] }),
    );
    expect(status).toBe(415);
    expect(body.error).toEqual({ code: "UNSUPPORTED_FILE", message: "chart.png: file type does not match its extension." });
    expect(state.uploadCalls).toBe(0);
  });

  it("rejects an invalid upload kind (400)", async () => {
    await signIn(fixture.userADoc);
    for (const kind of [undefined, "videos"]) {
      const { status, body } = await send(uploadRequest({ kind, files: [png()] }));
      expect(status).toBe(400);
      expect(body.error?.message).toBe("Select a valid upload type.");
    }
  });

  it("rejects a non-multipart request body (400)", async () => {
    await signIn(fixture.userADoc);
    const request = new NextRequest("http://localhost:3000/api/uploads", {
      method: "POST",
      body: JSON.stringify({ kind: "photos" }),
      headers: { "content-type": "application/json" },
    });
    const { status, body } = await send(request);
    expect(status).toBe(400);
    expect(body.error).toEqual({ code: "INVALID_INPUT", message: "Expected a multipart/form-data upload request." });
  });
});

describe("POST /api/uploads — storage failures", () => {
  it("returns 503 when Cloudinary is not configured (real upload function)", async () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    vi.stubEnv("CLOUDINARY_API_KEY", "");
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    resetServerEnvCache();
    state.passthrough = true;
    await signIn(fixture.userADoc);

    const { status, body } = await send(uploadRequest({ kind: "photos", files: [png()] }));
    expect(status).toBe(503);
    expect(body.error).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "File storage is not configured. Please contact the administrator.",
    });
    expect(state.uploads).toHaveLength(0);
  });

  it("still validates files before reporting missing storage configuration", async () => {
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    resetServerEnvCache();
    await signIn(fixture.userADoc);
    const { status } = await send(uploadRequest({ kind: "photos", files: [toFile(exeBytes(), "x.exe", MIME.exe)] }));
    expect(status).toBe(415);
  });

  it("returns 502 and deletes already-uploaded files when one upload fails", async () => {
    await signIn(fixture.adminDoc);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.failOnFileName = "four.pdf";
    state.failWith = new UploadFailedError(undefined, { message: "Simulated Cloudinary outage", http_code: 500 });

    const names = ["one.pdf", "two.pdf", "three.pdf", "four.pdf", "five.pdf"];
    const { status, body } = await send(
      uploadRequest({
        kind: "documents",
        officeId: String(fixture.officeB._id),
        files: names.map((name) => pdf(name)),
      }),
    );

    expect(status).toBe(502);
    expect(body.error).toEqual({ code: "UPLOAD_FAILED", message: "File upload failed. Please try again." });
    expect(body.data).toBeUndefined();

    // Files 1-3 (first batch) and 5 (same batch as the failure) were stored and must be removed.
    expect(state.deleted).toHaveLength(1);
    const deleted = state.deleted[0] ?? [];
    expect(deleted.map((url) => url.split("/").pop()).sort()).toEqual(["five.pdf", "one.pdf", "three.pdf", "two.pdf"]);
    for (const url of deleted) {
      expect(parseCloudinaryUrl(url)).toMatchObject({ resourceType: "raw" });
    }

    const logged = errorSpy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).toContain("Simulated Cloudinary outage");
    expect(logged).toContain("HTTP 500");
    expect(logged).not.toContain("%PDF");
  });

  it("stops starting new uploads after a failure in the first batch", async () => {
    await signIn(fixture.userADoc);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.failOnFileName = "two.png";
    state.failWith = new UploadFailedError();

    const names = ["one.png", "two.png", "three.png", "four.png", "five.png", "six.png"];
    const { status } = await send(uploadRequest({ kind: "photos", files: names.map((name) => png(name)) }));
    expect(status).toBe(502);
    // Only the first batch of three was started; files four to six were never sent to storage.
    expect(state.uploadCalls).toBe(3);
    expect(state.deleted).toHaveLength(1);
    expect(state.deleted[0]?.map((url) => url.split("/").pop()).sort()).toEqual(["one.png", "three.png"]);
  });

  it("maps an unexpected upload error to 502 without leaking its message", async () => {
    await signIn(fixture.userADoc);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.failOnFileName = "b.png";
    state.failWith = new Error("socket hang up api_secret=vitest-cloudinary-secret");

    const { status, body } = await send(uploadRequest({ kind: "photos", files: [png("a.png"), png("b.png")] }));
    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("socket hang up");
    expect(JSON.stringify(body)).not.toContain("vitest-cloudinary-secret");
    expect(state.deleted[0]?.map((url) => url.split("/").pop())).toEqual(["a.png"]);
  });

  it("keeps a storage outage as 503 and still rolls back", async () => {
    await signIn(fixture.userADoc);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.failOnFileName = "b.png";
    state.failWith = new ServiceUnavailableError("File storage is temporarily unavailable.");

    const { status, body } = await send(uploadRequest({ kind: "photos", files: [png("a.png"), png("b.png")] }));
    expect(status).toBe(503);
    expect(body.error?.message).toBe("File storage is temporarily unavailable.");
    expect(state.deleted[0]?.map((url) => url.split("/").pop())).toEqual(["a.png"]);
  });
});
