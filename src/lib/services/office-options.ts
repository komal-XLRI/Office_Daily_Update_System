import "server-only";

import type { Types } from "mongoose";

import { connectDB } from "@/lib/db/connect";
import { InvalidOfficeError } from "@/lib/errors";
import { isObjectId } from "@/lib/validation/common";
import { Office } from "@/models/Office";
import type { OfficeOption } from "@/types";

interface LeanOfficeOption {
  _id: Types.ObjectId;
  name: string;
  code: string;
  isActive: boolean;
}

function toOption(office: LeanOfficeOption): OfficeOption {
  return { id: String(office._id), name: office.name, code: office.code, isActive: office.isActive };
}

/** Offices for selects/filters, in creation (seed) order. Active only unless includeInactive. */
export async function listOfficeOptions(options: { includeInactive?: boolean } = {}): Promise<OfficeOption[]> {
  await connectDB();
  const filter = options.includeInactive ? {} : { isActive: true };
  const offices = await Office.find(filter)
    .select("name code isActive")
    .sort({ _id: 1 })
    .lean<LeanOfficeOption[]>();
  return offices.map(toOption);
}

export async function getOfficeOption(officeId: string): Promise<OfficeOption | null> {
  if (!isObjectId(officeId)) return null;
  await connectDB();
  const office = await Office.findById(officeId).select("name code isActive").lean<LeanOfficeOption>();
  return office ? toOption(office) : null;
}

/** Throws InvalidOfficeError unless the office exists and is active. Use before creating records. */
export async function requireActiveOffice(officeId: string): Promise<OfficeOption> {
  const office = await getOfficeOption(officeId);
  if (!office || !office.isActive) throw new InvalidOfficeError();
  return office;
}
