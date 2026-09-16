import { existsSync, readFileSync } from "node:fs";

import type { Model } from "mongoose";
import { z } from "zod";

import { emailSchema } from "@/lib/validation/common";
import { DailyMilestone, Office, User, Visitor } from "@/models";

/**
 * Idempotent seed operations (spec §35), used by scripts/seed.ts and tests/integration/seed.test.ts.
 *
 * Every write is an upsert with `$setOnInsert`, so re-running never creates duplicates and never
 * overwrites later admin edits (renamed or deactivated offices, changed roles, deactivated users).
 * No passwords are created: every account signs in with an email OTP.
 * Callers must connect mongoose first.
 */

/** Initial offices (spec §4, §7.1), created in this order so office selects list them in this order. */
export const SEED_OFFICES = [
  { name: "Director Office", code: "DIRECTOR" },
  { name: "Dean Admin", code: "DEAN-ADMIN" },
  { name: "Dean Academics", code: "DEAN-ACA" },
  { name: "ADSA Office", code: "ADSA" },
  { name: "HR", code: "HR" },
  { name: "Other", code: "OTHER" },
  { name: "XLEAD Office", code: "XLEAD" },
] as const;

/** Insert-only write options: no update timestamps, schema validators on the inserted values. */
const INSERT_ONLY = { upsert: true, timestamps: false, runValidators: true } as const;

export interface IndexSeedResult {
  collection: string;
  indexes: string[];
}

async function ensureModelIndexes<T>(model: Model<T>): Promise<IndexSeedResult> {
  // createIndexes() also creates the collection. Existing indexes are kept (never dropped).
  await model.createIndexes();
  const indexes: Array<{ name?: string }> = await model.listIndexes();
  return {
    collection: model.collection.collectionName,
    indexes: indexes.map((index) => index.name ?? "(unnamed)"),
  };
}

/** Create the four business collections and all schema indexes (spec §34). */
export async function ensureIndexes(): Promise<IndexSeedResult[]> {
  return [
    await ensureModelIndexes(Office),
    await ensureModelIndexes(User),
    await ensureModelIndexes(Visitor),
    await ensureModelIndexes(DailyMilestone),
  ];
}

export interface OfficeSeedResult {
  name: string;
  code: string;
  created: boolean;
}

export async function seedOffices(now: Date = new Date()): Promise<OfficeSeedResult[]> {
  const results: OfficeSeedResult[] = [];
  // Sequential on purpose: creation order defines the default office order.
  for (const office of SEED_OFFICES) {
    const result = await Office.updateOne(
      { code: office.code },
      {
        $setOnInsert: {
          name: office.name,
          code: office.code,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      INSERT_ONLY,
    );
    results.push({ name: office.name, code: office.code, created: result.upsertedCount > 0 });
  }
  return results;
}

export const seedAdminInputSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120, "Name is too long"),
});

export type SeedAdminInput = z.input<typeof seedAdminInputSchema>;

export interface AdminSeedResult {
  email: string;
  name: string;
  created: boolean;
  warnings: string[];
}

interface ExistingUserState {
  role: string;
  isActive: boolean;
}

/** Create the initial administrator (role admin, no office, active) unless the email already exists. */
export async function seedAdmin(input: SeedAdminInput, now: Date = new Date()): Promise<AdminSeedResult> {
  const { email, name } = seedAdminInputSchema.parse(input);

  const result = await User.updateOne(
    { email },
    {
      $setOnInsert: {
        name,
        email,
        role: "admin",
        designation: "",
        officeId: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    },
    INSERT_ONLY,
  );

  const warnings: string[] = [];
  const created = result.upsertedCount > 0;
  if (!created) {
    const existing = await User.findOne({ email }).select("role isActive").lean<ExistingUserState>();
    if (existing && existing.role !== "admin") {
      warnings.push(
        `${email} already exists with role "${existing.role}". It was NOT changed; promote it in User Management or use a different SEED_ADMIN_EMAIL.`,
      );
    }
    if (existing && !existing.isActive) {
      warnings.push(`${email} exists but is inactive. It was NOT reactivated.`);
    }
  }

  return { email, name, created, warnings };
}

export const staffMemberSchema = z.strictObject({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120, "Name is too long"),
  email: emailSchema,
  designation: z.string().trim().max(120, "Designation is too long").default(""),
  officeCode: z.string().trim().toUpperCase().min(2, "Office code is required").max(30),
  /** Defaults to false so staff accounts are only enabled deliberately (spec §62). */
  isActive: z.boolean().default(false),
});

export const staffFileSchema = z
  .strictObject({
    _comment: z.string().optional(),
    users: z.array(staffMemberSchema).max(1000),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.users.forEach((member, index) => {
      if (seen.has(member.email)) {
        ctx.addIssue({
          code: "custom",
          path: ["users", index, "email"],
          message: `Duplicate email ${member.email}`,
        });
      }
      seen.add(member.email);
    });
  });

export type StaffMember = z.output<typeof staffMemberSchema>;

/** Validate parsed staff JSON. Throws an Error listing every problem. */
export function parseStaffData(data: unknown, source = "staff file"): StaffMember[] {
  const result = staffFileSchema.safeParse(data);
  if (!result.success) {
    throw new Error(`Invalid ${source}:\n${z.prettifyError(result.error)}`);
  }
  return result.data.users;
}

/** Read and validate the optional staff file. Returns null when the file does not exist. */
export function loadStaffFile(filePath: string): StaffMember[] | null {
  if (!existsSync(filePath)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  return parseStaffData(data, filePath);
}

export interface StaffSeedResult {
  email: string;
  name: string;
  officeCode: string;
  isActive: boolean;
  created: boolean;
}

export interface StaffSeedSummary {
  results: StaffSeedResult[];
  warnings: string[];
}

interface LeanOfficeCode {
  _id: unknown;
  code: string;
  isActive: boolean;
}

/** Create normal users (role "user") for each staff entry whose email does not exist yet. */
export async function seedStaff(members: StaffMember[], now: Date = new Date()): Promise<StaffSeedSummary> {
  const codes = [...new Set(members.map((member) => member.officeCode))];
  const offices = await Office.find({ code: { $in: codes } })
    .select("_id code isActive")
    .lean<LeanOfficeCode[]>();
  const officeByCode = new Map(offices.map((office) => [office.code, office]));

  const unknownCodes = codes.filter((code) => !officeByCode.has(code));
  if (unknownCodes.length > 0) {
    throw new Error(
      `Unknown office code(s) in staff file: ${unknownCodes.join(", ")}. No staff were created.`,
    );
  }

  const results: StaffSeedResult[] = [];
  const warnings: string[] = [];

  for (const member of members) {
    const office = officeByCode.get(member.officeCode)!;
    const result = await User.updateOne(
      { email: member.email },
      {
        $setOnInsert: {
          name: member.name,
          email: member.email,
          role: "user",
          designation: member.designation,
          officeId: office._id,
          isActive: member.isActive,
          createdAt: now,
          updatedAt: now,
        },
      },
      INSERT_ONLY,
    );
    const created = result.upsertedCount > 0;
    results.push({
      email: member.email,
      name: member.name,
      officeCode: member.officeCode,
      isActive: member.isActive,
      created,
    });

    if (created && member.isActive && member.email.endsWith(".invalid")) {
      warnings.push(`${member.email} uses a placeholder address but was created as active.`);
    }
    if (created && member.isActive && !office.isActive) {
      warnings.push(
        `${member.email} belongs to inactive office ${office.code} and cannot sign in until it is reactivated.`,
      );
    }
  }

  return { results, warnings };
}
