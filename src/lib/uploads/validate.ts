import { FileTooLargeError, UnsupportedFileError, ValidationError } from "@/lib/errors";
import { getFileExtension, UPLOAD_KINDS, UPLOAD_RULES, type UploadKind } from "@/lib/uploads/constants";
import { sniffFileFormat, type SniffedFormat } from "@/lib/uploads/sniff";

/**
 * Pure upload validation (spec §9, §45.9): size, extension, declared MIME type and real content.
 * No Next.js or Node imports so it can be unit tested directly. The extension alone is never trusted.
 */

export type UploadResourceType = "image" | "raw";

export interface UploadFileInput {
  /** Client-supplied file name (untrusted). */
  name: string;
  /** Client-declared MIME type (untrusted). */
  type: string;
  /** Declared size in bytes. */
  size: number;
  /** The file content. */
  bytes: Uint8Array;
}

export interface ValidatedUploadFile {
  /** Display-safe file name ending in the lowercase extension. */
  safeFileName: string;
  /** Lowercase extension without the dot. */
  extension: string;
  resourceType: UploadResourceType;
}

export const MAX_SAFE_FILE_NAME_LENGTH = 120;

const MAX_STORAGE_NAME_LENGTH = 60;
const MAX_MESSAGE_NAME_LENGTH = 80;

/** The format the content must actually have for each allowed extension. */
const EXPECTED_FORMAT_BY_EXTENSION: Readonly<Record<string, SniffedFormat>> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  pdf: "pdf",
  doc: "doc",
  docx: "docx",
  xls: "xls",
  xlsx: "xlsx",
};

/**
 * Types sent when the browser/OS cannot determine a file's type (e.g. .docx on a machine without Office).
 * They carry no claim about the content, so they are allowed and the content sniff decides.
 */
const UNDECLARED_MIME_TYPES = new Set(["", "application/octet-stream"]);

/** Control, format (bidi overrides, zero-width) and line/paragraph separator characters. */
const INVISIBLE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
/** Anything other than letters, marks, digits, spaces and a few harmless punctuation characters. */
const UNSAFE_CHARACTERS = /[^\p{L}\p{M}\p{N} ._\-()[\],+&@'!~]/gu;
/** Leading characters that hide files or can start spreadsheet formulas when names are exported. */
const LEADING_JUNK = /^[\s._\-,+@~!']+/u;
const TRAILING_JUNK = /[\s._\-,+]+$/u;

export function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === "string" && (UPLOAD_KINDS as readonly string[]).includes(value);
}

function baseName(name: string): string {
  const parts = name.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
}

function stripInvisible(text: string): string {
  return text.replace(INVISIBLE_CHARACTERS, "");
}

function normalizeExtension(extension: string): string {
  return extension.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function removeExtension(name: string, extension: string): string {
  if (!extension) return name;
  const suffixLength = extension.length + 1;
  return name.slice(-suffixLength).toLowerCase() === `.${extension}` ? name.slice(0, -suffixLength) : name;
}

/** A short, printable form of a client-supplied name for error messages. */
function messageName(name: string): string {
  const cleaned = stripInvisible(baseName(name)).replace(/\s+/g, " ").trim();
  const codePoints = Array.from(cleaned);
  if (codePoints.length === 0) return "File";
  return codePoints.length > MAX_MESSAGE_NAME_LENGTH
    ? `${codePoints.slice(0, MAX_MESSAGE_NAME_LENGTH - 3).join("")}...`
    : cleaned;
}

function formatMegabytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return String(Number(megabytes.toFixed(megabytes < 1 ? 2 : 1)));
}

function normalizeMimeType(type: string): string {
  return (type.split(";")[0] ?? "").trim().toLowerCase();
}

/**
 * Display-safe file name: no directory parts, control/invisible or unsafe characters, collapsed
 * whitespace, at most MAX_SAFE_FILE_NAME_LENGTH characters, ending in the lowercase extension.
 * Falls back to "file.<ext>".
 */
export function sanitizeFileName(name: string, extension: string): string {
  const ext = normalizeExtension(extension);
  let base = removeExtension(stripInvisible(baseName(name)).normalize("NFC").trim(), ext);

  base = base
    .replace(/\s+/g, " ")
    .replace(UNSAFE_CHARACTERS, "_")
    .replace(/_{2,}/g, "_")
    .replace(LEADING_JUNK, "")
    .replace(TRAILING_JUNK, "");

  const maxBaseLength = MAX_SAFE_FILE_NAME_LENGTH - (ext ? ext.length + 1 : 0);
  const codePoints = Array.from(base);
  if (codePoints.length > maxBaseLength) {
    base = codePoints.slice(0, maxBaseLength).join("").replace(TRAILING_JUNK, "");
  }

  if (!base) base = "file";
  return ext ? `${base}.${ext}` : base;
}

/**
 * ASCII-only name for the storage provider's public id (letters, digits, "_" and "-"), so stored URLs
 * never depend on how the provider encodes spaces, punctuation or non-Latin scripts.
 */
export function toStorageFileName(safeFileName: string, extension: string): string {
  const ext = normalizeExtension(extension);
  const base = removeExtension(safeFileName, ext)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_{2,}/g, "_")
    .slice(0, MAX_STORAGE_NAME_LENGTH)
    .replace(/^[_-]+|[_-]+$/g, "");
  const safeBase = base || "file";
  return ext ? `${safeBase}.${ext}` : safeBase;
}

/**
 * Validate one uploaded file for `kind`. Throws:
 *   ValidationError (400)      empty file
 *   FileTooLargeError (413)    larger than maxBytes
 *   UnsupportedFileError (415) extension not allowed, declared MIME type not allowed for the extension,
 *                              or content that is not really the format its extension claims
 */
export function validateUploadFile(file: UploadFileInput, kind: UploadKind, maxBytes: number): ValidatedUploadFile {
  if (!isUploadKind(kind)) throw new ValidationError("Select a valid upload type.");
  const rule = UPLOAD_RULES[kind];
  const label = messageName(file.name);

  const size = Math.max(file.size, file.bytes.byteLength);
  if (size === 0) throw new ValidationError(`"${label}" is empty.`);
  if (size > maxBytes) {
    throw new FileTooLargeError(`"${label}" exceeds the ${formatMegabytes(maxBytes)} MB limit.`);
  }

  const extension = getFileExtension(stripInvisible(baseName(file.name)).trim());
  const allowedMimeTypes = Object.hasOwn(rule.mimeTypesByExtension, extension)
    ? rule.mimeTypesByExtension[extension]
    : undefined;
  if (!allowedMimeTypes) {
    throw new UnsupportedFileError(`"${label}" is not a supported file. Allowed: ${rule.description}.`);
  }

  const declaredType = normalizeMimeType(file.type);
  if (!UNDECLARED_MIME_TYPES.has(declaredType) && !allowedMimeTypes.includes(declaredType)) {
    throw new UnsupportedFileError(`${label}: file type does not match its extension.`);
  }

  const expectedFormat = Object.hasOwn(EXPECTED_FORMAT_BY_EXTENSION, extension)
    ? EXPECTED_FORMAT_BY_EXTENSION[extension]
    : undefined;
  if (!expectedFormat || sniffFileFormat(file.bytes) !== expectedFormat) {
    throw new UnsupportedFileError(`${label}: file content does not match its extension.`);
  }

  return {
    safeFileName: sanitizeFileName(file.name, extension),
    extension,
    resourceType: kind === "photos" ? "image" : "raw",
  };
}
