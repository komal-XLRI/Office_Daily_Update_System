import { Buffer } from "node:buffer";

import { expectApiError } from "../lib/assertions";
import type { E2EContext } from "../lib/context";
import { fixtures, MIME, toBlob } from "../lib/files";
import { assert, skip } from "../lib/harness";
import type { HttpClient } from "../lib/http";

/**
 * Spec §60 uploads through POST /api/uploads. Cloudinary is deliberately unconfigured for the run, so a
 * file that passes every server-side validation ends in 503 "File storage is not configured".
 */

interface UploadFile {
  name: string;
  type: string;
  bytes: Buffer;
}

function form(kind: string, files: UploadFile[], officeId?: string): FormData {
  const data = new FormData();
  data.append("kind", kind);
  if (officeId !== undefined) data.append("officeId", officeId);
  for (const file of files) data.append("files", toBlob(file.bytes, file.type), file.name);
  return data;
}

function upload(client: HttpClient, kind: string, files: UploadFile[], officeId?: string) {
  return client.request("POST", "/api/uploads", { form: form(kind, files, officeId) });
}

const MB = 1024 * 1024;

export async function runUploadsSection(ctx: E2EContext): Promise<void> {
  const { h, seed, clients } = ctx;
  const { userA, admin, anon } = clients;
  const { A, B, inactive } = seed.offices;
  h.section("UPLOADS");

  await h.check("unauthenticated upload -> 401", async () => {
    expectApiError(await upload(anon, "photos", [{ name: "a.jpg", type: MIME.jpg, bytes: fixtures.jpg() }]), 401, "UNAUTHORIZED");
  });

  const accepted: Array<[string, string, UploadFile]> = [
    ["JPG", "photos", { name: "Visitor photo.jpg", type: MIME.jpg, bytes: fixtures.jpg() }],
    ["JPEG", "photos", { name: "gate.jpeg", type: MIME.jpg, bytes: fixtures.jpg() }],
    ["PNG", "photos", { name: "chart.png", type: MIME.png, bytes: fixtures.png() }],
    ["WEBP", "photos", { name: "event.webp", type: MIME.webp, bytes: fixtures.webp() }],
    ["PDF", "documents", { name: "minutes.pdf", type: MIME.pdf, bytes: fixtures.pdf() }],
    ["DOCX", "documents", { name: "letter.docx", type: MIME.docx, bytes: fixtures.docx() }],
    ["XLSX", "documents", { name: "budget.xlsx", type: MIME.xlsx, bytes: fixtures.xlsx() }],
    ["DOCX with application/octet-stream", "documents", { name: "notes.docx", type: "application/octet-stream", bytes: fixtures.docx() }],
  ];
  for (const [label, kind, file] of accepted) {
    await h.check(`${label} passes validation -> 503 (Cloudinary unconfigured)`, async () => {
      const error = expectApiError(await upload(userA, kind, [file]), 503, "SERVICE_UNAVAILABLE");
      assert(/storage is not configured/i.test(error.message), `unexpected message: ${error.message}`);
      return error.message;
    });
  }

  await h.check("multiple valid files (JPG + PNG + WEBP) pass validation -> 503", async () => {
    expectApiError(
      await upload(userA, "photos", [
        { name: "1.jpg", type: MIME.jpg, bytes: fixtures.jpg() },
        { name: "2.png", type: MIME.png, bytes: fixtures.png() },
        { name: "3.webp", type: MIME.webp, bytes: fixtures.webp() },
      ]),
      503,
      "SERVICE_UNAVAILABLE",
    );
  });

  const rejected: Array<[string, string, UploadFile[], number, string]> = [
    ["unsupported .gif photo", "photos", [{ name: "anim.gif", type: MIME.gif, bytes: fixtures.gif() }], 415, "UNSUPPORTED_FILE"],
    ["unsupported .exe document", "documents", [{ name: "setup.exe", type: MIME.exe, bytes: fixtures.exe() }], 415, "UNSUPPORTED_FILE"],
    ["PNG bytes named .pdf declared application/pdf (wrong content)", "documents", [{ name: "report.pdf", type: MIME.pdf, bytes: fixtures.png() }], 415, "UNSUPPORTED_FILE"],
    ["PNG named .png declared image/jpeg (MIME mismatch)", "photos", [{ name: "photo.png", type: MIME.jpg, bytes: fixtures.png() }], 415, "UNSUPPORTED_FILE"],
    ["EXE bytes renamed to .jpg", "photos", [{ name: "photo.jpg", type: MIME.jpg, bytes: fixtures.exe() }], 415, "UNSUPPORTED_FILE"],
    ["photo uploaded as a document", "documents", [{ name: "photo.jpg", type: MIME.jpg, bytes: fixtures.jpg() }], 415, "UNSUPPORTED_FILE"],
    ["double extension setup.exe.pdf with EXE bytes", "documents", [{ name: "setup.exe.pdf", type: MIME.pdf, bytes: fixtures.exe() }], 415, "UNSUPPORTED_FILE"],
    ["oversized JPG (1.5 MB > MAX_FILE_SIZE_MB=1)", "photos", [{ name: "huge.jpg", type: MIME.jpg, bytes: fixtures.jpg(Math.round(1.5 * MB)) }], 413, "FILE_TOO_LARGE"],
    ["multiple files where one is invalid (JPG + GIF)", "photos", [{ name: "ok.jpg", type: MIME.jpg, bytes: fixtures.jpg() }, { name: "bad.gif", type: MIME.gif, bytes: fixtures.gif() }], 415, "UNSUPPORTED_FILE"],
    ["empty file", "photos", [{ name: "empty.jpg", type: MIME.jpg, bytes: Buffer.alloc(0) }], 400, "INVALID_INPUT"],
    ["11 files (limit 10)", "photos", Array.from({ length: 11 }, (_, index) => ({ name: `${index}.jpg`, type: MIME.jpg, bytes: fixtures.jpg() })), 400, "INVALID_INPUT"],
    ["invalid kind", "videos", [{ name: "a.jpg", type: MIME.jpg, bytes: fixtures.jpg() }], 400, "INVALID_INPUT"],
  ];
  for (const [label, kind, files, status, code] of rejected) {
    await h.check(`${label} -> ${status} ${code}`, async () => {
      const error = expectApiError(await upload(userA, kind, files), status, code);
      return error.message;
    });
  }

  await h.check("no files / non-multipart body -> 400", async () => {
    expectApiError(await upload(userA, "photos", []), 400, "INVALID_INPUT");
    expectApiError(await userA.post("/api/uploads", { kind: "photos" }), 400, "INVALID_INPUT");
  });

  await h.check("request body larger than the multipart limit (12 MB) -> 413", async () => {
    try {
      const response = await upload(userA, "photos", [{ name: "flood.jpg", type: MIME.jpg, bytes: fixtures.jpg(12 * MB) }]);
      const error = expectApiError(response, 413, "FILE_TOO_LARGE");
      return error.message;
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      if (cause?.code && /ECONNRESET|EPIPE|UND_ERR_SOCKET/.test(cause.code)) {
        skip(`server closed the connection while the body was being sent (${cause.code}); status not observable`);
      }
      throw error;
    }
  });

  await h.check("User A uploading with officeId=<Office B> -> 403", async () => {
    expectApiError(await upload(userA, "photos", [{ name: "a.jpg", type: MIME.jpg, bytes: fixtures.jpg() }], B.id), 403, "FORBIDDEN");
    expectApiError(await upload(userA, "photos", [{ name: "a.jpg", type: MIME.jpg, bytes: fixtures.jpg() }], "all"), 403, "FORBIDDEN");
  });

  await h.check("User A with own officeId -> validation passes (503); Admin without office / inactive office -> 400 INVALID_OFFICE", async () => {
    expectApiError(await upload(userA, "photos", [{ name: "a.jpg", type: MIME.jpg, bytes: fixtures.jpg() }], A.id), 503, "SERVICE_UNAVAILABLE");
    expectApiError(await upload(admin, "photos", [{ name: "a.jpg", type: MIME.jpg, bytes: fixtures.jpg() }]), 400, "INVALID_OFFICE");
    expectApiError(await upload(admin, "photos", [{ name: "a.jpg", type: MIME.jpg, bytes: fixtures.jpg() }], inactive.id), 400, "INVALID_OFFICE");
    expectApiError(await upload(admin, "photos", [{ name: "a.jpg", type: MIME.jpg, bytes: fixtures.jpg() }], B.id), 503, "SERVICE_UNAVAILABLE");
  });

  await h.check("real Cloudinary storage, delivery URLs and orphan clean-up", async () => {
    skip("requires Cloudinary credentials; the run deliberately blanks CLOUDINARY_* so no real uploads happen");
  });
}
