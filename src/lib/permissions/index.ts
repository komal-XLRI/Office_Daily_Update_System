import "server-only";

import type { Types } from "mongoose";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getSession } from "@/lib/auth/session";
import { connectDB } from "@/lib/db/connect";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { isObjectId } from "@/lib/validation/common";
import { Office } from "@/models/Office";
import { User } from "@/models/User";
import type { CurrentUser, Role } from "@/types";

import { isAdmin } from "./scope";

export {
  assertRecordAccess,
  canAccessOffice,
  isAdmin,
  requireOfficeAccess,
  resolveReadOfficeScope,
  resolveWriteOfficeId,
} from "./scope";

interface LeanSessionUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  designation?: string;
  officeId?: Types.ObjectId | null;
  isActive: boolean;
  sessionVersion?: number;
}

/**
 * The authenticated user loaded fresh from MongoDB, or null.
 * Returns null when the session is missing/invalid, the user no longer exists or is inactive,
 * or a normal user's office is missing or inactive. Role and office always come from the database,
 * never from the cookie. Memoized per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getSession();
  if (!session || !isObjectId(session.userId)) return null;

  await connectDB();
  const user = await User.findById(session.userId)
    .select("name email role designation officeId isActive sessionVersion")
    .lean<LeanSessionUser>();
  if (!user || !user.isActive) return null;
  // Revoked session (logout, deactivation, role or office change since sign-in).
  if ((user.sessionVersion ?? 0) !== (session.sessionVersion ?? 0)) return null;

  let officeName: string | null = null;
  if (user.officeId) {
    const office = await Office.findById(user.officeId).select("name isActive").lean<{
      name: string;
      isActive: boolean;
    }>();
    if (user.role === "user" && (!office || !office.isActive)) return null;
    officeName = office?.name ?? null;
  } else if (user.role === "user") {
    return null;
  }

  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    designation: user.designation ?? "",
    officeId: user.officeId ? String(user.officeId) : null,
    officeName,
  };
});

/** For Route Handlers: throws UnauthorizedError (401) when not signed in. */
export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** For Route Handlers: throws 401 when not signed in, 403 when not an admin. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireAuth();
  if (!isAdmin(user)) throw new ForbiddenError("Administrator access is required.");
  return user;
}

/** For Server Component pages: redirects to /login when not signed in. */
export async function requirePageUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?expired=1");
  return user;
}
