import type { NextRequest } from "next/server";

import { jsonOk, withApi } from "@/lib/api/handler";
import {
  deleteCloudinaryFiles,
  isCloudinaryConfigured,
  officeUploadFolder,
  uploadBufferToCloudinary,
} from "@/lib/cloudinary";
import { getMaxFileSizeBytes, getMaxFileSizeMb } from "@/lib/env";
import {
  AppError,
  FileTooLargeError,
  InvalidOfficeError,
  ServiceUnavailableError,
  UploadFailedError,
  ValidationError,
} from "@/lib/errors";
import { isAdmin, requireAuth, resolveWriteOfficeId } from "@/lib/permissions";
import { getOfficeOption, requireActiveOffice } from "@/lib/services/office-options";
import { MAX_FILES_PER_UPLOAD, type UploadKind } from "@/lib/uploads/constants";
import {
  isUploadKind,
  toStorageFileName,
  validateUploadFile,
  type ValidatedUploadFile,
} from "@/lib/uploads/validate";
import type { Attachment } from "@/types";

/**
 * POST /api/uploads (multipart/form-data): kind ("photos" | "documents"), optional officeId, one or more "files".
 * Every file is validated (size, extension, declared MIME type, real content) before any is uploaded to
 * Cloudinary. Responds with { data: { files: Attachment[] } } in upload order. File contents are never logged.
 */

/** Multipart parsing and the Cloudinary SDK require Node.js. */
export const runtime = "nodejs";
/** Seconds; up to MAX_FILES_PER_UPLOAD files are sent to Cloudinary in one request. */
export const maxDuration = 60;

/** Allowance for multipart boundaries, part headers and the text fields. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const UPLOAD_CONCURRENCY = 3;

interface PreparedFile extends ValidatedUploadFile {
  buffer: Buffer;
}

function requestTooLargeError(): FileTooLargeError {
  return new FileTooLargeError(
    `Uploads are limited to ${MAX_FILES_PER_UPLOAD} files of up to ${getMaxFileSizeMb()} MB each.`,
  );
}

/** Parse the multipart body, aborting as soon as it exceeds `maxBodyBytes` (even without Content-Length). */
async function readMultipartForm(request: NextRequest, maxBodyBytes: number): Promise<FormData> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new ValidationError("Expected a multipart/form-data upload request.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) throw requestTooLargeError();
  if (!request.body) throw new ValidationError("Select at least one file to upload.");

  const limit = { received: 0, exceeded: false };
  const limitedBody = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        limit.received += chunk.byteLength;
        if (limit.received > maxBodyBytes) {
          limit.exceeded = true;
          controller.error(new Error("Upload request body limit exceeded."));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  try {
    return await new Response(limitedBody, { headers: { "content-type": contentType } }).formData();
  } catch {
    if (limit.exceeded) throw requestTooLargeError();
    throw new ValidationError("The upload request could not be read. Please try again.");
  }
}

function readOfficeIdField(formData: FormData): string | null {
  const value = formData.get("officeId");
  if (value === null) return null;
  if (typeof value !== "string") throw new InvalidOfficeError();
  return value.trim() || null;
}

async function prepareFiles(formData: FormData, kind: UploadKind, maxFileBytes: number): Promise<PreparedFile[]> {
  const entries = formData.getAll("files");
  if (entries.length === 0) throw new ValidationError("Select at least one file to upload.");
  if (entries.length > MAX_FILES_PER_UPLOAD) {
    throw new ValidationError(`You can upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
  }

  const prepared: PreparedFile[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      throw new ValidationError("Invalid file data. Please select the files again.");
    }
    const buffer = Buffer.from(await entry.arrayBuffer());
    const validated = validateUploadFile(
      { name: entry.name, type: entry.type, size: entry.size, bytes: buffer },
      kind,
      maxFileBytes,
    );
    prepared.push({ ...validated, buffer });
  }
  return prepared;
}

function logUploadFailure(error: unknown): void {
  const cause = error instanceof AppError && error.cause !== undefined ? error.cause : error;
  let message = "unknown error";
  let httpCode: unknown;
  if (cause instanceof Error) {
    message = cause.message;
  } else if (typeof cause === "object" && cause !== null) {
    const details = cause as { message?: unknown; http_code?: unknown };
    if (typeof details.message === "string") message = details.message;
    httpCode = details.http_code;
  }
  const status = typeof httpCode === "number" ? ` (HTTP ${httpCode})` : "";
  console.error(`[uploads] Cloudinary upload failed${status}: ${message}`);
}

/**
 * Upload in small concurrent batches, keeping the original order. If any upload fails, files that were
 * already stored are deleted (best effort) so no orphaned files are left behind.
 */
async function uploadAll(files: PreparedFile[], folder: string): Promise<Attachment[]> {
  const uploaded: (Attachment | undefined)[] = new Array(files.length);
  let failed = false;
  let failure: unknown;

  for (let start = 0; start < files.length && !failed; start += UPLOAD_CONCURRENCY) {
    const batch = files.slice(start, start + UPLOAD_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((file) =>
        uploadBufferToCloudinary(file.buffer, {
          folder,
          resourceType: file.resourceType,
          fileName: toStorageFileName(file.safeFileName, file.extension),
        }),
      ),
    );

    for (const [offset, result] of results.entries()) {
      if (result.status === "fulfilled") {
        uploaded[start + offset] = { fileName: batch[offset].safeFileName, fileUrl: result.value.fileUrl };
      } else if (!failed) {
        failed = true;
        failure = result.reason;
      }
    }
  }

  if (failed) {
    await deleteCloudinaryFiles(
      uploaded.filter((file): file is Attachment => file !== undefined).map((file) => file.fileUrl),
    );
    logUploadFailure(failure);
    if (failure instanceof ServiceUnavailableError) throw failure;
    throw new UploadFailedError();
  }

  return uploaded.filter((file): file is Attachment => file !== undefined);
}

export const POST = withApi(async (request: NextRequest) => {
  const user = await requireAuth();

  const maxFileBytes = getMaxFileSizeBytes();
  const formData = await readMultipartForm(request, MAX_FILES_PER_UPLOAD * maxFileBytes + MULTIPART_OVERHEAD_BYTES);

  const kind = formData.get("kind");
  if (!isUploadKind(kind)) throw new ValidationError("Select a valid upload type.");

  // Admins must choose an office; a normal user always uploads for their own office (403 for any other).
  const officeId = resolveWriteOfficeId(user, readOfficeIdField(formData));
  // Admins may edit records of an inactive office, so they only need the office to exist.
  // Normal users keep the active-office rule (their own office is always active).
  if (isAdmin(user)) {
    if (!(await getOfficeOption(officeId))) throw new InvalidOfficeError();
  } else {
    await requireActiveOffice(officeId);
  }

  const files = await prepareFiles(formData, kind, maxFileBytes);

  if (!isCloudinaryConfigured()) {
    throw new ServiceUnavailableError("File storage is not configured. Please contact the administrator.");
  }

  // Keyed by office id: office codes are editable, ids are not.
  const attachments = await uploadAll(files, officeUploadFolder(officeId, kind));
  return jsonOk({ files: attachments });
});
