import mongoose, { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { MAX_ATTACHMENTS_PER_FIELD, MAX_MILESTONES_PER_RECORD } from "@/lib/constants";
import { businessDateToUtc, combineDateAndTime, utcToBusinessDate } from "@/lib/utils/dates";
import { DailyMilestone, Office, User, Visitor } from "@/models";
import type { Importance, Role } from "@/types";

import {
  createDailyMilestone,
  createOffice,
  createUser,
  createVisitor,
  registerTestDatabase,
} from "../setup/db";

registerTestDatabase();

const DUPLICATE_KEY = { code: 11000 };

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail");
}

async function expectValidationError(promise: Promise<unknown>, path: string, message?: string) {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
  const errors = (error as mongoose.Error.ValidationError).errors;
  expect(Object.keys(errors)).toContain(path);
  if (message) expect(errors[path]?.message).toBe(message);
}

function dailyRecord(officeId: Types.ObjectId, date: Date) {
  return {
    officeId,
    date,
    dailyUpdates: [{ title: "Daily update", description: "Description" }],
    milestones: [],
    createdBy: new Types.ObjectId(),
  };
}

type IndexInfo = { key: Record<string, number>; unique?: boolean };

function findIndex(indexes: IndexInfo[], key: Record<string, number>): IndexInfo | undefined {
  return indexes.find((index) => JSON.stringify(index.key) === JSON.stringify(key));
}

describe("business collections (spec §3, §34)", () => {
  it("registers exactly the four models and collections", async () => {
    expect(mongoose.modelNames().sort()).toEqual(["DailyMilestone", "Office", "User", "Visitor"]);
    expect(Office.collection.collectionName).toBe("offices");
    expect(User.collection.collectionName).toBe("users");
    expect(Visitor.collection.collectionName).toBe("visitors");
    expect(DailyMilestone.collection.collectionName).toBe("dailyMilestones");

    const collections = await mongoose.connection.db!.listCollections().toArray();
    expect(collections.map((collection) => collection.name).sort()).toEqual([
      "dailyMilestones",
      "offices",
      "users",
      "visitors",
    ]);
  });

  it("creates the required indexes", async () => {
    const offices: IndexInfo[] = await Office.listIndexes();
    const users: IndexInfo[] = await User.listIndexes();
    const visitors: IndexInfo[] = await Visitor.listIndexes();
    const dailyMilestones: IndexInfo[] = await DailyMilestone.listIndexes();

    expect(findIndex(offices, { code: 1 })?.unique).toBe(true);
    expect(findIndex(users, { email: 1 })?.unique).toBe(true);
    expect(findIndex(users, { officeId: 1 })).toBeDefined();
    expect(findIndex(users, { role: 1 })).toBeDefined();
    expect(findIndex(users, { isActive: 1 })).toBeDefined();
    // Index-aligned with the list sorts.
    expect(findIndex(visitors, { officeId: 1, date: -1, timeArrived: -1, _id: -1 })).toBeDefined();
    expect(findIndex(visitors, { date: -1, timeArrived: -1, _id: -1 })).toBeDefined();
    expect(findIndex(dailyMilestones, { date: -1, _id: -1 })).toBeDefined();
    expect(findIndex(visitors, { officeId: 1, name: 1 })).toBeDefined();
    expect(findIndex(visitors, { officeId: 1, importance: 1 })).toBeDefined();
    expect(findIndex(dailyMilestones, { officeId: 1, date: 1 })?.unique).toBe(true);
  });
});

describe("offices", () => {
  it("normalises the code and defaults to active", async () => {
    const office = await createOffice({ name: " Dean Academics ", code: " dean-aca " });
    expect(office.name).toBe("Dean Academics");
    expect(office.code).toBe("DEAN-ACA");
    expect(office.isActive).toBe(true);
    expect(office.createdAt).toBeInstanceOf(Date);
    expect(office.updatedAt).toBeInstanceOf(Date);
  });

  it("rejects a duplicate code (case-insensitive)", async () => {
    await createOffice({ name: "HR", code: "HR" });
    await expect(createOffice({ name: "Human Resources", code: "hr" })).rejects.toMatchObject(DUPLICATE_KEY);
    expect(await Office.countDocuments({ code: "HR" })).toBe(1);
  });

  it("validates name and code", async () => {
    await expectValidationError(Office.create({ code: "NO-NAME" }), "name", "Office name is required");
    await expectValidationError(
      Office.create({ name: "Bad code", code: "HR OFFICE" }),
      "code",
      "Office code may contain only letters, numbers and hyphens",
    );
  });
});

describe("users", () => {
  it("trims and lowercases the email", async () => {
    const user = await createUser({ role: "admin", officeId: null, email: "  Ayushi@XLRI.Example.COM " });
    expect(user.email).toBe("ayushi@xlri.example.com");
    const stored = await User.collection.findOne({ _id: user._id });
    expect(stored?.email).toBe("ayushi@xlri.example.com");
  });

  it("rejects a duplicate email regardless of case", async () => {
    await createUser({ role: "admin", officeId: null, email: "ayushi@example.com" });
    await expect(
      createUser({ role: "admin", officeId: null, email: "AYUSHI@example.com" }),
    ).rejects.toMatchObject(DUPLICATE_KEY);
  });

  it('rejects role "user" without an office', async () => {
    await expectValidationError(
      User.create({ name: "No Office", email: "no.office@example.com", role: "user", officeId: null }),
      "officeId",
      "Normal users must be assigned to an office",
    );
    await expectValidationError(
      User.create({ name: "Default Role", email: "default.role@example.com" }),
      "officeId",
      "Normal users must be assigned to an office",
    );
  });

  it("allows an admin without an office", async () => {
    const admin = await createUser({ role: "admin", officeId: null });
    expect(admin.officeId).toBeNull();
    expect(admin.isActive).toBe(true);
  });

  it("allows only the admin and user roles", async () => {
    const office = await createOffice();
    await expectValidationError(
      User.create({
        name: "Manager",
        email: "manager@example.com",
        role: "manager" as unknown as Role,
        officeId: office._id,
      }),
      "role",
    );
  });

  it("has no password fields", () => {
    expect(Object.keys(User.schema.paths).filter((path) => /pass/i.test(path))).toEqual([]);
  });

  it("hides the otp sub-document from default queries and strips it from serialization", async () => {
    const user = await createUser({ role: "admin", officeId: null });
    const otp = {
      codeHash: "hmac-of-the-code",
      expiresAt: new Date(Date.now() + 5 * 60_000),
      attempts: 1,
      lastSentAt: new Date(),
      sendWindowStartedAt: new Date(),
      sendCount: 1,
    };
    await User.updateOne({ _id: user._id }, { $set: { otp } });

    const lean = await User.findById(user._id).lean();
    expect(lean).not.toBeNull();
    expect(lean).not.toHaveProperty("otp");
    for (const listed of await User.find({}).lean()) expect(listed).not.toHaveProperty("otp");

    const hydrated = await User.findById(user._id).orFail();
    expect(hydrated.otp).toBeUndefined();
    expect(JSON.stringify(hydrated)).not.toContain("codeHash");

    const withOtp = await User.findById(user._id).select("+otp").orFail();
    expect(withOtp.otp?.codeHash).toBe("hmac-of-the-code");
    expect(withOtp.toJSON()).not.toHaveProperty("otp");
    expect(withOtp.toObject()).not.toHaveProperty("otp");
    expect(JSON.stringify(withOtp)).not.toContain("codeHash");

    const leanWithOtp = await User.findById(user._id).select("+otp").lean();
    expect(leanWithOtp?.otp?.codeHash).toBe("hmac-of-the-code");
  });
});

describe("dailyMilestones (spec §57)", () => {
  it("prevents a duplicate record for the same office and date while Office B may use the same date", async () => {
    const officeA = await createOffice({ name: "Office A", code: "OFFICE-A" });
    const officeB = await createOffice({ name: "Office B", code: "OFFICE-B" });

    const first = await createDailyMilestone({ officeId: officeA, date: "2026-09-08" });
    expect(utcToBusinessDate(first.date)).toBe("2026-09-08");

    await expect(createDailyMilestone({ officeId: officeA, date: "2026-09-08" })).rejects.toMatchObject(
      DUPLICATE_KEY,
    );

    await expect(createDailyMilestone({ officeId: officeB, date: "2026-09-08" })).resolves.toBeDefined();
    await expect(createDailyMilestone({ officeId: officeA, date: "2026-09-09" })).resolves.toBeDefined();

    expect(await DailyMilestone.countDocuments({ officeId: officeA._id })).toBe(2);
    expect(await DailyMilestone.countDocuments({ date: businessDateToUtc("2026-09-08") })).toBe(2);
  });

  it("prevents duplicates created concurrently", async () => {
    const office = await createOffice();
    const results = await Promise.allSettled([
      createDailyMilestone({ officeId: office, date: "2026-09-08" }),
      createDailyMilestone({ officeId: office, date: "2026-09-08" }),
      createDailyMilestone({ officeId: office, date: "2026-09-08" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await DailyMilestone.countDocuments({ officeId: office._id })).toBe(1);
  });

  it("rejects a business date that is not UTC midnight", async () => {
    const office = await createOffice();
    await expectValidationError(
      DailyMilestone.create(dailyRecord(office._id, new Date("2026-09-08T05:30:00.000Z"))),
      "date",
      "Date must be a calendar day",
    );
    // Midnight IST as an instant is a common timezone bug; it must not be stored as a business date.
    await expectValidationError(
      DailyMilestone.create(dailyRecord(office._id, new Date("2026-09-07T18:30:00.000Z"))),
      "date",
      "Date must be a calendar day",
    );
  });

  it("requires the daily update and milestone titles", async () => {
    const office = await createOffice();
    await expectValidationError(
      DailyMilestone.create({
        ...dailyRecord(office._id, businessDateToUtc("2026-09-08")),
        dailyUpdates: [{ title: "", description: "Description" }],
      }),
      "dailyUpdates.0.title",
    );
    await expectValidationError(
      DailyMilestone.create({
        ...dailyRecord(office._id, businessDateToUtc("2026-09-08")),
        milestones: [{ title: "", description: "", remarks: "" }],
      }),
      "milestones.0.title",
      "Milestone title is required",
    );
  });

  it("limits milestones and attachments", async () => {
    const office = await createOffice();
    const base = dailyRecord(office._id, businessDateToUtc("2026-09-08"));
    await expectValidationError(
      DailyMilestone.create({
        ...base,
        milestones: Array.from({ length: MAX_MILESTONES_PER_RECORD + 1 }, (_, i) => ({ title: `M${i}` })),
      }),
      "milestones",
    );
    await expectValidationError(
      DailyMilestone.create({
        ...base,
        photos: Array.from({ length: MAX_ATTACHMENTS_PER_FIELD + 1 }, (_, i) => ({
          fileName: `p${i}.jpg`,
          fileUrl: `https://res.cloudinary.com/demo/image/upload/p${i}.jpg`,
        })),
      }),
      "photos",
    );
  });
});

describe("visitors", () => {
  it("rejects a departure before arrival", async () => {
    const office = await createOffice();
    await expectValidationError(
      createVisitor({ officeId: office, timeArrived: "10:00", timeDeparted: "09:30" }),
      "timeDeparted",
      "Departure time cannot be before arrival time",
    );
  });

  it("allows no departure or a departure at/after arrival", async () => {
    const office = await createOffice();
    const pending = await createVisitor({ officeId: office, timeArrived: "10:00", timeDeparted: null });
    expect(pending.timeDeparted).toBeNull();
    expect(pending.importance).toBe("MEDIUM");
    await expect(
      createVisitor({ officeId: office, timeArrived: "10:00", timeDeparted: "10:00" }),
    ).resolves.toBeDefined();
    await expect(
      createVisitor({ officeId: office, timeArrived: "10:00", timeDeparted: "17:45" }),
    ).resolves.toBeDefined();
  });

  it("rejects a business date that is not UTC midnight and an unknown importance", async () => {
    const office = await createOffice();
    const base = {
      officeId: office._id,
      name: "Visitor",
      purpose: "Meeting",
      date: businessDateToUtc("2026-09-08"),
      timeArrived: combineDateAndTime("2026-09-08", "10:00"),
      createdBy: new Types.ObjectId(),
    };
    await expectValidationError(
      Visitor.create({ ...base, date: new Date("2026-09-08T10:00:00.000Z") }),
      "date",
      "Date must be a calendar day",
    );
    await expectValidationError(
      Visitor.create({ ...base, importance: "CRITICAL" as unknown as Importance }),
      "importance",
    );
  });
});
