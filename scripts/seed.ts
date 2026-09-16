/**
 * Idempotent database seed (spec §35): indexes, the seven initial offices, the initial administrator and
 * (optionally) staff accounts from scripts/seed-data/staff.json.
 *
 *   npm run seed
 *
 * Configuration is read from .env.local, then .env (variables already set in the environment win):
 *   MONGODB_URI        required
 *   SEED_ADMIN_EMAIL   required; the administrator signs in with an email OTP (no password)
 *   SEED_ADMIN_NAME    optional, default "System Administrator"
 *
 * Safe to run repeatedly: existing offices and users are never modified.
 */
import path from "node:path";

import { config as loadEnv } from "dotenv";
import mongoose from "mongoose";
import { z } from "zod";

import { blankToUndefined } from "@/lib/validation/common";

import {
  ensureIndexes,
  loadStaffFile,
  seedAdmin,
  seedAdminInputSchema,
  seedOffices,
  seedStaff,
} from "./seed-data/seed-database";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const STAFF_FILE = path.join(PROJECT_ROOT, "scripts", "seed-data", "staff.json");

loadEnv({ path: [path.join(PROJECT_ROOT, ".env.local"), path.join(PROJECT_ROOT, ".env")], quiet: true });

const seedEnvSchema = z.object({
  MONGODB_URI: z.preprocess(blankToUndefined, z.string({ error: "is required" }).trim()),
  SEED_ADMIN_EMAIL: z.preprocess(
    blankToUndefined,
    z.string({ error: "is required" }).pipe(seedAdminInputSchema.shape.email),
  ),
  SEED_ADMIN_NAME: z.preprocess(
    blankToUndefined,
    z.string().default("System Administrator").pipe(seedAdminInputSchema.shape.name),
  ),
});

function readConfig() {
  const result = seedEnvSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${String(issue.path[0])}: ${issue.message}`);
    throw new Error(
      `Invalid configuration (set it in .env.local; see .env.example):\n${problems.join("\n")}`,
    );
  }
  return result.data;
}

const pad = (value: string, width: number) => value.padEnd(width);
const status = (created: boolean) => pad(created ? "created" : "exists", 8);

function printWarnings(warnings: string[]): void {
  for (const warning of warnings) console.warn(`  WARNING: ${warning}`);
}

async function main(): Promise<void> {
  const config = readConfig();

  // Validate everything that can be checked offline before touching the database.
  const staff = loadStaffFile(STAFF_FILE);

  mongoose.set("strictQuery", true);
  await mongoose.connect(config.MONGODB_URI, { autoIndex: false, serverSelectionTimeoutMS: 10_000 });
  console.log(`Seeding database "${mongoose.connection.name}"`);

  // Indexes first, so the unique office code / user email indexes guard the upserts below.
  const indexes = await ensureIndexes();
  console.log("\nIndexes");
  for (const item of indexes) console.log(`  ${pad(item.collection, 16)} ${item.indexes.join(", ")}`);

  const offices = await seedOffices();
  const officesCreated = offices.filter((office) => office.created).length;
  console.log(`\nOffices (${officesCreated} created, ${offices.length - officesCreated} already present)`);
  for (const office of offices) console.log(`  ${status(office.created)} ${office.name} (${office.code})`);

  const admin = await seedAdmin({ email: config.SEED_ADMIN_EMAIL, name: config.SEED_ADMIN_NAME });
  console.log("\nInitial admin");
  console.log(
    `  ${status(admin.created)} ${admin.email}${admin.created ? ` (${admin.name}, role admin, active)` : " (left unchanged)"}`,
  );
  printWarnings(admin.warnings);

  console.log("\nStaff");
  if (!staff) {
    console.log("  skipped  scripts/seed-data/staff.json not found (optional; see staff.example.json)");
  } else {
    const summary = await seedStaff(staff);
    const staffCreated = summary.results.filter((member) => member.created).length;
    console.log(`  ${staffCreated} created, ${summary.results.length - staffCreated} already present`);
    for (const member of summary.results) {
      const state = member.created ? (member.isActive ? ", active" : ", inactive") : "";
      console.log(`  ${status(member.created)} ${member.email} (${member.officeCode}${state})`);
    }
    printWarnings(summary.warnings);
  }

  console.log("\nSeed completed. Existing records were left unchanged.");
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (error: unknown) => {
    console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
  });
