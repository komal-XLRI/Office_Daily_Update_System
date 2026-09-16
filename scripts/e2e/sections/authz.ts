import { DailyMilestone, Office, User, Visitor } from "@/models";
import type { DailyMilestoneDTO, Paginated, VisitorDTO } from "@/types";

import { apiData, expectApiError, qs } from "../lib/assertions";
import { DATE, type E2EContext } from "../lib/context";
import { assert, need } from "../lib/harness";
import { dailyBody } from "./daily";
import { visitorBody } from "./visitors";

/** Spec §38, §39, §56 authorization: office scope via query/body/URL ids, role manipulation, 401s, CSRF origin. */

export async function runAuthzSection(ctx: E2EContext): Promise<void> {
  const { h, seed, clients, state } = ctx;
  const { userA, admin, anon } = clients;
  const { A, B } = seed.offices;
  h.section("AUTHZ");

  await h.check("User A GET /api/visitors?officeId=<B> -> 403 and ?officeId=all -> 403 (own office -> 200)", async () => {
    expectApiError(await userA.get(`/api/visitors${qs({ officeId: B.id })}`), 403, "FORBIDDEN");
    expectApiError(await userA.get(`/api/visitors${qs({ officeId: "all" })}`), 403, "FORBIDDEN");
    const own = apiData<Paginated<VisitorDTO>>(await userA.get(`/api/visitors${qs({ officeId: A.id })}`), 200);
    assert(own.items.every((item) => item.officeId === A.id), "own-office list contains other offices");
  });

  await h.check("User A GET /api/daily-milestones?officeId=<B> / all (records and milestones views) -> 403", async () => {
    expectApiError(await userA.get(`/api/daily-milestones${qs({ officeId: B.id })}`), 403, "FORBIDDEN");
    expectApiError(await userA.get(`/api/daily-milestones${qs({ officeId: "all" })}`), 403, "FORBIDDEN");
    expectApiError(await userA.get(`/api/daily-milestones${qs({ officeId: B.id, view: "milestones" })}`), 403, "FORBIDDEN");
  });

  await h.check("User A POST visitor / daily record with body officeId=<B> -> 403, nothing stored", async () => {
    const visitorName = `Smuggled visitor ${seed.runId}`;
    expectApiError(
      await userA.post("/api/visitors", visitorBody({ name: visitorName, purpose: "x", date: DATE, timeArrived: "10:00", importance: "LOW", officeId: B.id })),
      403,
      "FORBIDDEN",
    );
    assert(!(await Visitor.exists({ name: visitorName })), "visitor was stored for Office B");
    expectApiError(await userA.post("/api/daily-milestones", dailyBody("2026-09-13", "Smuggled record", [], { officeId: B.id })), 403, "FORBIDDEN");
    assert(!(await DailyMilestone.exists({ officeId: B.id, date: new Date("2026-09-13T00:00:00.000Z") })), "record stored");
  });

  await h.check("User A GET / PATCH / DELETE an Office B visitor by id -> 403 each, visitor unchanged", async () => {
    const id = need(state.visitorB, "Office B visitor");
    expectApiError(await userA.get(`/api/visitors/${id}`), 403, "FORBIDDEN");
    expectApiError(
      await userA.patch(`/api/visitors/${id}`, visitorBody({ name: "Hijacked", purpose: "x", date: DATE, timeArrived: "10:00", importance: "LOW" })),
      403,
      "FORBIDDEN",
    );
    expectApiError(await userA.delete(`/api/visitors/${id}`), 403, "FORBIDDEN");
    const stored = await Visitor.findById(id).select("name officeId").lean();
    assert(stored && stored.name === state.visitorBName && String(stored.officeId) === B.id, `Office B visitor changed: ${JSON.stringify(stored)}`);
  });

  await h.check("User A GET / PATCH / DELETE an Office B daily record by id -> 403 each, record unchanged", async () => {
    const id = need(state.dailyB, "Office B daily record");
    expectApiError(await userA.get(`/api/daily-milestones/${id}`), 403, "FORBIDDEN");
    expectApiError(await userA.patch(`/api/daily-milestones/${id}`, dailyBody(DATE, "Hijacked", [])), 403, "FORBIDDEN");
    expectApiError(await userA.delete(`/api/daily-milestones/${id}`), 403, "FORBIDDEN");
    const stored = await DailyMilestone.findById(id).select("dailyUpdate officeId").lean();
    assert(stored && stored.dailyUpdate.title.includes(seed.keywords.b), `Office B record changed: ${JSON.stringify(stored)}`);
  });

  await h.check("User A cannot move an own visitor to Office B via PATCH body officeId -> 403", async () => {
    const id = need(state.visitorANoDeparture, "Anita Sharma visitor");
    expectApiError(
      await userA.patch(`/api/visitors/${id}`, visitorBody({ name: "Anita Sharma", purpose: "Admission enquiry", date: DATE, timeArrived: "09:00", importance: "MEDIUM", officeId: B.id })),
      403,
      "FORBIDDEN",
    );
    const stored = await Visitor.findById(id).select("officeId").lean();
    assert(String(stored?.officeId) === A.id, "visitor office changed");
  });

  await h.check("Admin reads Office B visitor and daily record by id (all offices)", async () => {
    const visitor = apiData<VisitorDTO>(await admin.get(`/api/visitors/${need(state.visitorB, "Office B visitor")}`), 200);
    const record = apiData<DailyMilestoneDTO>(await admin.get(`/api/daily-milestones/${need(state.dailyB, "Office B record")}`), 200);
    const recordA = apiData<DailyMilestoneDTO>(await admin.get(`/api/daily-milestones/${need(state.dailyA, "Office A record")}`), 200);
    assert(visitor.officeId === B.id && record.officeId === B.id && recordA.officeId === A.id, "admin read wrong records");
  });

  await h.check("User A: POST /api/users, PATCH own role to admin, GET /api/users -> 403 (role unchanged)", async () => {
    expectApiError(
      await userA.post("/api/users", { name: "Sneaky Admin", email: `sneaky@${seed.emailDomain}`, role: "admin", designation: "", officeId: null, isActive: true }),
      403,
      "FORBIDDEN",
    );
    expectApiError(await userA.patch(`/api/users/${seed.users.userA.id}`, { role: "admin" }), 403, "FORBIDDEN");
    expectApiError(await userA.patch(`/api/users/${seed.users.userA.id}`, { officeId: B.id }), 403, "FORBIDDEN");
    expectApiError(await userA.get("/api/users"), 403, "FORBIDDEN");
    expectApiError(await userA.get(`/api/users/${seed.users.admin.id}`), 403, "FORBIDDEN");
    const stored = await User.findById(seed.users.userA.id).select("role officeId").lean();
    assert(stored?.role === "user" && String(stored.officeId) === A.id, `User A changed: ${JSON.stringify(stored)}`);
    assert(!(await User.exists({ email: `sneaky@${seed.emailDomain}` })), "user was created");
  });

  await h.check("User A: POST /api/offices, PATCH an office, GET /api/offices -> 403", async () => {
    expectApiError(await userA.post("/api/offices", { name: "Rogue Office", code: "ROGUE", isActive: true }), 403, "FORBIDDEN");
    expectApiError(await userA.patch(`/api/offices/${B.id}`, { isActive: false }), 403, "FORBIDDEN");
    expectApiError(await userA.get("/api/offices"), 403, "FORBIDDEN");
    assert(!(await Office.exists({ code: "ROGUE" })), "office was created");
    const officeB = await Office.findById(B.id).select("isActive").lean();
    assert(officeB?.isActive === true, "Office B was deactivated by a normal user");
  });

  await h.check("Admin cannot change own role or deactivate self (409)", async () => {
    expectApiError(await admin.patch(`/api/users/${seed.users.admin.id}`, { role: "user", officeId: A.id }), 409, "CONFLICT");
    expectApiError(await admin.patch(`/api/users/${seed.users.admin.id}`, { isActive: false }), 409, "CONFLICT");
  });

  await h.check("unauthenticated API calls -> 401 JSON", async () => {
    const calls: Array<[string, string]> = [
      ["GET", "/api/auth/session"],
      ["GET", "/api/visitors"],
      ["POST", "/api/visitors"],
      ["GET", `/api/visitors/${need(state.visitorA, "visitor")}`],
      ["DELETE", `/api/visitors/${need(state.visitorA, "visitor")}`],
      ["GET", "/api/daily-milestones"],
      ["PATCH", `/api/daily-milestones/${need(state.dailyA, "record")}`],
      ["GET", "/api/reports?type=daily&date=2026-09-08"],
      ["GET", "/api/users"],
      ["POST", "/api/offices"],
      ["POST", "/api/uploads"],
    ];
    const summary: string[] = [];
    for (const [method, path] of calls) {
      const response = await anon.request(method, path, method === "GET" ? {} : { json: {} });
      expectApiError(response, 401, "UNAUTHORIZED");
      summary.push(`${method} ${path.split("?")[0]}`);
    }
    return `${summary.length} endpoints`;
  });

  await h.check("mutations with a foreign Origin -> 403 and no side effects", async () => {
    const name = `Cross-site visitor ${seed.runId}`;
    const create = await userA.post(
      "/api/visitors",
      visitorBody({ name, purpose: "csrf", date: DATE, timeArrived: "10:00", importance: "LOW" }),
      { origin: "https://evil.example.com" },
    );
    expectApiError(create, 403, "FORBIDDEN");
    assert(!(await Visitor.exists({ name })), "visitor created by a cross-origin request");

    const id = need(state.visitorA, "visitor");
    expectApiError(await userA.delete(`/api/visitors/${id}`, { origin: "https://evil.example.com" }), 403, "FORBIDDEN");
    expectApiError(await userA.delete(`/api/visitors/${id}`, { origin: "null" }), 403, "FORBIDDEN");
    expectApiError(await userA.request("POST", "/api/auth/logout", { origin: "http://localhost:3999" }), 403, "FORBIDDEN");
    assert(await Visitor.exists({ _id: id }), "visitor deleted by a cross-origin request");
    return "POST/DELETE with Origin evil.example.com / null / other port rejected";
  });
}
