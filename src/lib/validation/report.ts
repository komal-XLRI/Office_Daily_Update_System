import { z } from "zod";

import { REPORT_FORMATS, REPORT_TYPES } from "@/lib/constants";
import { daysInclusive, isValidBusinessDate, monthRange, weekRange, type BusinessDateRange } from "@/lib/utils/dates";

import { blankToUndefined, businessDateSchema, monthSchema, officeFilterParam, optionalParam } from "./common";

export const MAX_REPORT_RANGE_DAYS = 366;

/**
 * Report query (GET params).
 * - daily:   date
 * - weekly:  date (any day; the Monday–Sunday week containing it is used)
 * - monthly: month "YYYY-MM"
 * - custom:  from + to (inclusive, max 366 days)
 * - officeId: an office id or "all" (admin only; normal users are always restricted to their office)
 */
export const reportQuerySchema = z
  .object({
    type: z.preprocess(blankToUndefined, z.enum(REPORT_TYPES, { error: "Select a report type" }).default("daily")),
    date: optionalParam(businessDateSchema),
    month: optionalParam(monthSchema),
    from: optionalParam(businessDateSchema),
    to: optionalParam(businessDateSchema),
    officeId: officeFilterParam,
    format: z.preprocess(blankToUndefined, z.enum(REPORT_FORMATS, { error: "Invalid format" }).default("json")),
  })
  .superRefine((query, ctx) => {
    if ((query.type === "daily" || query.type === "weekly") && !query.date) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Select a date" });
    }
    if (query.type === "monthly" && !query.month) {
      ctx.addIssue({ code: "custom", path: ["month"], message: "Select a month" });
    }
    if (query.type === "custom") {
      if (!query.from) ctx.addIssue({ code: "custom", path: ["from"], message: "Select a From date" });
      if (!query.to) ctx.addIssue({ code: "custom", path: ["to"], message: "Select a To date" });
      if (isValidBusinessDate(query.from) && isValidBusinessDate(query.to)) {
        if (query.to < query.from) {
          ctx.addIssue({ code: "custom", path: ["to"], message: "To date must be on or after From date" });
        } else if (daysInclusive(query.from, query.to) > MAX_REPORT_RANGE_DAYS) {
          ctx.addIssue({
            code: "custom",
            path: ["to"],
            message: `Custom reports can cover at most ${MAX_REPORT_RANGE_DAYS} days`,
          });
        }
      }
    }
  });

export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** Resolve a validated report query to an inclusive business-date range. */
export function resolveReportRange(query: ReportQuery): BusinessDateRange {
  switch (query.type) {
    case "daily":
      if (!query.date) break;
      return { from: query.date, to: query.date };
    case "weekly":
      if (!query.date) break;
      return weekRange(query.date);
    case "monthly":
      if (!query.month) break;
      return monthRange(query.month);
    case "custom":
      if (!query.from || !query.to) break;
      return { from: query.from, to: query.to };
  }
  throw new RangeError("Report query is missing its date range");
}
