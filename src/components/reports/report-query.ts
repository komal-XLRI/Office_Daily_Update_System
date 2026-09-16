import { REPORT_TYPES } from "@/lib/constants";
import { currentMonth, todayBusinessDate } from "@/lib/utils/dates";
import type { ReportQuery } from "@/lib/validation/report";
import type { ReportType } from "@/types";

/**
 * Client-safe helpers shared by the report form, the /reports page and the print view.
 * They only shape URLs and form defaults. Office scope is always enforced by generateReport().
 */

/** "All offices" filter value (same as ALL_OFFICES_VALUE, which lives in a client module). */
export const ALL_OFFICES = "all";

export const REPORT_QUERY_KEYS = ["type", "date", "month", "from", "to", "officeId"] as const;

export const REPORT_TYPE_OPTIONS: ReadonlyArray<{ value: ReportType; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Custom" },
];

export function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && (REPORT_TYPES as readonly string[]).includes(value);
}

/**
 * Keep only report query params (drops format, page and anything else).
 * Pass includeOffice: false to drop officeId as well (links built for normal users).
 */
export function pickReportParams(
  params: Record<string, string>,
  options: { includeOffice?: boolean } = {},
): Record<string, string> {
  const includeOffice = options.includeOffice ?? true;
  const picked: Record<string, string> = {};
  for (const key of REPORT_QUERY_KEYS) {
    if (key === "officeId" && !includeOffice) continue;
    const value = params[key];
    if (typeof value === "string") picked[key] = value;
  }
  return picked;
}

/** True when the URL asks for a report. An office filter on its own only pre-selects the office. */
export function hasReportQuery(params: Record<string, string>): boolean {
  return (["type", "date", "month", "from", "to"] as const).some((key) => (params[key] ?? "").trim() !== "");
}

type ReportQueryFields = Pick<ReportQuery, "type" | "date" | "month" | "from" | "to" | "officeId">;

/**
 * Canonical params for a report query: only the date fields its type uses.
 * officeId is included only when includeOffice (admins); normal users never send one.
 */
export function toReportParams(
  query: ReportQueryFields,
  options: { includeOffice: boolean },
): Record<string, string> {
  const params: Record<string, string> = { type: query.type };
  switch (query.type) {
    case "daily":
    case "weekly":
      if (query.date) params.date = query.date;
      break;
    case "monthly":
      if (query.month) params.month = query.month;
      break;
    case "custom":
      if (query.from) params.from = query.from;
      if (query.to) params.to = query.to;
      break;
  }
  if (options.includeOffice) params.officeId = query.officeId || ALL_OFFICES;
  return params;
}

export interface ReportFormValues {
  type: ReportType;
  /** Daily: the date. Weekly: any date in the Monday–Sunday week. */
  date: string;
  /** Monthly: "YYYY-MM". */
  month: string;
  /** Custom range, inclusive. */
  from: string;
  to: string;
  /** Admins only: an office id or "all". Always "" for normal users. */
  officeId: string;
}

/** Form defaults: values from the URL when present, otherwise a daily report for today. */
export function initialReportFormValues(
  params: Record<string, string>,
  includeOffice: boolean,
): ReportFormValues {
  const today = todayBusinessDate();
  const month = currentMonth();
  return {
    type: isReportType(params.type) ? params.type : "daily",
    date: params.date || today,
    month: params.month || month,
    from: params.from || `${month}-01`,
    to: params.to || today,
    officeId: includeOffice ? params.officeId || ALL_OFFICES : "",
  };
}

/** Unique, non-empty messages in their original order. */
export function uniqueMessages(messages: Iterable<string>): string[] {
  return [...new Set([...messages].filter((message) => message.trim() !== ""))];
}
