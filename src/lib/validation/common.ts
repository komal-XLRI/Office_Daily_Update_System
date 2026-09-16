import { z } from "zod";

import { IMPORTANCE_LEVELS, MAX_ATTACHMENTS_PER_FIELD, ROLES } from "@/lib/constants";
import { isValidBusinessDate, isValidMonth } from "@/lib/utils/dates";

/**
 * Shared Zod building blocks. Schemas in this folder are used by BOTH client forms (React Hook Form)
 * and server services/APIs, so keep input and output types identical (no type-changing transforms)
 * for form schemas. Query-string schemas may coerce.
 */

export const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isObjectId(value: unknown): value is string {
  return typeof value === "string" && OBJECT_ID_RE.test(value);
}

export const objectIdSchema = z.string().trim().regex(OBJECT_ID_RE, "Invalid ID");

export const businessDateSchema = z.string().trim().refine(isValidBusinessDate, "Enter a valid date");

export const monthSchema = z.string().trim().refine(isValidMonth, "Enter a valid month");

export const timeSchema = z.string().trim().regex(TIME_RE, "Enter a valid time");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const roleSchema = z.enum(ROLES, { error: "Select a valid role" });

export const importanceSchema = z.enum(IMPORTANCE_LEVELS, { error: "Select an importance level" });

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Client-side shape check. Services additionally require Cloudinary URLs (assertAllowedAttachments). */
export const attachmentSchema = z.object({
  fileName: z.string().trim().min(1, "File name is required").max(255, "File name is too long"),
  fileUrl: z.string().trim().max(2048, "File URL is too long").refine(isHttpsUrl, "Invalid file URL"),
});

export const attachmentsSchema = z
  .array(attachmentSchema)
  .max(MAX_ATTACHMENTS_PER_FIELD, `A maximum of ${MAX_ATTACHMENTS_PER_FIELD} files is allowed`);

export const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Optional query-string param: missing and "" both become undefined. */
export function optionalParam<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema.optional());
}

/** Office filter param: an office id, or "all" (admin only — enforced by resolveReadOfficeScope). */
export const officeFilterParam = optionalParam(z.union([objectIdSchema, z.literal("all")]));

export const pageParam = z.preprocess(
  (value) => blankToUndefined(value) ?? 1,
  z.coerce.number().int().min(1).max(100_000).catch(1),
);

export const pageSizeParam = z.preprocess(
  (value) => blankToUndefined(value) ?? 20,
  z.coerce.number().int().min(1).max(100).catch(20),
);

export const searchTextParam = optionalParam(z.string().trim().max(100, "Search text is too long"));
