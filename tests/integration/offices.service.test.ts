import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createOffice, getOffice, listOffices, updateOffice } from "@/lib/services/offices";
import { DailyMilestone, Office, User, Visitor } from "@/models";

import {
  createAuthorizationFixture,
  createDailyMilestone as seedRecord,
  createOffice as seedOffice,
  createUser as seedUser,
  createVisitor as seedVisitor,
  registerTestDatabase,
  type AuthorizationFixture,
} from "../setup/db";

// Spec §5, §22 (Office management: admin only) and §43 (deactivate, never delete).

registerTestDatabase();

let fx: AuthorizationFixture;

beforeEach(async () => {
  fx = await createAuthorizationFixture();
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

describe("admin-only access", () => {
  it("returns 403 to normal users for every office function and changes nothing", async () => {
    const idA = String(fx.officeA._id);
    const before = await Office.find().sort({ _id: 1 }).lean();

    for (const user of [fx.userA, fx.userB]) {
      await expectForbidden(listOffices(user, {}));
      await expectForbidden(listOffices(user));
      await expectForbidden(getOffice(user, idA));
      await expectForbidden(getOffice(user, "not-an-id"));
      await expectForbidden(createOffice(user, { name: "Rogue Office", code: "ROGUE", isActive: true }));
      // Authorization is checked before validation: invalid input is still 403.
      await expectForbidden(createOffice(user, { name: "" }));
      await expectForbidden(updateOffice(user, idA, { name: "Renamed by user" }));
      await expectForbidden(updateOffice(user, idA, { isActive: false }));
      await expectForbidden(updateOffice(user, String(fx.officeB._id), { code: "HACKED" }));
    }

    const after = await Office.find().sort({ _id: 1 }).lean();
    expect(after).toEqual(before);
    expect(await Office.exists({ code: "ROGUE" })).toBeNull();
  });

  it("allows administrators", async () => {
    await expect(listOffices(fx.admin, {})).resolves.toMatchObject({ total: 2 });
    await expect(getOffice(fx.admin, String(fx.officeA._id))).resolves.toMatchObject({ name: "Office A" });
  });
});

describe("createOffice", () => {
  it("trims the name, uppercases the code and returns a DTO", async () => {
    const office = await createOffice(fx.admin, { name: "  Dean Academics ", code: " dean-aca ", isActive: true });

    expect(office).toMatchObject({ name: "Dean Academics", code: "DEAN-ACA", isActive: true });
    expect(Types.ObjectId.isValid(office.id)).toBe(true);
    expect(typeof office.createdAt).toBe("string");
    expect(Object.keys(office).sort()).toEqual(["code", "createdAt", "id", "isActive", "name", "updatedAt"]);

    const stored = await Office.findById(office.id).lean();
    expect(stored?.code).toBe("DEAN-ACA");
  });

  it("can create an inactive office", async () => {
    const office = await createOffice(fx.admin, { name: "Archive Office", code: "archive", isActive: false });
    expect(office).toMatchObject({ code: "ARCHIVE", isActive: false });
  });

  it("rejects a duplicate code regardless of letter case", async () => {
    await createOffice(fx.admin, { name: "Human Resources", code: "HR", isActive: true });

    const error = await captureError(createOffice(fx.admin, { name: "HR Two", code: "hr", isActive: true }));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ status: 409, code: "CONFLICT", details: { field: "code" } });

    await expect(
      createOffice(fx.admin, { name: "Office A again", code: "office-a", isActive: true }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await Office.countDocuments({ code: "HR" })).toBe(1);
  });

  it("maps a concurrent duplicate code to a conflict", async () => {
    const results = await Promise.allSettled([
      createOffice(fx.admin, { name: "Race One", code: "RACE", isActive: true }),
      createOffice(fx.admin, { name: "Race Two", code: "race", isActive: true }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ConflictError);
    expect(await Office.countDocuments({ code: "RACE" })).toBe(1);
  });

  it("validates name and code", async () => {
    await expect(createOffice(fx.admin, { name: "X", code: "OK", isActive: true })).rejects.toBeInstanceOf(ZodError);
    await expect(
      createOffice(fx.admin, { name: "Spaces", code: "HR OFFICE", isActive: true }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(createOffice(fx.admin, { name: "Dash", code: "-HR", isActive: true })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(createOffice(fx.admin, { name: "No status", code: "NOSTATUS" })).rejects.toBeInstanceOf(ZodError);
    expect(await Office.countDocuments()).toBe(2);
  });
});

describe("listOffices", () => {
  it("lists offices in creation order with active user counts", async () => {
    const inactive = await seedOffice({ name: "Closed Office", code: "CLOSED", isActive: false });
    await seedUser({ officeId: fx.officeA, name: "Second A user" });
    await seedUser({ officeId: fx.officeA, name: "Inactive A user", isActive: false });
    await seedUser({ role: "admin", officeId: fx.officeB, name: "Admin in B" });

    const result = await listOffices(fx.admin, {});
    expect(result).toMatchObject({ total: 3, page: 1, totalPages: 1 });
    expect(result.items.map((item) => [item.code, item.isActive, item.activeUserCount])).toEqual([
      ["OFFICE-A", true, 2],
      ["OFFICE-B", true, 2],
      [inactive.code, false, 0],
    ]);
  });

  it("searches name and code literally and filters by status", async () => {
    await seedOffice({ name: "Dean (Academics)", code: "DEAN-ACA" });
    await seedOffice({ name: "Dean Admin", code: "DEAN-ADMIN", isActive: false });

    expect((await listOffices(fx.admin, { q: "dean" })).total).toBe(2);
    expect((await listOffices(fx.admin, { q: "(academics)" })).items.map((item) => item.code)).toEqual([
      "DEAN-ACA",
    ]);
    expect((await listOffices(fx.admin, { q: "office-b" })).items.map((item) => item.code)).toEqual(["OFFICE-B"]);
    expect((await listOffices(fx.admin, { q: ".*" })).total).toBe(0);

    const active = await listOffices(fx.admin, { status: "active" });
    expect(active.items.map((item) => item.code)).toEqual(["OFFICE-A", "OFFICE-B", "DEAN-ACA"]);
    const inactive = await listOffices(fx.admin, { status: "inactive" });
    expect(inactive.items.map((item) => item.code)).toEqual(["DEAN-ADMIN"]);

    await expect(listOffices(fx.admin, { status: "deleted" })).rejects.toBeInstanceOf(ZodError);
  });

  it("paginates and clamps an out-of-range page", async () => {
    for (let index = 0; index < 3; index += 1) await seedOffice({ code: `EXTRA-${index}` });

    const page2 = await listOffices(fx.admin, { page: 2, pageSize: 2 });
    expect(page2).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
    expect(page2.items.map((item) => item.code)).toEqual(["EXTRA-0", "EXTRA-1"]);

    const clamped = await listOffices(fx.admin, { page: 99, pageSize: 2 });
    expect(clamped.page).toBe(3);
    expect(clamped.items.map((item) => item.code)).toEqual(["EXTRA-2"]);
  });
});

describe("getOffice", () => {
  it("returns 404 for malformed or unknown ids", async () => {
    await expect(getOffice(fx.admin, "abc")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getOffice(fx.admin, new Types.ObjectId().toHexString())).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("updateOffice", () => {
  it("renames an office and keeps its code", async () => {
    const updated = await updateOffice(fx.admin, String(fx.officeA._id), { name: "Office Alpha" });
    expect(updated).toMatchObject({ id: String(fx.officeA._id), name: "Office Alpha", code: "OFFICE-A", isActive: true });
  });

  it("rejects any code change, since office codes are immutable", async () => {
    for (const code of ["alpha-1", "office-b", "office-a"]) {
      await expect(
        updateOffice(fx.admin, String(fx.officeA._id), { code, name: "Renamed" }),
      ).rejects.toBeInstanceOf(ZodError);
    }
    const stored = await Office.findById(fx.officeA._id).lean();
    expect(stored).toMatchObject({ code: "OFFICE-A", name: "Office A" });
  });

  it("deactivates and reactivates an office without touching historical data (spec §43)", async () => {
    const visitor = await seedVisitor({ officeId: fx.officeA });
    const record = await seedRecord({ officeId: fx.officeA });

    const deactivated = await updateOffice(fx.admin, String(fx.officeA._id), { isActive: false });
    expect(deactivated.isActive).toBe(false);
    expect(await Office.countDocuments()).toBe(2);
    expect(await Visitor.exists({ _id: visitor._id })).not.toBeNull();
    expect(await DailyMilestone.exists({ _id: record._id })).not.toBeNull();
    expect((await User.findById(fx.userADoc._id).lean())?.officeId?.toString()).toBe(String(fx.officeA._id));

    const reactivated = await updateOffice(fx.admin, String(fx.officeA._id), { isActive: true });
    expect(reactivated.isActive).toBe(true);
  });

  it("returns the office unchanged for an empty patch and 404 for unknown ids", async () => {
    const unchanged = await updateOffice(fx.admin, String(fx.officeB._id), {});
    expect(unchanged).toMatchObject({ name: "Office B", code: "OFFICE-B", isActive: true });

    await expect(updateOffice(fx.admin, "xyz", { name: "Nope" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateOffice(fx.admin, new Types.ObjectId().toHexString(), { name: "Nope office" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateOffice(fx.admin, String(fx.officeB._id), { code: "BAD CODE" })).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});
