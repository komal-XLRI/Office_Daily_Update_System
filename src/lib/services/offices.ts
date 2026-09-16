import "server-only";

import type { QueryFilter, Types } from "mongoose";

import { connectDB } from "@/lib/db/connect";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { isAdmin } from "@/lib/permissions/scope";
import { serializeOffice, type LeanOffice } from "@/lib/serializers";
import { paginationWindow, toPaginated } from "@/lib/utils/pagination";
import { containsRegex } from "@/lib/utils/strings";
import { isObjectId } from "@/lib/validation/common";
import {
  officeInputSchema,
  officeListQuerySchema,
  officeUpdateSchema,
  type OfficeUpdateInput,
} from "@/lib/validation/office";
import { Office, type IOffice } from "@/models/Office";
import { User } from "@/models/User";
import type { CurrentUser, OfficeDTO, Paginated } from "@/types";

/**
 * Office management (spec §22). Administrators only. Offices are never hard-deleted:
 * deactivation (`isActive: false`) keeps historical records intact (spec §43).
 */

export type OfficeListItem = OfficeDTO & { activeUserCount: number };

const OFFICE_FIELDS = "name code isActive createdAt updatedAt";
const DUPLICATE_CODE_MESSAGE = "An office with this code already exists.";

function assertAdmin(user: CurrentUser): void {
  if (!isAdmin(user)) throw new ForbiddenError("Administrator access is required.");
}

function duplicateCodeError(): ConflictError {
  return new ConflictError(DUPLICATE_CODE_MESSAGE, { field: "code" });
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

async function assertCodeAvailable(code: string): Promise<void> {
  const filter: QueryFilter<IOffice> = { code };
  if (await Office.exists(filter)) throw duplicateCodeError();
}

/** Paginated office list (seed order) with the number of active users assigned to each office. */
export async function listOffices(
  user: CurrentUser,
  rawQuery: unknown = {},
): Promise<Paginated<OfficeListItem>> {
  assertAdmin(user);
  const query = officeListQuerySchema.parse(rawQuery ?? {});
  await connectDB();

  const filter: QueryFilter<IOffice> = {};
  if (query.q) {
    const pattern = containsRegex(query.q);
    filter.$or = [{ name: pattern }, { code: pattern }];
  }
  if (query.status) filter.isActive = query.status === "active";

  const total = await Office.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const { skip, limit } = paginationWindow(page, query.pageSize);

  const offices = await Office.find(filter)
    .select(OFFICE_FIELDS)
    .sort({ _id: 1 })
    .skip(skip)
    .limit(limit)
    .lean<LeanOffice[]>();

  const counts = new Map<string, number>();
  if (offices.length > 0) {
    const grouped = await User.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { officeId: { $in: offices.map((office) => office._id) }, isActive: true } },
      { $group: { _id: "$officeId", count: { $sum: 1 } } },
    ]);
    for (const row of grouped) counts.set(String(row._id), row.count);
  }

  const items = offices.map((office) => {
    const dto = serializeOffice(office);
    return { ...dto, activeUserCount: counts.get(dto.id) ?? 0 };
  });

  return toPaginated(items, total, page, query.pageSize);
}

export async function getOffice(user: CurrentUser, id: string): Promise<OfficeDTO> {
  assertAdmin(user);
  if (!isObjectId(id)) throw new NotFoundError("Office");
  await connectDB();

  const office = await Office.findById(id).select(OFFICE_FIELDS).lean<LeanOffice>();
  if (!office) throw new NotFoundError("Office");
  return serializeOffice(office);
}

export async function createOffice(user: CurrentUser, rawInput: unknown): Promise<OfficeDTO> {
  assertAdmin(user);
  const input = officeInputSchema.parse(rawInput);
  await connectDB();

  await assertCodeAvailable(input.code);
  try {
    const office = await Office.create({ name: input.name, code: input.code, isActive: input.isActive });
    return serializeOffice(office.toObject());
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateCodeError();
    throw error;
  }
}

/** Partial update, e.g. `{ isActive: false }` to deactivate. Codes are immutable (a `code` key is rejected). An empty patch returns the office unchanged. */
export async function updateOffice(user: CurrentUser, id: string, rawPatch: unknown): Promise<OfficeDTO> {
  assertAdmin(user);
  if (!isObjectId(id)) throw new NotFoundError("Office");
  const patch = officeUpdateSchema.parse(rawPatch);
  await connectDB();

  const changes: OfficeUpdateInput = {};
  if (patch.name !== undefined) changes.name = patch.name;
  if (patch.isActive !== undefined) changes.isActive = patch.isActive;

  if (Object.keys(changes).length === 0) return getOffice(user, id);

  try {
    const office = await Office.findByIdAndUpdate(
      id,
      { $set: changes },
      { returnDocument: "after", runValidators: true },
    )
      .select(OFFICE_FIELDS)
      .lean<LeanOffice>();
    if (!office) throw new NotFoundError("Office");
    return serializeOffice(office);
  } catch (error) {
    if (isDuplicateKeyError(error)) throw duplicateCodeError();
    throw error;
  }
}
