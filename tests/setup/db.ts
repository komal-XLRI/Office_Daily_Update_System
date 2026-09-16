import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose, { Types, type HydratedDocument } from "mongoose";
import { afterAll, afterEach, beforeAll } from "vitest";

import { connectDB } from "@/lib/db/connect";
import { resetServerEnvCache } from "@/lib/env";
import { businessDateToUtc, combineDateAndTime } from "@/lib/utils/dates";
import {
  DailyMilestone,
  Office,
  User,
  Visitor,
  type IAttachment,
  type IDailyMilestone,
  type IDailyUpdate,
  type IMilestone,
  type IOffice,
  type IUser,
  type IVisitor,
} from "@/models";
import type { CurrentUser, Importance, Role } from "@/types";

/**
 * In-memory MongoDB for integration/service suites.
 *
 * Each test file runs in its own process (vitest.config.mts), and calls `registerTestDatabase()` (or
 * setupTestDatabase/teardownTestDatabase) to start a private MongoMemoryServer. The app's own
 * connectDB() is used to connect, so services under test reuse the same cached connection.
 *
 *   import { createAuthorizationFixture, registerTestDatabase } from "../setup/db";
 *   registerTestDatabase();
 */

export const TEST_AUTH_SECRET = "vitest-only-auth-secret-0123456789-abcdefghij";
export const TEST_DATABASE_NAME = "odums-test";
/** Default business date used by factories (spec §57 example). */
export const DEFAULT_TEST_DATE = "2026-09-08";

let server: MongoMemoryServer | null = null;

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

function setEnv(values: Record<string, string>): void {
  Object.assign(process.env, values);
}

/** Start the in-memory server (once per file), configure env, connect and build all indexes. */
export async function setupTestDatabase(): Promise<typeof mongoose> {
  server ??= await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });

  setEnv({
    MONGODB_URI: server.getUri(TEST_DATABASE_NAME),
    AUTH_SECRET: TEST_AUTH_SECRET,
    NODE_ENV: "test",
  });
  resetServerEnvCache();

  const connection = await connectDB();
  // Creates the four collections and waits for every schema index (unique indexes must exist before tests).
  await Promise.all([Office.init(), User.init(), Visitor.init(), DailyMilestone.init()]);
  return connection;
}

/** Disconnect, reset connectDB()'s globalThis cache and stop the in-memory server. */
export async function teardownTestDatabase(): Promise<void> {
  await mongoose.disconnect();
  const cache = (globalThis as typeof globalThis & { __mongooseCache?: MongooseCache }).__mongooseCache;
  if (cache) {
    // Mutate (not replace): src/lib/db/connect.ts holds a reference to this object.
    cache.conn = null;
    cache.promise = null;
  }
  if (server) {
    await server.stop();
    server = null;
  }
}

/** Remove all documents from the four collections (indexes are kept). */
export async function clearDatabase(): Promise<void> {
  await Promise.all([
    Office.deleteMany({}),
    User.deleteMany({}),
    Visitor.deleteMany({}),
    DailyMilestone.deleteMany({}),
  ]);
}

/** Register beforeAll/afterAll (and by default afterEach clearDatabase) hooks for the current file. */
export function registerTestDatabase(options: { clearAfterEach?: boolean } = {}): void {
  beforeAll(async () => {
    await setupTestDatabase();
  });
  if (options.clearAfterEach ?? true) {
    afterEach(async () => {
      await clearDatabase();
    });
  }
  afterAll(async () => {
    await teardownTestDatabase();
  });
}

// ---------------------------------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------------------------------

export type OfficeDocument = HydratedDocument<IOffice>;
export type UserDocument = HydratedDocument<IUser>;
export type DailyMilestoneDocument = HydratedDocument<IDailyMilestone>;
export type VisitorDocument = HydratedDocument<IVisitor>;

/** An ObjectId, its hex string, or any document with an `_id`. */
export type IdLike = Types.ObjectId | string | { _id: Types.ObjectId };

export function toObjectId(value: IdLike): Types.ObjectId {
  if (value instanceof Types.ObjectId) return value;
  if (typeof value === "string") return new Types.ObjectId(value);
  return value._id;
}

let sequence = 0;
const nextSequence = () => ++sequence;

export interface OfficeFactoryInput {
  name?: string;
  code?: string;
  isActive?: boolean;
}

export async function createOffice(input: OfficeFactoryInput = {}): Promise<OfficeDocument> {
  const n = nextSequence();
  return Office.create({
    name: input.name ?? `Test Office ${n}`,
    code: input.code ?? `TEST-${n}`,
    isActive: input.isActive ?? true,
  });
}

export interface UserFactoryInput {
  name?: string;
  email?: string;
  role?: Role;
  designation?: string;
  /**
   * Omitted: a new active office is created for role "user"; admins get null.
   * Pass null explicitly for "no office" (invalid for role "user").
   */
  officeId?: IdLike | null;
  isActive?: boolean;
}

export async function createUser(input: UserFactoryInput = {}): Promise<UserDocument> {
  const n = nextSequence();
  const role = input.role ?? "user";

  let officeId: Types.ObjectId | null;
  if (input.officeId === undefined) {
    officeId = role === "user" ? (await createOffice())._id : null;
  } else {
    officeId = input.officeId === null ? null : toObjectId(input.officeId);
  }

  return User.create({
    name: input.name ?? `Test User ${n}`,
    email: input.email ?? `test.user.${n}@example.com`,
    role,
    designation: input.designation ?? "",
    officeId,
    isActive: input.isActive ?? true,
  });
}

export interface DailyMilestoneFactoryInput {
  officeId: IdLike;
  /** Business date "YYYY-MM-DD" (default DEFAULT_TEST_DATE). */
  date?: string;
  dailyUpdate?: Partial<IDailyUpdate>;
  milestones?: IMilestone[];
  photos?: IAttachment[];
  documents?: IAttachment[];
  /** Default: a fresh ObjectId (no user document is created). */
  createdBy?: IdLike;
}

export async function createDailyMilestone(
  input: DailyMilestoneFactoryInput,
): Promise<DailyMilestoneDocument> {
  const n = nextSequence();
  return DailyMilestone.create({
    officeId: toObjectId(input.officeId),
    date: businessDateToUtc(input.date ?? DEFAULT_TEST_DATE),
    dailyUpdate: {
      title: input.dailyUpdate?.title ?? `Daily update ${n}`,
      description: input.dailyUpdate?.description ?? `Description of daily update ${n}`,
    },
    milestones: input.milestones ?? [
      { title: `Milestone ${n}`, description: "Milestone description", remarks: "" },
    ],
    photos: input.photos ?? [],
    documents: input.documents ?? [],
    createdBy: input.createdBy ? toObjectId(input.createdBy) : new Types.ObjectId(),
  });
}

export interface VisitorFactoryInput {
  officeId: IdLike;
  name?: string;
  purpose?: string;
  /** Business date "YYYY-MM-DD" (default DEFAULT_TEST_DATE). */
  date?: string;
  /** "HH:mm" in the institutional timezone (default "10:00"). */
  timeArrived?: string;
  /** "HH:mm" in the institutional timezone, or null (default) when not departed. */
  timeDeparted?: string | null;
  importance?: Importance;
  remarks?: string;
  photos?: IAttachment[];
  documents?: IAttachment[];
  /** Default: a fresh ObjectId (no user document is created). */
  createdBy?: IdLike;
}

export async function createVisitor(input: VisitorFactoryInput): Promise<VisitorDocument> {
  const n = nextSequence();
  const date = input.date ?? DEFAULT_TEST_DATE;
  return Visitor.create({
    officeId: toObjectId(input.officeId),
    name: input.name ?? `Visitor ${n}`,
    purpose: input.purpose ?? `Purpose ${n}`,
    date: businessDateToUtc(date),
    timeArrived: combineDateAndTime(date, input.timeArrived ?? "10:00"),
    timeDeparted: input.timeDeparted ? combineDateAndTime(date, input.timeDeparted) : null,
    importance: input.importance ?? "MEDIUM",
    remarks: input.remarks ?? "",
    photos: input.photos ?? [],
    documents: input.documents ?? [],
    createdBy: input.createdBy ? toObjectId(input.createdBy) : new Types.ObjectId(),
  });
}

type CurrentUserSource = Pick<IUser, "name" | "email" | "role" | "officeId"> & {
  _id: Types.ObjectId;
  designation?: string | null;
};

/** The CurrentUser a service receives for this user (as getCurrentUser() would build it). */
export function makeCurrentUser(
  user: CurrentUserSource,
  office: { name: string } | null = null,
): CurrentUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    designation: user.designation ?? "",
    officeId: user.officeId ? String(user.officeId) : null,
    officeName: office?.name ?? null,
  };
}

/** Spec §56 authorization setup: Admin (no office), User A → Office A, User B → Office B. */
export async function createAuthorizationFixture() {
  const officeA = await createOffice({ name: "Office A", code: "OFFICE-A" });
  const officeB = await createOffice({ name: "Office B", code: "OFFICE-B" });
  const adminDoc = await createUser({
    name: "Admin",
    email: "admin@example.com",
    role: "admin",
    officeId: null,
  });
  const userADoc = await createUser({ name: "User A", email: "user.a@example.com", officeId: officeA });
  const userBDoc = await createUser({ name: "User B", email: "user.b@example.com", officeId: officeB });

  return {
    officeA,
    officeB,
    adminDoc,
    userADoc,
    userBDoc,
    admin: makeCurrentUser(adminDoc),
    userA: makeCurrentUser(userADoc, officeA),
    userB: makeCurrentUser(userBDoc, officeB),
  };
}

export type AuthorizationFixture = Awaited<ReturnType<typeof createAuthorizationFixture>>;
