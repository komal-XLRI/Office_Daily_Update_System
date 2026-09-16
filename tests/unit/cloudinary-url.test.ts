import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertAllowedAttachments,
  cloudinaryRootFolder,
  isAllowedAttachmentUrl,
  officeOwnedUrls,
  parseCloudinaryUrl,
  removedAttachmentUrls,
} from "@/lib/cloudinary";
import { cloudinaryImageUrl, cloudinaryThumbnailUrl } from "@/lib/cloudinary/url";
import { resetServerEnvCache } from "@/lib/env";
import { ValidationError } from "@/lib/errors";

const CLOUD = "odums-test-cloud";
const BASE = `https://res.cloudinary.com/${CLOUD}`;
const OFFICE = "64f1a0000000000000000abc";
const OTHER_OFFICE = "64f1a0000000000000000def";
const IMAGE_URL = `${BASE}/image/upload/v1757320000/${cloudinaryRootFolder()}/${OFFICE}/photos/meeting-photo_ab12cd.jpg`;
const RAW_URL = `${BASE}/raw/upload/v1757320000/${cloudinaryRootFolder()}/${OFFICE}/documents/minutes_ef34gh.pdf`;

beforeEach(() => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", "test-cloudinary-secret");
  resetServerEnvCache();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

describe("parseCloudinaryUrl", () => {
  it("accepts image uploads from this cloud and root folder", () => {
    expect(parseCloudinaryUrl(IMAGE_URL)).toEqual({
      resourceType: "image",
      publicId: `${cloudinaryRootFolder()}/${OFFICE}/photos/meeting-photo_ab12cd`,
      folders: [OFFICE, "photos"],
    });
    expect(isAllowedAttachmentUrl(IMAGE_URL)).toBe(true);
  });

  it("accepts raw (document) uploads and keeps their extension in the public id", () => {
    expect(parseCloudinaryUrl(RAW_URL)).toEqual({
      resourceType: "raw",
      publicId: `${cloudinaryRootFolder()}/${OFFICE}/documents/minutes_ef34gh.pdf`,
      folders: [OFFICE, "documents"],
    });
    expect(isAllowedAttachmentUrl(RAW_URL)).toBe(true);
  });

  it("accepts URLs without a version segment and decodes file names", () => {
    expect(
      parseCloudinaryUrl(`${BASE}/image/upload/${cloudinaryRootFolder()}/photos/site%20visit.png`),
    ).toEqual({
      resourceType: "image",
      publicId: `${cloudinaryRootFolder()}/photos/site visit`,
      folders: ["photos"],
    });
  });

  it.each([
    [
      "another cloud",
      `https://res.cloudinary.com/another-cloud/image/upload/v1/${cloudinaryRootFolder()}/photos/a.jpg`,
    ],
    [
      "another host",
      `https://evil.example.com/${CLOUD}/image/upload/v1/${cloudinaryRootFolder()}/photos/a.jpg`,
    ],
    [
      "look-alike host",
      `https://res.cloudinary.com.evil.example/${CLOUD}/image/upload/v1/${cloudinaryRootFolder()}/a.jpg`,
    ],
    [
      "userinfo host trick",
      `https://res.cloudinary.com@evil.example/${CLOUD}/image/upload/v1/${cloudinaryRootFolder()}/a.jpg`,
    ],
    ["another folder", `${BASE}/image/upload/v1/other-app/photos/a.jpg`],
    ["folder prefix trick", `${BASE}/image/upload/v1/${cloudinaryRootFolder()}-evil/a.jpg`],
    ["root folder without a file", `${BASE}/image/upload/v1/${cloudinaryRootFolder()}`],
    ["http", IMAGE_URL.replace("https://", "http://")],
    ["query string", `${IMAGE_URL}?x=1`],
    ["fragment", `${IMAGE_URL}#x`],
    ["dot-dot traversal", `${BASE}/image/upload/v1/${cloudinaryRootFolder()}/../other/a.jpg`],
    ["encoded dot-dot traversal", `${BASE}/image/upload/v1/${cloudinaryRootFolder()}/%2e%2e/secret.jpg`],
    ["backslash traversal", `${BASE}/image/upload/v1/${cloudinaryRootFolder()}\\..\\other\\a.jpg`],
    ["encoded root folder segment", `${BASE}/image/upload/v1/${cloudinaryRootFolder()}%2F..%2Fsecret.jpg`],
    ["video resource type", `${BASE}/video/upload/v1/${cloudinaryRootFolder()}/clip.mp4`],
    ["private delivery type", `${BASE}/image/private/v1/${cloudinaryRootFolder()}/photos/a.jpg`],
    ["authenticated delivery type", `${BASE}/image/authenticated/v1/${cloudinaryRootFolder()}/photos/a.jpg`],
    ["fetch delivery type", `${BASE}/image/fetch/https://evil.example.com/${cloudinaryRootFolder()}/a.jpg`],
    ["malformed URL", "not a url"],
    ["empty string", ""],
    ["javascript URL", "javascript:alert(1)"],
    ["data URL", "data:image/png;base64,iVBORw0KGgo="],
  ])("rejects %s", (_label, url) => {
    expect(parseCloudinaryUrl(url)).toBeNull();
    expect(isAllowedAttachmentUrl(url)).toBe(false);
  });

  // Regression (fixed): an encoded "/" inside a segment after the root folder is decoded into the
  // public id without re-checking for ".." parts, so "photos%2F..%2F..%2Fother" passes the folder check.
  it("rejects encoded-slash traversal after the root folder", () => {
    const url = `${BASE}/image/upload/v1/${cloudinaryRootFolder()}/photos%2F..%2F..%2Fother-app%2Fsecret.jpg`;
    expect(parseCloudinaryUrl(url)).toBeNull();
  });

  it("rejects everything when Cloudinary is not configured", () => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "");
    resetServerEnvCache();
    expect(parseCloudinaryUrl(IMAGE_URL)).toBeNull();
    expect(isAllowedAttachmentUrl(IMAGE_URL)).toBe(false);
  });
});

describe("assertAllowedAttachments (office-bound)", () => {
  const photo = (url: string) => ({ fileName: "photo.jpg", fileUrl: url });
  const doc = (url: string) => ({ fileName: "m.pdf", fileUrl: url });

  it("passes for the office's own photos (image) and documents (raw), and empty lists", () => {
    expect(() => assertAllowedAttachments(OFFICE, [photo(IMAGE_URL)], [doc(RAW_URL)])).not.toThrow();
    expect(() => assertAllowedAttachments(OFFICE, [], [])).not.toThrow();
    // The office id is matched case-insensitively.
    expect(() => assertAllowedAttachments(OFFICE.toUpperCase(), [photo(IMAGE_URL)], [])).not.toThrow();
  });

  it.each([
    ["another office's photo", [photo(IMAGE_URL.replace(OFFICE, OTHER_OFFICE))], []],
    ["another office's document", [], [doc(RAW_URL.replace(OFFICE, OTHER_OFFICE))]],
    ["a photo in the documents list", [], [doc(IMAGE_URL)]],
    ["a document in the photos list", [photo(RAW_URL)], []],
    ["a raw file under the photos folder", [photo(RAW_URL.replace("/documents/", "/photos/"))], []],
    ["an image under the documents folder", [], [doc(IMAGE_URL.replace("/photos/", "/documents/"))]],
    ["a legacy code-based folder", [photo(IMAGE_URL.replace(OFFICE, "OFFICE-A"))], []],
    ["a file directly in the office folder", [photo(`${BASE}/image/upload/v1/${cloudinaryRootFolder()}/${OFFICE}/a.jpg`)], []],
    ["a nested sub-folder", [photo(`${BASE}/image/upload/v1/${cloudinaryRootFolder()}/${OFFICE}/photos/x/a.jpg`)], []],
    ["a URL outside Cloudinary", [], [doc("https://evil.example.com/evil.pdf")]],
  ])("rejects %s", (_label, photos, documents) => {
    expect(() => assertAllowedAttachments(OFFICE, photos, documents)).toThrow(ValidationError);
  });
});

describe("officeOwnedUrls", () => {
  it("keeps only URLs in the office's own folders with the matching resource type", () => {
    const foreign = IMAGE_URL.replace(OFFICE, OTHER_OFFICE);
    expect(officeOwnedUrls(OFFICE, [IMAGE_URL, foreign, RAW_URL], [RAW_URL, IMAGE_URL, "not a url"])).toEqual([
      IMAGE_URL,
      RAW_URL,
    ]);
  });
});

describe("removedAttachmentUrls", () => {
  const a = { fileName: "a.jpg", fileUrl: `${BASE}/image/upload/v1/${cloudinaryRootFolder()}/a.jpg` };
  const b = { fileName: "b.jpg", fileUrl: `${BASE}/image/upload/v1/${cloudinaryRootFolder()}/b.jpg` };
  const c = { fileName: "c.pdf", fileUrl: `${BASE}/raw/upload/v1/${cloudinaryRootFolder()}/c.pdf` };
  const d = { fileName: "d.pdf", fileUrl: `${BASE}/raw/upload/v1/${cloudinaryRootFolder()}/d.pdf` };

  it("returns URLs that are no longer referenced", () => {
    expect(removedAttachmentUrls([a, b, c], [b, d])).toEqual([a.fileUrl, c.fileUrl]);
    expect(removedAttachmentUrls([a, b], [])).toEqual([a.fileUrl, b.fileUrl]);
  });

  it("returns nothing when all files are kept or there were none", () => {
    expect(removedAttachmentUrls([a, b], [b, a])).toEqual([]);
    expect(removedAttachmentUrls([], [a])).toEqual([]);
  });

  it("matches by URL, not by file name", () => {
    expect(removedAttachmentUrls([a], [{ fileName: "renamed.jpg", fileUrl: a.fileUrl }])).toEqual([]);
  });
});

describe("cloudinaryThumbnailUrl", () => {
  it("inserts a square thumbnail transformation into image URLs", () => {
    expect(cloudinaryThumbnailUrl(IMAGE_URL)).toBe(
      `${BASE}/image/upload/c_fill,w_240,h_240,f_auto,q_auto/v1757320000/${cloudinaryRootFolder()}/${OFFICE}/photos/meeting-photo_ab12cd.jpg`,
    );
    expect(cloudinaryThumbnailUrl(IMAGE_URL, 96)).toContain(
      "/image/upload/c_fill,w_96,h_96,f_auto,q_auto/v1757320000/",
    );
  });

  it("optimises image delivery by default", () => {
    expect(cloudinaryImageUrl(IMAGE_URL)).toBe(
      `${BASE}/image/upload/f_auto,q_auto/v1757320000/${cloudinaryRootFolder()}/${OFFICE}/photos/meeting-photo_ab12cd.jpg`,
    );
  });

  it.each([RAW_URL, "https://example.com/image/upload/a.jpg", "not a url", ""])(
    "returns %j unchanged",
    (url) => {
      expect(cloudinaryThumbnailUrl(url)).toBe(url);
    },
  );
});
