import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import { ForbiddenError, InvalidOfficeError } from "@/lib/errors";
import {
  assertRecordAccess,
  canAccessOffice,
  isAdmin,
  requireOfficeAccess,
  resolveReadOfficeScope,
  resolveWriteOfficeId,
} from "@/lib/permissions/scope";
import type { CurrentUser, Role } from "@/types";

// Spec §56 Authorization: Admin, User A → Office A, User B → Office B.
// admin → all offices; user → own office only; another office → 403 Forbidden (spec §6, §38, §39).

const OFFICE_A = "64f1a0000000000000000a01";
const OFFICE_B = "64f1b0000000000000000b02";

function makeUser(role: Role, officeId: string | null): CurrentUser {
  return {
    id: new Types.ObjectId().toHexString(),
    name: `${role} user`,
    email: `${role}@example.com`,
    role,
    designation: "",
    officeId,
    officeName: null,
  };
}

const admin = makeUser("admin", null);
const adminWithOffice = makeUser("admin", OFFICE_A);
const userA = makeUser("user", OFFICE_A);
const userB = makeUser("user", OFFICE_B);
const userWithoutOffice = makeUser("user", null);

function expectForbidden(action: () => unknown) {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ForbiddenError);
  expect(caught).toMatchObject({ status: 403, code: "FORBIDDEN" });
}

describe("isAdmin", () => {
  it("recognises exactly the admin role", () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(adminWithOffice)).toBe(true);
    expect(isAdmin(userA)).toBe(false);
  });
});

describe("Admin → all offices", () => {
  it("can access every office", () => {
    expect(canAccessOffice(admin, OFFICE_A)).toBe(true);
    expect(canAccessOffice(admin, OFFICE_B)).toBe(true);
    expect(canAccessOffice(admin, new Types.ObjectId(OFFICE_B))).toBe(true);
    expect(canAccessOffice(adminWithOffice, OFFICE_B)).toBe(true);
    expect(() => requireOfficeAccess(admin, OFFICE_B)).not.toThrow();
  });

  it("reads all offices unless a specific office is requested", () => {
    expect(resolveReadOfficeScope(admin)).toBeNull();
    expect(resolveReadOfficeScope(admin, undefined)).toBeNull();
    expect(resolveReadOfficeScope(admin, null)).toBeNull();
    expect(resolveReadOfficeScope(admin, "")).toBeNull();
    expect(resolveReadOfficeScope(admin, "all")).toBeNull();
    expect(resolveReadOfficeScope(admin, OFFICE_A)).toBe(OFFICE_A);
    expect(resolveReadOfficeScope(admin, OFFICE_B)).toBe(OFFICE_B);
    expect(resolveReadOfficeScope(adminWithOffice, OFFICE_B)).toBe(OFFICE_B);
    expect(resolveReadOfficeScope(adminWithOffice, undefined)).toBeNull();
  });

  it("writes to the selected office", () => {
    expect(resolveWriteOfficeId(admin, OFFICE_A)).toBe(OFFICE_A);
    expect(resolveWriteOfficeId(admin, OFFICE_B)).toBe(OFFICE_B);
  });

  it.each([undefined, null, "", "all"])(
    "must choose an office when creating records (requested %j)",
    (requested) => {
      let caught: unknown;
      try {
        resolveWriteOfficeId(admin, requested);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(InvalidOfficeError);
      expect(caught).toMatchObject({ status: 400, code: "INVALID_OFFICE" });
      expect((caught as InvalidOfficeError).fieldErrors?.officeId).toBeDefined();
    },
  );

  it("can update/delete records of any office", () => {
    expect(() => assertRecordAccess(admin, { officeId: new Types.ObjectId(OFFICE_A) })).not.toThrow();
    expect(() => assertRecordAccess(admin, { officeId: new Types.ObjectId(OFFICE_B) })).not.toThrow();
    expect(() => assertRecordAccess(adminWithOffice, { officeId: OFFICE_B })).not.toThrow();
  });
});

describe("User A → Office A only", () => {
  it("can access Office A only", () => {
    expect(canAccessOffice(userA, OFFICE_A)).toBe(true);
    expect(canAccessOffice(userA, new Types.ObjectId(OFFICE_A))).toBe(true);
    expect(canAccessOffice(userA, OFFICE_B)).toBe(false);
    expect(canAccessOffice(userA, new Types.ObjectId(OFFICE_B))).toBe(false);
    expect(canAccessOffice(userA, "all")).toBe(false);
    expect(canAccessOffice(userA, null)).toBe(false);
    expect(canAccessOffice(userA, undefined)).toBe(false);
  });

  it("requireOfficeAccess allows Office A and forbids Office B", () => {
    expect(() => requireOfficeAccess(userA, OFFICE_A)).not.toThrow();
    expectForbidden(() => requireOfficeAccess(userA, OFFICE_B));
  });

  it("always reads Office A when no office or Office A is requested", () => {
    expect(resolveReadOfficeScope(userA)).toBe(OFFICE_A);
    expect(resolveReadOfficeScope(userA, undefined)).toBe(OFFICE_A);
    expect(resolveReadOfficeScope(userA, null)).toBe(OFFICE_A);
    expect(resolveReadOfficeScope(userA, "")).toBe(OFFICE_A);
    expect(resolveReadOfficeScope(userA, OFFICE_A)).toBe(OFFICE_A);
  });

  it("is forbidden from reading Office B or all offices via query parameters", () => {
    expectForbidden(() => resolveReadOfficeScope(userA, OFFICE_B));
    expectForbidden(() => resolveReadOfficeScope(userA, "all"));
  });

  it("creates records only for Office A, ignoring no client choice and rejecting another office", () => {
    expect(resolveWriteOfficeId(userA)).toBe(OFFICE_A);
    expect(resolveWriteOfficeId(userA, undefined)).toBe(OFFICE_A);
    expect(resolveWriteOfficeId(userA, "")).toBe(OFFICE_A);
    expect(resolveWriteOfficeId(userA, OFFICE_A)).toBe(OFFICE_A);
    expectForbidden(() => resolveWriteOfficeId(userA, OFFICE_B));
    expectForbidden(() => resolveWriteOfficeId(userA, "all"));
  });

  it("can update/delete Office A records but not Office B records (URL id manipulation)", () => {
    expect(() => assertRecordAccess(userA, { officeId: new Types.ObjectId(OFFICE_A) })).not.toThrow();
    expect(() => assertRecordAccess(userA, { officeId: OFFICE_A })).not.toThrow();
    expectForbidden(() => assertRecordAccess(userA, { officeId: new Types.ObjectId(OFFICE_B) }));
    expectForbidden(() => assertRecordAccess(userA, { officeId: OFFICE_B }));
    expectForbidden(() => assertRecordAccess(userA, { officeId: null }));
    expectForbidden(() => assertRecordAccess(userA, { officeId: undefined }));
  });
});

describe("User B → Office B only", () => {
  it("mirrors User A for Office B", () => {
    expect(resolveReadOfficeScope(userB)).toBe(OFFICE_B);
    expect(resolveWriteOfficeId(userB, OFFICE_B)).toBe(OFFICE_B);
    expect(() => assertRecordAccess(userB, { officeId: new Types.ObjectId(OFFICE_B) })).not.toThrow();
    expectForbidden(() => resolveReadOfficeScope(userB, OFFICE_A));
    expectForbidden(() => resolveWriteOfficeId(userB, OFFICE_A));
    expectForbidden(() => assertRecordAccess(userB, { officeId: new Types.ObjectId(OFFICE_A) }));
  });
});

describe("user without an office", () => {
  it("cannot access any office", () => {
    expect(canAccessOffice(userWithoutOffice, OFFICE_A)).toBe(false);
    expect(canAccessOffice(userWithoutOffice, null)).toBe(false);
    expectForbidden(() => requireOfficeAccess(userWithoutOffice, OFFICE_A));
    expectForbidden(() => resolveReadOfficeScope(userWithoutOffice));
    expectForbidden(() => resolveReadOfficeScope(userWithoutOffice, OFFICE_A));
    expectForbidden(() => resolveWriteOfficeId(userWithoutOffice));
    expectForbidden(() => resolveWriteOfficeId(userWithoutOffice, OFFICE_A));
    expectForbidden(() => assertRecordAccess(userWithoutOffice, { officeId: null }));
    expectForbidden(() => assertRecordAccess(userWithoutOffice, { officeId: OFFICE_A }));
  });
});
