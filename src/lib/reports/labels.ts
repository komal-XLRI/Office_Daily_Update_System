import { formatBusinessDate, formatBusinessDateRange, formatMonth } from "@/lib/utils/dates";
import type { Attachment, Importance, ReportType } from "@/types";

/**
 * Client-safe report labels and formatting helpers shared by the report pages and the
 * PDF / CSV / XLSX exporters. Do not import server-only code here.
 */

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  daily: "Daily Report",
  weekly: "Weekly Report",
  monthly: "Monthly Report",
  custom: "Custom Report",
};

export const ALL_OFFICES_LABEL = "All Offices";

export const REPORT_IMPORTANCE_LABELS: Record<Importance, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

/**
 * Files can hang off the record itself, one of its updates or one of its milestones. Reports show a
 * day's files together, so they are collected from all three places.
 */
interface RecordWithFiles {
  photos: Attachment[];
  documents: Attachment[];
  dailyUpdates: { photos: Attachment[]; documents: Attachment[] }[];
  milestones: { photos: Attachment[]; documents: Attachment[] }[];
}

export function recordPhotos(record: RecordWithFiles): Attachment[] {
  return [
    ...record.photos,
    ...record.dailyUpdates.flatMap((update) => update.photos),
    ...record.milestones.flatMap((milestone) => milestone.photos),
  ];
}

export function recordDocuments(record: RecordWithFiles): Attachment[] {
  return [
    ...record.documents,
    ...record.dailyUpdates.flatMap((update) => update.documents),
    ...record.milestones.flatMap((milestone) => milestone.documents),
  ];
}

/**
 * Tabular exports (CSV, Excel) have one row per day, so a day's updates are folded into a single
 * title and body cell. The PDF and the on-screen report list them separately.
 */
export function dailyUpdateTitleCell(updates: { title: string }[]): string {
  if (updates.length <= 1) return updates[0]?.title ?? "";
  return updates.map((update, index) => `${index + 1}. ${update.title}`).join(" | ");
}

export function dailyUpdateBodyCell(updates: { title: string; description: string }[]): string {
  if (updates.length <= 1) return updates[0]?.description ?? "";
  return updates
    .map((update, index) => `${index + 1}. ${update.title}\n${update.description}`)
    .join("\n\n");
}

/** Empty-state wording (spec §40). */
export const REPORT_EMPTY_MESSAGES = {
  dailyUpdate: "No daily update has been recorded for this date.",
  dailyUpdatesInPeriod: "No daily updates have been recorded for this period.",
  milestones: "No milestones have been added yet.",
  visitors: "No visitors found.",
} as const;

/** Human label for a report range: "08 Sep 2026", "07 Sep 2026 – 13 Sep 2026" or "September 2026". */
export function reportRangeLabel(type: ReportType, from: string, to: string): string {
  if (type === "monthly") return formatMonth(from.slice(0, 7));
  if (type === "daily") return formatBusinessDate(from);
  return formatBusinessDateRange(from, to);
}

/** "Date" for single-day ranges, "Date Range" otherwise. */
export function reportRangeHeading(from: string, to: string): string {
  return from === to ? "Date" : "Date Range";
}

/** Empty message for an office with no daily records in the range. */
export function noDailyUpdatesMessage(from: string, to: string): string {
  return from === to ? REPORT_EMPTY_MESSAGES.dailyUpdate : REPORT_EMPTY_MESSAGES.dailyUpdatesInPeriod;
}

const FORMULA_TRIGGER_RE = /^(?:[=+\-@\t\r\n]|\s+[=+\-@])/;

/**
 * Spreadsheet formula-injection guard (CSV / XLSX): text that a spreadsheet could interpret as a
 * formula is prefixed with an apostrophe so it is always shown as plain text.
 */
export function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGER_RE.test(value) ? `'${value}` : value;
}

/** Only http(s) URLs are ever rendered as clickable links in exported files. */
export function isLinkableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
