import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  ConflictError,
  ForbiddenError,
  InvalidOfficeError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { createUser, getProfile, getUser, listUsers, updateUser } from "@/lib/services/users";
import { User, Visitor } from "@/models";
import type { UserDTO } from "@/types";

import {
  createAuthorizationFixture,
  createOffice as seedOffice,
  createUser as seedUser,
  createVisitor as seedVisitor,
  makeCurrentUser,
  registerTestDatabase,
  type AuthorizationFixture,
} from "../setup/db";

// Spec §5, §23 (User management: admin only), §24 (Profile), §43 (deactivate, never delete).

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

async function expectConflict(promise: Promise<unknown>, message?: RegExp): Promise<ConflictError> {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(ConflictError);
  expect(error).toMatchObject({ status: 409, code: "CONFLICT" });
  if (message) expect((error as ConflictError).message).toMatch(message);
  return error as ConflictError;
}

function userInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Priya Nair",
    email: "priya.nair@example.com",
    role: "user",
    designation: "Assistant Manager",
    officeId: String(fx.officeA._id),
    isActive: true,
    ...overrides,
  };
}

const PENDING_OTP = {
  codeHash: "hmac-of-pending-code-0123456789abcdef",
  expiresAt: new Date(Date.now() + 5 * 60_000),
  attempts: 1,
  lastSentAt: new Date(),
  sendWindowStartedAt: new Date(),
  sendCount: 2,
};

async function setPendingOtp(userId: Types.ObjectId | string): Promise<void> {
  await User.updateOne({ _id: userId }, { $set: { otp: PENDING_OTP } });
}

function expectNoOtp(dto: UserDTO | UserDTO[]): void {
  const list = Array.isArray(dto) ? dto : [dto];
  for (const item of list) expect(item).not.toHaveProperty("otp");
  const json = JSON.stringify(dto);
  expect(json).not.toContain("otp");
  expect(json).not.toContain(PENDING_OTP.codeHash);
}

describe("admin-only access", () => {
  it("returns 403 to normal users for every management function and changes nothing", async () => {
    const before = await User.find().sort({ _id: 1 }).lean();

    for (const user of [fx.userA, fx.userB]) {
      await expectForbidden(listUsers(user, {}));
      await expectForbidden(listUsers(user, { officeId: String(fx.officeA._id) }));
      await expectForbidden(getUser(user, user.id));
      await expectForbidden(getUser(user, fx.admin.id));
      await expectForbidden(createUser(user, userInput({ email: "rogue@example.com" })));
      await expectForbidden(createUser(user, { email: "not-valid" }));
      // Normal users can never change their own role or office (spec §5, §23, §24).
      await expectForbidden(updateUser(user, user.id, { role: "admin" }));
      await expectForbidden(updateUser(user, user.id, { officeId: String(fx.officeB._id) }));
      await expectForbidden(updateUser(user, fx.admin.id, { isActive: false }));
      await expectForbidden(updateUser(user, "not-an-id", {}));
    }

    const after = await User.find().sort({ _id: 1 }).lean();
    expect(after).toEqual(before);
  });

  it("lets normal users read their own profile", async () => {
    const profile = await getProfile(fx.userA);
    expect(profile).toMatchObject({
      id: fx.userA.id,
      name: "User A",
      email: "user.a@example.com",
      role: "user",
      officeId: String(fx.officeA._id),
      office: { id: String(fx.officeA._id), name: "Office A", code: "OFFICE-A" },
      isActive: true,
    });

    const adminProfile = await getProfile(fx.admin);
    expect(adminProfile).toMatchObject({ role: "admin", officeId: null, office: null });

    const ghost = makeCurrentUser({
      _id: new Types.ObjectId(),
      name: "Ghost",
      email: "ghost@example.com",
      role: "user",
      officeId: fx.officeA._id,
    });
    await expect(getProfile(ghost)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("createUser", () => {
  it("trims and lowercases the email and populates the office", async () => {
    const created = await createUser(fx.admin, userInput({ email: "  Priya.NAIR@Example.COM ", name: "  Priya Nair " }));

    expect(created).toMatchObject({
      name: "Priya Nair",
      email: "priya.nair@example.com",
      role: "user",
      designation: "Assistant Manager",
      officeId: String(fx.officeA._id),
      office: { name: "Office A", code: "OFFICE-A" },
      isActive: true,
    });
    expect((await User.findById(created.id).lean())?.email).toBe("priya.nair@example.com");
  });

  it("rejects a duplicate email regardless of letter case", async () => {
    const error = await expectConflict(createUser(fx.admin, userInput({ email: "USER.A@example.com" })));
    expect(error.details).toEqual({ field: "email" });
    expect(await User.countDocuments({ email: "user.a@example.com" })).toBe(1);
  });

  it("maps a concurrent duplicate email to a conflict", async () => {
    const results = await Promise.allSettled([
      createUser(fx.admin, userInput({ email: "race@example.com" })),
      createUser(fx.admin, userInput({ email: "RACE@example.com", officeId: String(fx.officeB._id) })),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")?.reason).toBeInstanceOf(ConflictError);
    expect(await User.countDocuments({ email: "race@example.com" })).toBe(1);
  });

  it("requires an active, existing office for role user", async () => {
    const noOffice = await captureError(createUser(fx.admin, userInput({ officeId: null })));
    expect(noOffice).toBeInstanceOf(ZodError);
    expect((noOffice as ZodError).issues.map((issue) => issue.path.join("."))).toContain("officeId");

    const inactive = await seedOffice({ name: "Closed", code: "CLOSED", isActive: false });
    await expect(createUser(fx.admin, userInput({ officeId: String(inactive._id) }))).rejects.toBeInstanceOf(
      InvalidOfficeError,
    );
    await expect(
      createUser(fx.admin, userInput({ officeId: new Types.ObjectId().toHexString() })),
    ).rejects.toBeInstanceOf(InvalidOfficeError);

    expect(await User.exists({ email: "priya.nair@example.com" })).toBeNull();
  });

  it("allows an administrator without an office, or with an existing office", async () => {
    const adminNoOffice = await createUser(fx.admin, userInput({ role: "admin", officeId: null, email: "a2@example.com" }));
    expect(adminNoOffice).toMatchObject({ role: "admin", officeId: null, office: null });

    const adminWithOffice = await createUser(
      fx.admin,
      userInput({ role: "admin", officeId: String(fx.officeB._id), email: "a3@example.com" }),
    );
    expect(adminWithOffice).toMatchObject({ role: "admin", officeId: String(fx.officeB._id) });

    await expect(
      createUser(fx.admin, userInput({ role: "admin", officeId: new Types.ObjectId().toHexString(), email: "a4@example.com" })),
    ).rejects.toBeInstanceOf(InvalidOfficeError);
  });

  it("validates role and email", async () => {
    await expect(createUser(fx.admin, userInput({ role: "manager" }))).rejects.toBeInstanceOf(ZodError);
    await expect(createUser(fx.admin, userInput({ email: "not-an-email" }))).rejects.toBeInstanceOf(ZodError);
    await expect(createUser(fx.admin, userInput({ officeId: "office-a" }))).rejects.toBeInstanceOf(ZodError);
  });
});

describe("updateUser guards", () => {
  it("prevents an administrator from deactivating themselves or changing their own role", async () => {
    await seedUser({ role: "admin", officeId: null, email: "second.admin@example.com" });

    await expectConflict(updateUser(fx.admin, fx.admin.id, { isActive: false }), /deactivate your own/i);
    await expectConflict(
      updateUser(fx.admin, fx.admin.id, { role: "user", officeId: String(fx.officeA._id) }),
      /own role/i,
    );

    const stored = await User.findById(fx.admin.id).lean();
    expect(stored).toMatchObject({ role: "admin", isActive: true });

    // Harmless self-edits are fine.
    await expect(
      updateUser(fx.admin, fx.admin.id, { name: "Chief Admin", role: "admin", isActive: true }),
    ).resolves.toMatchObject({ name: "Chief Admin", role: "admin", isActive: true });
  });

  // APP BUG: updateUser compares `id === user.id` case-sensitively, but ObjectIds are accepted in any letter case
  // (isObjectId / getRouteId use /i). PATCH /api/users/<OWN ID IN UPPERCASE> {isActive:false} bypasses the
  // self-deactivation and own-role-change guards whenever another active administrator exists.
  it("applies the self-guards when the administrator's own id is sent in upper case", async () => {
    await seedUser({ role: "admin", officeId: null, email: "second.admin@example.com" });

    await expectConflict(updateUser(fx.admin, fx.admin.id.toUpperCase(), { isActive: false }), /own account/i);

    const stored = await User.findById(fx.admin.id).lean();
    expect(stored?.isActive).toBe(true);
  });

  it("increments sessionVersion on deactivation, role change and office change only", async () => {
    const doc = await seedUser({ role: "user", officeId: fx.officeA._id, email: "revoke.me@example.com" });
    const id = String(doc._id);
    const version = async () => (await User.findById(id).lean())?.sessionVersion ?? 0;

    await updateUser(fx.admin, id, { name: "Renamed" });
    expect(await version()).toBe(0);
    await updateUser(fx.admin, id, { officeId: String(fx.officeB._id) });
    expect(await version()).toBe(1);
    await updateUser(fx.admin, id, { role: "admin" });
    expect(await version()).toBe(2);
    await updateUser(fx.admin, id, { isActive: false });
    expect(await version()).toBe(3);
  });

  it("never deactivates or demotes the last active administrator", async () => {
    // Acting admin whose own account has since been deactivated (defence in depth for the guard).
    const formerAdminDoc = await seedUser({ role: "admin", officeId: null, email: "former.admin@example.com", isActive: false });
    const formerAdmin = makeCurrentUser(formerAdminDoc);

    await expectConflict(updateUser(formerAdmin, fx.admin.id, { isActive: false }), /last active administrator/i);
    await expectConflict(
      updateUser(formerAdmin, fx.admin.id, { role: "user", officeId: String(fx.officeA._id) }),
      /last active administrator/i,
    );
    expect(await User.findById(fx.admin.id).lean()).toMatchObject({ role: "admin", isActive: true });

    // Once another admin is active, the first one may be deactivated by a different admin.
    const secondAdminDoc = await seedUser({ role: "admin", officeId: null, email: "second.admin@example.com" });
    const secondAdmin = makeCurrentUser(secondAdminDoc);
    await expect(updateUser(secondAdmin, fx.admin.id, { isActive: false })).resolves.toMatchObject({
      isActive: false,
    });

    // Now secondAdmin is the only active admin; formerAdmin (inactive) cannot remove them either.
    await expectConflict(updateUser(formerAdmin, secondAdmin.id, { isActive: false }), /last active administrator/i);
  });

  it("allows reactivating and editing inactive administrators", async () => {
    const inactiveAdmin = await seedUser({ role: "admin", officeId: null, email: "old.admin@example.com", isActive: false });
    await expect(updateUser(fx.admin, String(inactiveAdmin._id), { isActive: true })).resolves.toMatchObject({
      isActive: true,
    });
  });
});

describe("updateUser office and email rules", () => {
  it("requires an office when changing an administrator to a normal user", async () => {
    const other = await seedUser({ role: "admin", officeId: null, email: "other.admin@example.com" });

    const error = await captureError(updateUser(fx.admin, String(other._id), { role: "user" }));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.officeId).toEqual(["Normal users must be assigned to an office"]);
    expect((await User.findById(other._id).lean())?.role).toBe("admin");

    const demoted = await updateUser(fx.admin, String(other._id), {
      role: "user",
      officeId: String(fx.officeB._id),
    });
    expect(demoted).toMatchObject({ role: "user", officeId: String(fx.officeB._id), office: { name: "Office B" } });
  });

  it("rejects removing a normal user's office and assigning an inactive or unknown office", async () => {
    const id = fx.userA.id;
    await expect(updateUser(fx.admin, id, { officeId: null })).rejects.toBeInstanceOf(ValidationError);

    const inactive = await seedOffice({ name: "Closed", code: "CLOSED", isActive: false });
    await expect(updateUser(fx.admin, id, { officeId: String(inactive._id) })).rejects.toBeInstanceOf(
      InvalidOfficeError,
    );
    await expect(
      updateUser(fx.admin, id, { officeId: new Types.ObjectId().toHexString() }),
    ).rejects.toBeInstanceOf(InvalidOfficeError);

    expect(String((await User.findById(id).lean())?.officeId)).toBe(String(fx.officeA._id));

    const moved = await updateUser(fx.admin, id, { officeId: String(fx.officeB._id) });
    expect(moved.officeId).toBe(String(fx.officeB._id));
  });

  it("lets an administrator edit a user whose existing office has since become inactive", async () => {
    const office = await seedOffice({ name: "Soon closed", code: "SOON" });
    const member = await seedUser({ officeId: office, email: "member@example.com" });
    await office.updateOne({ $set: { isActive: false } });

    await expect(updateUser(fx.admin, String(member._id), { designation: "Clerk" })).resolves.toMatchObject({
      designation: "Clerk",
      officeId: String(office._id),
    });
  });

  it("lets an admin be promoted from user and keep no office", async () => {
    const promoted = await updateUser(fx.admin, fx.userB.id, { role: "admin", officeId: null });
    expect(promoted).toMatchObject({ role: "admin", officeId: null, office: null });
  });

  it("lowercases email changes and rejects another user's email", async () => {
    const error = await expectConflict(updateUser(fx.admin, fx.userA.id, { email: "USER.B@EXAMPLE.COM" }));
    expect(error.details).toEqual({ field: "email" });

    await expect(updateUser(fx.admin, fx.userA.id, { email: "User.A@Example.com" })).resolves.toMatchObject({
      email: "user.a@example.com",
    });
    await expect(updateUser(fx.admin, fx.userA.id, { email: " New.A@Example.com " })).resolves.toMatchObject({
      email: "new.a@example.com",
    });
  });

  it("returns 404 for malformed or unknown ids", async () => {
    await expect(getUser(fx.admin, "nope")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getUser(fx.admin, new Types.ObjectId().toHexString())).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateUser(fx.admin, "nope", { name: "Nobody" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateUser(fx.admin, new Types.ObjectId().toHexString(), { name: "Nobody" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deactivation (spec §43) and the hidden OTP state", () => {
  it("clears a pending OTP when a user is deactivated and keeps historical records", async () => {
    await setPendingOtp(fx.userADoc._id);
    const visitor = await seedVisitor({ officeId: fx.officeA, createdBy: fx.userADoc });

    const result = await updateUser(fx.admin, fx.userA.id, { isActive: false });
    expect(result.isActive).toBe(false);
    expectNoOtp(result);

    const stored = await User.findById(fx.userA.id).select("+otp").lean();
    expect(stored?.otp).toMatchObject({ codeHash: null, expiresAt: null, sendCount: PENDING_OTP.sendCount });
    expect(stored?.isActive).toBe(false);

    expect(await User.countDocuments()).toBe(3);
    const storedVisitor = await Visitor.findById(visitor._id).lean();
    expect(String(storedVisitor?.createdBy)).toBe(fx.userA.id);
  });

  it("clears a pending OTP when saving an already inactive user, without creating otp for others", async () => {
    await updateUser(fx.admin, fx.userB.id, { isActive: false });
    const raw = await User.collection.findOne({ _id: fx.userBDoc._id });
    expect(raw).not.toHaveProperty("otp");

    await setPendingOtp(fx.userBDoc._id);
    await updateUser(fx.admin, fx.userB.id, { designation: "Still inactive" });
    const stored = await User.findById(fx.userB.id).select("+otp").lean();
    expect(stored?.otp?.codeHash).toBeNull();
  });

  it("keeps the pending OTP of active users untouched", async () => {
    await setPendingOtp(fx.userADoc._id);
    await updateUser(fx.admin, fx.userA.id, { designation: "Senior Officer" });
    const stored = await User.findById(fx.userA.id).select("+otp").lean();
    expect(stored?.otp?.codeHash).toBe(PENDING_OTP.codeHash);
  });

  it("never returns otp from any user DTO", async () => {
    await setPendingOtp(fx.userADoc._id);
    await setPendingOtp(fx.adminDoc._id);

    const list = await listUsers(fx.admin, {});
    expect(list.total).toBe(3);
    expectNoOtp(list.items);
    for (const item of list.items) {
      expect(Object.keys(item).sort()).toEqual([
        "createdAt",
        "designation",
        "email",
        "id",
        "isActive",
        "name",
        "office",
        "officeId",
        "role",
        "updatedAt",
      ]);
    }

    expectNoOtp(await getUser(fx.admin, fx.userA.id));
    expectNoOtp(await updateUser(fx.admin, fx.userA.id, { name: "User A (renamed)" }));
    expectNoOtp(await getProfile(fx.userA));
    expectNoOtp(await getProfile(fx.admin));
    expectNoOtp(await createUser(fx.admin, userInput()));
  });
});

describe("listUsers filters", () => {
  beforeEach(async () => {
    await seedUser({ name: "Zara Inactive", email: "zara@example.com", officeId: fx.officeA, isActive: false });
    await seedUser({ name: "Beta Admin", email: "beta.admin@example.com", role: "admin", officeId: fx.officeB });
  });

  it("lists users sorted by name with populated offices", async () => {
    const result = await listUsers(fx.admin, {});
    expect(result.total).toBe(5);
    expect(result.items.map((item) => item.name)).toEqual(["Admin", "Beta Admin", "User A", "User B", "Zara Inactive"]);
    expect(result.items.find((item) => item.name === "User B")?.office).toEqual({
      id: String(fx.officeB._id),
      name: "Office B",
      code: "OFFICE-B",
    });
  });

  it("filters by keyword, role, office and status and ignores 'all' values", async () => {
    const names = async (query: Record<string, unknown>) =>
      (await listUsers(fx.admin, query)).items.map((item) => item.name);

    expect(await names({ q: "ZARA" })).toEqual(["Zara Inactive"]);
    expect(await names({ q: "user.b@" })).toEqual(["User B"]);
    expect(await names({ q: "a.*" })).toEqual([]);
    expect(await names({ role: "admin" })).toEqual(["Admin", "Beta Admin"]);
    expect(await names({ officeId: String(fx.officeA._id) })).toEqual(["User A", "Zara Inactive"]);
    expect(await names({ status: "inactive" })).toEqual(["Zara Inactive"]);
    expect(await names({ status: "active", officeId: String(fx.officeB._id) })).toEqual(["Beta Admin", "User B"]);
    expect(await names({ role: "all", officeId: "all", status: "all" })).toHaveLength(5);

    const page = await listUsers(fx.admin, { page: 2, pageSize: 2 });
    expect(page).toMatchObject({ page: 2, total: 5, totalPages: 3 });
    expect(page.items.map((item) => item.name)).toEqual(["User A", "User B"]);

    await expect(listUsers(fx.admin, { role: "superuser" })).rejects.toBeInstanceOf(ZodError);
  });
});
