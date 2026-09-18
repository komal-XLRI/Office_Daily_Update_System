import { z } from "zod";

import { MAX_DAILY_UPDATES_PER_RECORD, MAX_MILESTONES_PER_RECORD } from "@/lib/constants";

import {
  attachmentsSchema,
  businessDateSchema,
  objectIdSchema,
  officeFilterParam,
  optionalParam,
  pageParam,
  pageSizeParam,
  searchTextParam,
} from "./common";
import { expectedUpdatedAtSchema } from "./visitor";

export const dailyUpdateSchema = z.object({
  title: z.string().trim().min(1, "Daily update title is required").max(200, "Title is too long"),
  description: z
    .string()
    .trim()
    .min(1, "Daily update description is required")
    .max(10000, "Description is too long"),
  photos: attachmentsSchema.default([]),
  documents: attachmentsSchema.default([]),
});

export const milestoneSchema = z.object({
  title: z.string().trim().min(1, "Milestone title is required").max(200, "Milestone title is too long"),
  description: z.string().trim().max(5000, "Description is too long"),
  remarks: z.string().trim().max(2000, "Remarks are too long"),
  photos: attachmentsSchema.default([]),
  documents: attachmentsSchema.default([]),
});

export const dailyMilestoneInputSchema = z.object({
  /** Admin: required on create. Normal users: omit (the server uses the session office). */
  officeId: objectIdSchema.optional(),
  date: businessDateSchema,
  dailyUpdates: z
    .array(dailyUpdateSchema)
    .min(1, "At least one daily update is required")
    .max(MAX_DAILY_UPDATES_PER_RECORD, `A maximum of ${MAX_DAILY_UPDATES_PER_RECORD} daily updates is allowed`),
  milestones: z
    .array(milestoneSchema)
    .max(MAX_MILESTONES_PER_RECORD, `A maximum of ${MAX_MILESTONES_PER_RECORD} milestones is allowed`),
  photos: attachmentsSchema,
  documents: attachmentsSchema,
});

/**
 * Edit payload: the office of an existing record cannot be changed. `expectedUpdatedAt` is the record's
 * `updatedAt` (ISO) loaded by the form; a mismatch with the stored record → 409 CONFLICT.
 */
export const dailyMilestoneUpdateSchema = dailyMilestoneInputSchema.omit({ officeId: true }).extend({
  expectedUpdatedAt: expectedUpdatedAtSchema,
});

export const dailyMilestoneListQuerySchema = z.object({
  officeId: officeFilterParam,
  date: optionalParam(businessDateSchema),
  from: optionalParam(businessDateSchema),
  to: optionalParam(businessDateSchema),
  /** Matches daily update and milestone text. */
  q: searchTextParam,
  /** "records" (default) lists daily records; "milestones" lists individual milestones. */
  view: optionalParam(z.enum(["records", "milestones"])),
  page: pageParam,
  pageSize: pageSizeParam,
});

/** What the form holds: nested `photos`/`documents` may be omitted and default to []. */
export type DailyMilestoneFormInput = z.input<typeof dailyMilestoneInputSchema>;
export type DailyUpdateInput = z.infer<typeof dailyUpdateSchema>;
export type MilestoneInput = z.infer<typeof milestoneSchema>;
export type DailyMilestoneInput = z.infer<typeof dailyMilestoneInputSchema>;
export type DailyMilestoneUpdateInput = z.infer<typeof dailyMilestoneUpdateSchema>;
export type DailyMilestoneListQuery = z.infer<typeof dailyMilestoneListQuerySchema>;
