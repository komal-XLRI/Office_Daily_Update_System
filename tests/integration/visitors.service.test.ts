import { v2 as cloudinaryV2 } from "cloudinary";
import { Types } from "mongoose";
import { afterAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ZodError } from "zod";

import { cloudinaryRootFolder } from "@/lib/cloudinary";
import { resetServerEnvCache } from "@/lib/env";
import { ForbiddenError, InvalidOfficeError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  createVisitor,
  deleteVisitor,
  getVisitor,
  listVisitors,
  updateVisitor,
} from "@/lib/services/visitors";
import { formatTime, toTimeInputValue } from "@/lib/utils/dates";
import { Visitor } from "@/models";
import type { CurrentUser } from "@/types";

import {
  createAuthorizationFixture,
  createOffice,
  createUser,
  createVisitor as seedVisitor,
  makeCurrentUser,
  registerTestDatabase,
  type AuthorizationFixture,
} from "../setup/db";

// Spec §5, §6, §16, §38, §39, §56 (Authorization) and §58 (Visitor testing), exercised at the service layer.
// Admin (no office) → every office; User A → Office A only; User B → Office B only.

registerTestDatabase();

const CLOUD = "odums-visitors-test";
const officeFolder = (office: { _id: unknown }) => String(office._id).toLowerCase();
const photoUrl = (name: string, office: { _id: unknown } = fx.officeA) =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/v1757320000/${cloudinaryRootFolder()}/${officeFolder(office)}/photos/${name}.jpg`;
const documentUrl = (name: string, office: { _id: unknown } = fx.officeA) =>
  `https://res.cloudinary.com/${CLOUD}/raw/upload/v1757320000/${cloudinaryRootFolder()}/${officeFolder(office)}/documents/${name}.pdf`;

let fx: AuthorizationFixture;
let deleteResources: MockInstance;

beforeEach(async () => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", CLOUD);
  vi.stubEnv("CLOUDINARY_API_KEY", "123456789012345");
  vi.stubEnv("CLOUDINARY_API_SECRET", "visitors-test-cloudinary-secret");
  resetServerEnvCache();
  // Never reach the real Cloudinary API: best-effort deletions are recorded instead.
  deleteResources = vi.spyOn(cloudinaryV2.api, "delete_resources").mockResolvedValue({} as never);

  fx = await createAuthorizationFixture();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
});

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail");
}

async function expectForbidden(promise: Promise<unknown>): Promise<void> {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(ForbiddenError);
  expect(error).toMatchObject({ status: 403, code: "FORBIDDEN" });
}

async function expectZodIssue(promise: Promise<unknown>, path: string): Promise<ZodError> {
  const error = await captureError(promise);
  expect(error).toBeInstanceOf(ZodError);
  const paths = (error as ZodError).issues.map((issue) => issue.path.map(String).join("."));
  expect(paths).toContain(path);
  return error as ZodError;
}

function visitorInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Ravi Kumar",
    purpose: "Admission enquiry",
    date: "2026-09-08",
    timeArrived: "10:00",
    timeDeparted: "",
    importance: "MEDIUM",
    photos: [],
    documents: [],
    remarks: "",
    ...overrides,
  };
}

/** Edit payload with the record's current version (what an up-to-date edit form sends). */
async function editInput(id: string, overrides: Record<string, unknown> = {}) {
  const stored = Types.ObjectId.isValid(id) ? await Visitor.findById(id).select("updatedAt").lean() : null;
  return {
    ...visitorInput(overrides),
    expectedUpdatedAt: (stored?.updatedAt ?? new Date("2026-09-08T00:00:00.000Z")).toISOString(),
  };
}

const namesOf = (items: { name: string }[]) => items.map((item) => item.name).sort();

describe("createVisitor", () => {
  it("forces a normal user's own office and records the creator", async () => {
    const visitor = await createVisitor(fx.userA, visitorInput({ remarks: "  Walk-in  " }));

    expect(visitor).toMatchObject({
      officeId: String(fx.officeA._id),
      office: { id: String(fx.officeA._id), name: "Office A", code: "OFFICE-A" },
      name: "Ravi Kumar",
      purpose: "Admission enquiry",
      date: "2026-09-08",
      timeDeparted: null,
      importance: "MEDIUM",
      remarks: "Walk-in",
      createdBy: { id: fx.userA.id, name: "User A" },
    });

    const stored = await Visitor.findById(visitor.id).lean();
    expect(String(stored?.officeId)).toBe(String(fx.officeA._id));
    expect(String(stored?.createdBy)).toBe(fx.userA.id);
    expect(stored?.date.toISOString()).toBe("2026-09-08T00:00:00.000Z");
  });

  it("accepts a normal user's own office id in the payload", async () => {
    const visitor = await createVisitor(fx.userA, visitorInput({ officeId: String(fx.officeA._id) }));
    expect(visitor.officeId).toBe(String(fx.officeA._id));
  });

  it("rejects a normal user sending another office with 403 and stores nothing", async () => {
    await expectForbidden(createVisitor(fx.userA, visitorInput({ officeId: String(fx.officeB._id) })));
    expect(await Visitor.countDocuments()).toBe(0);
  });

  it("requires an administrator to choose an office", async () => {
    const error = await captureError(createVisitor(fx.admin, visitorInput()));
    expect(error).toBeInstanceOf(InvalidOfficeError);
    expect(error).toMatchObject({ status: 400, code: "INVALID_OFFICE" });
    expect((error as InvalidOfficeError).fieldErrors?.officeId?.length).toBeGreaterThan(0);

    // "all" is not an office (rejected by the payload schema before any scope logic runs).
    await expectZodIssue(createVisitor(fx.admin, visitorInput({ officeId: "all" })), "officeId");
    expect(await Visitor.countDocuments()).toBe(0);
  });

  it("lets an administrator create a visitor for any active office", async () => {
    const visitor = await createVisitor(fx.admin, visitorInput({ officeId: String(fx.officeB._id) }));
    expect(visitor.officeId).toBe(String(fx.officeB._id));
    expect(visitor.office?.name).toBe("Office B");
    expect(visitor.createdBy).toEqual({ id: fx.admin.id, name: "Admin" });
  });

  it("rejects inactive or unknown offices with InvalidOfficeError", async () => {
    const inactive = await createOffice({ name: "Closed Office", code: "CLOSED", isActive: false });

    await expect(
      createVisitor(fx.admin, visitorInput({ officeId: String(inactive._id) })),
    ).rejects.toBeInstanceOf(InvalidOfficeError);
    await expect(
      createVisitor(fx.admin, visitorInput({ officeId: new Types.ObjectId().toHexString() })),
    ).rejects.toBeInstanceOf(InvalidOfficeError);

    // A normal user whose own office has been deactivated cannot add records either.
    const staleUserDoc = await createUser({ name: "Stale User", officeId: inactive });
    const staleUser = makeCurrentUser(staleUserDoc, inactive);
    await expect(createVisitor(staleUser, visitorInput())).rejects.toBeInstanceOf(InvalidOfficeError);

    expect(await Visitor.countDocuments()).toBe(0);
  });

  it("rejects a normal user without an office", async () => {
    const orphan: CurrentUser = { ...fx.userA, officeId: null, officeName: null };
    await expectForbidden(createVisitor(orphan, visitorInput()));
  });

  it("rejects attachments that are not this app's Cloudinary uploads", async () => {
    const outside = [{ fileName: "photo.jpg", fileUrl: "https://example.com/photo.jpg" }];
    const otherCloud = [
      {
        fileName: "doc.pdf",
        fileUrl: `https://res.cloudinary.com/another-cloud/raw/upload/v1/${cloudinaryRootFolder()}/documents/doc.pdf`,
      },
    ];

    const photoError = await captureError(createVisitor(fx.userA, visitorInput({ photos: outside })));
    expect(photoError).toBeInstanceOf(ValidationError);
    expect(photoError).toMatchObject({ status: 400, code: "INVALID_INPUT" });

    await expect(createVisitor(fx.userA, visitorInput({ documents: otherCloud }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await Visitor.countDocuments()).toBe(0);
  });

  it("stores multiple photos and documents in order (spec §58)", async () => {
    const photos = [
      { fileName: "front.jpg", fileUrl: photoUrl("front") },
      { fileName: "badge.jpg", fileUrl: photoUrl("badge") },
    ];
    const documents = [
      { fileName: "id-proof.pdf", fileUrl: documentUrl("id-proof") },
      { fileName: "letter.pdf", fileUrl: documentUrl("letter") },
    ];

    const visitor = await createVisitor(fx.userA, visitorInput({ photos, documents }));
    expect(visitor.photos).toEqual(photos);
    expect(visitor.documents).toEqual(documents);
    expect(deleteResources).not.toHaveBeenCalled();
  });

  it("rejects a departure before the arrival time and accepts an equal time", async () => {
    await expectZodIssue(
      createVisitor(fx.userA, visitorInput({ timeArrived: "14:30", timeDeparted: "14:29" })),
      "timeDeparted",
    );
    // A departure after midnight would be on the next business date: not allowed for a same-day visit.
    await expectZodIssue(
      createVisitor(fx.userA, visitorInput({ timeArrived: "23:30", timeDeparted: "00:15" })),
      "timeDeparted",
    );
    expect(await Visitor.countDocuments()).toBe(0);

    const visitor = await createVisitor(fx.userA, visitorInput({ timeArrived: "14:30", timeDeparted: "14:30" }));
    expect(visitor.timeDeparted).toBe(visitor.timeArrived);
  });

  it("validates required fields and formats", async () => {
    await expectZodIssue(createVisitor(fx.userA, visitorInput({ name: "   " })), "name");
    await expectZodIssue(createVisitor(fx.userA, visitorInput({ purpose: "" })), "purpose");
    await expectZodIssue(createVisitor(fx.userA, visitorInput({ date: "2026-02-30" })), "date");
    await expectZodIssue(createVisitor(fx.userA, visitorInput({ timeArrived: "24:00" })), "timeArrived");
    await expectZodIssue(createVisitor(fx.userA, visitorInput({ importance: "URGENT" })), "importance");
    expect(await Visitor.countDocuments()).toBe(0);
  });
});

describe("listVisitors scope (spec §6, §38)", () => {
  beforeEach(async () => {
    await seedVisitor({ officeId: fx.officeA, name: "Alpha Visitor" });
    await seedVisitor({ officeId: fx.officeA, name: "Another Alpha" });
    await seedVisitor({ officeId: fx.officeB, name: "Bravo Visitor" });
  });

  it("gives an administrator every office, or the chosen office", async () => {
    const all = await listVisitors(fx.admin, {});
    expect(all.total).toBe(3);
    expect(namesOf(all.items)).toEqual(["Alpha Visitor", "Another Alpha", "Bravo Visitor"]);

    const explicitAll = await listVisitors(fx.admin, { officeId: "all" });
    expect(explicitAll.total).toBe(3);

    const onlyB = await listVisitors(fx.admin, { officeId: String(fx.officeB._id) });
    expect(onlyB.total).toBe(1);
    expect(onlyB.items[0]).toMatchObject({ name: "Bravo Visitor", officeId: String(fx.officeB._id) });
    expect(onlyB.items[0]?.office?.name).toBe("Office B");

    const onlyA = await listVisitors(fx.admin, { officeId: String(fx.officeA._id) });
    expect(namesOf(onlyA.items)).toEqual(["Alpha Visitor", "Another Alpha"]);
  });

  it("limits User A to Office A", async () => {
    const result = await listVisitors(fx.userA, {});
    expect(result.total).toBe(2);
    expect(result.items.every((item) => item.officeId === String(fx.officeA._id))).toBe(true);

    const explicitOwn = await listVisitors(fx.userA, { officeId: String(fx.officeA._id) });
    expect(explicitOwn.total).toBe(2);

    const resultB = await listVisitors(fx.userB, {});
    expect(namesOf(resultB.items)).toEqual(["Bravo Visitor"]);
  });

  it("forbids User A from requesting Office B or all offices", async () => {
    await expectForbidden(listVisitors(fx.userA, { officeId: String(fx.officeB._id) }));
    await expectForbidden(listVisitors(fx.userA, { officeId: "all" }));
  });

  it("never leaks another office's visitors through search", async () => {
    const result = await listVisitors(fx.userA, { q: "Bravo" });
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("rejects a malformed office filter", async () => {
    await expect(listVisitors(fx.admin, { officeId: "office-b" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("listVisitors filters (spec §21, §58)", () => {
  it("searches name and purpose case-insensitively", async () => {
    await seedVisitor({ officeId: fx.officeA, name: "Meera Iyer", purpose: "Placement meeting" });
    await seedVisitor({ officeId: fx.officeA, name: "John Mathew", purpose: "Vendor MEERA demo" });
    await seedVisitor({ officeId: fx.officeA, name: "Sanjay Rao", purpose: "Audit" });

    const keyword = await listVisitors(fx.userA, { q: "meera" });
    expect(namesOf(keyword.items)).toEqual(["John Mathew", "Meera Iyer"]);

    const byName = await listVisitors(fx.userA, { name: "meera" });
    expect(namesOf(byName.items)).toEqual(["Meera Iyer"]);

    const byPurpose = await listVisitors(fx.userA, { purpose: "AUDIT" });
    expect(namesOf(byPurpose.items)).toEqual(["Sanjay Rao"]);

    const blank = await listVisitors(fx.userA, { q: "   " });
    expect(blank.total).toBe(3);
  });

  it("treats regular-expression characters in search text literally", async () => {
    await seedVisitor({ officeId: fx.officeA, name: "Guest a.*( literal", purpose: "Delivery (urgent)" });
    await seedVisitor({ officeId: fx.officeA, name: "R.K. Sharma", purpose: "urgent delivery" });
    await seedVisitor({ officeId: fx.officeA, name: "RXK Traders", purpose: "Anything at all" });

    const special = await listVisitors(fx.userA, { q: "a.*(" });
    expect(namesOf(special.items)).toEqual(["Guest a.*( literal"]);

    const dot = await listVisitors(fx.userA, { q: "R.K" });
    expect(namesOf(dot.items)).toEqual(["R.K. Sharma"]);

    const group = await listVisitors(fx.userA, { purpose: "(urgent)" });
    expect(namesOf(group.items)).toEqual(["Guest a.*( literal"]);

    const anchors = await listVisitors(fx.userA, { q: "^$|[" });
    expect(anchors.total).toBe(0);
  });

  it("filters by exact date and by an inclusive from/to range", async () => {
    for (const date of ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10"]) {
      await seedVisitor({ officeId: fx.officeA, name: `Visitor ${date}`, date });
    }
    // Late-evening arrival (IST) is still on its business date.
    await seedVisitor({ officeId: fx.officeA, name: "Late 2026-09-08", date: "2026-09-08", timeArrived: "23:30" });
    await seedVisitor({ officeId: fx.officeB, name: "Office B 2026-09-08", date: "2026-09-08" });

    const exact = await listVisitors(fx.userA, { date: "2026-09-08" });
    expect(namesOf(exact.items)).toEqual(["Late 2026-09-08", "Visitor 2026-09-08"]);

    const range = await listVisitors(fx.userA, { from: "2026-09-07", to: "2026-09-09" });
    expect(range.items.map((item) => item.date).sort()).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-08",
      "2026-09-09",
    ]);

    const sameDay = await listVisitors(fx.userA, { from: "2026-09-10", to: "2026-09-10" });
    expect(namesOf(sameDay.items)).toEqual(["Visitor 2026-09-10"]);

    const fromOnly = await listVisitors(fx.userA, { from: "2026-09-09" });
    expect(fromOnly.items.map((item) => item.date).sort()).toEqual(["2026-09-09", "2026-09-10"]);

    const toOnly = await listVisitors(fx.userA, { to: "2026-09-07" });
    expect(toOnly.items.map((item) => item.date).sort()).toEqual(["2026-09-06", "2026-09-07"]);

    const adminDay = await listVisitors(fx.admin, { date: "2026-09-08" });
    expect(adminDay.total).toBe(3);
  });

  it("rejects a range whose To date is before its From date", async () => {
    const error = await captureError(listVisitors(fx.userA, { from: "2026-09-10", to: "2026-09-09" }));
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors?.to?.length).toBeGreaterThan(0);

    await expect(listVisitors(fx.userA, { date: "2026-13-01" })).rejects.toBeInstanceOf(ZodError);
  });

  it("filters by importance", async () => {
    await seedVisitor({ officeId: fx.officeA, name: "High One", importance: "HIGH" });
    await seedVisitor({ officeId: fx.officeA, name: "High Two", importance: "HIGH" });
    await seedVisitor({ officeId: fx.officeA, name: "Low One", importance: "LOW" });
    await seedVisitor({ officeId: fx.officeB, name: "High B", importance: "HIGH" });

    const high = await listVisitors(fx.userA, { importance: "HIGH" });
    expect(namesOf(high.items)).toEqual(["High One", "High Two"]);

    const low = await listVisitors(fx.userA, { importance: "LOW" });
    expect(namesOf(low.items)).toEqual(["Low One"]);

    const medium = await listVisitors(fx.userA, { importance: "MEDIUM" });
    expect(medium.total).toBe(0);

    const adminHigh = await listVisitors(fx.admin, { importance: "HIGH" });
    expect(adminHigh.total).toBe(3);

    await expect(listVisitors(fx.userA, { importance: "CRITICAL" })).rejects.toBeInstanceOf(ZodError);
  });

  it("combines filters", async () => {
    await seedVisitor({ officeId: fx.officeA, name: "Meera", importance: "HIGH", date: "2026-09-08" });
    await seedVisitor({ officeId: fx.officeA, name: "Meera", importance: "LOW", date: "2026-09-08" });
    await seedVisitor({ officeId: fx.officeA, name: "Meera", importance: "HIGH", date: "2026-09-09" });

    const result = await listVisitors(fx.userA, { q: "meera", importance: "HIGH", date: "2026-09-08" });
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({ importance: "HIGH", date: "2026-09-08" });
  });

  it("paginates newest first with correct totals", async () => {
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    for (const date of dates) await seedVisitor({ officeId: fx.officeA, name: `Visitor ${date}`, date });
    // Same date, later arrival sorts first.
    await seedVisitor({ officeId: fx.officeA, name: "Visitor 2026-09-05 late", date: "2026-09-05", timeArrived: "18:00" });
    await seedVisitor({ officeId: fx.officeB, name: "Office B visitor", date: "2026-09-09" });

    const page1 = await listVisitors(fx.userA, { page: "1", pageSize: "2" });
    expect(page1).toMatchObject({ page: 1, pageSize: 2, total: 6, totalPages: 3 });
    expect(page1.items.map((item) => item.name)).toEqual(["Visitor 2026-09-05 late", "Visitor 2026-09-05"]);

    const page3 = await listVisitors(fx.userA, { page: 3, pageSize: 2 });
    expect(page3.items.map((item) => item.name)).toEqual(["Visitor 2026-09-02", "Visitor 2026-09-01"]);

    // Past the last page → clamped to the last page (never an empty "Showing 7–6 of 6").
    const beyond = await listVisitors(fx.userA, { page: 4, pageSize: 2 });
    expect(beyond).toMatchObject({ page: 3, total: 6, totalPages: 3 });
    expect(beyond.items.map((item) => item.name)).toEqual(["Visitor 2026-09-02", "Visitor 2026-09-01"]);

    const defaults = await listVisitors(fx.userA, { page: "abc", pageSize: "1000" });
    expect(defaults).toMatchObject({ page: 1, pageSize: 20, total: 6, totalPages: 1 });

    const empty = await listVisitors(fx.userB, { date: "2026-09-01" });
    expect(empty).toMatchObject({ items: [], total: 0, totalPages: 1 });

    const allOffices = await listVisitors(fx.admin, { pageSize: 5 });
    expect(allOffices).toMatchObject({ total: 7, totalPages: 2 });
    expect(allOffices.items[0]?.name).toBe("Office B visitor");
  });
});

describe("getVisitor / updateVisitor / deleteVisitor (spec §39)", () => {
  it("forbids User A from viewing Office B's visitor; admin and User B may view it", async () => {
    const visitorB = await seedVisitor({ officeId: fx.officeB, name: "Bravo Guest" });
    const id = String(visitorB._id);

    await expectForbidden(getVisitor(fx.userA, id));
    await expect(getVisitor(fx.admin, id)).resolves.toMatchObject({ id, name: "Bravo Guest" });
    await expect(getVisitor(fx.userB, id)).resolves.toMatchObject({ id, officeId: String(fx.officeB._id) });
  });

  it("returns 404 for malformed or unknown ids", async () => {
    const missing = new Types.ObjectId().toHexString();
    for (const id of ["not-an-id", missing]) {
      await expect(getVisitor(fx.admin, id)).rejects.toBeInstanceOf(NotFoundError);
      await expect(updateVisitor(fx.admin, id, await editInput(id))).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteVisitor(fx.admin, id)).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("forbids User A from updating Office B's visitor and leaves it unchanged", async () => {
    const visitorB = await seedVisitor({ officeId: fx.officeB, name: "Bravo Guest", purpose: "Original" });
    const id = String(visitorB._id);

    await expectForbidden(updateVisitor(fx.userA, id, await editInput(id, { name: "Hijacked" })));
    await expectForbidden(
      updateVisitor(fx.userA, id, await editInput(id, { name: "Hijacked", officeId: String(fx.officeA._id) })),
    );

    const stored = await Visitor.findById(id).lean();
    expect(stored).toMatchObject({ name: "Bravo Guest", purpose: "Original" });
    expect(String(stored?.officeId)).toBe(String(fx.officeB._id));
  });

  it("lets an administrator update any office's visitor", async () => {
    const visitorB = await seedVisitor({ officeId: fx.officeB, name: "Bravo Guest" });
    const updated = await updateVisitor(fx.admin, String(visitorB._id), await editInput(String(visitorB._id), { name: "Bravo Guest (edited)", importance: "HIGH", date: "2026-09-09" }),
    );
    expect(updated).toMatchObject({
      name: "Bravo Guest (edited)",
      importance: "HIGH",
      date: "2026-09-09",
      officeId: String(fx.officeB._id),
    });
  });

  it("lets a user update their own office's visitor but never move it to another office", async () => {
    const visitorA = await seedVisitor({ officeId: fx.officeA, name: "Alpha Guest" });
    const id = String(visitorA._id);

    const updated = await updateVisitor(fx.userA, id, await editInput(id, { name: "Alpha Guest (edited)" }));
    expect(updated.name).toBe("Alpha Guest (edited)");

    await expectForbidden(updateVisitor(fx.userA, id, await editInput(id, { officeId: String(fx.officeB._id) })));

    const adminMove = await captureError(
      updateVisitor(fx.admin, id, await editInput(id, { officeId: String(fx.officeB._id) })),
    );
    expect(adminMove).toBeInstanceOf(ValidationError);
    expect((adminMove as ValidationError).fieldErrors?.officeId?.length).toBeGreaterThan(0);

    // Sending the record's own office (any letter case) is accepted.
    await expect(
      updateVisitor(fx.admin, id, await editInput(id, { officeId: String(fx.officeA._id).toUpperCase() })),
    ).resolves.toMatchObject({ officeId: String(fx.officeA._id) });

    const stored = await Visitor.findById(id).lean();
    expect(String(stored?.officeId)).toBe(String(fx.officeA._id));
  });

  it("applies the same validation on update", async () => {
    const visitorA = await seedVisitor({ officeId: fx.officeA });
    const id = String(visitorA._id);

    await expectZodIssue(
      updateVisitor(fx.userA, id, await editInput(id, { timeArrived: "12:00", timeDeparted: "11:00" })),
      "timeDeparted",
    );
    await expect(
      updateVisitor(fx.userA, id, await editInput(id, { photos: [{ fileName: "x.jpg", fileUrl: "https://evil.example.com/x.jpg" }] }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("forbids User A from deleting Office B's visitor; admin can delete it", async () => {
    const visitorB = await seedVisitor({ officeId: fx.officeB });
    const id = String(visitorB._id);

    await expectForbidden(deleteVisitor(fx.userA, id));
    expect(await Visitor.exists({ _id: id })).not.toBeNull();

    await deleteVisitor(fx.admin, id);
    expect(await Visitor.exists({ _id: id })).toBeNull();
    await expect(getVisitor(fx.admin, id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a normal user delete a visitor of their own office", async () => {
    const visitorA = await seedVisitor({ officeId: fx.officeA });
    const other = await seedVisitor({ officeId: fx.officeA });

    await deleteVisitor(fx.userA, String(visitorA._id));
    expect(await Visitor.exists({ _id: visitorA._id })).toBeNull();
    expect(await Visitor.exists({ _id: other._id })).not.toBeNull();
  });

  it("removes Cloudinary files that are no longer referenced (update) and all files (delete)", async () => {
    const kept = { fileName: "kept.jpg", fileUrl: photoUrl("kept") };
    const dropped = { fileName: "dropped.jpg", fileUrl: photoUrl("dropped") };
    const doc = { fileName: "doc.pdf", fileUrl: documentUrl("doc") };

    const created = await createVisitor(fx.userA, visitorInput({ photos: [kept, dropped], documents: [doc] }));

    await updateVisitor(fx.userA, created.id, await editInput(created.id, { photos: [kept], documents: [doc] }));
    expect(deleteResources).toHaveBeenCalledTimes(1);
    expect(deleteResources).toHaveBeenCalledWith([`${cloudinaryRootFolder()}/${officeFolder(fx.officeA)}/photos/dropped`], {
      resource_type: "image",
      type: "upload",
    });

    deleteResources.mockClear();
    await deleteVisitor(fx.userA, created.id);
    expect(deleteResources).toHaveBeenCalledWith([`${cloudinaryRootFolder()}/${officeFolder(fx.officeA)}/photos/kept`], {
      resource_type: "image",
      type: "upload",
    });
    expect(deleteResources).toHaveBeenCalledWith([`${cloudinaryRootFolder()}/${officeFolder(fx.officeA)}/documents/doc.pdf`], {
      resource_type: "raw",
      type: "upload",
    });
  });

  it("does not touch Cloudinary when a forbidden delete is attempted", async () => {
    const visitorB = await seedVisitor({
      officeId: fx.officeB,
      photos: [{ fileName: "b.jpg", fileUrl: photoUrl("office-b") }],
    });
    await expectForbidden(deleteVisitor(fx.userA, String(visitorB._id)));
    expect(deleteResources).not.toHaveBeenCalled();
  });
});

describe("arrival/departure times in Asia/Kolkata (spec §36)", () => {
  it("keeps a 23:30 arrival on the same business date and round-trips the wall-clock time", async () => {
    const created = await createVisitor(
      fx.userA,
      visitorInput({ date: "2026-09-08", timeArrived: "23:30", timeDeparted: "23:45" }),
    );

    expect(created.date).toBe("2026-09-08");
    expect(created.timeArrived).toBe("2026-09-08T18:00:00.000Z");
    expect(created.timeDeparted).toBe("2026-09-08T18:15:00.000Z");
    expect(toTimeInputValue(created.timeArrived)).toBe("23:30");
    expect(toTimeInputValue(created.timeDeparted)).toBe("23:45");
    expect(formatTime(created.timeArrived)).toBe("11:30 PM");

    const stored = await Visitor.collection.findOne({ _id: new Types.ObjectId(created.id) });
    expect(stored?.date.toISOString()).toBe("2026-09-08T00:00:00.000Z");

    const fetched = await getVisitor(fx.userA, created.id);
    expect(fetched.date).toBe("2026-09-08");
    expect(toTimeInputValue(fetched.timeArrived)).toBe("23:30");

    expect((await listVisitors(fx.userA, { date: "2026-09-08" })).total).toBe(1);
    expect((await listVisitors(fx.userA, { date: "2026-09-09" })).total).toBe(0);
  });

  it("keeps an early 00:15 arrival on its business date even though the UTC instant is the previous day", async () => {
    const created = await createVisitor(fx.userA, visitorInput({ date: "2026-09-08", timeArrived: "00:15" }));
    expect(created.timeArrived).toBe("2026-09-07T18:45:00.000Z");
    expect(created.date).toBe("2026-09-08");
    expect(toTimeInputValue(created.timeArrived)).toBe("00:15");

    expect((await listVisitors(fx.userA, { date: "2026-09-08" })).total).toBe(1);
    expect((await listVisitors(fx.userA, { date: "2026-09-07" })).total).toBe(0);
  });

  it("round-trips edited times and clears the departure time", async () => {
    const created = await createVisitor(fx.userA, visitorInput({ timeArrived: "09:05", timeDeparted: "10:10" }));

    const moved = await updateVisitor(fx.userA, created.id, await editInput(created.id, { date: "2026-09-10", timeArrived: "23:30", timeDeparted: "23:59" }),
    );
    expect(moved.date).toBe("2026-09-10");
    expect(toTimeInputValue(moved.timeArrived)).toBe("23:30");
    expect(toTimeInputValue(moved.timeDeparted)).toBe("23:59");

    const cleared = await updateVisitor(fx.userA, created.id, await editInput(created.id, { date: "2026-09-10", timeArrived: "23:30", timeDeparted: "" }),
    );
    expect(cleared.timeDeparted).toBeNull();
    expect(toTimeInputValue(cleared.timeDeparted)).toBe("");
    const stored = await Visitor.findById(created.id).lean();
    expect(stored?.timeDeparted).toBeNull();
  });
});
