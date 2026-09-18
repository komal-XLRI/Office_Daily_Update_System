import type { IMPORTANCE_LEVELS, REPORT_FORMATS, REPORT_TYPES, ROLES } from "@/lib/constants";

export type Role = (typeof ROLES)[number];
export type Importance = (typeof IMPORTANCE_LEVELS)[number];
export type ReportType = (typeof REPORT_TYPES)[number];
export type ReportFormat = (typeof REPORT_FORMATS)[number];

/** File metadata stored on records. Binary content lives in Cloudinary. */
export interface Attachment {
  fileName: string;
  fileUrl: string;
}

export interface OfficeRef {
  id: string;
  name: string;
  code: string;
}

export interface OfficeOption extends OfficeRef {
  isActive: boolean;
}

export interface UserRef {
  id: string;
  name: string;
}

/**
 * The authenticated user, always loaded fresh from the database (never trusted from the cookie alone).
 * `officeId` is null only for admins without an office.
 */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation: string;
  officeId: string | null;
  officeName: string | null;
}

export interface OfficeDTO {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation: string;
  officeId: string | null;
  office: OfficeRef | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneDTO {
  title: string;
  description: string;
  remarks: string;
  photos: Attachment[];
  documents: Attachment[];
}

export interface DailyUpdateDTO {
  title: string;
  description: string;
  photos: Attachment[];
  documents: Attachment[];
}

export interface DailyMilestoneDTO {
  id: string;
  officeId: string;
  office: OfficeRef | null;
  /** Business date, "YYYY-MM-DD". */
  date: string;
  dailyUpdates: DailyUpdateDTO[];
  milestones: MilestoneDTO[];
  photos: Attachment[];
  documents: Attachment[];
  createdBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface VisitorDTO {
  id: string;
  officeId: string;
  office: OfficeRef | null;
  name: string;
  purpose: string;
  /** Business date, "YYYY-MM-DD". */
  date: string;
  /** ISO timestamp (UTC). Display with formatTime(). */
  timeArrived: string;
  /** ISO timestamp (UTC) or null when the visitor has not departed yet. */
  timeDeparted: string | null;
  importance: Importance;
  photos: Attachment[];
  documents: Attachment[];
  remarks: string;
  createdBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

export interface ApiErrorBody {
  error: ApiErrorPayload;
}

export interface ApiSuccessBody<T> {
  data: T;
}
