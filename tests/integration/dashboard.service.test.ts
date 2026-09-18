import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import {
  getAdminDashboard,
  getUserDashboard,
  RECENT_MILESTONES_LIMIT,
  RECENT_RECORDS_LIMIT,
  TODAYS_VISITORS_LIMIT,
} from "@/lib/services/dashboard";
import { addDays, currentMonth, todayBusinessDate } from "@/lib/utils/dates";
import type { CurrentUser } from "@/types";

import {
  createAuthorizationFixture,
  createDailyMilestone as seedRecord,
  createOffice as seedOffice,
  createUser as seedUser,
  createVisitor as seedVisitor,
  makeCurrentUser,
  registerTestDatabase,
  type AuthorizationFixture,
} from "../setup/db";

// Spec §14 (Dashboard), §6 and §56 (Authorization). "Today" is the business date in Asia/Kolkata (§36);
// the suite runs with TZ=America/Los_Angeles so a local-time or UTC "today" would be caught.

registerTestDatabase();

let fx: AuthorizationFixture;

beforeEach(async () => {
  fx = await createAuthorizationFixture();
});

afterEach(() => {
  vi.useRealTimers();
});

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail");
}

async function expectForbidden(promise: Promise<unknown>): Promise<void> {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(ForbiddenError);
  expect(error).toMatchObject({ status: 403, code: "FORBIDDEN" });
}

const ms = (title: string, remarks = "") => ({ title, description: "", remarks });

describe("authorization", () => {
  it("forbids normal users from the admin dashboard, whatever office they ask for", async () => {
    await expectForbidden(getAdminDashboard(fx.userA));
    await expectForbidden(getAdminDashboard(fx.userA, String(fx.officeA._id)));
    await expectForbidden(getAdminDashboard(fx.userA, String(fx.officeB._id)));
    await expectForbidden(getAdminDashboard(fx.userB, "all"));
  });

  it("keeps administrators on the admin dashboard and rejects users without an active office", async () => {
    await expectForbidden(getUserDashboard(fx.admin));

    const orphan: CurrentUser = { ...fx.userA, officeId: null, officeName: null };
    await expectForbidden(getUserDashboard(orphan));

    const closed = await seedOffice({ name: "Closed", code: "CLOSED", isActive: false });
    const staleUser = makeCurrentUser(await seedUser({ officeId: closed }), closed);
    await expectForbidden(getUserDashboard(staleUser));

    const ghostOffice: CurrentUser = { ...fx.userA, officeId: new Types.ObjectId().toHexString() };
    await expectForbidden(getUserDashboard(ghostOffice));
  });
});

describe("getAdminDashboard (records dated todayBusinessDate())", () => {
  let today: string;
  let yesterday: string;
  let recordAToday: string;
  let recordBToday: string;

  beforeEach(async () => {
    today = todayBusinessDate();
    yesterday = addDays(today, -1);

    const closed = await seedOffice({ name: "Closed Office", code: "CLOSED", isActive: false });
    await seedUser({ officeId: fx.officeA, name: "Inactive A", isActive: false });
    await seedUser({ officeId: fx.officeA, name: "Second A" });

    recordAToday = String(
      (await seedRecord({ officeId: fx.officeA, date: today, milestones: [ms("A today 1"), ms("A today 2")] }))._id,
    );
    recordBToday = String(
      (await seedRecord({ officeId: fx.officeB, date: today, milestones: [ms("B today 1", "remark B")] }))._id,
    );
    await seedRecord({ officeId: fx.officeA, date: yesterday, milestones: [ms("A yesterday")] });
    await seedRecord({ officeId: closed, date: today, milestones: [] });
    // A future-dated record never counts as today or recent.
    await seedRecord({ officeId: fx.officeA, date: addDays(today, 2), milestones: [ms("A future")] });

    await seedVisitor({ officeId: fx.officeA, date: today });
    await seedVisitor({ officeId: fx.officeA, date: today, timeArrived: "23:30" });
    await seedVisitor({ officeId: fx.officeB, date: today, timeArrived: "00:15" });
    await seedVisitor({ officeId: fx.officeA, date: yesterday, timeArrived: "23:59" });
    await seedVisitor({ officeId: fx.officeB, date: addDays(today, 1), timeArrived: "00:00" });
  });

  it("counts every office for All Offices", async () => {
    const data = await getAdminDashboard(fx.admin);

    expect(data.today).toBe(today);
    expect(data.month).toBe(currentMonth());
    expect(data.selectedOffice).toBeNull();
    expect(data.stats).toEqual({
      totalOffices: 3,
      activeOffices: 2,
      activeUsers: 4, // Admin, User A, User B, Second A
      todaysDailyUpdates: 3, // A, B and the inactive office
      todaysVisitors: 3,
    });

    const yesterdayInMonth = yesterday.slice(0, 7) === today.slice(0, 7);
    // Active offices only, in creation order.
    expect(data.officeActivity).toEqual([
      {
        office: { id: String(fx.officeA._id), name: "Office A", code: "OFFICE-A" },
        todayRecordId: recordAToday,
        todaysVisitors: 2,
        todaysMilestones: 2,
        recordsThisMonth:
          1 + (yesterdayInMonth ? 1 : 0) + (addDays(today, 2).slice(0, 7) === today.slice(0, 7) ? 1 : 0),
      },
      {
        office: { id: String(fx.officeB._id), name: "Office B", code: "OFFICE-B" },
        todayRecordId: recordBToday,
        todaysVisitors: 1,
        todaysMilestones: 1,
        recordsThisMonth: 1,
      },
    ]);

    const titles = data.recentMilestones.map((item) => item.title);
    expect(titles.sort()).toEqual(["A today 1", "A today 2", "A yesterday", "B today 1"]);
    expect(titles).not.toContain("A future");
    const bMilestone = data.recentMilestones.find((item) => item.title === "B today 1");
    expect(bMilestone).toMatchObject({ recordId: recordBToday, date: today, remarks: "remark B", office: { name: "Office B" } });
  });

  it("limits every figure to the selected office", async () => {
    const data = await getAdminDashboard(fx.admin, String(fx.officeB._id));

    expect(data.selectedOffice).toEqual({ id: String(fx.officeB._id), name: "Office B", code: "OFFICE-B" });
    expect(data.stats).toEqual({
      totalOffices: 3,
      activeOffices: 2,
      activeUsers: 1,
      todaysDailyUpdates: 1,
      todaysVisitors: 1,
    });
    expect(data.officeActivity).toHaveLength(1);
    expect(data.officeActivity[0]).toMatchObject({
      office: { id: String(fx.officeB._id) },
      todayRecordId: recordBToday,
      todaysVisitors: 1,
      todaysMilestones: 1,
    });
    expect(data.recentMilestones.map((item) => item.title)).toEqual(["B today 1"]);

    const officeA = await getAdminDashboard(fx.admin, String(fx.officeA._id));
    expect(officeA.stats).toMatchObject({ activeUsers: 2, todaysDailyUpdates: 1, todaysVisitors: 2 });
    expect(officeA.recentMilestones.every((item) => item.office?.id === String(fx.officeA._id))).toBe(true);
  });

  it("treats 'all', malformed and unknown office ids as All Offices", async () => {
    for (const value of [undefined, null, "", "all", "office-b", new Types.ObjectId().toHexString()]) {
      const data = await getAdminDashboard(fx.admin, value);
      expect(data.selectedOffice).toBeNull();
      expect(data.stats.todaysDailyUpdates).toBe(3);
      expect(data.officeActivity).toHaveLength(2);
    }
  });

  it("still lists a selected inactive office", async () => {
    const closed = await seedOffice({ name: "Another Closed", code: "CLOSED-2", isActive: false });
    const data = await getAdminDashboard(fx.admin, String(closed._id));
    expect(data.selectedOffice?.code).toBe("CLOSED-2");
    expect(data.officeActivity).toEqual([
      {
        office: { id: String(closed._id), name: "Another Closed", code: "CLOSED-2" },
        todayRecordId: null,
        todaysVisitors: 0,
        todaysMilestones: 0,
        recordsThisMonth: 0,
      },
    ]);
  });
});

describe("recent milestones limit", () => {
  it(`returns at most ${RECENT_MILESTONES_LIMIT} milestones, newest records first`, async () => {
    const today = todayBusinessDate();
    for (let offset = 0; offset < 5; offset += 1) {
      const date = addDays(today, -offset);
      await seedRecord({ officeId: fx.officeA, date, milestones: [ms(`${date} a`), ms(`${date} b`), ms(`${date} c`)] });
    }
    const data = await getAdminDashboard(fx.admin);
    expect(data.recentMilestones).toHaveLength(RECENT_MILESTONES_LIMIT);
    expect(data.recentMilestones[0]?.date).toBe(today);
    expect(data.recentMilestones.map((item) => item.date)).toEqual(
      [...data.recentMilestones.map((item) => item.date)].sort().reverse(),
    );
  });
});

describe("'today' is computed in Asia/Kolkata", () => {
  // 2026-09-30T19:00Z is 2026-10-01 00:30 in Kolkata but still 30 Sep in UTC and in Los Angeles.
  const INSTANT = new Date("2026-09-30T19:00:00.000Z");

  beforeEach(async () => {
    await seedRecord({ officeId: fx.officeA, date: "2026-10-01", milestones: [ms("Kolkata today")], dailyUpdates: [{ title: "A Oct 1" }] });
    await seedRecord({ officeId: fx.officeA, date: "2026-09-30", milestones: [ms("UTC today")], dailyUpdates: [{ title: "A Sep 30" }] });
    await seedRecord({ officeId: fx.officeA, date: "2026-10-02", milestones: [ms("Tomorrow")], dailyUpdates: [{ title: "A Oct 2" }] });
    await seedRecord({ officeId: fx.officeB, date: "2026-09-30", milestones: [ms("B Sep 30")], dailyUpdates: [{ title: "B Sep 30" }] });

    await seedVisitor({ officeId: fx.officeA, date: "2026-10-01", name: "A Oct 1 visitor", timeArrived: "00:10" });
    await seedVisitor({ officeId: fx.officeA, date: "2026-09-30", name: "A Sep 30 visitor", timeArrived: "23:50" });
    await seedVisitor({ officeId: fx.officeB, date: "2026-10-01", name: "B Oct 1 visitor" });

    vi.setSystemTime(INSTANT);
  });

  it("uses the Kolkata date and month on the admin dashboard", async () => {
    const data = await getAdminDashboard(fx.admin);
    expect(data.today).toBe("2026-10-01");
    expect(data.month).toBe("2026-10");
    expect(data.stats).toMatchObject({ todaysDailyUpdates: 1, todaysVisitors: 2 });

    const [rowA, rowB] = data.officeActivity;
    expect(rowA).toMatchObject({ todaysVisitors: 1, todaysMilestones: 1, recordsThisMonth: 2 }); // Oct 1 + Oct 2
    expect(rowA?.todayRecordId).not.toBeNull();
    expect(rowB).toMatchObject({ todayRecordId: null, todaysVisitors: 1, todaysMilestones: 0, recordsThisMonth: 0 });

    expect(data.recentMilestones.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Kolkata today", "UTC today", "B Sep 30"]),
    );
    expect(data.recentMilestones.map((item) => item.title)).not.toContain("Tomorrow");
    expect(data.recentMilestones[0]).toMatchObject({ title: "Kolkata today", date: "2026-10-01" });
  });

  it("uses the Kolkata date on the user dashboard", async () => {
    const data = await getUserDashboard(fx.userA);
    expect(data.today).toBe("2026-10-01");
    expect(data.month).toBe("2026-10");
    expect(data.todayRecord?.dailyUpdates[0]?.title).toBe("A Oct 1");
    expect(data.todaysVisitors.map((visitor) => visitor.name)).toEqual(["A Oct 1 visitor"]);
    expect(data.todaysVisitorCount).toBe(1);
    expect(data.recentRecords.map((record) => [record.date, record.title])).toEqual([
      ["2026-10-01", "A Oct 1"],
      ["2026-09-30", "A Sep 30"],
    ]);
  });
});

describe("getUserDashboard", () => {
  it("returns only the user's own office data", async () => {
    const today = todayBusinessDate();

    const recordA = await seedRecord({
      officeId: fx.officeA,
      date: today,
      dailyUpdates: [{ title: "Office A today", description: "Alpha work" }],
      milestones: [ms("Alpha milestone 1"), ms("Alpha milestone 2")],
      createdBy: fx.userADoc,
    });
    await seedRecord({ officeId: fx.officeA, date: addDays(today, -1), dailyUpdates: [{ title: "Office A yesterday" }], milestones: [] });
    await seedVisitor({ officeId: fx.officeA, date: today, name: "Alpha late guest", timeArrived: "17:00" });
    await seedVisitor({ officeId: fx.officeA, date: today, name: "Alpha early guest", timeArrived: "09:00", createdBy: fx.userADoc });
    await seedVisitor({ officeId: fx.officeA, date: addDays(today, -1), name: "Alpha yesterday guest" });

    // Office B data on the same dates must never appear.
    const recordB = await seedRecord({
      officeId: fx.officeB,
      date: today,
      dailyUpdates: [{ title: "SECRET-B record", description: "SECRET-B description" }],
      milestones: [ms("SECRET-B milestone")],
    });
    await seedRecord({ officeId: fx.officeB, date: addDays(today, -1), dailyUpdates: [{ title: "SECRET-B older" }] });
    await seedVisitor({ officeId: fx.officeB, date: today, name: "SECRET-B guest", timeArrived: "08:00" });

    const data = await getUserDashboard(fx.userA);

    expect(data.today).toBe(today);
    expect(data.office).toEqual({ id: String(fx.officeA._id), name: "Office A", code: "OFFICE-A" });
    expect(data.todayRecord).toMatchObject({
      id: String(recordA._id),
      officeId: String(fx.officeA._id),
      office: { name: "Office A" },
      dailyUpdates: [{ title: "Office A today" }],
      createdBy: { id: fx.userA.id, name: "User A" },
    });
    expect(data.todayRecord?.milestones.map((item) => item.title)).toEqual(["Alpha milestone 1", "Alpha milestone 2"]);
    expect(data.todaysVisitors.map((visitor) => visitor.name)).toEqual(["Alpha early guest", "Alpha late guest"]);
    expect(data.todaysVisitors.every((visitor) => visitor.officeId === String(fx.officeA._id))).toBe(true);
    expect(data.todaysVisitorCount).toBe(2);
    expect(data.recentRecords.map((record) => record.title)).toEqual(["Office A today", "Office A yesterday"]);
    expect(data.recentRecords[0]).toMatchObject({ id: String(recordA._id), milestoneCount: 2 });

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("SECRET-B");
    expect(serialized).not.toContain(String(fx.officeB._id));
    expect(serialized).not.toContain(String(recordB._id));

    const dataB = await getUserDashboard(fx.userB);
    expect(dataB.todayRecord?.dailyUpdates[0]?.title).toBe("SECRET-B record");
    expect(dataB.todaysVisitors.map((visitor) => visitor.name)).toEqual(["SECRET-B guest"]);
    expect(JSON.stringify(dataB)).not.toContain("Alpha");
  });

  it("returns empty sections when the office has no activity today", async () => {
    await seedRecord({ officeId: fx.officeB, date: todayBusinessDate() });
    await seedVisitor({ officeId: fx.officeB, date: todayBusinessDate() });

    const data = await getUserDashboard(fx.userA);
    expect(data).toMatchObject({ todayRecord: null, todaysVisitors: [], todaysVisitorCount: 0, recentRecords: [] });
  });

  it(`caps today's visitors at ${TODAYS_VISITORS_LIMIT} and recent records at ${RECENT_RECORDS_LIMIT}`, async () => {
    const today = todayBusinessDate();
    for (let index = 0; index < TODAYS_VISITORS_LIMIT + 2; index += 1) {
      await seedVisitor({ officeId: fx.officeA, date: today, timeArrived: `${String(8 + index).padStart(2, "0")}:00` });
    }
    for (let offset = 0; offset < RECENT_RECORDS_LIMIT + 2; offset += 1) {
      await seedRecord({ officeId: fx.officeA, date: addDays(today, -offset) });
    }

    const data = await getUserDashboard(fx.userA);
    expect(data.todaysVisitors).toHaveLength(TODAYS_VISITORS_LIMIT);
    expect(data.todaysVisitorCount).toBe(TODAYS_VISITORS_LIMIT + 2);
    const arrivals = data.todaysVisitors.map((visitor) => visitor.timeArrived);
    expect(arrivals).toEqual([...arrivals].sort());
    expect(data.recentRecords).toHaveLength(RECENT_RECORDS_LIMIT);
    expect(data.recentRecords[0]?.date).toBe(today);
  });
});
