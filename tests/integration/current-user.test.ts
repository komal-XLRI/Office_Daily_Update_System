import { Types } from "mongoose";
import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession, type SessionPayload } from "@/lib/auth/session";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { getCurrentUser, requireAdmin, requireAuth, requirePageUser } from "@/lib/permissions";
import { Office } from "@/models/Office";
import { User } from "@/models/User";

import { createAuthorizationFixture, createOffice, createUser, registerTestDatabase, type UserDocument } from "../setup/db";

// Spec §5-6 (roles, server-side authorization), §12 (session), §45.1/§45.3/§45.11, §55.5-7, §56.

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

registerTestDatabase();

const mockedGetSession = vi.mocked(getSession);
const mockedRedirect = vi.mocked(redirect);

beforeEach(() => {
  mockedGetSession.mockReset();
  mockedGetSession.mockResolvedValue(null);
  mockedRedirect.mockReset();
  mockedRedirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
});

function sessionFor(user: UserDocument, overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    userId: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    officeId: user.officeId ? String(user.officeId) : null,
    ...overrides,
  };
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail");
}

async function expectSignedOut() {
  await expect(getCurrentUser()).resolves.toBeNull();
  const authError = await capture(requireAuth());
  expect(authError).toBeInstanceOf(UnauthorizedError);
  expect(authError).toMatchObject({ status: 401, code: "UNAUTHORIZED", message: "Please sign in to continue." });
  expect(await capture(requireAdmin())).toBeInstanceOf(UnauthorizedError);
}

describe("getCurrentUser", () => {
  it("returns null without a session", async () => {
    await expectSignedOut();
    expect(mockedGetSession).toHaveBeenCalled();
  });

  it("returns the user loaded from the database for a valid session", async () => {
    const { officeA, userADoc } = await createAuthorizationFixture();
    await User.updateOne({ _id: userADoc._id }, { $set: { designation: "Office Assistant" } });
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));

    const user = await getCurrentUser();

    expect(user).toEqual({
      id: String(userADoc._id),
      name: "User A",
      email: "user.a@example.com",
      role: "user",
      designation: "Office Assistant",
      officeId: String(officeA._id),
      officeName: "Office A",
    });
    expect(user).not.toHaveProperty("otp");
    await expect(requireAuth()).resolves.toEqual(user);
  });

  it.each(["not-an-object-id", '{"$ne":null}', "", "64f1a0000000000000000a0"])(
    "returns null for a session with an invalid userId %j",
    async (userId) => {
      await createAuthorizationFixture();
      mockedGetSession.mockResolvedValue({
        userId,
        name: "Forged",
        email: "forged@example.com",
        role: "admin",
        officeId: null,
      });
      await expectSignedOut();
    },
  );

  it("returns null when the user no longer exists", async () => {
    const { userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));
    await User.deleteOne({ _id: userADoc._id });
    await expectSignedOut();
  });

  it("returns null for a session whose user id was never registered", async () => {
    await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue({
      userId: new Types.ObjectId().toHexString(),
      name: "Ghost",
      email: "ghost@example.com",
      role: "admin",
      officeId: null,
    });
    await expectSignedOut();
  });

  it("returns null for an inactive user (spec §55.5)", async () => {
    const { userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));
    await User.updateOne({ _id: userADoc._id }, { $set: { isActive: false } });
    await expectSignedOut();
  });

  it("returns null for an inactive admin", async () => {
    const { adminDoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(adminDoc));
    await User.updateOne({ _id: adminDoc._id }, { $set: { isActive: false } });
    await expectSignedOut();
  });

  it("returns null for a normal user whose office is inactive", async () => {
    const { officeA, userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));
    await Office.updateOne({ _id: officeA._id }, { $set: { isActive: false } });
    await expectSignedOut();
  });

  it("returns null for a normal user whose office was deleted", async () => {
    const { officeA, userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));
    await Office.deleteOne({ _id: officeA._id });
    await expectSignedOut();
  });

  it("returns null for a normal user without an office in the database", async () => {
    const { userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));
    await User.collection.updateOne({ _id: userADoc._id }, { $set: { officeId: null } });
    await expectSignedOut();
  });

  it("returns an admin without an office", async () => {
    const { adminDoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(adminDoc));

    await expect(getCurrentUser()).resolves.toEqual({
      id: String(adminDoc._id),
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      designation: "",
      officeId: null,
      officeName: null,
    });
    await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });
  });

  it("returns an admin whose optional office is inactive", async () => {
    const office = await createOffice({ name: "Closed Office", isActive: false });
    const admin = await createUser({ role: "admin", officeId: office, email: "admin.closed@example.com" });
    mockedGetSession.mockResolvedValue(sessionFor(admin));

    await expect(getCurrentUser()).resolves.toMatchObject({
      role: "admin",
      officeId: String(office._id),
      officeName: "Closed Office",
    });
    await expect(requireAdmin()).resolves.toMatchObject({ id: String(admin._id) });
  });

  it("takes role, office, name and email from the database, not from the token (spec §55.11)", async () => {
    const { officeA, officeB, userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(
      sessionFor(userADoc, {
        role: "admin",
        officeId: String(officeB._id),
        name: "Forged Name",
        email: "forged@example.com",
      }),
    );

    const user = await getCurrentUser();
    expect(user).toMatchObject({
      id: String(userADoc._id),
      role: "user",
      officeId: String(officeA._id),
      officeName: "Office A",
      name: "User A",
      email: "user.a@example.com",
    });

    const error = await capture(requireAdmin());
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", message: "Administrator access is required." });
  });

  it("applies promotions, demotions and office moves immediately for an existing session", async () => {
    const { officeB, userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));

    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);

    await User.updateOne({ _id: userADoc._id }, { $set: { role: "admin" } });
    await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });

    await User.updateOne({ _id: userADoc._id }, { $set: { role: "user", officeId: officeB._id } });
    await expect(getCurrentUser()).resolves.toMatchObject({
      role: "user",
      officeId: String(officeB._id),
      officeName: "Office B",
    });
    await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requireAuth / requireAdmin / requirePageUser", () => {
  it("requireAuth throws UnauthorizedError when signed out", async () => {
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("requireAdmin throws ForbiddenError for normal users of any office", async () => {
    const { userADoc, userBDoc } = await createAuthorizationFixture();
    for (const doc of [userADoc, userBDoc]) {
      mockedGetSession.mockResolvedValue(sessionFor(doc));
      await expect(requireAuth()).resolves.toMatchObject({ role: "user" });
      await expect(requireAdmin()).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("requireAdmin returns the admin", async () => {
    const { adminDoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(adminDoc));
    await expect(requireAdmin()).resolves.toMatchObject({ id: String(adminDoc._id), role: "admin" });
  });

  it("requirePageUser redirects to /login?expired=1 when signed out", async () => {
    await expect(requirePageUser()).rejects.toThrow("NEXT_REDIRECT:/login?expired=1");
    expect(mockedRedirect).toHaveBeenCalledWith("/login?expired=1");
  });

  it("requirePageUser redirects when the account was deactivated", async () => {
    const { userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));
    await User.updateOne({ _id: userADoc._id }, { $set: { isActive: false } });
    await expect(requirePageUser()).rejects.toThrow("NEXT_REDIRECT:/login?expired=1");
  });

  it("requirePageUser returns the signed-in user without redirecting", async () => {
    const { userADoc } = await createAuthorizationFixture();
    mockedGetSession.mockResolvedValue(sessionFor(userADoc));
    await expect(requirePageUser()).resolves.toMatchObject({ id: String(userADoc._id) });
    expect(mockedRedirect).not.toHaveBeenCalled();
  });
});
