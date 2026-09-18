import mongoose, { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { APP_NAME } from "@/lib/constants";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { generateReport } from "@/lib/reports/generate";
import type { ReportData, ReportOfficeSection } from "@/lib/reports/types";
import { combineDateAndTime } from "@/lib/utils/dates";
import { DailyMilestone, Visitor } from "@/models";
import type { CurrentUser } from "@/types";

import {
  createAuthorizationFixture,
  createDailyMilestone,
  createOffice,
  createVisitor,
  makeCurrentUser,
  registerTestDatabase,
  type IdLike,
} from "../setup/db";

// Reports (spec §17–§19, §59): Daily / Weekly (Mon–Sun) / Monthly / Custom, for Admin + All Offices,
// Admin + Single Office, User + Own Office; User + Other Office must be blocked. Reports are built
// from dailyMilestones + visitors only (no reports collection).

registerTestDatabase();

const cdn = (type: "image" | "raw", name: string) =>
  `https://res.cloudinary.com/odums-test/${type}/upload/v1757320000/office-daily-updates/${name}`;

async function daily(officeId: IdLike, date: string, milestones = 0, files: { photos?: number; documents?: number } = {}) {
  return createDailyMilestone({
    officeId,
    date,
    dailyUpdates: [{ title: `Update ${date}`, description: `Work done on ${date}` }],
    milestones: Array.from({ length: milestones }, (_, index) => ({
      title: `Milestone ${index + 1}`,
      description: "Details",
      remarks: index === 0 ? "On track" : "",
    })),
    photos: Array.from({ length: files.photos ?? 0 }, (_, index) => ({
      fileName: `photo-${index + 1}.jpg`,
      fileUrl: cdn("image", `photo-${date}-${index + 1}.jpg`),
    })),
    documents: Array.from({ length: files.documents ?? 0 }, (_, index) => ({
      fileName: `document-${index + 1}.pdf`,
      fileUrl: cdn("raw", `document-${date}-${index + 1}.pdf`),
    })),
  });
}

/**
 * Office A (active), Office B (active), Empty Office (active, no records), Old Office (inactive, one
 * record in the week) and Closed Office (inactive, no records), created in that order.
 * Test week: Monday 2026-09-07 – Sunday 2026-09-13 (2026-09-10 is a Thursday).
 */
async function seedReports() {
  const fixture = await createAuthorizationFixture();
  const emptyOffice = await createOffice({ name: "Empty Office", code: "EMPTY" });
  const oldOffice = await createOffice({ name: "Old Office", code: "OLD", isActive: false });
  const closedOffice = await createOffice({ name: "Closed Office", code: "CLOSED", isActive: false });
  const { officeA, officeB } = fixture;

  // Office A: records on and just outside the week and month boundaries (created out of order).
  for (const date of ["2026-09-14", "2026-08-31", "2026-09-07", "2026-10-01", "2026-09-13", "2026-09-06", "2026-09-01", "2026-09-30"]) {
    await daily(officeA, date);
  }
  await daily(officeA, "2026-09-10", 2, { photos: 1, documents: 2 });

  await daily(officeB, "2026-09-10", 1);
  await daily(officeB, "2026-09-13", 0);
  await daily(oldOffice, "2026-09-08", 1);

  const visitor = (officeId: IdLike, name: string, date: string, timeArrived: string, extra = {}) =>
    createVisitor({ officeId, name, date, timeArrived, purpose: `Purpose of ${name}`, ...extra });

  await visitor(officeA, "Just before week", "2026-09-06", "23:59");
  await visitor(officeA, "Afternoon", "2026-09-10", "15:00", {
    timeDeparted: "16:00",
    importance: "HIGH",
    remarks: "Signed MoU",
    documents: [{ fileName: "mou.pdf", fileUrl: cdn("raw", "mou.pdf") }],
  });
  // 00:30 IST on 7 Sep is 6 Sep 19:00 UTC (and 6 Sep noon in the test process timezone).
  await visitor(officeA, "Week start midnight", "2026-09-07", "00:30", { importance: "LOW" });
  await visitor(officeA, "Morning", "2026-09-10", "09:00", {
    photos: [{ fileName: "badge.png", fileUrl: cdn("image", "badge.png") }],
  });
  await visitor(officeA, "Week end late", "2026-09-13", "23:30");
  await visitor(officeA, "Next week", "2026-09-14", "00:00");
  await visitor(officeB, "B visitor", "2026-09-10", "11:00");

  return { ...fixture, emptyOffice, oldOffice, closedOffice };
}

const codes = (report: ReportData) => report.sections.map((section) => section.office.code);
const dates = (section: ReportOfficeSection | undefined) => section?.dailyRecords.map((record) => record.date);
const visitorNames = (section: ReportOfficeSection | undefined) => section?.visitors.map((visitor) => visitor.name);
const sectionFor = (report: ReportData, code: string) => report.sections.find((section) => section.office.code === code);

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected generateReport to fail");
}

describe("generateReport: report types and date ranges", () => {
  it("daily: only the selected business date", async () => {
    const { admin } = await seedReports();
    const report = await generateReport(admin, { type: "daily", date: "2026-09-10" });

    expect(codes(report)).toEqual(["OFFICE-A", "OFFICE-B", "EMPTY"]);
    const officeA = sectionFor(report, "OFFICE-A");
    expect(dates(officeA)).toEqual(["2026-09-10"]);
    expect(visitorNames(officeA)).toEqual(["Morning", "Afternoon"]); // sorted by arrival time
    expect(officeA?.totals).toEqual({ dailyRecords: 1, milestones: 2, visitors: 2, photos: 2, documents: 3 });
    expect(report.meta).toMatchObject({ type: "daily", typeLabel: "Daily Report", from: "2026-09-10", to: "2026-09-10", rangeLabel: "10 Sep 2026" });
  });

  it("weekly: the Monday–Sunday week containing the date, boundaries inclusive", async () => {
    const { admin } = await seedReports();
    const report = await generateReport(admin, { type: "weekly", date: "2026-09-10" });

    expect(report.meta).toMatchObject({
      type: "weekly",
      typeLabel: "Weekly Report",
      from: "2026-09-07",
      to: "2026-09-13",
      rangeLabel: "07 Sep 2026 – 13 Sep 2026",
    });
    const officeA = sectionFor(report, "OFFICE-A");
    expect(dates(officeA)).toEqual(["2026-09-07", "2026-09-10", "2026-09-13"]);
    expect(visitorNames(officeA)).toEqual(["Week start midnight", "Morning", "Afternoon", "Week end late"]);
    expect(dates(sectionFor(report, "OFFICE-B"))).toEqual(["2026-09-10", "2026-09-13"]);
  });

  it.each([
    ["2026-09-07", "Monday", "2026-09-07", "2026-09-13"],
    ["2026-09-13", "Sunday", "2026-09-07", "2026-09-13"],
    ["2026-09-06", "the previous Sunday", "2026-08-31", "2026-09-06"],
    ["2026-01-01", "a Thursday across the year boundary", "2025-12-29", "2026-01-04"],
  ])("weekly for %s (%s) covers %s – %s", async (date, _weekday, from, to) => {
    const { admin } = await seedReports();
    const report = await generateReport(admin, { type: "weekly", date, officeId: "all" });
    expect([report.meta.from, report.meta.to]).toEqual([from, to]);
    for (const section of report.sections) {
      for (const record of section.dailyRecords) expect(record.date >= from && record.date <= to).toBe(true);
    }
  });

  it("monthly: the whole calendar month, excluding the days either side", async () => {
    const { admin, officeA } = await seedReports();
    const report = await generateReport(admin, { type: "monthly", month: "2026-09", officeId: String(officeA._id) });

    expect(report.meta).toMatchObject({
      type: "monthly",
      typeLabel: "Monthly Report",
      from: "2026-09-01",
      to: "2026-09-30",
      rangeLabel: "September 2026",
    });
    expect(dates(report.sections[0])).toEqual([
      "2026-09-01",
      "2026-09-06",
      "2026-09-07",
      "2026-09-10",
      "2026-09-13",
      "2026-09-14",
      "2026-09-30",
    ]);
    expect(visitorNames(report.sections[0])).toEqual([
      "Just before week",
      "Week start midnight",
      "Morning",
      "Afternoon",
      "Week end late",
      "Next week",
    ]);
  });

  it("monthly: handles leap-year February", async () => {
    const { admin } = await seedReports();
    const report = await generateReport(admin, { type: "monthly", month: "2028-02" });
    expect(report.meta).toMatchObject({ from: "2028-02-01", to: "2028-02-29", rangeLabel: "February 2028" });
  });

  it("custom: from and to are inclusive", async () => {
    const { userA } = await seedReports();
    const report = await generateReport(userA, { type: "custom", from: "2026-09-07", to: "2026-09-13" });

    expect(report.meta).toMatchObject({
      type: "custom",
      typeLabel: "Custom Report",
      from: "2026-09-07",
      to: "2026-09-13",
      rangeLabel: "07 Sep 2026 – 13 Sep 2026",
    });
    expect(dates(report.sections[0])).toEqual(["2026-09-07", "2026-09-10", "2026-09-13"]);
    expect(visitorNames(report.sections[0])).not.toContain("Just before week");
    expect(visitorNames(report.sections[0])).not.toContain("Next week");
  });

  it("custom: a single day and a range spanning both month boundaries", async () => {
    const { userA } = await seedReports();
    const single = await generateReport(userA, { type: "custom", from: "2026-09-10", to: "2026-09-10" });
    expect(single.meta.rangeLabel).toBe("10 Sep 2026");
    expect(dates(single.sections[0])).toEqual(["2026-09-10"]);

    const wide = await generateReport(userA, { type: "custom", from: "2026-08-31", to: "2026-10-01" });
    expect(dates(wide.sections[0])).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-06",
      "2026-09-07",
      "2026-09-10",
      "2026-09-13",
      "2026-09-14",
      "2026-09-30",
      "2026-10-01",
    ]);
  });

  it("custom: accepts the maximum 366-day range", async () => {
    const { admin } = await seedReports();
    const report = await generateReport(admin, { type: "custom", from: "2025-10-01", to: "2026-10-01" });
    expect(report.totals.dailyRecords).toBe(12);
  });
});

describe("generateReport: Admin + All Offices", () => {
  it("has a section for every active office plus inactive offices with records, and overall totals", async () => {
    const { admin, officeA, officeB, emptyOffice, oldOffice } = await seedReports();
    const report = await generateReport(admin, { type: "weekly", date: "2026-09-10", officeId: "all" });

    expect(report.sections.map((section) => section.office)).toEqual([
      { id: String(officeA._id), name: "Office A", code: "OFFICE-A" },
      { id: String(officeB._id), name: "Office B", code: "OFFICE-B" },
      { id: String(emptyOffice._id), name: "Empty Office", code: "EMPTY" },
      { id: String(oldOffice._id), name: "Old Office", code: "OLD" },
    ]);
    expect(sectionFor(report, "EMPTY")).toMatchObject({
      dailyRecords: [],
      visitors: [],
      totals: { dailyRecords: 0, milestones: 0, visitors: 0, photos: 0, documents: 0 },
    });
    expect(dates(sectionFor(report, "OLD"))).toEqual(["2026-09-08"]);
    expect(sectionFor(report, "CLOSED")).toBeUndefined();

    expect(sectionFor(report, "OFFICE-A")?.totals).toEqual({ dailyRecords: 3, milestones: 2, visitors: 4, photos: 2, documents: 3 });
    expect(sectionFor(report, "OFFICE-B")?.totals).toEqual({ dailyRecords: 2, milestones: 1, visitors: 1, photos: 0, documents: 0 });
    expect(report.totals).toEqual({ dailyRecords: 6, milestones: 4, visitors: 5, photos: 2, documents: 3 });

    expect(report.meta).toMatchObject({ systemName: APP_NAME, officeLabel: "All Offices", officeId: null, generatedBy: "Admin" });
  });

  it("treats a missing officeId as all offices for admins", async () => {
    const { admin } = await seedReports();
    const withoutOffice = await generateReport(admin, { type: "daily", date: "2026-09-10" });
    const allOffices = await generateReport(admin, { type: "daily", date: "2026-09-10", officeId: "all" });
    expect(codes(withoutOffice)).toEqual(codes(allOffices));
    expect(withoutOffice.totals).toEqual(allOffices.totals);
  });

  it("omits inactive offices that have no records in the range", async () => {
    const { admin } = await seedReports();
    const report = await generateReport(admin, { type: "daily", date: "2026-09-08" });
    expect(codes(report)).toEqual(["OFFICE-A", "OFFICE-B", "EMPTY", "OLD"]);
    const other = await generateReport(admin, { type: "daily", date: "2026-09-09" });
    expect(codes(other)).toEqual(["OFFICE-A", "OFFICE-B", "EMPTY"]);
  });

  it("never silently drops records whose office document no longer exists", async () => {
    const { admin } = await seedReports();
    const orphanOfficeId = new Types.ObjectId();
    await daily(orphanOfficeId, "2026-09-11", 1);
    const report = await generateReport(admin, { type: "daily", date: "2026-09-11" });
    expect(report.sections.at(-1)).toMatchObject({
      office: { id: String(orphanOfficeId), name: "Unknown office", code: "" },
      totals: { dailyRecords: 1, milestones: 1 },
    });
  });
});

describe("generateReport: Admin + Single Office", () => {
  it("reports only the selected office", async () => {
    const { admin, officeB } = await seedReports();
    const report = await generateReport(admin, { type: "weekly", date: "2026-09-10", officeId: String(officeB._id) });
    expect(codes(report)).toEqual(["OFFICE-B"]);
    expect(report.meta).toMatchObject({ officeLabel: "Office B", officeId: String(officeB._id) });
    expect(report.totals).toEqual({ dailyRecords: 2, milestones: 1, visitors: 1, photos: 0, documents: 0 });
  });

  it("can report on an inactive office (history stays readable)", async () => {
    const { admin, oldOffice, closedOffice } = await seedReports();
    const old = await generateReport(admin, { type: "weekly", date: "2026-09-10", officeId: String(oldOffice._id) });
    expect(dates(old.sections[0])).toEqual(["2026-09-08"]);

    const closed = await generateReport(admin, { type: "daily", date: "2026-09-10", officeId: String(closedOffice._id) });
    expect(codes(closed)).toEqual(["CLOSED"]);
    expect(closed.totals).toEqual({ dailyRecords: 0, milestones: 0, visitors: 0, photos: 0, documents: 0 });
  });

  it("throws NotFoundError for an office that does not exist", async () => {
    const { admin } = await seedReports();
    const error = await captureError(
      generateReport(admin, { type: "daily", date: "2026-09-10", officeId: new Types.ObjectId().toHexString() }),
    );
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ status: 404, message: "Office not found." });
  });
});

describe("generateReport: User + Own Office", () => {
  it("is restricted to the user's office when no officeId is supplied", async () => {
    const { userA, officeA } = await seedReports();
    const report = await generateReport(userA, { type: "weekly", date: "2026-09-10" });
    expect(report.sections.map((section) => section.office)).toEqual([
      { id: String(officeA._id), name: "Office A", code: "OFFICE-A" },
    ]);
    expect(report.meta).toMatchObject({ officeLabel: "Office A", officeId: String(officeA._id), generatedBy: "User A" });
    expect(report.totals).toEqual({ dailyRecords: 3, milestones: 2, visitors: 4, photos: 2, documents: 3 });
  });

  it("accepts the user's own officeId explicitly", async () => {
    const { userB, officeB } = await seedReports();
    const report = await generateReport(userB, { type: "monthly", month: "2026-09", officeId: String(officeB._id) });
    expect(codes(report)).toEqual(["OFFICE-B"]);
    expect(dates(report.sections[0])).toEqual(["2026-09-10", "2026-09-13"]);
    expect(visitorNames(report.sections[0])).toEqual(["B visitor"]);
  });
});

describe("generateReport: User + Other Office is blocked (spec §18, §59)", () => {
  const queries = [
    { type: "daily", date: "2026-09-10" },
    { type: "weekly", date: "2026-09-10" },
    { type: "monthly", month: "2026-09" },
    { type: "custom", from: "2026-09-01", to: "2026-09-30" },
  ];

  it.each(queries)("rejects User A asking for Office B (%o)", async (query) => {
    const { userA, officeB } = await seedReports();
    const error = await captureError(generateReport(userA, { ...query, officeId: String(officeB._id) }));
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it.each(queries)("rejects User A asking for all offices (%o)", async (query) => {
    const { userA } = await seedReports();
    const error = await captureError(generateReport(userA, { ...query, officeId: "all" }));
    expect(error).toBeInstanceOf(ForbiddenError);
  });

  it("rejects a user asking for a non-existent office and a user without an office", async () => {
    const { userA, officeA } = await seedReports();
    await expect(
      generateReport(userA, { type: "daily", date: "2026-09-10", officeId: new Types.ObjectId().toHexString() }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const officeless: CurrentUser = { ...userA, officeId: null, officeName: null };
    await expect(generateReport(officeless, { type: "daily", date: "2026-09-10" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      generateReport(officeless, { type: "daily", date: "2026-09-10", officeId: String(officeA._id) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("generateReport: invalid queries", () => {
  it.each([
    ["no query at all", undefined],
    ["a non-object query", "type=daily"],
    ["daily without a date", {}],
    ["daily with an impossible date", { type: "daily", date: "2026-02-30" }],
    ["daily with a non-ISO date", { type: "daily", date: "10/09/2026" }],
    ["weekly without a date", { type: "weekly" }],
    ["monthly without a month", { type: "monthly" }],
    ["monthly with month 13", { type: "monthly", month: "2026-13" }],
    ["custom without dates", { type: "custom" }],
    ["custom without a To date", { type: "custom", from: "2026-09-01" }],
    ["custom with To before From", { type: "custom", from: "2026-09-10", to: "2026-09-01" }],
    ["custom longer than 366 days", { type: "custom", from: "2025-10-01", to: "2026-10-02" }],
    ["an unknown report type", { type: "yearly", date: "2026-09-10" }],
    ["a malformed officeId", { type: "daily", date: "2026-09-10", officeId: "not-an-id" }],
    ["an unknown format", { type: "daily", date: "2026-09-10", format: "docx" }],
  ])("throws ZodError for %s", async (_label, query) => {
    const { admin, userA } = await seedReports();
    expect(await captureError(generateReport(admin, query))).toBeInstanceOf(ZodError);
    expect(await captureError(generateReport(userA, query))).toBeInstanceOf(ZodError);
  });

  it("reports the offending field", async () => {
    const { admin } = await seedReports();
    const error = (await captureError(generateReport(admin, { type: "custom", from: "2026-09-10", to: "2026-09-01" }))) as ZodError;
    expect(error.issues).toEqual([expect.objectContaining({ path: ["to"], message: "To date must be on or after From date" })]);
  });
});

describe("generateReport: output shape", () => {
  it("returns plain JSON DTOs with IST-correct instants and no internal fields", async () => {
    const { admin } = await seedReports();
    const before = Date.now();
    const report = await generateReport(admin, { type: "weekly", date: "2026-09-10", format: "pdf" });
    const after = Date.now();

    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    const generatedAt = Date.parse(report.meta.generatedAt);
    expect(generatedAt).toBeGreaterThanOrEqual(before);
    expect(generatedAt).toBeLessThanOrEqual(after);

    const officeA = sectionFor(report, "OFFICE-A");
    const record = officeA?.dailyRecords.find((item) => item.date === "2026-09-10");
    expect(Object.keys(record ?? {}).sort()).toEqual([
      "dailyUpdates",
      "date",
      "documents",
      "id",
      "milestones",
      "photos",
    ]);
    expect(record).toMatchObject({
      dailyUpdates: [{ title: "Update 2026-09-10", description: "Work done on 2026-09-10" }],
      milestones: [
        { title: "Milestone 1", description: "Details", remarks: "On track" },
        { title: "Milestone 2", description: "Details", remarks: "" },
      ],
      photos: [{ fileName: "photo-1.jpg", fileUrl: cdn("image", "photo-2026-09-10-1.jpg") }],
    });

    const early = officeA?.visitors[0];
    expect(Object.keys(early ?? {}).sort()).toEqual([
      "date",
      "documents",
      "id",
      "importance",
      "name",
      "photos",
      "purpose",
      "remarks",
      "timeArrived",
      "timeDeparted",
    ]);
    expect(early).toMatchObject({
      name: "Week start midnight",
      date: "2026-09-07",
      timeArrived: "2026-09-06T19:00:00.000Z",
      timeDeparted: null,
      importance: "LOW",
    });
    const afternoon = officeA?.visitors.find((item) => item.name === "Afternoon");
    expect(afternoon).toMatchObject({
      timeArrived: combineDateAndTime("2026-09-10", "15:00").toISOString(),
      timeDeparted: combineDateAndTime("2026-09-10", "16:00").toISOString(),
      remarks: "Signed MoU",
      documents: [{ fileName: "mou.pdf", fileUrl: cdn("raw", "mou.pdf") }],
    });
  });

  it("is read-only: no documents or collections are created", async () => {
    const { admin } = await seedReports();
    const counts = async () => [await DailyMilestone.countDocuments(), await Visitor.countDocuments()];
    const before = await counts();
    await generateReport(admin, { type: "monthly", month: "2026-09" });
    expect(await counts()).toEqual(before);
    const collections = await mongoose.connection.db!.listCollections().toArray();
    expect(collections.map((collection) => collection.name).sort()).toEqual(["dailyMilestones", "offices", "users", "visitors"]);
  });

  it("uses the role and office from the CurrentUser, not user-supplied names", async () => {
    const { userADoc, officeA, officeB } = await seedReports();
    const renamed = makeCurrentUser({ ...userADoc.toObject(), name: "Renamed User" }, officeA);
    const report = await generateReport(renamed, { type: "daily", date: "2026-09-10" });
    expect(report.meta.generatedBy).toBe("Renamed User");
    await expect(
      generateReport(renamed, { type: "daily", date: "2026-09-10", officeId: String(officeB._id) }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
