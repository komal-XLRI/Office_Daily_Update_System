import type {
  Attachment,
  DailyUpdateDTO,
  Importance,
  MilestoneDTO,
  OfficeRef,
  ReportType,
} from "@/types";

/**
 * Dynamically generated report (spec §17–§20). Nothing here is persisted — there is no reports collection.
 * Produced by generateReport() in ./generate.ts and rendered as HTML, print view, PDF, CSV and XLSX.
 */

export interface ReportMeta {
  /** "Office Daily Update & Milestone Management System" */
  systemName: string;
  /** Office name, or "All Offices". */
  officeLabel: string;
  /** Selected office id, or null for all offices (admin only). */
  officeId: string | null;
  type: ReportType;
  /** e.g. "Daily Report", "Weekly Report", "Monthly Report", "Custom Report". */
  typeLabel: string;
  /** Inclusive business-date range "YYYY-MM-DD". */
  from: string;
  to: string;
  /** Human label, e.g. "08 Sep 2026", "07 Sep 2026 – 13 Sep 2026", "September 2026". */
  rangeLabel: string;
  /** ISO timestamp of generation. */
  generatedAt: string;
  /** Name of the user who generated the report. */
  generatedBy: string;
}

export interface ReportTotals {
  dailyRecords: number;
  milestones: number;
  visitors: number;
  photos: number;
  documents: number;
}

export interface ReportDailyRecord {
  id: string;
  /** Business date "YYYY-MM-DD". */
  date: string;
  /** One or more updates written for the day, in the order they were entered. */
  dailyUpdates: DailyUpdateDTO[];
  milestones: MilestoneDTO[];
  photos: Attachment[];
  documents: Attachment[];
}

export interface ReportVisitor {
  id: string;
  /** Business date "YYYY-MM-DD". */
  date: string;
  name: string;
  purpose: string;
  /** ISO timestamps; format with formatTime(). */
  timeArrived: string;
  timeDeparted: string | null;
  importance: Importance;
  remarks: string;
  photos: Attachment[];
  documents: Attachment[];
}

export interface ReportOfficeSection {
  office: OfficeRef;
  /** Sorted by date ascending. */
  dailyRecords: ReportDailyRecord[];
  /** Sorted by date, then arrival time ascending. */
  visitors: ReportVisitor[];
  totals: ReportTotals;
}

export interface ReportData {
  meta: ReportMeta;
  /** One section per office in scope (a single section for single-office reports). */
  sections: ReportOfficeSection[];
  totals: ReportTotals;
}
