import { z } from "zod";

import { optionalParam, pageParam, pageSizeParam, searchTextParam } from "./common";

export const officeInputSchema = z.object({
  name: z.string().trim().min(2, "Office name is required").max(120, "Office name is too long"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, "Office code is required")
    .max(30, "Office code is too long")
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use letters, numbers and hyphens only"),
  isActive: z.boolean(),
});

/**
 * PATCH body: any subset of name/isActive (e.g. `{ isActive: false }` to deactivate). Office codes are
 * immutable after creation (the seed script matches offices by code), so any `code` is rejected.
 */
export const officeUpdateSchema = officeInputSchema
  .omit({ code: true })
  .partial()
  .extend({
    code: z.undefined({ error: "Office codes cannot be changed after creation" }).optional(),
  });

export const officeListQuerySchema = z.object({
  q: searchTextParam,
  status: optionalParam(z.enum(["active", "inactive"])),
  page: pageParam,
  pageSize: pageSizeParam,
});

export type OfficeInput = z.infer<typeof officeInputSchema>;
export type OfficeUpdateInput = z.infer<typeof officeUpdateSchema>;
export type OfficeListQuery = z.infer<typeof officeListQuerySchema>;
