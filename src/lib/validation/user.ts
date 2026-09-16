import { z } from "zod";

import {
  emailSchema,
  objectIdSchema,
  optionalParam,
  pageParam,
  pageSizeParam,
  roleSchema,
  searchTextParam,
} from "./common";

export const userFieldsSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120, "Name is too long"),
  email: emailSchema,
  role: roleSchema,
  designation: z.string().trim().max(120, "Designation is too long"),
  officeId: objectIdSchema.nullable(),
  isActive: z.boolean(),
});

/** Create / full edit (admin only). Normal users must have an office. */
export const userInputSchema = userFieldsSchema.superRefine((value, ctx) => {
  if (value.role === "user" && !value.officeId) {
    ctx.addIssue({
      code: "custom",
      path: ["officeId"],
      message: "Normal users must be assigned to an office",
    });
  }
});

/** PATCH body: any subset. The service re-checks the office rule against the merged result. */
export const userUpdateSchema = userFieldsSchema.partial();

export const userListQuerySchema = z.object({
  q: searchTextParam,
  role: optionalParam(roleSchema),
  officeId: optionalParam(objectIdSchema),
  status: optionalParam(z.enum(["active", "inactive"])),
  page: pageParam,
  pageSize: pageSizeParam,
});

export type UserInput = z.infer<typeof userInputSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
