import { v2 as cloudinaryV2 } from "cloudinary";
import { afterAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ZodError } from "zod";

import { cloudinaryRootFolder } from "@/lib/cloudinary";
import { resetServerEnvCache } from "@/lib/env";
import { ConflictError } from "@/lib/errors";
import { createDailyMilestone, updateDailyMilestone } from "@/lib/services/daily-milestones";
import { createVisitor, updateVisitor } from "@/lib/services/visitors";
import { DailyMilestone, Visitor } from "@/models";

import { createAuthorizationFixture, registerTestDatabase, type AuthorizationFixture } from "../setup/db";

// F03: an edit form sends the updatedAt it loaded as `expectedUpdatedAt`. A save made after that snapshot wins;
// the stale save gets 409 CONFLICT, writes nothing and deletes none of the newer save's files.

registerTestDatabase();

const CLOUD = "odums-concurrency-test";
const STALE_MESSAGE = "This record was changed by someone else. Reload to see the latest version.";

let fx: AuthorizationFixture;
let deleteResources: MockInstance;

const photo = (name: string) => ({
  fileName: `${name}.jpg`,
  fileUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${cloudinaryRootFolder()}/${String(fx.officeA._id)}/photos/${name}.jpg`,
});

beforeEach(async () => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", "concurrency-test-cloudinary-secret");
  resetServerEnvCache();
  deleteResources = vi.spyOn(cloudinaryV2.api, "delete_resources").mockResolvedValue({} as never);
  fx = await createAuthorizationFixture();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

async function expectStale(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => {
      throw new Error("Expected a conflict");
    },
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConflictError);
  expect(error).toMatchObject({ status: 409, code: "CONFLICT", message: STALE_MESSAGE });
}

const visitorInput = (overrides: Record<string, unknown> = {}) => ({
  name: "Guest",
  purpose: "Meeting",
  date: "2026-09-08",
  timeArrived: "10:00",
  timeDeparted: "",
  importance: "MEDIUM",
  photos: [],
  documents: [],
  remarks: "",
  ...overrides,
});

const recordInput = (overrides: Record<string, unknown> = {}) => ({
  date: "2026-09-08",
  dailyUpdates: [{ title: "Update", description: "Description" }],
  milestones: [],
  photos: [],
  documents: [],
  ...overrides,
});

describe("updateVisitor optimistic concurrency", () => {
  it("rejects a stale save with 409, keeps the newer save and deletes none of its files", async () => {
    const created = await createVisitor(fx.userA, visitorInput({ photos: [photo("original")] }));
    const snapshot = created.updatedAt; // Both users open the edit form now.

    // User 1 saves first (same millisecond is fine: versions always advance), adding a new photo.
    const newer = await updateVisitor(fx.userA, created.id, {
      ...visitorInput({ name: "Newer", photos: [photo("original"), photo("added-by-other")] }),
      expectedUpdatedAt: snapshot,
    });
    expect(newer.updatedAt).not.toBe(snapshot);
    deleteResources.mockClear();

    // User 2 saves from the old form, which never saw "added-by-other" and dropped "original".
    await expectStale(
      updateVisitor(fx.admin, created.id, {
        ...visitorInput({ name: "Stale", photos: [] }),
        expectedUpdatedAt: snapshot,
      }),
    );

    const stored = await Visitor.findById(created.id).lean();
    expect(stored?.name).toBe("Newer");
    expect(stored?.photos.map((item) => item.fileName)).toEqual(["original.jpg", "added-by-other.jpg"]);
    expect(deleteResources).not.toHaveBeenCalled();

    // Reloading (fresh version) lets the edit through.
    await expect(
      updateVisitor(fx.admin, created.id, { ...visitorInput({ name: "Reloaded" }), expectedUpdatedAt: newer.updatedAt }),
    ).resolves.toMatchObject({ name: "Reloaded" });
  });

  it("requires expectedUpdatedAt on update", async () => {
    const created = await createVisitor(fx.userA, visitorInput());
    await expect(updateVisitor(fx.userA, created.id, visitorInput({ name: "No version" }))).rejects.toBeInstanceOf(
      ZodError,
    );
    expect((await Visitor.findById(created.id).lean())?.name).toBe("Guest");
  });
});

describe("updateDailyMilestone optimistic concurrency", () => {
  it("rejects a stale save with 409 (no existingId), keeps the newer save and deletes none of its files", async () => {
    const created = await createDailyMilestone(fx.userA, recordInput({ photos: [photo("original")] }));
    const snapshot = created.updatedAt;

    const newer = await updateDailyMilestone(fx.userA, created.id, {
      ...recordInput({
        dailyUpdates: [{ title: "Newer", description: "Saved first" }],
        photos: [photo("original"), photo("added-by-other")],
      }),
      expectedUpdatedAt: snapshot,
    });
    deleteResources.mockClear();

    const error = await updateDailyMilestone(fx.admin, created.id, {
      ...recordInput({ dailyUpdates: [{ title: "Stale", description: "Old form" }], photos: [] }),
      expectedUpdatedAt: snapshot,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ status: 409, message: STALE_MESSAGE });
    expect((error as ConflictError).details).toBeUndefined();

    const stored = await DailyMilestone.findById(created.id).lean();
    expect(stored?.dailyUpdates[0]?.title).toBe("Newer");
    expect(stored?.photos.map((item) => item.fileName)).toEqual(["original.jpg", "added-by-other.jpg"]);
    expect(deleteResources).not.toHaveBeenCalled();

    await expect(
      updateDailyMilestone(fx.userA, created.id, { ...recordInput(), expectedUpdatedAt: newer.updatedAt }),
    ).resolves.toMatchObject({ dailyUpdates: [{ title: "Update" }] });
  });

  it("rejects a malformed expectedUpdatedAt", async () => {
    const created = await createDailyMilestone(fx.userA, recordInput());
    await expect(
      updateDailyMilestone(fx.userA, created.id, { ...recordInput(), expectedUpdatedAt: "yesterday" }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
