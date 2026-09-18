import "server-only";

import { Types, type PipelineStage } from "mongoose";

import {
  assertAllowedAttachments,
  deleteCloudinaryFiles,
  officeOwnedUrls,
  removedAttachmentUrls,
} from "@/lib/cloudinary";
import { connectDB } from "@/lib/db/connect";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
// Pure scope rules only (no session/redirect code) — the same helpers @/lib/permissions re-exports.
import {
  assertRecordAccess,
  isAdmin,
  resolveReadOfficeScope,
  resolveWriteOfficeId,
} from "@/lib/permissions/scope";
import {
  serializeAttachments,
  serializeDailyMilestone,
  serializeDailyUpdates,
  serializeMilestones,
  type LeanDailyMilestone,
} from "@/lib/serializers";
import { requireActiveOffice } from "@/lib/services/office-options";
import {
  addDays,
  businessDateFilter,
  businessDateRangeFilter,
  businessDateToUtc,
  isValidBusinessDate,
  utcToBusinessDate,
} from "@/lib/utils/dates";
import { paginationWindow, toPaginated } from "@/lib/utils/pagination";
import { containsRegex } from "@/lib/utils/strings";
import { isObjectId } from "@/lib/validation/common";
import {
  dailyMilestoneInputSchema,
  dailyMilestoneListQuerySchema,
  dailyMilestoneUpdateSchema,
  type DailyMilestoneListQuery,
} from "@/lib/validation/daily-milestone";
import { DailyMilestone } from "@/models/DailyMilestone";
import { Office } from "@/models/Office";
import type { Attachment, CurrentUser, DailyMilestoneDTO, OfficeRef, Paginated } from "@/types";

/**
 * Daily records (spec §7.4, §15, §21, §39): one `dailyMilestones` document per office per business date,
 * holding the daily update, its milestones and attachments. Every function enforces office scope.
 */

const RESOURCE = "Daily record";
const DUPLICATE_MESSAGE = "A daily record already exists for this office and date.";
export const STALE_RECORD_MESSAGE = "This record was changed by someone else. Reload to see the latest version.";
const RECORD_FIELDS =
  "officeId date dailyUpdates dailyUpdate milestones photos documents createdBy createdAt updatedAt";

/** One milestone row for "View all milestones" and milestone search. */
export interface MilestoneListItem {
  /** The daily record the milestone belongs to. */
  recordId: string;
  /** Zero-based position inside the record (the detail page anchors milestones as `#milestone-${index + 1}`). */
  index: number;
  /** Business date, "YYYY-MM-DD". */
  date: string;
  office: OfficeRef | null;
  title: string;
  description: string;
  remarks: string;
}

type DateFilter = { $gte?: Date; $lt?: Date };

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

function toObjectId(id: string): Types.ObjectId {
  return new Types.ObjectId(id);
}

/** Date filter from an exact date or a from/to range (either end may be open). */
function buildDateFilter(query: Pick<DailyMilestoneListQuery, "date" | "from" | "to">): DateFilter | null {
  if (query.date) return businessDateFilter(query.date);
  if (query.from && query.to) {
    if (query.from > query.to) {
      throw new ValidationError("The From date must be on or before the To date.", {
        to: ["The To date must be on or after the From date."],
      });
    }
    return businessDateRangeFilter(query.from, query.to);
  }
  if (query.from) return { $gte: businessDateToUtc(query.from) };
  if (query.to) return { $lt: businessDateToUtc(addDays(query.to, 1)) };
  return null;
}

/** Office scope + date filter shared by the record and milestone lists. ObjectIds are cast explicitly for aggregation. */
function buildScopeFilter(user: CurrentUser, query: DailyMilestoneListQuery): Record<string, unknown> {
  const officeId = resolveReadOfficeScope(user, query.officeId);
  const filter: Record<string, unknown> = {};
  if (officeId !== null) {
    if (!isObjectId(officeId)) throw new ForbiddenError("You do not have access to this office.");
    filter.officeId = toObjectId(officeId);
  }
  const dateFilter = buildDateFilter(query);
  if (dateFilter) filter.date = dateFilter;
  return filter;
}

function duplicateError(existingId: string | null): ConflictError {
  return new ConflictError(DUPLICATE_MESSAGE, existingId ? { existingId } : undefined);
}

async function findRecordIdFor(
  officeId: string | Types.ObjectId,
  date: Date,
  excludeId?: Types.ObjectId,
): Promise<string | null> {
  const filter: Record<string, unknown> = { officeId, date };
  if (excludeId) filter._id = { $ne: excludeId };
  const existing = await DailyMilestone.findOne(filter).select("_id").lean<{ _id: Types.ObjectId }>();
  return existing ? String(existing._id) : null;
}

/** Load a record with office/creator populated. Callers must have checked access already. */
async function loadRecordDto(id: string | Types.ObjectId): Promise<DailyMilestoneDTO> {
  const doc = await DailyMilestone.findById(id)
    .select(RECORD_FIELDS)
    .populate("officeId", "name code")
    .populate("createdBy", "name")
    .lean<LeanDailyMilestone>();
  if (!doc) throw new NotFoundError(RESOURCE);
  return serializeDailyMilestone(doc);
}

function attachmentUrls(list: Attachment[]): string[] {
  return list.map((item) => item.fileUrl);
}

/**
 * Files can hang off the record itself, one of its updates or one of its milestones. Authorization and
 * Cloudinary clean-up must cover all of them, so they are flattened before every check.
 */
interface RecordAttachments {
  photos: Attachment[];
  documents: Attachment[];
  dailyUpdates: { photos: Attachment[]; documents: Attachment[] }[];
  milestones: { photos: Attachment[]; documents: Attachment[] }[];
}

function allPhotos(record: RecordAttachments): Attachment[] {
  return [
    ...record.photos,
    ...record.dailyUpdates.flatMap((update) => update.photos),
    ...record.milestones.flatMap((milestone) => milestone.photos),
  ];
}

/** Flatten the file lists of a stored record (any field the query did not select reads as empty). */
function storedAttachments(raw: {
  photos?: unknown;
  documents?: unknown;
  dailyUpdates?: unknown;
  milestones?: unknown;
}): RecordAttachments {
  return {
    photos: serializeAttachments(raw.photos),
    documents: serializeAttachments(raw.documents),
    dailyUpdates: serializeDailyUpdates(raw),
    milestones: serializeMilestones(raw.milestones),
  };
}

function allDocuments(record: RecordAttachments): Attachment[] {
  return [
    ...record.documents,
    ...record.dailyUpdates.flatMap((update) => update.documents),
    ...record.milestones.flatMap((milestone) => milestone.documents),
  ];
}

/** Past the last page -> the last page (like listOffices). */
function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
}

/** Paginated daily records, newest first. Normal users only ever see their own office. */
export async function listDailyMilestones(
  user: CurrentUser,
  rawQuery: unknown,
): Promise<Paginated<DailyMilestoneDTO>> {
  const query = dailyMilestoneListQuerySchema.parse(rawQuery);
  const filter = buildScopeFilter(user, query);
  if (query.q) {
    const pattern = containsRegex(query.q);
    filter.$or = [
      { "dailyUpdates.title": pattern },
      { "dailyUpdates.description": pattern },
      // Records written before daily updates became a list.
      { "dailyUpdate.title": pattern },
      { "dailyUpdate.description": pattern },
      { "milestones.title": pattern },
      { "milestones.description": pattern },
      { "milestones.remarks": pattern },
    ];
  }

  await connectDB();
  // strictQuery would drop the legacy `dailyUpdate.*` conditions above, hiding older records from search.
  const total = await DailyMilestone.countDocuments(filter).setOptions({ strictQuery: false });
  const page = clampPage(query.page, total, query.pageSize);
  const { skip, limit } = paginationWindow(page, query.pageSize);
  const docs = await DailyMilestone.find(filter)
    .setOptions({ strictQuery: false })
    .select(RECORD_FIELDS)
    .populate("officeId", "name code")
    .populate("createdBy", "name")
    // Index-aligned: { date: -1, _id: -1 }.
    .sort({ date: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .lean<LeanDailyMilestone[]>();

  return toPaginated(docs.map(serializeDailyMilestone), total, page, query.pageSize);
}

interface MilestoneAggregateRow {
  _id: Types.ObjectId;
  date: Date;
  index: number;
  milestone: { title?: string; description?: string; remarks?: string };
  office: { _id: Types.ObjectId; name: string; code: string } | null;
}

/** Paginated individual milestones across daily records (same scope/date filters), newest first. */
export async function listMilestones(
  user: CurrentUser,
  rawQuery: unknown,
): Promise<Paginated<MilestoneListItem>> {
  const query = dailyMilestoneListQuerySchema.parse(rawQuery);
  const filter = buildScopeFilter(user, query);
  filter["milestones.0"] = { $exists: true };

  let keywordMatch: Record<string, unknown> | null = null;
  if (query.q) {
    const pattern = containsRegex(query.q);
    filter.$or = [
      { "milestones.title": pattern },
      { "milestones.description": pattern },
      { "milestones.remarks": pattern },
    ];
    keywordMatch = {
      $or: [
        { "milestone.title": pattern },
        { "milestone.description": pattern },
        { "milestone.remarks": pattern },
      ],
    };
  }

  const buildPipeline = (page: number): PipelineStage[] => {
  const { skip, limit } = paginationWindow(page, query.pageSize);
  return [
    { $match: filter },
    { $project: { officeId: 1, date: 1, milestones: 1 } },
    { $unwind: { path: "$milestones", includeArrayIndex: "index" } },
    { $project: { officeId: 1, date: 1, index: 1, milestone: "$milestones" } },
    ...(keywordMatch ? [{ $match: keywordMatch }] : []),
    { $sort: { date: -1, _id: -1, index: 1 } },
    {
      $facet: {
        total: [{ $count: "count" }],
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: Office.collection.name,
              localField: "officeId",
              foreignField: "_id",
              as: "office",
            },
          },
          {
            $project: {
              date: 1,
              index: 1,
              milestone: 1,
              office: {
                $let: {
                  vars: { found: { $arrayElemAt: ["$office", 0] } },
                  in: {
                    $cond: [
                      { $ifNull: ["$$found", false] },
                      { _id: "$$found._id", name: "$$found.name", code: "$$found.code" },
                      null,
                    ],
                  },
                },
              },
            },
          },
        ],
      },
    },
  ];
  };

  type AggregateResult = { total: { count: number }[]; items: MilestoneAggregateRow[] };
  await connectDB();
  let page = query.page;
  let [result] = await DailyMilestone.aggregate<AggregateResult>(buildPipeline(page));
  let total = result?.total[0]?.count ?? 0;
  const clamped = clampPage(page, total, query.pageSize);
  if (clamped !== page) {
    // Requested page is past the last page: return the last page instead.
    page = clamped;
    [result] = await DailyMilestone.aggregate<AggregateResult>(buildPipeline(page));
    total = result?.total[0]?.count ?? 0;
  }
  const items = (result?.items ?? []).map((row): MilestoneListItem => ({
    recordId: String(row._id),
    index: Number(row.index),
    date: utcToBusinessDate(row.date),
    office: row.office ? { id: String(row.office._id), name: row.office.name, code: row.office.code } : null,
    title: row.milestone.title ?? "",
    description: row.milestone.description ?? "",
    remarks: row.milestone.remarks ?? "",
  }));

  return toPaginated(items, total, page, query.pageSize);
}

/** A single daily record. 404 for invalid/missing ids; 403 when it belongs to another office. */
export async function getDailyMilestone(user: CurrentUser, id: string): Promise<DailyMilestoneDTO> {
  if (!isObjectId(id)) throw new NotFoundError(RESOURCE);
  await connectDB();

  const record = await DailyMilestone.findById(id).select("officeId").lean<{ officeId: Types.ObjectId }>();
  if (!record) throw new NotFoundError(RESOURCE);
  assertRecordAccess(user, record);

  return loadRecordDto(id);
}

/**
 * Id of the record for an office and business date, or null. Normal users are always scoped to their
 * own office (another office → 403); admins must name an office (null/"all" → null).
 */
export async function findDailyMilestoneIdForDate(
  user: CurrentUser,
  officeId: string | null,
  date: string,
): Promise<string | null> {
  const scope = resolveReadOfficeScope(user, officeId);
  if (scope === null || !isObjectId(scope) || !isValidBusinessDate(date)) return null;

  await connectDB();
  const existing = await DailyMilestone.findOne({ officeId: scope, date: businessDateFilter(date) })
    .select("_id")
    .lean<{ _id: Types.ObjectId }>();
  return existing ? String(existing._id) : null;
}

/** Create the daily record for an office and date. Duplicates → 409 with `details.existingId`. */
export async function createDailyMilestone(user: CurrentUser, rawInput: unknown): Promise<DailyMilestoneDTO> {
  const input = dailyMilestoneInputSchema.parse(rawInput);
  const officeId = resolveWriteOfficeId(user, input.officeId);

  await connectDB();
  await requireActiveOffice(officeId);
  assertAllowedAttachments(officeId, allPhotos(input), allDocuments(input));

  const date = businessDateToUtc(input.date);
  const existingId = await findRecordIdFor(officeId, date);
  if (existingId) throw duplicateError(existingId);

  let createdId: Types.ObjectId;
  try {
    const created = await DailyMilestone.create({
      officeId,
      date,
      dailyUpdates: input.dailyUpdates,
      milestones: input.milestones,
      photos: input.photos,
      documents: input.documents,
      createdBy: user.id,
    });
    createdId = created._id;
  } catch (error) {
    // Lost a race with a concurrent create for the same office/date (unique index).
    if (isDuplicateKeyError(error)) throw duplicateError(await findRecordIdFor(officeId, date));
    throw error;
  }

  return loadRecordDto(createdId);
}

/**
 * Update a daily record (the office cannot change). Optimistic concurrency: `expectedUpdatedAt` must equal the
 * stored `updatedAt`, otherwise 409 CONFLICT (no `existingId`) and nothing is written or deleted. Afterwards,
 * files removed from the client's snapshot are deleted when they live in the record's own office folder.
 */
export async function updateDailyMilestone(
  user: CurrentUser,
  id: string,
  rawInput: unknown,
): Promise<DailyMilestoneDTO> {
  if (!isObjectId(id)) throw new NotFoundError(RESOURCE);
  const input = dailyMilestoneUpdateSchema.parse(rawInput);
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);

  await connectDB();
  const doc = await DailyMilestone.findById(id).select(RECORD_FIELDS);
  if (!doc) throw new NotFoundError(RESOURCE);
  assertRecordAccess(user, doc);
  if (doc.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictError(STALE_RECORD_MESSAGE);

  const recordOfficeId = String(doc.officeId);
  const stored = storedAttachments(doc.toObject());
  const previousPhotos = allPhotos(stored);
  const previousDocuments = allDocuments(stored);
  const nextPhotos = allPhotos(input);
  const nextDocuments = allDocuments(input);
  // Files already on the record stay valid; newly added ones must be this office's uploads.
  const previousUrls = new Set([...attachmentUrls(previousPhotos), ...attachmentUrls(previousDocuments)]);
  assertAllowedAttachments(
    recordOfficeId,
    nextPhotos.filter((item) => !previousUrls.has(item.fileUrl)),
    nextDocuments.filter((item) => !previousUrls.has(item.fileUrl)),
  );

  const date = businessDateToUtc(input.date);
  if (doc.date.getTime() !== date.getTime()) {
    const existingId = await findRecordIdFor(doc.officeId, date, doc._id);
    if (existingId) throw duplicateError(existingId);
  }

  const fields = {
    date,
    dailyUpdates: input.dailyUpdates,
    milestones: input.milestones,
    photos: input.photos,
    documents: input.documents,
  };
  doc.set(fields);
  await doc.validate();

  let matched: number;
  try {
    // Conditional write: matches nothing when someone saved the record after the client loaded it.
    // updatedAt is set here (always later than the expected value) so two saves in the same millisecond
    // can never share a version.
    const updatedAt = new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1));
    const result = await DailyMilestone.updateOne(
      { _id: doc._id, updatedAt: expectedUpdatedAt },
      // $unset clears the pre-list `dailyUpdate` field when an older record is saved.
      { $set: { ...fields, updatedAt }, $unset: { dailyUpdate: "" } },
      // strict: false lets $unset clear `dailyUpdate`, which is no longer part of the schema.
      { timestamps: false, strict: false },
    );
    matched = result.matchedCount;
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateError(await findRecordIdFor(doc.officeId, date, doc._id));
    throw error;
  }
  if (matched === 0) throw new ConflictError(STALE_RECORD_MESSAGE);

  await deleteCloudinaryFiles(
    officeOwnedUrls(
      recordOfficeId,
      removedAttachmentUrls(previousPhotos, nextPhotos),
      removedAttachmentUrls(previousDocuments, nextDocuments),
    ),
  );

  return loadRecordDto(doc._id);
}

/** Delete a daily record and its files. Administrators only (spec §5). */
export async function deleteDailyMilestone(user: CurrentUser, id: string): Promise<void> {
  if (!isAdmin(user)) throw new ForbiddenError("Only administrators can delete daily records.");
  if (!isObjectId(id)) throw new NotFoundError(RESOURCE);

  await connectDB();
  const record = await DailyMilestone.findById(id)
    .select("officeId photos documents dailyUpdates dailyUpdate milestones")
    .lean<
      { _id: Types.ObjectId; officeId: Types.ObjectId } & Partial<
        Pick<LeanDailyMilestone, "photos" | "documents" | "dailyUpdates" | "dailyUpdate" | "milestones">
      >
    >();
  if (!record) throw new NotFoundError(RESOURCE);
  assertRecordAccess(user, record);

  const result = await DailyMilestone.deleteOne({ _id: record._id });
  if (result.deletedCount === 0) throw new NotFoundError(RESOURCE);

  // Never delete files outside the record's own office folders.
  await deleteCloudinaryFiles(
    officeOwnedUrls(
      String(record.officeId),
      attachmentUrls(allPhotos(storedAttachments(record))),
      attachmentUrls(allDocuments(storedAttachments(record))),
    ),
  );
}
