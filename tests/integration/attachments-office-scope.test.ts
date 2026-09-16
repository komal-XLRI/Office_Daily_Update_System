import { v2 as cloudinaryV2 } from "cloudinary";
import { afterAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { cloudinaryRootFolder } from "@/lib/cloudinary";
import { resetServerEnvCache } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import {
  createDailyMilestone,
  deleteDailyMilestone,
  updateDailyMilestone,
} from "@/lib/services/daily-milestones";
import { createVisitor, deleteVisitor, updateVisitor } from "@/lib/services/visitors";
import { DailyMilestone, Visitor } from "@/models";

import {
  createAuthorizationFixture,
  createDailyMilestone as seedRecord,
  createVisitor as seedVisitor,
  registerTestDatabase,
  type AuthorizationFixture,
} from "../setup/db";

// F02: attachment URLs are bound to the record's office (<root>/<officeId>/<kind>), so a user can neither
// attach another office's files nor get them deleted through their own records.

registerTestDatabase();

const CLOUD = "odums-attachments-test";

let fx: AuthorizationFixture;
let deleteResources: MockInstance;

type OfficeLike = { _id: unknown };
const folder = (office: OfficeLike) => String(office._id).toLowerCase();
const photo = (name: string, office: OfficeLike) => ({
  fileName: `${name}.jpg`,
  fileUrl: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${cloudinaryRootFolder()}/${folder(office)}/photos/${name}.jpg`,
});
const documentFile = (name: string, office: OfficeLike) => ({
  fileName: `${name}.pdf`,
  fileUrl: `https://res.cloudinary.com/${CLOUD}/raw/upload/v1/${cloudinaryRootFolder()}/${folder(office)}/documents/${name}.pdf`,
});

beforeEach(async () => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", "attachments-test-cloudinary-secret");
  resetServerEnvCache();
  deleteResources = vi.spyOn(cloudinaryV2.api, "delete_resources").mockResolvedValue({} as never);
  fx = await createAuthorizationFixture();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

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
  dailyUpdate: { title: "Update", description: "Description" },
  milestones: [],
  photos: [],
  documents: [],
  ...overrides,
});

const deletedPublicIds = () => deleteResources.mock.calls.flatMap((call) => call[0] as string[]);

describe("visitors: cross-office attachment URLs", () => {
  it("rejects another office's file URL on create, including for admins", async () => {
    await expect(
      createVisitor(fx.userA, visitorInput({ photos: [photo("b-photo", fx.officeB)] })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createVisitor(
        fx.admin,
        visitorInput({ officeId: String(fx.officeA._id), documents: [documentFile("b-doc", fx.officeB)] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    // A photo URL in the documents list is rejected too.
    await expect(
      createVisitor(fx.userA, visitorInput({ documents: [photo("a-photo", fx.officeA)] })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await Visitor.countDocuments()).toBe(0);

    await expect(
      createVisitor(fx.userA, visitorInput({ photos: [photo("a-photo", fx.officeA)] })),
    ).resolves.toMatchObject({ photos: [photo("a-photo", fx.officeA)] });
  });

  it("rejects newly added cross-office URLs on update and leaves the record unchanged", async () => {
    const created = await createVisitor(fx.userA, visitorInput({ photos: [photo("own", fx.officeA)] }));
    await expect(
      updateVisitor(fx.userA, created.id, {
        ...visitorInput({ photos: [photo("own", fx.officeA), photo("stolen", fx.officeB)] }),
        expectedUpdatedAt: created.updatedAt,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const stored = await Visitor.findById(created.id).lean();
    expect(stored?.photos.map((item) => item.fileName)).toEqual(["own.jpg"]);
    expect(deleteResources).not.toHaveBeenCalled();
  });

  it("never deletes another office's file when it is removed from, or deleted with, a record", async () => {
    // A record that already references Office B's files (e.g. saved before office binding existed).
    const visitor = await seedVisitor({
      officeId: fx.officeA,
      photos: [photo("foreign", fx.officeB), photo("own", fx.officeA)],
      documents: [documentFile("foreign-doc", fx.officeB)],
    });
    const id = String(visitor._id);

    // Existing references stay valid, so the record can still be edited.
    const updated = await updateVisitor(fx.userA, id, {
      ...visitorInput({ photos: [photo("own", fx.officeA)], documents: [documentFile("foreign-doc", fx.officeB)] }),
      expectedUpdatedAt: visitor.updatedAt.toISOString(),
    });
    expect(updated.photos).toEqual([photo("own", fx.officeA)]);
    expect(deleteResources).not.toHaveBeenCalled();

    await deleteVisitor(fx.userA, id);
    expect(deletedPublicIds()).toEqual([`${cloudinaryRootFolder()}/${folder(fx.officeA)}/photos/own`]);
    expect(deletedPublicIds().some((publicId) => publicId.includes(folder(fx.officeB)))).toBe(false);
  });
});

describe("daily records: cross-office attachment URLs", () => {
  it("rejects another office's file URL on create and on update", async () => {
    await expect(
      createDailyMilestone(fx.userA, recordInput({ documents: [documentFile("b-doc", fx.officeB)] })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await DailyMilestone.countDocuments()).toBe(0);

    const record = await createDailyMilestone(fx.userA, recordInput());
    await expect(
      updateDailyMilestone(fx.userA, record.id, {
        ...recordInput({ photos: [photo("b-photo", fx.officeB)] }),
        expectedUpdatedAt: record.updatedAt,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await DailyMilestone.findById(record.id).lean())?.photos).toEqual([]);
  });

  it("only deletes files in the record's own office folder", async () => {
    const record = await seedRecord({
      officeId: fx.officeA,
      photos: [photo("foreign", fx.officeB), photo("own", fx.officeA)],
    });
    const id = String(record._id);

    await updateDailyMilestone(fx.userA, id, {
      ...recordInput({ photos: [] }),
      expectedUpdatedAt: record.updatedAt.toISOString(),
    });
    expect(deletedPublicIds()).toEqual([`${cloudinaryRootFolder()}/${folder(fx.officeA)}/photos/own`]);

    deleteResources.mockClear();
    const second = await seedRecord({
      officeId: fx.officeA,
      date: "2026-09-09",
      documents: [documentFile("foreign-doc", fx.officeB)],
    });
    await deleteDailyMilestone(fx.admin, String(second._id));
    expect(deleteResources).not.toHaveBeenCalled();
  });
});
