import "server-only";

import type { QueryFilter } from "mongoose";

import {
  assertAllowedAttachments,
  deleteCloudinaryFiles,
  officeOwnedUrls,
  removedAttachmentUrls,
} from "@/lib/cloudinary";
import { connectDB } from "@/lib/db/connect";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertRecordAccess,
  isAdmin,
  resolveReadOfficeScope,
  resolveWriteOfficeId,
} from "@/lib/permissions/scope";
import { serializeAttachments, serializeVisitor, type LeanVisitor } from "@/lib/serializers";
import { requireActiveOffice } from "@/lib/services/office-options";
import {
  addDays,
  businessDateFilter,
  businessDateRangeFilter,
  businessDateToUtc,
  combineDateAndTime,
} from "@/lib/utils/dates";
import { paginationWindow, toPaginated } from "@/lib/utils/pagination";
import { containsRegex } from "@/lib/utils/strings";
import { isObjectId } from "@/lib/validation/common";
import {
  visitorInputSchema,
  visitorListQuerySchema,
  visitorUpdateSchema,
  type VisitorInput,
} from "@/lib/validation/visitor";
import { Visitor, type IVisitor } from "@/models/Visitor";
import type { CurrentUser, Paginated, VisitorDTO } from "@/types";

/**
 * Visitor management (spec §7.3, §16, §21, §39, §53).
 * Every function authorizes against the caller's role and office:
 *   admin → visitors of every office; user → only visitors of user.officeId.
 */

const VISITOR_FIELDS =
  "officeId name purpose date timeArrived timeDeparted importance photos documents remarks createdBy createdAt updatedAt";

const RANGE_ERROR = "The To date cannot be before the From date.";
const OFFICE_IMMUTABLE_ERROR = "The office of an existing visitor cannot be changed.";
export const STALE_RECORD_MESSAGE = "This record was changed by someone else. Reload to see the latest version.";

function findVisitorForDisplay(id: string) {
  return Visitor.findById(id)
    .select(VISITOR_FIELDS)
    .populate("officeId", "name code")
    .populate("createdBy", "name")
    .lean<LeanVisitor>();
}

/** Form values ("YYYY-MM-DD" + "HH:mm" in APP_TIMEZONE) → stored values (UTC midnight + real instants). */
function toStoredFields(input: Omit<VisitorInput, "officeId">) {
  return {
    name: input.name,
    purpose: input.purpose,
    date: businessDateToUtc(input.date),
    timeArrived: combineDateAndTime(input.date, input.timeArrived),
    timeDeparted: input.timeDeparted ? combineDateAndTime(input.date, input.timeDeparted) : null,
    importance: input.importance,
    photos: input.photos,
    documents: input.documents,
    remarks: input.remarks,
  };
}

/**
 * A visitor's office is fixed once recorded. Sending no officeId (or the record's own) is fine.
 * - Normal user naming another office → 403 Forbidden (a client-supplied office is never used, spec §6).
 * - Admin naming another office → 400 with a field error. Admins may access every office, but moving a
 *   record between offices is deliberately not part of editing (it would silently re-scope the record
 *   and its attachments), so the request is refused rather than ignored.
 */
function assertOfficeUnchanged(user: CurrentUser, recordOfficeId: string, requestedOfficeId?: string): void {
  if (!requestedOfficeId || requestedOfficeId.toLowerCase() === recordOfficeId.toLowerCase()) return;
  if (!isAdmin(user)) throw new ForbiddenError("You cannot move a visitor to another office.");
  throw new ValidationError(OFFICE_IMMUTABLE_ERROR, { officeId: [OFFICE_IMMUTABLE_ERROR] });
}

async function loadVisitorDTO(id: string): Promise<VisitorDTO> {
  const doc = await findVisitorForDisplay(id);
  if (!doc) throw new NotFoundError("Visitor");
  return serializeVisitor(doc);
}

/** Paginated visitor list, newest first, scoped to the caller's office (admins: all or a chosen office). */
export async function listVisitors(user: CurrentUser, rawQuery: unknown): Promise<Paginated<VisitorDTO>> {
  const query = visitorListQuerySchema.parse(rawQuery);
  const officeScope = resolveReadOfficeScope(user, query.officeId);

  const filter: QueryFilter<IVisitor> = {};
  if (officeScope) filter.officeId = officeScope;

  if (query.date) {
    filter.date = businessDateFilter(query.date);
  } else if (query.from && query.to) {
    if (query.from > query.to) throw new ValidationError(RANGE_ERROR, { to: [RANGE_ERROR] });
    filter.date = businessDateRangeFilter(query.from, query.to);
  } else if (query.from) {
    filter.date = { $gte: businessDateToUtc(query.from) };
  } else if (query.to) {
    filter.date = { $lt: businessDateToUtc(addDays(query.to, 1)) };
  }

  if (query.q) {
    const keyword = containsRegex(query.q);
    filter.$or = [{ name: keyword }, { purpose: keyword }];
  }
  if (query.name) filter.name = containsRegex(query.name);
  if (query.purpose) filter.purpose = containsRegex(query.purpose);
  if (query.importance) filter.importance = query.importance;

  await connectDB();
  const total = await Visitor.countDocuments(filter);
  // Past the last page → the last page (never an empty "Showing 41–20 of 20").
  const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
  const { skip, limit } = paginationWindow(page, query.pageSize);
  const docs = await Visitor.find(filter)
    .select(VISITOR_FIELDS)
    .populate("officeId", "name code")
    .populate("createdBy", "name")
    // Index-aligned: { officeId, date, timeArrived, _id } and { date, timeArrived, _id } (all descending).
    .sort({ date: -1, timeArrived: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .lean<LeanVisitor[]>();

  return toPaginated(docs.map(serializeVisitor), total, page, query.pageSize);
}

/** One visitor. 404 when missing (or the id is malformed), 403 when it belongs to another office. */
export async function getVisitor(user: CurrentUser, id: string): Promise<VisitorDTO> {
  if (!isObjectId(id)) throw new NotFoundError("Visitor");
  await connectDB();
  const visitor = await loadVisitorDTO(id);
  assertRecordAccess(user, visitor);
  return visitor;
}

/** Create a visitor. Normal users always write to their own office; admins must choose an active office. */
export async function createVisitor(user: CurrentUser, rawInput: unknown): Promise<VisitorDTO> {
  const input = visitorInputSchema.parse(rawInput);
  const officeId = resolveWriteOfficeId(user, input.officeId);

  await connectDB();
  await requireActiveOffice(officeId);
  assertAllowedAttachments(officeId, input.photos, input.documents);

  const created = await Visitor.create({
    officeId,
    ...toStoredFields(input),
    createdBy: user.id,
  });

  return loadVisitorDTO(String(created._id));
}

/**
 * Replace a visitor's editable fields (the full form is sent). The office cannot be changed.
 * Optimistic concurrency: `expectedUpdatedAt` must equal the stored `updatedAt`, otherwise 409 CONFLICT and
 * nothing is written or deleted. Only files removed from the client's (current) snapshot are deleted, and
 * only when they live in the record's own office folder.
 */
export async function updateVisitor(user: CurrentUser, id: string, rawInput: unknown): Promise<VisitorDTO> {
  if (!isObjectId(id)) throw new NotFoundError("Visitor");
  const input = visitorUpdateSchema.parse(rawInput);
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);

  await connectDB();
  const visitor = await Visitor.findById(id).select(VISITOR_FIELDS);
  if (!visitor) throw new NotFoundError("Visitor");

  const recordOfficeId = String(visitor.officeId);
  assertRecordAccess(user, { officeId: recordOfficeId });
  assertOfficeUnchanged(user, recordOfficeId, input.officeId);
  if (visitor.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new ConflictError(STALE_RECORD_MESSAGE);

  const previousPhotos = serializeAttachments(visitor.photos);
  const previousDocuments = serializeAttachments(visitor.documents);
  // Files already on the record stay valid; newly added ones must be this office's uploads.
  const previousUrls = new Set([...previousPhotos, ...previousDocuments].map((item) => item.fileUrl));
  assertAllowedAttachments(
    recordOfficeId,
    input.photos.filter((item) => !previousUrls.has(item.fileUrl)),
    input.documents.filter((item) => !previousUrls.has(item.fileUrl)),
  );

  const fields = toStoredFields(input);
  visitor.set(fields);
  await visitor.validate();

  // Conditional write: fails when someone saved the record after the client loaded it.
  // updatedAt is set here (always later than the expected value) so two saves in the same millisecond
  // can never share a version.
  const updatedAt = new Date(Math.max(Date.now(), expectedUpdatedAt.getTime() + 1));
  const result = await Visitor.updateOne(
    { _id: visitor._id, updatedAt: expectedUpdatedAt },
    { $set: { ...fields, updatedAt } },
    { timestamps: false },
  );
  if (result.matchedCount === 0) throw new ConflictError(STALE_RECORD_MESSAGE);

  await deleteCloudinaryFiles(
    officeOwnedUrls(
      recordOfficeId,
      removedAttachmentUrls(previousPhotos, input.photos),
      removedAttachmentUrls(previousDocuments, input.documents),
    ),
  );

  return loadVisitorDTO(id);
}

/** Delete a visitor (admins: any office; users: their own office) and its Cloudinary files (best effort). */
export async function deleteVisitor(user: CurrentUser, id: string): Promise<void> {
  if (!isObjectId(id)) throw new NotFoundError("Visitor");

  await connectDB();
  const visitor = await Visitor.findById(id)
    .select("officeId photos documents")
    .lean<Pick<LeanVisitor, "_id" | "officeId" | "photos" | "documents">>();
  if (!visitor) throw new NotFoundError("Visitor");

  const recordOfficeId = String(visitor.officeId);
  assertRecordAccess(user, { officeId: recordOfficeId });

  const result = await Visitor.deleteOne({ _id: id, officeId: recordOfficeId });
  if (result.deletedCount === 0) throw new NotFoundError("Visitor");

  // Never delete files outside the record's own office folders.
  await deleteCloudinaryFiles(
    officeOwnedUrls(
      recordOfficeId,
      serializeAttachments(visitor.photos).map((file) => file.fileUrl),
      serializeAttachments(visitor.documents).map((file) => file.fileUrl),
    ),
  );
}
