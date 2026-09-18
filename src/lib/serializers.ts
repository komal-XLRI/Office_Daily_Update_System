import { utcToBusinessDate } from "@/lib/utils/dates";
import type {
  Attachment,
  DailyMilestoneDTO,
  DailyUpdateDTO,
  Importance,
  MilestoneDTO,
  OfficeDTO,
  OfficeRef,
  Role,
  UserDTO,
  UserRef,
  VisitorDTO,
} from "@/types";

/**
 * Convert lean Mongoose documents into plain, client-safe DTOs.
 * Reference fields may be raw ObjectIds or populated `{ _id, name, ... }` objects.
 * Never add the users.otp sub-document to any DTO.
 */

type Stringable = { toString(): string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPopulated(value: unknown): value is { _id: Stringable; name?: unknown; code?: unknown } {
  return isRecord(value) && "_id" in value && "name" in value;
}

export function idOf(value: unknown): string {
  if (isPopulated(value)) return String(value._id);
  return String(value);
}

function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function serializeAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    fileName: String(item.fileName ?? ""),
    fileUrl: String(item.fileUrl ?? ""),
  }));
}

export function serializeOfficeRef(value: unknown): OfficeRef | null {
  if (!isPopulated(value)) return null;
  return { id: String(value._id), name: String(value.name ?? ""), code: String(value.code ?? "") };
}

export function serializeUserRef(value: unknown): UserRef | null {
  if (!isPopulated(value)) return null;
  return { id: String(value._id), name: String(value.name ?? "") };
}

export interface LeanOffice {
  _id: Stringable;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeOffice(doc: LeanOffice): OfficeDTO {
  return {
    id: String(doc._id),
    name: doc.name,
    code: doc.code,
    isActive: doc.isActive,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

export interface LeanUser {
  _id: Stringable;
  name: string;
  email: string;
  role: Role;
  designation?: string | null;
  officeId?: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeUser(doc: LeanUser): UserDTO {
  return {
    id: String(doc._id),
    name: doc.name,
    email: doc.email,
    role: doc.role,
    designation: doc.designation ?? "",
    officeId: doc.officeId ? idOf(doc.officeId) : null,
    office: serializeOfficeRef(doc.officeId),
    isActive: doc.isActive,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

export interface LeanVisitor {
  _id: Stringable;
  officeId: unknown;
  name: string;
  purpose: string;
  date: Date;
  timeArrived: Date;
  timeDeparted?: Date | null;
  importance: Importance;
  photos?: unknown;
  documents?: unknown;
  remarks?: string | null;
  createdBy?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeVisitor(doc: LeanVisitor): VisitorDTO {
  return {
    id: String(doc._id),
    officeId: idOf(doc.officeId),
    office: serializeOfficeRef(doc.officeId),
    name: doc.name,
    purpose: doc.purpose,
    date: utcToBusinessDate(doc.date),
    timeArrived: toIso(doc.timeArrived),
    timeDeparted: doc.timeDeparted ? toIso(doc.timeDeparted) : null,
    importance: doc.importance,
    photos: serializeAttachments(doc.photos),
    documents: serializeAttachments(doc.documents),
    remarks: doc.remarks ?? "",
    createdBy: serializeUserRef(doc.createdBy),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

export interface LeanDailyMilestone {
  _id: Stringable;
  officeId: unknown;
  date: Date;
  dailyUpdates?: unknown;
  /** Records written before daily updates became a list. Read only; never written. */
  dailyUpdate?: { title?: string | null; description?: string | null } | null;
  milestones?: unknown;
  photos?: unknown;
  documents?: unknown;
  createdBy?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A record always has at least one daily update. Records created before the field became a list still
 * hold a single `dailyUpdate` object, so those are read as a one-item list.
 */
export function serializeDailyUpdates(doc: {
  dailyUpdates?: unknown;
  dailyUpdate?: { title?: string | null; description?: string | null } | null;
}): DailyUpdateDTO[] {
  const list = Array.isArray(doc.dailyUpdates)
    ? doc.dailyUpdates.filter(isRecord).map((item) => ({
        title: String(item.title ?? ""),
        description: String(item.description ?? ""),
        photos: serializeAttachments(item.photos),
        documents: serializeAttachments(item.documents),
      }))
    : [];
  if (list.length > 0) return list;
  if (doc.dailyUpdate) {
    return [
      {
        title: doc.dailyUpdate.title ?? "",
        description: doc.dailyUpdate.description ?? "",
        photos: [],
        documents: [],
      },
    ];
  }
  return [];
}

export function serializeMilestones(value: unknown): MilestoneDTO[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    title: String(item.title ?? ""),
    description: String(item.description ?? ""),
    remarks: String(item.remarks ?? ""),
    photos: serializeAttachments(item.photos),
    documents: serializeAttachments(item.documents),
  }));
}

export function serializeDailyMilestone(doc: LeanDailyMilestone): DailyMilestoneDTO {
  return {
    id: String(doc._id),
    officeId: idOf(doc.officeId),
    office: serializeOfficeRef(doc.officeId),
    date: utcToBusinessDate(doc.date),
    dailyUpdates: serializeDailyUpdates(doc),
    milestones: serializeMilestones(doc.milestones),
    photos: serializeAttachments(doc.photos),
    documents: serializeAttachments(doc.documents),
    createdBy: serializeUserRef(doc.createdBy),
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}
