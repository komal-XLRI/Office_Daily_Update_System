import "server-only";

import { Types, type QueryFilter } from "mongoose";

import { connectDB } from "@/lib/db/connect";
import {
  ConflictError,
  ForbiddenError,
  InvalidOfficeError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { isAdmin } from "@/lib/permissions/scope";
import { serializeUser, type LeanUser } from "@/lib/serializers";
import { getOfficeOption, requireActiveOffice } from "@/lib/services/office-options";
import { paginationWindow, toPaginated } from "@/lib/utils/pagination";
import { containsRegex } from "@/lib/utils/strings";
import { isObjectId } from "@/lib/validation/common";
import { userInputSchema, userListQuerySchema, userUpdateSchema } from "@/lib/validation/user";
import { User, type IUser } from "@/models/User";
import type { CurrentUser, Paginated, Role, UserDTO } from "@/types";

/**
 * User management (spec §5, §7.2, §23, §24, §43). Admin only, except getProfile().
 * There is no hard delete: users are deactivated so their historical records stay intact.
 * The hidden `otp` sub-document is never selected or returned from this module.
 */

/** Explicit projection. Never add `otp` here. */
const USER_FIELDS = "name email role designation officeId isActive createdAt updatedAt";
const OFFICE_POPULATE = { path: "officeId", select: "name code" } as const;
const ALL_FILTER_VALUE = "all";

export const EMAIL_TAKEN_MESSAGE = "A user with this email already exists.";

function assertAdmin(user: CurrentUser): void {
  if (!isAdmin(user)) throw new ForbiddenError("Administrator access is required.");
}

function emailTakenError(): ConflictError {
  // `details.field` lets the form show the message on the email input.
  return new ConflictError(EMAIL_TAKEN_MESSAGE, { field: "email" });
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

async function findUserDto(id: string): Promise<UserDTO | null> {
  const doc = await User.findById(id).select(USER_FIELDS).populate(OFFICE_POPULATE).lean<LeanUser>();
  return doc ? serializeUser(doc) : null;
}

async function loadUserDto(id: string): Promise<UserDTO> {
  const dto = await findUserDto(id);
  if (!dto) throw new NotFoundError("User");
  return dto;
}

/** "all" (from filter selects) means no filter. */
function dropAllValues(rawQuery: unknown): unknown {
  if (typeof rawQuery !== "object" || rawQuery === null) return rawQuery ?? {};
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawQuery)) {
    if (value !== ALL_FILTER_VALUE) cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Office rules for a user's final state:
 *   - role "user" must have an office, and a newly assigned office must be active;
 *   - an admin may have no office, or any existing office.
 */
async function assertOfficeAssignment(
  role: Role,
  officeId: string | null,
  options: { officeAssigned: boolean },
): Promise<void> {
  if (role === "user") {
    if (!officeId) {
      const message = "Normal users must be assigned to an office";
      throw new ValidationError(undefined, { officeId: [message] });
    }
    if (options.officeAssigned) await requireActiveOffice(officeId);
    return;
  }

  if (officeId && options.officeAssigned) {
    const office = await getOfficeOption(officeId);
    if (!office) throw new InvalidOfficeError("The selected office does not exist.");
  }
}

/** Paginated user list with search (name/email) and role, office and status filters. Admin only. */
export async function listUsers(user: CurrentUser, rawQuery: unknown): Promise<Paginated<UserDTO>> {
  assertAdmin(user);
  const query = userListQuerySchema.parse(dropAllValues(rawQuery));
  await connectDB();

  const filter: QueryFilter<IUser> = {};
  if (query.q) {
    const pattern = containsRegex(query.q);
    filter.$or = [{ name: pattern }, { email: pattern }];
  }
  if (query.role) filter.role = query.role;
  if (query.officeId) filter.officeId = query.officeId;
  if (query.status) filter.isActive = query.status === "active";

  const { skip, limit } = paginationWindow(query.page, query.pageSize);
  const [docs, total] = await Promise.all([
    User.find(filter)
      .select(USER_FIELDS)
      .populate(OFFICE_POPULATE)
      .sort({ name: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean<LeanUser[]>(),
    User.countDocuments(filter),
  ]);

  return toPaginated(docs.map(serializeUser), total, query.page, query.pageSize);
}

/** A single user by id. Admin only. */
export async function getUser(user: CurrentUser, id: string): Promise<UserDTO> {
  assertAdmin(user);
  if (!isObjectId(id)) throw new NotFoundError("User");
  await connectDB();
  return loadUserDto(id);
}

/** Create a user. Admin only. Emails are unique (normalized to lowercase by the schema). */
export async function createUser(user: CurrentUser, rawInput: unknown): Promise<UserDTO> {
  assertAdmin(user);
  const input = userInputSchema.parse(rawInput);
  await connectDB();

  if (await User.exists({ email: input.email })) throw emailTakenError();
  await assertOfficeAssignment(input.role, input.officeId, { officeAssigned: true });

  let createdId: string;
  try {
    const created = await User.create({
      name: input.name,
      email: input.email,
      role: input.role,
      designation: input.designation,
      officeId: input.officeId,
      isActive: input.isActive,
    });
    createdId = String(created._id);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw emailTakenError();
    throw error;
  }

  return loadUserDto(createdId);
}

interface LeanExistingUser {
  _id: Types.ObjectId;
  email: string;
  role: Role;
  officeId?: Types.ObjectId | null;
  isActive: boolean;
}

/**
 * Partial update. Admin only. The patch is merged with the stored user and the office rules are re-applied.
 * Safety guards: an admin cannot deactivate themselves or change their own role, and the last active admin
 * cannot be deactivated or demoted. Deactivating a user also clears any pending OTP.
 */
export async function updateUser(user: CurrentUser, id: string, rawPatch: unknown): Promise<UserDTO> {
  assertAdmin(user);
  if (!isObjectId(id)) throw new NotFoundError("User");
  const patch = userUpdateSchema.parse(rawPatch);
  await connectDB();

  const existing = await User.findById(id).select("email role officeId isActive").lean<LeanExistingUser>();
  if (!existing) throw new NotFoundError("User");

  const existingOfficeId = existing.officeId ? String(existing.officeId) : null;
  const nextRole = patch.role ?? existing.role;
  const nextOfficeId = patch.officeId === undefined ? existingOfficeId : patch.officeId;
  const nextIsActive = patch.isActive ?? existing.isActive;

  const roleChanged = nextRole !== existing.role;
  const deactivating = existing.isActive && !nextIsActive;

  // Ids are accepted case-insensitively, so compare as ObjectIds (not strings).
  if (new Types.ObjectId(id).equals(user.id)) {
    if (deactivating) throw new ConflictError("You cannot deactivate your own account.");
    if (roleChanged) throw new ConflictError("You cannot change your own role.");
  }

  if (existing.role === "admin" && existing.isActive && (nextRole !== "admin" || !nextIsActive)) {
    const otherActiveAdmins = await User.countDocuments({ _id: { $ne: id }, role: "admin", isActive: true });
    if (otherActiveAdmins === 0) {
      throw new ConflictError(
        deactivating
          ? "This is the last active administrator and cannot be deactivated. Activate or add another administrator first."
          : "This is the last active administrator and cannot be changed to a normal user. Activate or add another administrator first.",
      );
    }
  }

  if (patch.email !== undefined && patch.email !== existing.email) {
    if (await User.exists({ email: patch.email, _id: { $ne: id } })) throw emailTakenError();
  }

  await assertOfficeAssignment(nextRole, nextOfficeId, {
    // A user's office must be active when it is newly assigned (office changed, or promoted to the "user" role).
    officeAssigned: nextOfficeId !== existingOfficeId || (nextRole === "user" && roleChanged),
  });

  const $set: Record<string, unknown> = {};
  if (patch.name !== undefined) $set.name = patch.name;
  if (patch.email !== undefined) $set.email = patch.email;
  if (patch.role !== undefined) $set.role = patch.role;
  if (patch.designation !== undefined) $set.designation = patch.designation;
  if (patch.officeId !== undefined) $set.officeId = patch.officeId;
  if (patch.isActive !== undefined) $set.isActive = patch.isActive;

  // Revoke existing sessions when access-relevant attributes change.
  const revokeSessions = deactivating || roleChanged || nextOfficeId !== existingOfficeId;

  if (Object.keys($set).length > 0) {
    try {
      await User.updateOne(
        { _id: id },
        revokeSessions ? { $set, $inc: { sessionVersion: 1 } } : { $set },
        { runValidators: true },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) throw emailTakenError();
      throw error;
    }
  }

  if (!nextIsActive) {
    // An inactive user must not be able to finish a login started before deactivation. Only touch users
    // with a pending code so no partial otp sub-document is created.
    await User.updateOne(
      { _id: id, "otp.codeHash": { $ne: null } },
      { $set: { "otp.codeHash": null, "otp.expiresAt": null } },
    );
  }

  return loadUserDto(id);
}

/** The signed-in user's own profile (any role). Read-only: there is no self-service update. */
export async function getProfile(user: CurrentUser): Promise<UserDTO> {
  await connectDB();
  return loadUserDto(user.id);
}
