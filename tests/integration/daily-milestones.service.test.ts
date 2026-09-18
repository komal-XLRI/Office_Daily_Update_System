import { v2 as cloudinaryV2 } from "cloudinary";
import { Types } from "mongoose";
import { afterAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ZodError } from "zod";

import { cloudinaryRootFolder } from "@/lib/cloudinary";
import { resetServerEnvCache } from "@/lib/env";
import {
  ConflictError,
  ForbiddenError,
  InvalidOfficeError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  createDailyMilestone,
  deleteDailyMilestone,
  findDailyMilestoneIdForDate,
  getDailyMilestone,
  listDailyMilestones,
  listMilestones,
  updateDailyMilestone,
} from "@/lib/services/daily-milestones";
import { DailyMilestone } from "@/models";

import {
  createAuthorizationFixture,
  createDailyMilestone as seedRecord,
  createOffice,
  createUser,
  makeCurrentUser,
  registerTestDatabase,
  type AuthorizationFixture,
} from "../setup/db";

// Spec §5, §6, §15, §39, §56 (Authorization) and §57 (Daily record testing) at the service layer.

registerTestDatabase();

const CLOUD = "odums-daily-test";
const officeFolder = (office: { _id: unknown }) => String(office._id).toLowerCase();
const photoUrl = (name: string, office: { _id: unknown } = fx.officeA) =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1757320000/${cloudinaryRootFolder()}/${officeFolder(office)}/photos/${name}.jpg`;
const documentUrl = (name: string, office: { _id: unknown } = fx.officeA) =>
  `https://res.cloudinary.com/${CLOUD}/raw/upload/v1757320000/${cloudinaryRootFolder()}/${officeFolder(office)}/documents/${name}.pdf`;

let fx: AuthorizationFixture;
let deleteResources: MockInstance;

beforeEach(async () => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", "daily-test-cloudinary-secret");
  resetServerEnvCache();
  deleteResources = vi.spyOn(cloudinaryV2.api, "delete_resources").mockResolvedValue({} as never);

  fx = await createAuthorizationFixture();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
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

async function expectConflict(promise: Promise<unknown>, existingId: string): Promise<void> {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(ConflictError);
  expect(error).toMatchObject({ status: 409, code: "CONFLICT", details: { existingId } });
}

async function expectZodIssue(promise: Promise<unknown>, path: string): Promise<void> {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(ZodError);
  expect((error as ZodError).issues.map((issue) => issue.path.map(String).join("."))).toContain(path);
}

function recordInput(overrides: Record<string, unknown> = {}) {
  return {
    date: "2026-09-08",
    dailyUpdates: [{ title: "Admissions review", description: "Reviewed pending applications." }],
    milestones: [{ title: "Shortlist published", description: "", remarks: "" }],
    photos: [],
    documents: [],
    ...overrides,
  };
}

/** Edit payload with the record's current version (what an up-to-date edit form sends). */
async function editInput(id: string, overrides: Record<string, unknown> = {}) {
  const stored = Types.ObjectId.isValid(id) ? await DailyMilestone.findById(id).select("updatedAt").lean() : null;
  return {
    ...recordInput(overrides),
    expectedUpdatedAt: (stored?.updatedAt ?? new Date("2026-09-08T00:00:00.000Z")).toISOString(),
  };
}

const milestone = (title: string, description = "", remarks = "") => ({ title, description, remarks });

/**
 * Records saved before daily updates became a list still hold a single `dailyUpdate` object.
 * They must keep reading correctly, and saving one must migrate it to the list.
 */
describe("records written before daily updates became a list", () => {
  async function insertLegacyRecord(): Promise<string> {
    const id = new Types.ObjectId();
    await DailyMilestone.collection.insertOne({
      _id: id,
      officeId: fx.officeA._id,
      date: new Date("2026-09-08T00:00:00.000Z"),
      dailyUpdate: { title: "Legacy update", description: "Written before the change." },
      milestones: [],
      photos: [],
      documents: [],
      createdBy: new Types.ObjectId(fx.userA.id),
      createdAt: new Date("2026-09-08T04:00:00.000Z"),
      updatedAt: new Date("2026-09-08T04:00:00.000Z"),
      __v: 0,
    });
    return String(id);
  }

  it("reads the old single update as a one-item list", async () => {
    const id = await insertLegacyRecord();

    expect((await getDailyMilestone(fx.userA, id)).dailyUpdates).toEqual([
      { title: "Legacy update", description: "Written before the change.", photos: [], documents: [] },
    ]);
    const listed = await listDailyMilestones(fx.userA, { q: "legacy" });
    expect(listed.items[0]?.dailyUpdates[0]?.title).toBe("Legacy update");
  });

  it("replaces the old field when the record is saved", async () => {
    const id = await insertLegacyRecord();

    await updateDailyMilestone(
      fx.userA,
      id,
      await editInput(id, { dailyUpdates: [{ title: "Rewritten", description: "Now a list." }] }),
    );

    const stored = await DailyMilestone.collection.findOne({ _id: new Types.ObjectId(id) });
    expect(stored?.dailyUpdate).toBeUndefined();
    expect(stored?.dailyUpdates).toEqual([
      { title: "Rewritten", description: "Now a list.", photos: [], documents: [] },
    ]);
  });
});

describe("createDailyMilestone (spec §57)", () => {
  it("creates Office A + 08 Sep 2026 for User A (office forced from the session)", async () => {
    const record = await createDailyMilestone(fx.userA, recordInput());

    expect(record).toMatchObject({
      officeId: String(fx.officeA._id),
      office: { id: String(fx.officeA._id), name: "Office A", code: "OFFICE-A" },
      date: "2026-09-08",
      dailyUpdates: [{ title: "Admissions review", description: "Reviewed pending applications." }],
      milestones: [{ title: "Shortlist published", description: "", remarks: "" }],
      createdBy: { id: fx.userA.id, name: "User A" },
    });

    const stored = await DailyMilestone.findById(record.id).lean();
    expect(stored?.date.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(String(stored?.officeId)).toBe(String(fx.officeA._id));
  });

  it("stores several daily updates for one date, in order", async () => {
    const updates = [
      { title: "Morning briefing", description: "Reviewed the day's priorities." },
      { title: "Admissions review", description: "Reviewed pending applications." },
      { title: "Vendor meeting", description: "Discussed the canteen contract." },
    ];
    const record = await createDailyMilestone(fx.userA, recordInput({ dailyUpdates: updates }));

    expect(record.dailyUpdates).toEqual(updates.map((update) => ({ ...update, photos: [], documents: [] })));
    const stored = await DailyMilestone.findById(record.id).lean();
    expect(stored?.dailyUpdates.map((update) => update.title)).toEqual([
      "Morning briefing",
      "Admissions review",
      "Vendor meeting",
    ]);
  });

  it("rejects a record with no daily update", async () => {
    await expectZodIssue(createDailyMilestone(fx.userA, recordInput({ dailyUpdates: [] })), "dailyUpdates");
  });

  it("finds a record by text in any of its daily updates", async () => {
    await createDailyMilestone(
      fx.userA,
      recordInput({
        dailyUpdates: [
          { title: "Morning briefing", description: "Routine." },
          { title: "Vendor meeting", description: "Canteen contract renewal." },
        ],
      }),
    );

    const found = await listDailyMilestones(fx.userA, { q: "canteen" });
    expect(found.items).toHaveLength(1);
  });

  it("prevents a duplicate for the same office and date with details.existingId", async () => {
    const first = await createDailyMilestone(fx.userA, recordInput());

    await expectConflict(createDailyMilestone(fx.userA, recordInput({ dailyUpdates: [{ title: "Again", description: "Again" }] })), first.id);
    // The administrator hits the same rule for Office A.
    await expectConflict(
      createDailyMilestone(fx.admin, recordInput({ officeId: String(fx.officeA._id) })),
      first.id,
    );

    expect(await DailyMilestone.countDocuments({ officeId: fx.officeA._id })).toBe(1);
  });

  it("maps a concurrent duplicate create to a conflict", async () => {
    const results = await Promise.allSettled([
      createDailyMilestone(fx.userA, recordInput()),
      createDailyMilestone(fx.userA, recordInput()),
      createDailyMilestone(fx.admin, recordInput({ officeId: String(fx.officeA._id) })),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    const createdId = fulfilled[0]!.value.id;
    for (const result of rejected) {
      expect(result.reason).toBeInstanceOf(ConflictError);
      expect(result.reason).toMatchObject({ details: { existingId: createdId } });
    }
    expect(await DailyMilestone.countDocuments()).toBe(1);
  });

  it("lets Office B independently have a record for the same date", async () => {
    const recordA = await createDailyMilestone(fx.userA, recordInput());
    const recordB = await createDailyMilestone(fx.userB, recordInput());
    const recordByAdmin = await createDailyMilestone(
      fx.admin,
      recordInput({ officeId: String(fx.officeB._id), date: "2026-09-09" }),
    );

    expect(recordA.officeId).toBe(String(fx.officeA._id));
    expect(recordB.officeId).toBe(String(fx.officeB._id));
    expect(recordB.date).toBe("2026-09-08");
    expect(recordByAdmin).toMatchObject({ officeId: String(fx.officeB._id), date: "2026-09-09" });
    expect(await DailyMilestone.countDocuments({ date: new Date("2026-09-08T00:00:00.000Z") })).toBe(2);
  });

  it("forbids User A from creating a record for Office B", async () => {
    await expectForbidden(createDailyMilestone(fx.userA, recordInput({ officeId: String(fx.officeB._id) })));
    expect(await DailyMilestone.countDocuments()).toBe(0);
  });

  it("requires the administrator to pick an active office", async () => {
    await expect(createDailyMilestone(fx.admin, recordInput())).rejects.toBeInstanceOf(InvalidOfficeError);

    const inactive = await createOffice({ name: "Closed", code: "CLOSED", isActive: false });
    await expect(
      createDailyMilestone(fx.admin, recordInput({ officeId: String(inactive._id) })),
    ).rejects.toBeInstanceOf(InvalidOfficeError);
    await expect(
      createDailyMilestone(fx.admin, recordInput({ officeId: new Types.ObjectId().toHexString() })),
    ).rejects.toBeInstanceOf(InvalidOfficeError);

    const staleUser = makeCurrentUser(await createUser({ officeId: inactive }), inactive);
    await expect(createDailyMilestone(staleUser, recordInput())).rejects.toBeInstanceOf(InvalidOfficeError);

    expect(await DailyMilestone.countDocuments()).toBe(0);
  });

  it("stores multiple milestones in order and requires a title on each", async () => {
    const record = await createDailyMilestone(
      fx.userA,
      recordInput({
        milestones: [
          milestone("First", "Desc 1", "Remark 1"),
          milestone("Second"),
          milestone("  Third  ", "  padded  ", ""),
        ],
      }),
    );
    expect(record.milestones).toEqual(
      [
        { title: "First", description: "Desc 1", remarks: "Remark 1" },
        { title: "Second", description: "", remarks: "" },
        { title: "Third", description: "padded", remarks: "" },
      ].map((item) => ({ ...item, photos: [], documents: [] })),
    );

    await expectZodIssue(
      createDailyMilestone(
        fx.userB,
        recordInput({ milestones: [milestone("Valid"), milestone("   ", "No title")] }),
      ),
      "milestones.1.title",
    );
    await expectZodIssue(
      createDailyMilestone(fx.userB, recordInput({ milestones: [{ description: "missing", remarks: "" }] })),
      "milestones.0.title",
    );
    expect(await DailyMilestone.countDocuments({ officeId: fx.officeB._id })).toBe(0);

    // A daily update without milestones is allowed.
    const noMilestones = await createDailyMilestone(fx.userB, recordInput({ milestones: [] }));
    expect(noMilestones.milestones).toEqual([]);
  });

  it("validates the daily update and date", async () => {
    await expectZodIssue(
      createDailyMilestone(fx.userA, recordInput({ dailyUpdates: [{ title: "", description: "x" }] })),
      "dailyUpdates.0.title",
    );
    await expectZodIssue(
      createDailyMilestone(fx.userA, recordInput({ dailyUpdates: [{ title: "x", description: "  " }] })),
      "dailyUpdates.0.description",
    );
    await expectZodIssue(createDailyMilestone(fx.userA, recordInput({ date: "08-09-2026" })), "date");
  });

  it("rejects attachments that are not this app's Cloudinary uploads", async () => {
    await expect(
      createDailyMilestone(
        fx.userA,
        recordInput({ documents: [{ fileName: "a.pdf", fileUrl: "https://files.example.com/a.pdf" }] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await DailyMilestone.countDocuments()).toBe(0);

    const photos = [
      { fileName: "one.jpg", fileUrl: photoUrl("one") },
      { fileName: "two.jpg", fileUrl: photoUrl("two") },
    ];
    const documents = [{ fileName: "minutes.pdf", fileUrl: documentUrl("minutes") }];
    const record = await createDailyMilestone(fx.userA, recordInput({ photos, documents }));
    expect(record.photos).toEqual(photos);
    expect(record.documents).toEqual(documents);
  });
});

describe("updateDailyMilestone", () => {
  it("rejects moving a record onto a date that already has a record for the office", async () => {
    const sep8 = await createDailyMilestone(fx.userA, recordInput({ date: "2026-09-08" }));
    const sep9 = await createDailyMilestone(fx.userA, recordInput({ date: "2026-09-09" }));

    await expectConflict(updateDailyMilestone(fx.userA, sep9.id, await editInput(sep9.id, { date: "2026-09-08" })), sep8.id);
    await expectConflict(updateDailyMilestone(fx.admin, sep9.id, await editInput(sep9.id, { date: "2026-09-08" })), sep8.id);

    const stored = await DailyMilestone.findById(sep9.id).lean();
    expect(stored?.date.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });

  it("allows keeping the same date, moving to a free date, or a date used only by another office", async () => {
    await createDailyMilestone(fx.userB, recordInput({ date: "2026-09-10" }));
    const record = await createDailyMilestone(fx.userA, recordInput({ date: "2026-09-08" }));

    const sameDate = await updateDailyMilestone(fx.userA, record.id, await editInput(record.id, { dailyUpdates: [{ title: "Edited", description: "Edited description" }] }),
    );
    expect(sameDate).toMatchObject({ date: "2026-09-08", dailyUpdates: [{ title: "Edited" }] });

    const moved = await updateDailyMilestone(fx.userA, record.id, await editInput(record.id, { date: "2026-09-10" }));
    expect(moved).toMatchObject({ id: record.id, date: "2026-09-10", officeId: String(fx.officeA._id) });
  });

  it("forbids User A from viewing or updating Office B's record", async () => {
    const recordB = await seedRecord({ officeId: fx.officeB, dailyUpdates: [{ title: "Office B plan" }] });
    const id = String(recordB._id);

    await expectForbidden(getDailyMilestone(fx.userA, id));
    await expectForbidden(
      updateDailyMilestone(fx.userA, id, await editInput(id, { dailyUpdates: [{ title: "Hijack", description: "x" }] })),
    );

    const stored = await DailyMilestone.findById(id).lean();
    expect(stored?.dailyUpdates[0]?.title).toBe("Office B plan");

    await expect(getDailyMilestone(fx.admin, id)).resolves.toMatchObject({ id, officeId: String(fx.officeB._id) });
    await expect(getDailyMilestone(fx.userB, id)).resolves.toMatchObject({ id });
    await expect(
      updateDailyMilestone(fx.admin, id, await editInput(id, { dailyUpdates: [{ title: "Admin edit", description: "ok" }] })),
    ).resolves.toMatchObject({ dailyUpdates: [{ title: "Admin edit" }] });
  });

  it("never changes the office of an existing record", async () => {
    const record = await createDailyMilestone(fx.userA, recordInput());

    const byUser = await updateDailyMilestone(fx.userA, record.id, await editInput(record.id, { officeId: String(fx.officeB._id), date: "2026-09-11" }),
    );
    expect(byUser.officeId).toBe(String(fx.officeA._id));

    const byAdmin = await updateDailyMilestone(fx.admin, record.id, await editInput(record.id, { officeId: String(fx.officeB._id), date: "2026-09-12" }),
    );
    expect(byAdmin.officeId).toBe(String(fx.officeA._id));
    expect(String((await DailyMilestone.findById(record.id).lean())?.officeId)).toBe(String(fx.officeA._id));
  });

  it("replaces milestones, validates titles and removes unreferenced files", async () => {
    const kept = { fileName: "kept.jpg", fileUrl: photoUrl("kept") };
    const dropped = { fileName: "old.pdf", fileUrl: documentUrl("old") };
    const record = await createDailyMilestone(
      fx.userA,
      recordInput({ photos: [kept], documents: [dropped], milestones: [milestone("One"), milestone("Two")] }),
    );

    await expectZodIssue(
      updateDailyMilestone(fx.userA, record.id, await editInput(record.id, { milestones: [milestone("")] })),
      "milestones.0.title",
    );

    const updated = await updateDailyMilestone(fx.userA, record.id, await editInput(record.id, { photos: [kept], documents: [], milestones: [milestone("Two"), milestone("Three", "", "Late")] }),
    );
    expect(updated.milestones.map((item) => item.title)).toEqual(["Two", "Three"]);
    expect(updated.documents).toEqual([]);
    expect(deleteResources).toHaveBeenCalledTimes(1);
    expect(deleteResources).toHaveBeenCalledWith([`${cloudinaryRootFolder()}/${officeFolder(fx.officeA)}/documents/old.pdf`], {
      resource_type: "raw",
      type: "upload",
    });
  });

  it("returns 404 for malformed or unknown ids", async () => {
    const missing = new Types.ObjectId().toHexString();
    for (const id of ["abc", missing]) {
      await expect(getDailyMilestone(fx.admin, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(updateDailyMilestone(fx.admin, id, await editInput(id))).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteDailyMilestone(fx.admin, id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});

describe("deleteDailyMilestone (administrators only)", () => {
  it("forbids normal users, even for their own office", async () => {
    const recordA = await seedRecord({ officeId: fx.officeA });
    const recordB = await seedRecord({ officeId: fx.officeB });

    await expectForbidden(deleteDailyMilestone(fx.userA, String(recordA._id)));
    await expectForbidden(deleteDailyMilestone(fx.userA, String(recordB._id)));
    await expectForbidden(deleteDailyMilestone(fx.userB, String(recordB._id)));
    // Role check happens before any lookup: a malformed id is still 403 for a normal user.
    await expectForbidden(deleteDailyMilestone(fx.userA, "not-an-id"));

    expect(await DailyMilestone.countDocuments()).toBe(2);
    expect(deleteResources).not.toHaveBeenCalled();
  });

  it("lets the administrator delete any office's record and its files", async () => {
    const recordB = await seedRecord({
      officeId: fx.officeB,
      photos: [{ fileName: "p.jpg", fileUrl: photoUrl("p", fx.officeB) }],
      documents: [{ fileName: "d.pdf", fileUrl: documentUrl("d", fx.officeB) }],
    });
    const recordA = await seedRecord({ officeId: fx.officeA });

    await deleteDailyMilestone(fx.admin, String(recordB._id));
    expect(await DailyMilestone.exists({ _id: recordB._id })).toBeNull();
    expect(await DailyMilestone.exists({ _id: recordA._id })).not.toBeNull();
    expect(deleteResources).toHaveBeenCalledWith([`${cloudinaryRootFolder()}/${officeFolder(fx.officeB)}/photos/p`], {
      resource_type: "image",
      type: "upload",
    });
    expect(deleteResources).toHaveBeenCalledWith([`${cloudinaryRootFolder()}/${officeFolder(fx.officeB)}/documents/d.pdf`], {
      resource_type: "raw",
      type: "upload",
    });

    // The office/date slot is free again.
    const recreated = await createDailyMilestone(fx.userB, recordInput());
    expect(recreated.officeId).toBe(String(fx.officeB._id));
  });
});

describe("listDailyMilestones", () => {
  beforeEach(async () => {
    await seedRecord({
      officeId: fx.officeA,
      date: "2026-09-01",
      dailyUpdates: [{ title: "Budget planning", description: "Quarterly figures" }],
      milestones: [milestone("Draft circulated")],
    });
    await seedRecord({
      officeId: fx.officeA,
      date: "2026-09-02",
      dailyUpdates: [{ title: "Events", description: "Preparations for the convocation ceremony" }],
      milestones: [],
    });
    await seedRecord({
      officeId: fx.officeA,
      date: "2026-09-03",
      dailyUpdates: [{ title: "Facilities", description: "Routine" }],
      milestones: [milestone("Other"), milestone("Hostel audit completed")],
    });
    await seedRecord({
      officeId: fx.officeA,
      date: "2026-09-04",
      dailyUpdates: [{ title: "Library", description: "Routine" }],
      milestones: [milestone("Phase 1", "Library RENOVATION started")],
    });
    await seedRecord({
      officeId: fx.officeA,
      date: "2026-09-05",
      dailyUpdates: [{ title: "Legal", description: "Routine" }],
      milestones: [milestone("MoU", "", "Pending signature from partner")],
    });
    await seedRecord({
      officeId: fx.officeB,
      date: "2026-09-01",
      dailyUpdates: [{ title: "Budget planning (Office B)", description: "Office B figures" }],
      milestones: [milestone("Hostel audit scheduled")],
    });
  });

  it("scopes records by role and office, newest first", async () => {
    const all = await listDailyMilestones(fx.admin, {});
    expect(all.total).toBe(6);

    const ownA = await listDailyMilestones(fx.userA, {});
    expect(ownA.total).toBe(5);
    expect(ownA.items.map((item) => item.date)).toEqual([
      "2026-09-05",
      "2026-09-04",
      "2026-09-03",
      "2026-09-02",
      "2026-09-01",
    ]);
    expect(ownA.items.every((item) => item.officeId === String(fx.officeA._id))).toBe(true);
    expect(ownA.items[0]?.office?.name).toBe("Office A");

    const adminB = await listDailyMilestones(fx.admin, { officeId: String(fx.officeB._id) });
    expect(adminB.items.map((item) => item.dailyUpdates[0]?.title)).toEqual(["Budget planning (Office B)"]);

    await expect(listDailyMilestones(fx.userA, { officeId: String(fx.officeA._id) })).resolves.toMatchObject({
      total: 5,
    });
    await expectForbidden(listDailyMilestones(fx.userA, { officeId: String(fx.officeB._id) }));
    await expectForbidden(listDailyMilestones(fx.userA, { officeId: "all" }));
  });

  it("searches the daily update and every milestone field", async () => {
    const titles = async (user = fx.userA, q: string) =>
      (await listDailyMilestones(user, { q })).items.map((item) => item.date).sort();

    expect(await titles(fx.userA, "budget")).toEqual(["2026-09-01"]); // dailyUpdates[0].title
    expect(await titles(fx.userA, "CONVOCATION")).toEqual(["2026-09-02"]); // dailyUpdates[0].description
    expect(await titles(fx.userA, "hostel audit")).toEqual(["2026-09-03"]); // milestones.title
    expect(await titles(fx.userA, "renovation")).toEqual(["2026-09-04"]); // milestones.description
    expect(await titles(fx.userA, "signature")).toEqual(["2026-09-05"]); // milestones.remarks
    expect(await titles(fx.userA, "Office B")).toEqual([]);

    const adminBudget = await listDailyMilestones(fx.admin, { q: "budget planning" });
    expect(adminBudget.total).toBe(2);
    expect((await listDailyMilestones(fx.admin, { q: "(Office B)" })).total).toBe(1);
    expect((await listDailyMilestones(fx.admin, { q: ".*" })).total).toBe(0);
  });

  it("filters by exact date and inclusive range and paginates", async () => {
    const exact = await listDailyMilestones(fx.admin, { date: "2026-09-01" });
    expect(exact.total).toBe(2);

    const range = await listDailyMilestones(fx.userA, { from: "2026-09-02", to: "2026-09-04" });
    expect(range.items.map((item) => item.date)).toEqual(["2026-09-04", "2026-09-03", "2026-09-02"]);

    const toOnly = await listDailyMilestones(fx.userA, { to: "2026-09-01" });
    expect(toOnly.total).toBe(1);

    await expect(listDailyMilestones(fx.userA, { from: "2026-09-05", to: "2026-09-01" })).rejects.toBeInstanceOf(
      ValidationError,
    );

    const page2 = await listDailyMilestones(fx.userA, { page: 2, pageSize: 2 });
    expect(page2).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(page2.items.map((item) => item.date)).toEqual(["2026-09-03", "2026-09-02"]);

    // Past the last page → clamped to the last page.
    const beyond = await listDailyMilestones(fx.userA, { page: 9, pageSize: 2 });
    expect(beyond).toMatchObject({ page: 3, total: 5, totalPages: 3 });
    expect(beyond.items.map((item) => item.date)).toEqual(["2026-09-01"]);
  });
});

describe("listMilestones (View all milestones)", () => {
  let recordA8: string;
  let recordA6: string;
  let recordB8: string;

  beforeEach(async () => {
    recordA8 = String(
      (
        await seedRecord({
          officeId: fx.officeA,
          date: "2026-09-08",
          dailyUpdates: [{ title: "Hostel update", description: "Daily update text only" }],
          milestones: [milestone("A8-first"), milestone("A8-second", "Fire safety drill"), milestone("A8-third", "", "Done")],
        })
      )._id,
    );
    await seedRecord({ officeId: fx.officeA, date: "2026-09-07", milestones: [] });
    recordA6 = String(
      (await seedRecord({ officeId: fx.officeA, date: "2026-09-06", milestones: [milestone("A6-only", "", "fire")] }))._id,
    );
    recordB8 = String(
      (
        await seedRecord({
          officeId: fx.officeB,
          date: "2026-09-08",
          milestones: [milestone("B8-first", "Fire extinguisher refill"), milestone("B8-second")],
        })
      )._id,
    );
  });

  it("returns individual milestones in scope with correct totals and positions", async () => {
    const all = await listMilestones(fx.admin, {});
    expect(all.total).toBe(6);

    const ownA = await listMilestones(fx.userA, {});
    expect(ownA.total).toBe(4);
    expect(ownA.items.map((item) => [item.date, item.title, item.index])).toEqual([
      ["2026-09-08", "A8-first", 0],
      ["2026-09-08", "A8-second", 1],
      ["2026-09-08", "A8-third", 2],
      ["2026-09-06", "A6-only", 0],
    ]);
    expect(ownA.items[1]).toEqual({
      recordId: recordA8,
      index: 1,
      date: "2026-09-08",
      office: { id: String(fx.officeA._id), name: "Office A", code: "OFFICE-A" },
      title: "A8-second",
      description: "Fire safety drill",
      remarks: "",
    });
    expect(ownA.items[3]?.recordId).toBe(recordA6);

    const onlyB = await listMilestones(fx.admin, { officeId: String(fx.officeB._id) });
    expect(onlyB.total).toBe(2);
    expect(onlyB.items.every((item) => item.recordId === recordB8 && item.office?.name === "Office B")).toBe(true);

    await expectForbidden(listMilestones(fx.userA, { officeId: String(fx.officeB._id) }));
    await expectForbidden(listMilestones(fx.userA, { officeId: "all" }));
  });

  it("matches keywords against milestone fields only and counts matching milestones", async () => {
    const fireA = await listMilestones(fx.userA, { q: "FIRE" });
    expect(fireA.items.map((item) => item.title)).toEqual(["A8-second", "A6-only"]);
    expect(fireA.total).toBe(2);

    const fireAll = await listMilestones(fx.admin, { q: "fire" });
    expect(fireAll.total).toBe(3);

    // "Hostel" only appears in a daily update title, not in any milestone.
    expect((await listMilestones(fx.admin, { q: "hostel" })).total).toBe(0);
  });

  it("applies date filters and pagination to milestones", async () => {
    const day = await listMilestones(fx.admin, { date: "2026-09-08" });
    expect(day.total).toBe(5);

    const page = await listMilestones(fx.userA, { page: 2, pageSize: 3 });
    expect(page).toMatchObject({ page: 2, pageSize: 3, total: 4, totalPages: 2 });
    expect(page.items.map((item) => item.title)).toEqual(["A6-only"]);

    const empty = await listMilestones(fx.userB, { date: "2026-09-06" });
    expect(empty).toMatchObject({ total: 0, items: [], totalPages: 1 });
  });
});

describe("findDailyMilestoneIdForDate", () => {
  it("scopes normal users to their own office and requires admins to name an office", async () => {
    const recordA = String((await seedRecord({ officeId: fx.officeA, date: "2026-09-08" }))._id);
    const recordB = String((await seedRecord({ officeId: fx.officeB, date: "2026-09-08" }))._id);

    await expect(findDailyMilestoneIdForDate(fx.userA, null, "2026-09-08")).resolves.toBe(recordA);
    await expect(findDailyMilestoneIdForDate(fx.userA, String(fx.officeA._id), "2026-09-08")).resolves.toBe(recordA);
    await expect(findDailyMilestoneIdForDate(fx.userB, null, "2026-09-08")).resolves.toBe(recordB);
    await expect(findDailyMilestoneIdForDate(fx.userA, null, "2026-09-09")).resolves.toBeNull();

    await expectForbidden(findDailyMilestoneIdForDate(fx.userA, String(fx.officeB._id), "2026-09-08"));
    await expectForbidden(findDailyMilestoneIdForDate(fx.userA, "all", "2026-09-08"));

    await expect(findDailyMilestoneIdForDate(fx.admin, null, "2026-09-08")).resolves.toBeNull();
    await expect(findDailyMilestoneIdForDate(fx.admin, "all", "2026-09-08")).resolves.toBeNull();
    await expect(findDailyMilestoneIdForDate(fx.admin, String(fx.officeB._id), "2026-09-08")).resolves.toBe(recordB);
    await expect(findDailyMilestoneIdForDate(fx.admin, "not-an-office", "2026-09-08")).resolves.toBeNull();
    await expect(findDailyMilestoneIdForDate(fx.admin, String(fx.officeA._id), "2026-02-30")).resolves.toBeNull();
    await expect(findDailyMilestoneIdForDate(fx.userA, null, "yesterday")).resolves.toBeNull();
  });
});
