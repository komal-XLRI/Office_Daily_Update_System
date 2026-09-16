import "server-only";

import { Types } from "mongoose";

import { connectDB } from "@/lib/db/connect";
import { ForbiddenError } from "@/lib/errors";
import { isAdmin, resolveReadOfficeScope } from "@/lib/permissions/scope";
import {
  serializeDailyMilestone,
  serializeVisitor,
  type LeanDailyMilestone,
  type LeanVisitor,
} from "@/lib/serializers";
import {
  addDays,
  businessDateFilter,
  businessDateRangeFilter,
  businessDateToUtc,
  currentMonth,
  monthRange,
  todayBusinessDate,
  utcToBusinessDate,
} from "@/lib/utils/dates";
import { isObjectId } from "@/lib/validation/common";
import { DailyMilestone, Office, User, Visitor } from "@/models";
import type { CurrentUser, DailyMilestoneDTO, OfficeRef, VisitorDTO } from "@/types";

/**
 * Dashboard data (spec §14). Admin: all offices or one selected office. User: only their own office.
 * Queries are counts, grouped aggregates and small limited lists on indexed fields (officeId, date).
 */

export const RECENT_MILESTONES_LIMIT = 8;
export const RECENT_RECORDS_LIMIT = 5;
export const TODAYS_VISITORS_LIMIT = 10;

export interface AdminDashboardStats {
  totalOffices: number;
  activeOffices: number;
  /** Active users of the selected office, or all active users. */
  activeUsers: number;
  /** Daily records for today in scope. */
  todaysDailyUpdates: number;
  /** Visitors for today in scope. */
  todaysVisitors: number;
}

export interface RecentMilestoneItem {
  recordId: string;
  /** Business date, "YYYY-MM-DD". */
  date: string;
  office: OfficeRef | null;
  title: string;
  remarks: string;
}

export interface OfficeActivityRow {
  office: OfficeRef;
  todayRecordId: string | null;
  todaysVisitors: number;
  todaysMilestones: number;
  recordsThisMonth: number;
}

export interface AdminDashboardData {
  /** Business date, "YYYY-MM-DD". */
  today: string;
  /** Current month, "YYYY-MM". */
  month: string;
  /** null = All Offices. */
  selectedOffice: OfficeRef | null;
  stats: AdminDashboardStats;
  recentMilestones: RecentMilestoneItem[];
  officeActivity: OfficeActivityRow[];
}

export interface RecentRecordItem {
  id: string;
  /** Business date, "YYYY-MM-DD". */
  date: string;
  title: string;
  milestoneCount: number;
}

export interface UserDashboardData {
  /** Business date, "YYYY-MM-DD". */
  today: string;
  /** Current month, "YYYY-MM". */
  month: string;
  office: OfficeRef;
  todayRecord: DailyMilestoneDTO | null;
  /** Today's visitors sorted by arrival (at most TODAYS_VISITORS_LIMIT). */
  todaysVisitors: VisitorDTO[];
  todaysVisitorCount: number;
  recentRecords: RecentRecordItem[];
}

interface LeanOfficeRef {
  _id: Types.ObjectId;
  name: string;
  code: string;
  isActive?: boolean;
}

interface CountByOfficeRow {
  _id: Types.ObjectId;
  count: number;
}

interface TodayRecordRow {
  _id: Types.ObjectId;
  officeId: Types.ObjectId;
  milestoneCount: number;
}

interface RecentMilestoneRow {
  _id: Types.ObjectId;
  date: Date;
  title?: string | null;
  remarks?: string | null;
  office?: LeanOfficeRef | null;
}

interface RecentRecordRow {
  _id: Types.ObjectId;
  date: Date;
  title?: string | null;
  milestoneCount: number;
}

const MILESTONE_COUNT = { $size: { $ifNull: ["$milestones", []] } };

const DAILY_MILESTONE_FIELDS = "officeId date dailyUpdate milestones photos documents createdBy createdAt updatedAt";
const VISITOR_FIELDS =
  "officeId name purpose date timeArrived timeDeparted importance photos documents remarks createdBy createdAt updatedAt";

function toOfficeRef(office: LeanOfficeRef): OfficeRef {
  return { id: String(office._id), name: office.name, code: office.code };
}

function countsByOffice(rows: CountByOfficeRow[]): Map<string, number> {
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

/** Stored business dates on or before `date` (so future-dated records never appear as "recent"). */
function onOrBefore(date: string): { $lt: Date } {
  return { $lt: businessDateToUtc(addDays(date, 1)) };
}

/**
 * Admin dashboard. `rawOfficeId` is the untrusted `officeId` query param: a valid id of an existing office
 * selects that office; anything else (missing, "all", malformed, unknown) means All Offices.
 */
export async function getAdminDashboard(
  user: CurrentUser,
  rawOfficeId?: string | null,
): Promise<AdminDashboardData> {
  if (!isAdmin(user)) throw new ForbiddenError("Administrator access is required.");
  await connectDB();

  const now = new Date();
  const today = todayBusinessDate(now);
  const month = currentMonth(now);

  const requestedOfficeId = resolveReadOfficeScope(user, isObjectId(rawOfficeId) ? rawOfficeId : null);
  let selectedOffice: OfficeRef | null = null;
  if (requestedOfficeId) {
    const office = await Office.findById(requestedOfficeId).select("name code").lean<LeanOfficeRef>();
    selectedOffice = office ? toOfficeRef(office) : null;
  }

  const scopeObjectId = selectedOffice ? new Types.ObjectId(selectedOffice.id) : null;
  // Aggregation $match does not cast strings, so always filter with a real ObjectId.
  const officeMatch = scopeObjectId ? { officeId: scopeObjectId } : {};
  const todayFilter = businessDateFilter(today);
  const { from: monthStart, to: monthEnd } = monthRange(month);

  const [
    totalOffices,
    activeOffices,
    activeUsers,
    activityOffices,
    todayRecords,
    todayVisitorCounts,
    monthRecordCounts,
    milestoneRows,
  ] = await Promise.all([
    Office.countDocuments({}),
    Office.countDocuments({ isActive: true }),
    User.countDocuments({ isActive: true, ...officeMatch }),
    // A selected office is always listed (even if inactive); All Offices lists active offices in seed order.
    Office.find(scopeObjectId ? { _id: scopeObjectId } : { isActive: true })
      .select("name code")
      .sort({ _id: 1 })
      .lean<LeanOfficeRef[]>(),
    DailyMilestone.aggregate<TodayRecordRow>([
      { $match: { ...officeMatch, date: todayFilter } },
      { $project: { officeId: 1, milestoneCount: MILESTONE_COUNT } },
    ]),
    Visitor.aggregate<CountByOfficeRow>([
      { $match: { ...officeMatch, date: todayFilter } },
      { $group: { _id: "$officeId", count: { $sum: 1 } } },
    ]),
    DailyMilestone.aggregate<CountByOfficeRow>([
      { $match: { ...officeMatch, date: businessDateRangeFilter(monthStart, monthEnd) } },
      { $group: { _id: "$officeId", count: { $sum: 1 } } },
    ]),
    DailyMilestone.aggregate<RecentMilestoneRow>([
      { $match: { ...officeMatch, date: onOrBefore(today), "milestones.0": { $exists: true } } },
      // Sort on the indexed date only so MongoDB can stop after the first few matching records.
      { $sort: { date: -1 } },
      { $limit: RECENT_MILESTONES_LIMIT },
      {
        $project: {
          officeId: 1,
          date: 1,
          milestones: {
            $map: {
              input: { $slice: ["$milestones", RECENT_MILESTONES_LIMIT] },
              as: "milestone",
              in: { title: "$$milestone.title", remarks: "$$milestone.remarks" },
            },
          },
        },
      },
      { $unwind: "$milestones" },
      { $limit: RECENT_MILESTONES_LIMIT },
      {
        $lookup: {
          from: Office.collection.collectionName,
          localField: "officeId",
          foreignField: "_id",
          pipeline: [{ $project: { name: 1, code: 1 } }],
          as: "office",
        },
      },
      {
        $project: {
          date: 1,
          title: "$milestones.title",
          remarks: "$milestones.remarks",
          office: { $first: "$office" },
        },
      },
    ]),
  ]);

  const todayRecordByOffice = new Map(todayRecords.map((record) => [String(record.officeId), record]));
  const visitorsByOffice = countsByOffice(todayVisitorCounts);
  const recordsThisMonthByOffice = countsByOffice(monthRecordCounts);

  const officeActivity: OfficeActivityRow[] = activityOffices.map((office) => {
    const officeId = String(office._id);
    const record = todayRecordByOffice.get(officeId);
    return {
      office: toOfficeRef(office),
      todayRecordId: record ? String(record._id) : null,
      todaysVisitors: visitorsByOffice.get(officeId) ?? 0,
      todaysMilestones: record?.milestoneCount ?? 0,
      recordsThisMonth: recordsThisMonthByOffice.get(officeId) ?? 0,
    };
  });

  return {
    today,
    month,
    selectedOffice,
    stats: {
      totalOffices,
      activeOffices,
      activeUsers,
      todaysDailyUpdates: todayRecords.length,
      todaysVisitors: todayVisitorCounts.reduce((sum, row) => sum + row.count, 0),
    },
    recentMilestones: milestoneRows.map((row) => ({
      recordId: String(row._id),
      date: utcToBusinessDate(row.date),
      office: row.office ? toOfficeRef(row.office) : null,
      title: row.title ?? "",
      remarks: row.remarks ?? "",
    })),
    officeActivity,
  };
}

/** Normal-user dashboard: strictly the user's own office (never a client-supplied office). */
export async function getUserDashboard(user: CurrentUser): Promise<UserDashboardData> {
  if (isAdmin(user)) throw new ForbiddenError("The office dashboard is only available to office users.");
  const officeId = resolveReadOfficeScope(user);
  if (!isObjectId(officeId)) throw new ForbiddenError("Your account is not assigned to an office.");
  await connectDB();

  const now = new Date();
  const today = todayBusinessDate(now);
  const month = currentMonth(now);
  const officeObjectId = new Types.ObjectId(officeId);
  const todayFilter = businessDateFilter(today);

  const [officeDoc, recordDoc, visitorDocs, todaysVisitorCount, recentRows] = await Promise.all([
    Office.findById(officeObjectId).select("name code isActive").lean<LeanOfficeRef>(),
    DailyMilestone.findOne({ officeId: officeObjectId, date: todayFilter })
      .select(DAILY_MILESTONE_FIELDS)
      .populate("createdBy", "name")
      .lean<LeanDailyMilestone>(),
    Visitor.find({ officeId: officeObjectId, date: todayFilter })
      .select(VISITOR_FIELDS)
      .sort({ timeArrived: 1, _id: 1 })
      .limit(TODAYS_VISITORS_LIMIT)
      .populate("createdBy", "name")
      .lean<LeanVisitor[]>(),
    Visitor.countDocuments({ officeId: officeObjectId, date: todayFilter }),
    DailyMilestone.aggregate<RecentRecordRow>([
      { $match: { officeId: officeObjectId, date: onOrBefore(today) } },
      { $sort: { date: -1 } },
      { $limit: RECENT_RECORDS_LIMIT },
      { $project: { date: 1, title: "$dailyUpdate.title", milestoneCount: MILESTONE_COUNT } },
    ]),
  ]);

  if (!officeDoc || officeDoc.isActive === false) {
    throw new ForbiddenError("Your office is inactive or no longer available.");
  }
  const office = toOfficeRef(officeDoc);

  return {
    today,
    month,
    office,
    todayRecord: recordDoc ? { ...serializeDailyMilestone(recordDoc), office } : null,
    todaysVisitors: visitorDocs.map((doc) => ({ ...serializeVisitor(doc), office })),
    todaysVisitorCount,
    recentRecords: recentRows.map((row) => ({
      id: String(row._id),
      date: utcToBusinessDate(row.date),
      title: row.title ?? "",
      milestoneCount: row.milestoneCount,
    })),
  };
}
