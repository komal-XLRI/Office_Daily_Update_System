import "server-only";

import { v2 as cloudinary } from "cloudinary";

import { getCloudinaryConfig, getCloudinaryUploadFolder, type CloudinaryConfig } from "@/lib/env";
import { ServiceUnavailableError, UploadFailedError, ValidationError } from "@/lib/errors";
import type { Attachment } from "@/types";

/**
 * Cloudinary integration (server only — the API secret never reaches the browser).
 * MongoDB stores only { fileName, fileUrl }; files live under the configured upload folder.
 */

/** Root folder for uploads; configurable with CLOUDINARY_UPLOAD_FOLDER. */
export function cloudinaryRootFolder(): string {
  return getCloudinaryUploadFolder();
}

export type CloudinaryResourceType = "image" | "raw";

let configuredKey: string | null = null;

function requireCloudinary(): CloudinaryConfig {
  const config = getCloudinaryConfig();
  if (!config) {
    throw new ServiceUnavailableError("File storage is not configured. Please contact the administrator.");
  }
  const key = `${config.cloudName}:${config.apiKey}`;
  if (configuredKey !== key) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });
    configuredKey = key;
  }
  return config;
}

export function isCloudinaryConfigured(): boolean {
  return getCloudinaryConfig() !== null;
}

/** Upload a validated file buffer. Images use resource_type "image"; documents use "raw". */
export async function uploadBufferToCloudinary(
  buffer: Buffer,
  options: { folder: string; resourceType: CloudinaryResourceType; fileName: string },
): Promise<{ fileUrl: string; publicId: string }> {
  requireCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        resource_type: options.resourceType,
        use_filename: true,
        unique_filename: true,
        filename_override: options.fileName,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result?.secure_url) {
          reject(new UploadFailedError(undefined, error));
          return;
        }
        resolve({ fileUrl: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/** Upload kinds and the Cloudinary resource type each one must use. */
export const ATTACHMENT_RESOURCE_TYPES = { photos: "image", documents: "raw" } as const;
export type AttachmentKind = keyof typeof ATTACHMENT_RESOURCE_TYPES;

/**
 * Folder key for an office's uploads. Keyed by the office id (not the editable office code) so a record's
 * files always stay under <root>/<officeId>/<kind>. Uploads stored under the old code-based folders are
 * no longer accepted on save or deleted by services.
 */
export function officeFolderKey(officeId: string): string {
  return officeId.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

export function officeUploadFolder(officeId: string, kind: AttachmentKind): string {
  return `${cloudinaryRootFolder()}/${officeFolderKey(officeId)}/${kind}`;
}

export interface ParsedCloudinaryUrl {
  resourceType: CloudinaryResourceType;
  publicId: string;
  /** Folder segments of the public id below the root folder (the file name excluded). */
  folders: string[];
}

/**
 * Parse a delivery URL from this app's Cloudinary account and root folder.
 * Returns null for any other URL (other hosts, other accounts, other folders, malformed).
 */
export function parseCloudinaryUrl(fileUrl: string): ParsedCloudinaryUrl | null {
  const config = getCloudinaryConfig();
  if (!config) return null;

  let url: URL;
  try {
    url = new URL(fileUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.search || url.hash) return null;

  let segments: string[];
  try {
    segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  // An encoded "/" or "\" inside a segment ("photos%2F..%2Fother") would smuggle extra path levels.
  if (segments.some((segment) => segment.includes("/") || segment.includes("\\"))) return null;

  // /<cloud>/<resource_type>/upload/[v<version>/]<public_id>
  if (segments.length < 5 || segments[0] !== config.cloudName || segments[2] !== "upload") return null;
  const resourceType = segments[1];
  if (resourceType !== "image" && resourceType !== "raw") return null;

  let rest = segments.slice(3);
  if (/^v\d+$/.test(rest[0] ?? "")) rest = rest.slice(1);
  if (rest[0] !== cloudinaryRootFolder() || rest.length < 2 || rest.some((part) => part === ".." || part === ".")) {
    return null;
  }

  const joined = rest.join("/");
  const publicId = resourceType === "image" ? joined.replace(/\.[^./]+$/, "") : joined;
  return { resourceType, publicId, folders: rest.slice(1, -1) };
}

export function isAllowedAttachmentUrl(fileUrl: string): boolean {
  return parseCloudinaryUrl(fileUrl) !== null;
}

/** True when the URL is exactly <root>/<office folder>/<kind>/<file> with the resource type of that kind. */
export function isOfficeAttachmentUrl(fileUrl: string, officeId: string, kind: AttachmentKind): boolean {
  const parsed = parseCloudinaryUrl(fileUrl);
  return (
    parsed !== null &&
    parsed.resourceType === ATTACHMENT_RESOURCE_TYPES[kind] &&
    parsed.folders.length === 2 &&
    parsed.folders[0] === officeFolderKey(officeId) &&
    parsed.folders[1] === kind
  );
}

/**
 * Services must call this before saving attachments so records only reference this app's uploads for the
 * record's own office: photos under <root>/<officeId>/photos (image), documents under <root>/<officeId>/documents (raw).
 */
export function assertAllowedAttachments(officeId: string, photos: Attachment[], documents: Attachment[]): void {
  const valid =
    photos.every((item) => isOfficeAttachmentUrl(item.fileUrl, officeId, "photos")) &&
    documents.every((item) => isOfficeAttachmentUrl(item.fileUrl, officeId, "documents"));
  if (!valid) {
    throw new ValidationError("One or more attachments are invalid. Please upload the files again.");
  }
}

/** Keep only URLs stored in the office's own folders (safe for services to delete). */
export function officeOwnedUrls(officeId: string, photoUrls: string[], documentUrls: string[]): string[] {
  return [
    ...photoUrls.filter((url) => isOfficeAttachmentUrl(url, officeId, "photos")),
    ...documentUrls.filter((url) => isOfficeAttachmentUrl(url, officeId, "documents")),
  ];
}

/** URLs present in `previous` but no longer in `next`. */
export function removedAttachmentUrls(previous: Attachment[], next: Attachment[]): string[] {
  const kept = new Set(next.map((item) => item.fileUrl));
  return previous.map((item) => item.fileUrl).filter((url) => !kept.has(url));
}

/** Best-effort deletion of files that are no longer referenced. Never throws. */
export async function deleteCloudinaryFiles(fileUrls: string[]): Promise<void> {
  if (fileUrls.length === 0 || !isCloudinaryConfigured()) return;
  try {
    requireCloudinary();
  } catch {
    return;
  }

  const byType = new Map<CloudinaryResourceType, string[]>();
  for (const url of fileUrls) {
    const parsed = parseCloudinaryUrl(url);
    if (!parsed) continue;
    const ids = byType.get(parsed.resourceType) ?? [];
    ids.push(parsed.publicId);
    byType.set(parsed.resourceType, ids);
  }

  await Promise.all(
    [...byType.entries()].map(async ([resourceType, publicIds]) => {
      try {
        await cloudinary.api.delete_resources(publicIds, { resource_type: resourceType, type: "upload" });
      } catch (error) {
        console.warn(
          `[cloudinary] Could not delete ${publicIds.length} ${resourceType} file(s): ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }),
  );
}
