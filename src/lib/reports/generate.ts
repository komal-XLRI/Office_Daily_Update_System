import "server-only";

import mongoose, { type Types } from "mongoose";

import { APP_NAME } from "@/lib/constants";
import { connectDB } from "@/lib/db/connect";
import { NotFoundError } from "@/lib/errors";
import { resolveReadOfficeScope } from "@/lib/permissions/scope";
import { serializeAttachments, serializeMilestones } from "@/lib/serializers";
import { businessDateRangeFilter, utcToBusinessDate } from "@/lib/utils/dates";
import { reportQuerySchema, resolveReportRange } from "@/lib/validation/report";
import { DailyMilestone } from "@/models/DailyMilestone";
import { Office } from "@/models/Office";
import { Visitor } from "@/models/Visitor";
import type { CurrentUser, Importance, OfficeRef } from "@/types";

import { ALL_OFFICES_LABEL, REPORT_TYPE_LABELS, reportRangeLabel } from "./labels";
import type {
  ReportData,
  ReportDailyRecord,
  ReportOfficeSection,
  ReportTotals,
  ReportVisitor,
} from "./types";

interface LeanReportOffice {
  _id: Types.ObjectId;
  name: string;
  code: string;
}

interface LeanReportDailyMilestone {
  _id: Types.ObjectId;
  officeId: Types.ObjectId;
  date: Date;
  dailyUpdate?: { title?: string | null; description?: string | null } | null;
  milestones?: unknown;
  photos?: unknown;
  documents?: unknown;
}

interface LeanReportVisitor {
  _id: Types.ObjectId;
  officeId: Types.ObjectId;
  name: string;
  purpose: string;
  date: Date;
  timeArrived: Date;
  timeDeparted?: Date | null;
  importance: Importance;
  remarks?: string | null;
  photos?: unknown;
  documents?: unknown;
}

const DAILY_FIELDS = "officeId date dailyUpdate milestones photos documents";
const VISITOR_FIELDS = "officeId name purpose date timeArrived timeDeparted importance remarks photos documents";

function toDailyRecord(doc: LeanReportDailyMilestone): ReportDailyRecord {
  return {
    id: String(doc._id),
    date: utcToBusinessDate(doc.date),
    dailyUpdate: {
      title: doc.dailyUpdate?.title ?? "",
      description: doc.dailyUpdate?.description ?? "",
    },
    milestones: serializeMilestones(doc.milestones),
    photos: serializeAttachments(doc.photos),
    documents: serializeAttachments(doc.documents),
  };
}

function toIsoString(value: Date): string {
  return new Date(value).toISOString();
}

function toReportVisitor(doc: LeanReportVisitor): ReportVisitor {
  return {
    id: String(doc._id),
    date: utcToBusinessDate(doc.date),
    name: doc.name,
    purpose: doc.purpose,
    timeArrived: toIsoString(doc.timeArrived),
    timeDeparted: doc.timeDeparted ? toIsoString(doc.timeDeparted) : null,
    importance: doc.importance,
    remarks: doc.remarks ?? "",
    photos: serializeAttachments(doc.photos),
    documents: serializeAttachments(doc.documents),
  };
}

function emptyTotals(): ReportTotals {
  return { dailyRecords: 0, milestones: 0, visitors: 0, photos: 0, documents: 0 };
}

function sectionTotals(dailyRecords: ReportDailyRecord[], visitors: ReportVisitor[]): ReportTotals {
  const totals = emptyTotals();
  totals.dailyRecords = dailyRecords.length;
  totals.visitors = visitors.length;
  for (const record of dailyRecords) {
    totals.milestones += record.milestones.length;
    totals.photos += record.photos.length;
    totals.documents += record.documents.length;
  }
  for (const visitor of visitors) {
    totals.photos += visitor.photos.length;
    totals.documents += visitor.documents.length;
  }
  return totals;
}

function sumTotals(sections: ReportOfficeSection[]): ReportTotals {
  const totals = emptyTotals();
  for (const { totals: section } of sections) {
    totals.dailyRecords += section.dailyRecords;
    totals.milestones += section.milestones;
    totals.visitors += section.visitors;
    totals.photos += section.photos;
    totals.documents += section.documents;
  }
  return totals;
}

function groupByOffice<Doc extends { officeId: Types.ObjectId }, Item>(
  docs: Doc[],
  map: (doc: Doc) => Item,
): Map<string, Item[]> {
  const groups = new Map<string, Item[]>();
  for (const doc of docs) {
    const officeId = String(doc.officeId);
    const group = groups.get(officeId);
    if (group) group.push(map(doc));
    else groups.set(officeId, [map(doc)]);
  }
  return groups;
}

function toOfficeRef(office: LeanReportOffice): OfficeRef {
  return { id: String(office._id), name: office.name, code: office.code };
}

/** Every active office plus any inactive office that has records in the range, in creation order. */
async function loadAllReportOffices(recordOfficeIds: string[]): Promise<OfficeRef[]> {
  const offices = await Office.find({
    $or: [{ isActive: true }, { _id: { $in: recordOfficeIds.map((id) => new mongoose.Types.ObjectId(id)) } }],
  })
    .select("name code")
    .sort({ _id: 1 })
    .lean<LeanReportOffice[]>();

  const refs = offices.map(toOfficeRef);
  // Defensive: records whose office document no longer exists are still reported, never silently dropped.
  const known = new Set(refs.map((office) => office.id));
  for (const id of recordOfficeIds) {
    if (!known.has(id)) refs.push({ id, name: "Unknown office", code: "" });
  }
  return refs;
}

/**
 * Build a report (spec §17–§20) from `dailyMilestones` and `visitors`. Read-only: nothing is persisted.
 * `rawQuery` is validated with reportQuerySchema (ZodError → 400). Admins may report on one office or
 * all offices; a normal user is always limited to their own office and gets 403 for any other office
 * or for "all" (spec §18, §59).
 */
export async function generateReport(user: CurrentUser, rawQuery: unknown): Promise<ReportData> {
  const query = reportQuerySchema.parse(rawQuery);
  const range = resolveReportRange(query);
  const officeScope = resolveReadOfficeScope(user, query.officeId);

  await connectDB();

  let scopedOffice: OfficeRef | null = null;
  if (officeScope) {
    const office = await Office.findById(officeScope).select("name code").lean<LeanReportOffice>();
    if (!office) throw new NotFoundError("Office");
    scopedOffice = toOfficeRef(office);
  }

  const filter = {
    date: businessDateRangeFilter(range.from, range.to),
    ...(officeScope ? { officeId: new mongoose.Types.ObjectId(officeScope) } : {}),
  };

  const [dailyDocs, visitorDocs] = await Promise.all([
    DailyMilestone.find(filter)
      .select(DAILY_FIELDS)
      .sort({ date: 1, _id: 1 })
      .lean<LeanReportDailyMilestone[]>(),
    Visitor.find(filter)
      .select(VISITOR_FIELDS)
      .sort({ date: 1, timeArrived: 1, _id: 1 })
      .lean<LeanReportVisitor[]>(),
  ]);

  const dailyByOffice = groupByOffice(dailyDocs, toDailyRecord);
  const visitorsByOffice = groupByOffice(visitorDocs, toReportVisitor);

  const offices = scopedOffice
    ? [scopedOffice]
    : await loadAllReportOffices([...new Set([...dailyByOffice.keys(), ...visitorsByOffice.keys()])]);

  const sections: ReportOfficeSection[] = offices.map((office) => {
    const dailyRecords = dailyByOffice.get(office.id) ?? [];
    const visitors = visitorsByOffice.get(office.id) ?? [];
    return { office, dailyRecords, visitors, totals: sectionTotals(dailyRecords, visitors) };
  });

  return {
    meta: {
      systemName: APP_NAME,
      officeLabel: scopedOffice ? scopedOffice.name : ALL_OFFICES_LABEL,
      officeId: scopedOffice ? scopedOffice.id : null,
      type: query.type,
      typeLabel: REPORT_TYPE_LABELS[query.type],
      from: range.from,
      to: range.to,
      rangeLabel: reportRangeLabel(query.type, range.from, range.to),
      generatedAt: new Date().toISOString(),
      generatedBy: user.name,
    },
    sections,
    totals: sumTotals(sections),
  };
}
