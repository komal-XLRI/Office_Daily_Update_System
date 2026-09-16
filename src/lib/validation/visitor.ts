import { z } from "zod";

import {
  attachmentsSchema,
  businessDateSchema,
  importanceSchema,
  objectIdSchema,
  officeFilterParam,
  optionalParam,
  pageParam,
  pageSizeParam,
  searchTextParam,
  timeSchema,
} from "./common";

export const visitorFieldsSchema = z.object({
  /** Admin: required on create. Normal users: omit (the server uses the session office). */
  officeId: objectIdSchema.optional(),
  name: z.string().trim().min(1, "Visitor name is required").max(120, "Visitor name is too long"),
  purpose: z.string().trim().min(1, "Purpose is required").max(500, "Purpose is too long"),
  date: businessDateSchema,
  /** "HH:mm" wall-clock time in the institutional timezone. */
  timeArrived: timeSchema,
  /** "HH:mm", or "" when the visitor has not departed yet. */
  timeDeparted: z.union([timeSchema, z.literal("")]),
  importance: importanceSchema,
  photos: attachmentsSchema,
  documents: attachmentsSchema,
  remarks: z.string().trim().max(2000, "Remarks are too long"),
});

/** Create and edit payload (edits send the full form). */
export const visitorInputSchema = visitorFieldsSchema.refine(
  (value) => value.timeDeparted === "" || value.timeDeparted >= value.timeArrived,
  { path: ["timeDeparted"], message: "Departure time cannot be before arrival time" },
);

/**
 * The record's `updatedAt` (ISO) as loaded by the edit form. The update only applies while the stored
 * record still has this timestamp; otherwise the API responds 409 CONFLICT.
 */
export const expectedUpdatedAtSchema = z.iso.datetime({
  offset: true,
  message: "Reload the page and try again.",
});

/** Edit payload: the full form plus the version the client edited. */
export const visitorUpdateSchema = visitorFieldsSchema
  .extend({ expectedUpdatedAt: expectedUpdatedAtSchema })
  .refine((value) => value.timeDeparted === "" || value.timeDeparted >= value.timeArrived, {
    path: ["timeDeparted"],
    message: "Departure time cannot be before arrival time",
  });

export const visitorListQuerySchema = z.object({
  officeId: officeFilterParam,
  date: optionalParam(businessDateSchema),
  from: optionalParam(businessDateSchema),
  to: optionalParam(businessDateSchema),
  /** Matches visitor name or purpose. */
  q: searchTextParam,
  name: searchTextParam,
  purpose: searchTextParam,
  importance: optionalParam(importanceSchema),
  page: pageParam,
  pageSize: pageSizeParam,
});

export type VisitorInput = z.infer<typeof visitorInputSchema>;
export type VisitorUpdateInput = z.infer<typeof visitorUpdateSchema>;
export type VisitorListQuery = z.infer<typeof visitorListQuerySchema>;
