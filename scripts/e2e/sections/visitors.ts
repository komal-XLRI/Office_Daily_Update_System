import { Visitor } from "@/models";
import type { Paginated, VisitorDTO } from "@/types";

import { apiData, expectApiError, qs, sameMembers } from "../lib/assertions";
import { DATE, LATER_DATE, NEXT_DAY, type E2EContext } from "../lib/context";
import { assert, need } from "../lib/harness";
import type { HttpClient } from "../lib/http";

/** Spec §58 visitors: create/edit/delete, search, date and importance filters, pagination. */

export interface VisitorFields {
  name: string;
  purpose: string;
  date: string;
  timeArrived: string;
  timeDeparted?: string;
  importance: "HIGH" | "MEDIUM" | "LOW";
  remarks?: string;
  officeId?: string;
}

export function visitorBody(fields: VisitorFields): Record<string, unknown> {
  return {
    ...(fields.officeId ? { officeId: fields.officeId } : {}),
    name: fields.name,
    purpose: fields.purpose,
    date: fields.date,
    timeArrived: fields.timeArrived,
    timeDeparted: fields.timeDeparted ?? "",
    importance: fields.importance,
    photos: [],
    documents: [],
    remarks: fields.remarks ?? "",
  };
}

async function list(client: HttpClient, params: Record<string, string | number | undefined>) {
  return apiData<Paginated<VisitorDTO>>(await client.get(`/api/visitors${qs(params)}`), 200);
}

const names = (page: Paginated<VisitorDTO>) => page.items.map((item) => item.name);

export async function runVisitorsSection(ctx: E2EContext): Promise<void> {
  const { h, seed, clients, state } = ctx;
  const { userA, userB, admin } = clients;
  const { A, B } = seed.offices;
  h.section("VISITORS");

  await h.check("User A creates a visitor with departure -> 201 (IST times stored as UTC instants)", async () => {
    const response = await userA.post(
      "/api/visitors",
      visitorBody({ name: "Ravi Kumar", purpose: "Budget review meeting", date: DATE, timeArrived: "10:15", timeDeparted: "11:30", importance: "HIGH", remarks: "Bring files" }),
    );
    const visitor = apiData<VisitorDTO>(response, 201);
    assert(visitor.officeId === A.id && visitor.date === DATE, `office/date: ${response.describe()}`);
    assert(visitor.timeArrived === `${DATE}T04:45:00.000Z`, `timeArrived ${visitor.timeArrived} != 10:15 IST (04:45Z)`);
    assert(visitor.timeDeparted === `${DATE}T06:00:00.000Z`, `timeDeparted ${visitor.timeDeparted} != 11:30 IST (06:00Z)`);
    assert(visitor.createdBy?.id === seed.users.userA.id, `createdBy ${JSON.stringify(visitor.createdBy)}`);
    state.visitorA = visitor.id;
    return `id ${visitor.id}`;
  });

  await h.check("User A creates a visitor without departure -> 201, timeDeparted null", async () => {
    const visitor = apiData<VisitorDTO>(
      await userA.post("/api/visitors", visitorBody({ name: "Anita Sharma", purpose: "Admission enquiry", date: DATE, timeArrived: "09:00", importance: "MEDIUM" })),
      201,
    );
    assert(visitor.timeDeparted === null, `timeDeparted should be null, got ${visitor.timeDeparted}`);
    state.visitorANoDeparture = visitor.id;
  });

  await h.check("departure before arrival / invalid importance / missing name -> 400 with field errors", async () => {
    const before = expectApiError(
      await userA.post("/api/visitors", visitorBody({ name: "Early Leaver", purpose: "Test", date: DATE, timeArrived: "12:00", timeDeparted: "11:00", importance: "LOW" })),
      400,
      "INVALID_INPUT",
    );
    assert(before.fieldErrors?.timeDeparted?.length, `no fieldErrors.timeDeparted: ${JSON.stringify(before)}`);
    const importance = expectApiError(
      await userA.post("/api/visitors", { ...visitorBody({ name: "X", purpose: "Y", date: DATE, timeArrived: "10:00", importance: "LOW" }), importance: "URGENT" }),
      400,
    );
    assert(importance.fieldErrors?.importance?.length, `no fieldErrors.importance: ${JSON.stringify(importance)}`);
    const missing = expectApiError(
      await userA.post("/api/visitors", visitorBody({ name: "  ", purpose: "Y", date: DATE, timeArrived: "10:00", importance: "LOW" })),
      400,
    );
    assert(missing.fieldErrors?.name?.length, `no fieldErrors.name: ${JSON.stringify(missing)}`);
  });

  await h.check("more visitors for filters/pagination (User A x3) and an Office B visitor (User B) -> 201", async () => {
    const created = [
      { name: "Sita Devi", purpose: "Library access", date: DATE, timeArrived: "14:00", timeDeparted: "14:30", importance: "LOW" as const },
      { name: "Arjun Rao", purpose: "Vendor demo", date: LATER_DATE, timeArrived: "11:00", importance: "MEDIUM" as const },
      { name: "Kavya Iyer", purpose: "Internal audit", date: LATER_DATE, timeArrived: "15:45", timeDeparted: "17:00", importance: "HIGH" as const },
    ];
    for (const fields of created) apiData<VisitorDTO>(await userA.post("/api/visitors", visitorBody(fields)), 201);
    const nameB = `Meera ${seed.keywords.b}`;
    const visitorB = apiData<VisitorDTO>(
      await userB.post("/api/visitors", visitorBody({ name: nameB, purpose: `Hostel inspection ${seed.keywords.b}`, date: DATE, timeArrived: "10:30", importance: "HIGH" })),
      201,
    );
    assert(visitorB.officeId === B.id, `Office B visitor stored for ${visitorB.officeId}`);
    state.visitorB = visitorB.id;
    state.visitorBName = nameB;
  });

  await h.check("delete an own-office visitor (User A) -> 200, then GET 404", async () => {
    const temp = apiData<VisitorDTO>(
      await userA.post("/api/visitors", visitorBody({ name: "Temporary Guest", purpose: "Delete me", date: NEXT_DAY, timeArrived: "08:00", importance: "LOW" })),
      201,
    );
    const deleted = apiData<{ id: string }>(await userA.delete(`/api/visitors/${temp.id}`), 200);
    assert(deleted.id === temp.id, `delete returned ${JSON.stringify(deleted)}`);
    expectApiError(await userA.get(`/api/visitors/${temp.id}`), 404, "NOT_FOUND");
    assert(!(await Visitor.exists({ _id: temp.id })), "visitor still in the database");
  });

  await h.check("edit (PATCH full form) by User A -> 200 with new purpose/departure", async () => {
    const id = need(state.visitorA, "Ravi Kumar visitor");
    const visitor = apiData<VisitorDTO>(
      await userA.patch(
        `/api/visitors/${id}`,
        visitorBody({ name: "Ravi Kumar", purpose: "Budget review meeting - extended", date: DATE, timeArrived: "10:15", timeDeparted: "12:00", importance: "HIGH", remarks: "Extended" }),
      ),
      200,
    );
    assert(visitor.purpose === "Budget review meeting - extended", `purpose ${visitor.purpose}`);
    assert(visitor.timeDeparted === `${DATE}T06:30:00.000Z`, `timeDeparted ${visitor.timeDeparted}`);
    const reread = apiData<VisitorDTO>(await userA.get(`/api/visitors/${id}`), 200);
    assert(reread.remarks === "Extended" && reread.officeId === A.id, `reread ${JSON.stringify(reread)}`);
  });

  await h.check("search by name / purpose (q, name, purpose; case-insensitive)", async () => {
    const byName = await list(userA, { q: "ravi" });
    assert(sameMembers(names(byName), ["Ravi Kumar"]), `q=ravi -> ${names(byName).join()}`);
    const byPurpose = await list(userA, { q: "VENDOR" });
    assert(sameMembers(names(byPurpose), ["Arjun Rao"]), `q=VENDOR -> ${names(byPurpose).join()}`);
    const nameParam = await list(userA, { name: "sita" });
    assert(sameMembers(names(nameParam), ["Sita Devi"]), `name=sita -> ${names(nameParam).join()}`);
    const purposeParam = await list(userA, { purpose: "audit" });
    assert(sameMembers(names(purposeParam), ["Kavya Iyer"]), `purpose=audit -> ${names(purposeParam).join()}`);
    const foreign = await list(userA, { q: seed.keywords.b });
    assert(foreign.total === 0, `User A search found Office B visitors: ${names(foreign).join()}`);
    const regex = await list(userA, { q: ".*" });
    assert(regex.total === 0, `q=".*" treated as a regex (${regex.total} results)`);
  });

  await h.check("date filter (date, from/to range)", async () => {
    const onDate = await list(userA, { date: DATE });
    assert(sameMembers(names(onDate), ["Ravi Kumar", "Anita Sharma", "Sita Devi"]), `date=${DATE} -> ${names(onDate).join()}`);
    const later = await list(userA, { date: LATER_DATE });
    assert(sameMembers(names(later), ["Arjun Rao", "Kavya Iyer"]), `date=${LATER_DATE} -> ${names(later).join()}`);
    const range = await list(userA, { from: DATE, to: NEXT_DAY });
    assert(range.total === 3, `from ${DATE} to ${NEXT_DAY} -> ${range.total}`);
    expectApiError(await userA.get(`/api/visitors${qs({ from: LATER_DATE, to: DATE })}`), 400, "INVALID_INPUT");
    expectApiError(await userA.get(`/api/visitors${qs({ date: "2026-13-01" })}`), 400, "INVALID_INPUT");
  });

  await h.check("importance filter", async () => {
    const high = await list(userA, { importance: "HIGH" });
    assert(sameMembers(names(high), ["Ravi Kumar", "Kavya Iyer"]), `importance=HIGH -> ${names(high).join()}`);
    assert(high.items.every((item) => item.importance === "HIGH"), "non-HIGH visitor returned");
    const low = await list(userA, { importance: "LOW" });
    assert(sameMembers(names(low), ["Sita Devi"]), `importance=LOW -> ${names(low).join()}`);
    expectApiError(await userA.get(`/api/visitors${qs({ importance: "URGENT" })}`), 400, "INVALID_INPUT");
  });

  await h.check("pagination (pageSize=2) returns disjoint pages covering all 5 visitors", async () => {
    const pages = [await list(userA, { pageSize: 2, page: 1 }), await list(userA, { pageSize: 2, page: 2 }), await list(userA, { pageSize: 2, page: 3 })];
    assert(pages.every((page) => page.total === 5 && page.totalPages === 3 && page.pageSize === 2), `meta: ${JSON.stringify(pages.map(({ items: _items, ...meta }) => meta))}`);
    assert(pages.map((page) => page.items.length).join() === "2,2,1", `page sizes ${pages.map((page) => page.items.length).join()}`);
    const ids = pages.flatMap((page) => page.items.map((item) => item.id));
    assert(new Set(ids).size === 5, `pages overlap: ${ids.join()}`);
    const beyond = await list(userA, { pageSize: 2, page: 9 });
    assert(beyond.items.length === 0 && beyond.total === 5, `page 9: ${JSON.stringify({ items: beyond.items.length, total: beyond.total })}`);
    const sortedDesc = [...pages.flatMap((page) => page.items)].map((item) => item.timeArrived);
    assert(sortedDesc.every((value, index) => index === 0 || sortedDesc[index - 1] >= value), `not newest first: ${sortedDesc.join()}`);
  });

  await h.check("Admin lists visitors of every office; officeId=B narrows to Office B", async () => {
    const all = await list(admin, { pageSize: 100 });
    const offices = new Set(all.items.map((item) => item.officeId));
    assert(offices.has(A.id) && offices.has(B.id) && all.total === 6, `admin all: total ${all.total}, offices ${[...offices].join()}`);
    const onlyB = await list(admin, { officeId: B.id });
    assert(onlyB.total === 1 && onlyB.items[0]?.officeId === B.id, `admin officeId=B -> ${JSON.stringify(names(onlyB))}`);
    const allParam = await list(admin, { officeId: "all" });
    assert(allParam.total === 6, `admin officeId=all -> ${allParam.total}`);
  });
}
