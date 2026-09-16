import { ForbiddenError, InvalidOfficeError } from "@/lib/errors";
import type { CurrentUser } from "@/types";

/**
 * Pure office-scope rules (spec §6, §38, §39). There is no permissions object and no extra roles:
 *   admin → all offices
 *   user  → only user.officeId
 * A normal user who explicitly asks for another office (query, body or URL) gets 403 Forbidden;
 * a client-supplied officeId is never used for a normal user.
 */

type ScopeUser = Pick<CurrentUser, "role" | "officeId">;

const ALL_OFFICES = "all";

export function isAdmin(user: Pick<CurrentUser, "role">): boolean {
  return user.role === "admin";
}

export function canAccessOffice(user: ScopeUser, officeId: unknown): boolean {
  if (isAdmin(user)) return true;
  if (!user.officeId || officeId === null || officeId === undefined) return false;
  return String(officeId) === user.officeId;
}

/** Throws ForbiddenError unless the user may access `officeId`. */
export function requireOfficeAccess(user: ScopeUser, officeId: unknown): void {
  if (!canAccessOffice(user, officeId)) {
    throw new ForbiddenError("You do not have access to this office.");
  }
}

/**
 * Office filter for reads (lists, search, dashboards, reports).
 * Returns an office id to filter by, or null meaning "all offices" (admins only).
 */
export function resolveReadOfficeScope(user: ScopeUser, requestedOfficeId?: string | null): string | null {
  const requested = requestedOfficeId ? requestedOfficeId : null;

  if (isAdmin(user)) {
    return requested === null || requested === ALL_OFFICES ? null : requested;
  }

  if (!user.officeId) throw new ForbiddenError("Your account is not assigned to an office.");
  if (requested !== null && requested !== user.officeId) {
    throw new ForbiddenError("You do not have access to this office.");
  }
  return user.officeId;
}

/**
 * Office for a new record. Admins must choose an office; normal users always get their own office.
 * Callers must still verify the office exists and is active (requireActiveOffice).
 */
export function resolveWriteOfficeId(user: ScopeUser, requestedOfficeId?: string | null): string {
  const requested = requestedOfficeId ? requestedOfficeId : null;

  if (isAdmin(user)) {
    if (requested === null || requested === ALL_OFFICES) throw new InvalidOfficeError("Select an office.");
    return requested;
  }

  if (!user.officeId) throw new ForbiddenError("Your account is not assigned to an office.");
  if (requested !== null && requested !== user.officeId) {
    throw new ForbiddenError("You cannot add records for another office.");
  }
  return user.officeId;
}

/** Update/delete/view guard for a loaded record (spec §39). */
export function assertRecordAccess(user: ScopeUser, record: { officeId: unknown }): void {
  requireOfficeAccess(user, record.officeId);
}
