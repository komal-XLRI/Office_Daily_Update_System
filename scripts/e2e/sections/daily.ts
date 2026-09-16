import { DailyMilestone } from "@/models";
import type { DailyMilestoneDTO, Paginated } from "@/types";

import { apiData, expectApiError, qs } from "../lib/assertions";
import { DATE, NEXT_DAY, type E2EContext } from "../lib/context";
import { assert, need } from "../lib/harness";

/** Spec §57 daily records: create, duplicate prevention, independent offices, list/search/milestones, update, delete. */

interface MilestoneRow {
  recordId: string;
  index: number;
  date: string;
  office: { id: string; name: string; code: string } | null;
  title: string;
  description: string;
  remarks: string;
}

export function dailyBody(
  date: string,
  title: string,
  milestoneTitles: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    date,
    dailyUpdate: { title, description: `${title} - description of the day's work.` },
    milestones: milestoneTitles.map((milestone) => ({
      title: milestone,
      description: `${milestone} details`,
      remarks: "On track",
    })),
    photos: [],
    documents: [],
    ...extra,
  };
}

export async function runDailySection(ctx: E2EContext): Promise<void> {
  const { h, seed, clients, state } = ctx;
  const { userA, userB, admin } = clients;
  const { A, B, inactive } = seed.offices;
  const kw = seed.keywords;
  const titleA = `Budget planning ${kw.a}`;
  const titleB = `ADSA orientation ${kw.b}`;
  h.section("DAILY");

  await h.check(`User A creates Office A + ${DATE} (daily update + 2 milestones) -> 201`, async () => {
    const response = await userA.post(
      "/api/daily-milestones",
      dailyBody(DATE, titleA, [`Draft budget ${kw.milestone}`, "Circulate agenda"]),
    );
    const record = apiData<DailyMilestoneDTO>(response, 201);
    assert(record.officeId === A.id, `officeId ${record.officeId} != Office A`);
    assert(record.date === DATE, `date ${record.date} != ${DATE}`);
    assert(record.milestones.length === 2, `expected 2 milestones, got ${record.milestones.length}`);
    assert(record.office?.name === A.name, `office name ${record.office?.name}`);
    assert(record.createdBy?.id === seed.users.userA.id, `createdBy ${JSON.stringify(record.createdBy)}`);
    const stored = await DailyMilestone.findById(record.id).select("date").lean();
    assert(
      stored?.date.toISOString() === `${DATE}T00:00:00.000Z`,
      `stored date ${stored?.date.toISOString()} is not UTC midnight of ${DATE} (server TZ=America/Los_Angeles)`,
    );
    state.dailyA = record.id;
    return `id ${record.id}, stored as ${stored.date.toISOString()}`;
  });

  await h.check(`duplicate Office A + ${DATE} (User A) -> 409 with details.existingId`, async () => {
    const existing = need(state.dailyA, "Office A record");
    const response = await userA.post("/api/daily-milestones", dailyBody(DATE, "Duplicate attempt", []));
    const error = expectApiError(response, 409, "CONFLICT");
    assert(error.details?.existingId === existing, `details.existingId ${String(error.details?.existingId)} != ${existing}`);
    assert((await DailyMilestone.countDocuments({ officeId: A.id })) === 1, "a duplicate document was stored");
    return error.message;
  });

  await h.check(`duplicate Office A + ${DATE} created by Admin -> 409`, async () => {
    const existing = need(state.dailyA, "Office A record");
    const response = await admin.post("/api/daily-milestones", dailyBody(DATE, "Admin duplicate", [], { officeId: A.id }));
    const error = expectApiError(response, 409, "CONFLICT");
    assert(error.details?.existingId === existing, `details.existingId ${String(error.details?.existingId)}`);
  });

  await h.check(`User B creates Office B + ${DATE} independently -> 201`, async () => {
    const response = await userB.post("/api/daily-milestones", dailyBody(DATE, titleB, [`Hostel allocation ${kw.b}`]));
    const record = apiData<DailyMilestoneDTO>(response, 201);
    assert(record.officeId === B.id && record.date === DATE, `unexpected record ${response.describe()}`);
    state.dailyB = record.id;
    return `id ${record.id}`;
  });

  await h.check("Admin create without an office / for an inactive office -> 400 INVALID_OFFICE", async () => {
    expectApiError(await admin.post("/api/daily-milestones", dailyBody("2026-09-12", "No office", [])), 400, "INVALID_OFFICE");
    expectApiError(
      await admin.post("/api/daily-milestones", dailyBody("2026-09-12", "Inactive office", [], { officeId: inactive.id })),
      400,
      "INVALID_OFFICE",
    );
  });

  await h.check("invalid business date (2026-02-30) -> 400 with fieldErrors.date", async () => {
    const error = expectApiError(await userA.post("/api/daily-milestones", dailyBody("2026-02-30", "Bad date", [])), 400, "INVALID_INPUT");
    assert(error.fieldErrors?.date?.length, `no fieldErrors.date: ${JSON.stringify(error)}`);
  });

  await h.check("list with date filter: User A sees only Office A, Admin sees both offices", async () => {
    const own = apiData<Paginated<DailyMilestoneDTO>>(await userA.get(`/api/daily-milestones${qs({ date: DATE })}`), 200);
    assert(own.total === 1 && own.items[0]?.officeId === A.id, `User A list: ${JSON.stringify(own.items.map((item) => item.officeId))}`);
    const all = apiData<Paginated<DailyMilestoneDTO>>(await admin.get(`/api/daily-milestones${qs({ date: DATE })}`), 200);
    const offices = all.items.map((item) => item.officeId).sort();
    assert(all.total === 2 && offices.join() === [A.id, B.id].sort().join(), `Admin list offices ${offices.join()}`);
    const otherDay = apiData<Paginated<DailyMilestoneDTO>>(await admin.get(`/api/daily-milestones${qs({ date: "2026-09-07" })}`), 200);
    assert(otherDay.total === 0, `2026-09-07 should have no records, got ${otherDay.total}`);
    return `user A ${own.total}, admin ${all.total}`;
  });

  await h.check("keyword search (q) matches daily update text; regex metacharacters are safe", async () => {
    const found = apiData<Paginated<DailyMilestoneDTO>>(await userA.get(`/api/daily-milestones${qs({ q: kw.a.toUpperCase() })}`), 200);
    assert(found.total === 1 && found.items[0]?.id === state.dailyA, `q=${kw.a} found ${found.total}`);
    const foreign = apiData<Paginated<DailyMilestoneDTO>>(await userA.get(`/api/daily-milestones${qs({ q: kw.b })}`), 200);
    assert(foreign.total === 0, `User A keyword search returned Office B data (${foreign.total})`);
    const meta = apiData<Paginated<DailyMilestoneDTO>>(await userA.get(`/api/daily-milestones${qs({ q: "(.*[" })}`), 200);
    assert(meta.total === 0, `q="(.*[" returned ${meta.total}`);
  });

  await h.check("view=milestones lists individual milestones (with keyword filter)", async () => {
    const recordId = need(state.dailyA, "Office A record");
    const rows = apiData<Paginated<MilestoneRow>>(await userA.get(`/api/daily-milestones${qs({ view: "milestones" })}`), 200);
    assert(rows.total === 2, `expected 2 milestones for User A, got ${rows.total}`);
    assert(rows.items.every((row) => row.recordId === recordId && row.office?.id === A.id), `rows: ${JSON.stringify(rows.items)}`);
    assert(rows.items.map((row) => row.index).sort().join() === "0,1", `indexes ${rows.items.map((row) => row.index).join()}`);
    const filtered = apiData<Paginated<MilestoneRow>>(
      await userA.get(`/api/daily-milestones${qs({ view: "milestones", q: kw.milestone })}`),
      200,
    );
    assert(filtered.total === 1 && filtered.items[0]?.title.includes(kw.milestone), `milestone keyword: ${JSON.stringify(filtered.items)}`);
    const adminRows = apiData<Paginated<MilestoneRow>>(await admin.get(`/api/daily-milestones${qs({ view: "milestones", date: DATE })}`), 200);
    assert(adminRows.total === 3, `admin milestones on ${DATE}: expected 3, got ${adminRows.total}`);
  });

  await h.check("PATCH update by User A (title + third milestone) -> 200, office unchanged", async () => {
    const id = need(state.dailyA, "Office A record");
    const response = await userA.patch(
      `/api/daily-milestones/${id}`,
      dailyBody(DATE, `${titleA} (revised)`, [`Draft budget ${kw.milestone}`, "Circulate agenda", "Board approval"]),
    );
    const record = apiData<DailyMilestoneDTO>(response, 200);
    assert(record.dailyUpdate.title === `${titleA} (revised)`, `title ${record.dailyUpdate.title}`);
    assert(record.milestones.length === 3 && record.officeId === A.id, `record ${response.describe()}`);
  });

  let extraRecord: string | undefined;
  await h.check(`PATCH moving a record onto an occupied date (${DATE}) -> 409 with existingId`, async () => {
    const existing = need(state.dailyA, "Office A record");
    const created = apiData<DailyMilestoneDTO>(await userA.post("/api/daily-milestones", dailyBody(NEXT_DAY, "Second day", ["One"])), 201);
    extraRecord = created.id;
    const response = await userA.patch(`/api/daily-milestones/${created.id}`, dailyBody(DATE, "Second day", ["One"]));
    const error = expectApiError(response, 409, "CONFLICT");
    assert(error.details?.existingId === existing, `existingId ${String(error.details?.existingId)}`);
  });

  await h.check("User A DELETE of an own-office daily record -> 403 (admin-only), record kept", async () => {
    const id = need(extraRecord, "extra Office A record");
    expectApiError(await userA.delete(`/api/daily-milestones/${id}`), 403, "FORBIDDEN");
    assert(await DailyMilestone.exists({ _id: id }), "record was deleted by a normal user");
  });

  await h.check("Admin DELETE -> 200 and the record is gone (GET 404)", async () => {
    const id = need(extraRecord, "extra Office A record");
    const data = apiData<{ id: string }>(await admin.delete(`/api/daily-milestones/${id}`), 200);
    assert(data.id === id, `delete returned ${JSON.stringify(data)}`);
    expectApiError(await admin.get(`/api/daily-milestones/${id}`), 404, "NOT_FOUND");
  });

  await h.check("attachments with a non-Cloudinary URL -> 400 (nothing stored)", async () => {
    const body = dailyBody("2026-09-11", "Attachment test", [], {
      photos: [{ fileName: "evil.jpg", fileUrl: "https://evil.example.com/evil.jpg" }],
    });
    const error = expectApiError(await userA.post("/api/daily-milestones", body), 400);
    const cloudinaryLike = dailyBody("2026-09-11", "Attachment test", [], {
      documents: [{ fileName: "a.pdf", fileUrl: "https://res.cloudinary.com/demo/raw/upload/v1/office-daily-updates/a.pdf" }],
    });
    const second = expectApiError(await userA.post("/api/daily-milestones", cloudinaryLike), 400);
    const http = dailyBody("2026-09-11", "Attachment test", [], {
      photos: [{ fileName: "a.jpg", fileUrl: "http://res.cloudinary.com/demo/image/upload/a.jpg" }],
    });
    expectApiError(await userA.post("/api/daily-milestones", http), 400);
    assert(!(await DailyMilestone.exists({ officeId: A.id, date: new Date("2026-09-11T00:00:00.000Z") })), "record stored");
    return `${error.code}: ${error.message}; res.cloudinary.com URL (Cloudinary unconfigured) -> ${second.code}`;
  });

  await h.check("malformed / unknown record ids -> 404", async () => {
    expectApiError(await userA.get("/api/daily-milestones/not-an-id"), 404, "NOT_FOUND");
    expectApiError(await userA.get("/api/daily-milestones/0123456789abcdef01234567"), 404, "NOT_FOUND");
    expectApiError(await admin.delete("/api/daily-milestones/0123456789abcdef01234567"), 404, "NOT_FOUND");
  });
}
