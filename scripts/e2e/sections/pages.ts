import { qs } from "../lib/assertions";
import { DATE, type E2EContext } from "../lib/context";
import { assert, need } from "../lib/harness";
import type { HttpClient } from "../lib/http";
import { describeInspection, inspectPage, loginNextPath, redirectTarget } from "../lib/pages";

/** Server-rendered pages: role access, office scope through URLs, redirects and open-redirect protection. */

type Expectation = "rendered" | "denied" | "denied-or-404" | "not-found" | "no-leak";

interface PageSpec {
  path: string;
  expect: Expectation;
  contains?: string[];
  notContains?: string[];
}

export async function runPagesSection(ctx: E2EContext): Promise<void> {
  const { h, seed, clients, state, baseUrl } = ctx;
  const { admin, userA, anon } = clients;
  const { A, B } = seed.offices;
  const kw = seed.keywords;
  h.section("PAGES");

  const serverErrorCount = () => ctx.server.lines.filter((line) => line.stream === "stderr").length;

  async function checkPage(client: HttpClient, spec: PageSpec): Promise<void> {
    await h.check(`${client.label} ${spec.path} -> ${spec.expect}`, async () => {
      const before = serverErrorCount();
      const response = await client.get(spec.path);
      const page = inspectPage(response);
      const summary = describeInspection(page);
      const html = response.text;

      assert(!page.errorBoundary && page.errorDigests.length === 0, `server error rendered: ${summary}`);
      assert(response.status !== 500, `HTTP 500: ${summary}`);
      switch (spec.expect) {
        case "rendered":
          assert(response.status === 200, `expected 200: ${summary}`);
          assert(!page.accessDenied && !page.notFound, `expected the page content: ${summary}`);
          break;
        case "denied":
          assert(response.status === 200 && page.accessDenied, `expected "Access denied": ${summary}`);
          break;
        case "denied-or-404":
          assert(page.accessDenied || page.notFound, `expected "Access denied" or not found: ${summary}`);
          break;
        case "not-found":
          assert(page.notFound, `expected not found: ${summary}`);
          break;
        case "no-leak":
          assert([200, 404].includes(response.status) && !page.location, `unexpected response: ${summary}`);
          break;
      }
      for (const text of spec.contains ?? []) assert(html.includes(text), `page does not contain "${text}" (${summary})`);
      for (const text of spec.notContains ?? []) assert(!html.includes(text), `page leaks "${text}" (${summary})`);
      const newErrors = ctx.server.lines.filter((line) => line.stream === "stderr").slice(before);
      assert(newErrors.length === 0, `server logged errors while rendering: ${newErrors.map((line) => line.text).join(" | ")}`);
      return summary;
    });
  }

  // ---- Unauthenticated ------------------------------------------------------------------------------
  await h.check("GET /login (signed out) -> 200 renders the email form", async () => {
    const response = await anon.get("/login");
    const page = inspectPage(response);
    assert(response.status === 200 && !page.errorBoundary, describeInspection(page));
    assert(response.text.includes('id="login-email"') && response.text.includes("Send OTP"), "login form not rendered");
    assert(loginNextPath(response.text) === "/dashboard", `nextPath ${loginNextPath(response.text)}`);
  });

  for (const [path, expectedNext] of [
    ["/", null],
    ["/dashboard", null],
    ["/visitors?date=2026-09-08", "/visitors?date=2026-09-08"],
    ["/users", "/users"],
  ] as const) {
    await h.check(`GET ${path} without a session -> redirect to /login`, async () => {
      const response = await anon.get(path);
      const page = inspectPage(response);
      assert([302, 303, 307, 308].includes(response.status), `expected a redirect: ${describeInspection(page)}`);
      const target = redirectTarget(page, baseUrl);
      assert(target && target.origin === new URL(baseUrl).origin && target.pathname === "/login", `redirect target ${page.location}`);
      if (expectedNext) assert(target.searchParams.get("next") === expectedNext, `next=${target.searchParams.get("next")}`);
      return `${response.status} -> ${page.location}`;
    });
  }

  for (const next of ["//evil.example.com", "https://evil.example.com/"]) {
    await h.check(`GET /login?next=${next} (signed out) -> form posts back to /dashboard, not off-site`, async () => {
      const response = await anon.get(`/login${qs({ next })}`);
      assert(response.status === 200, `status ${response.status}`);
      const nextPath = loginNextPath(response.text);
      assert(nextPath === "/dashboard", `LoginForm nextPath is ${JSON.stringify(nextPath)}`);
    });
  }

  // ---- Signed-in redirects -------------------------------------------------------------------------
  await h.check("GET /login while signed in -> redirect to /dashboard", async () => {
    const page = inspectPage(await userA.get("/login"));
    const target = redirectTarget(page, baseUrl);
    assert(target?.pathname === "/dashboard" && target.origin === new URL(baseUrl).origin, describeInspection(page));
    return describeInspection(page);
  });

  await h.check("GET /login?next=/visitors while signed in -> redirect to /visitors", async () => {
    const page = inspectPage(await userA.get(`/login${qs({ next: "/visitors" })}`));
    const target = redirectTarget(page, baseUrl);
    assert(target?.pathname === "/visitors", describeInspection(page));
  });

  const openRedirects = [
    "//evil.example.com",
    "https://evil.example.com",
    "/\\evil.example.com",
    "/\t/evil.example.com",
    "/.//evil.example.com",
    "///evil.example.com",
    "/%2F%2Fevil.example.com",
    "javascript:alert(1)",
  ];
  await h.check("open redirect: /login?next=<off-site variants> while signed in stays on this origin", async () => {
    const results: string[] = [];
    for (const next of openRedirects) {
      const page = inspectPage(await userA.get(`/login${qs({ next })}`));
      const target = redirectTarget(page, baseUrl);
      assert(target, `no redirect for next=${JSON.stringify(next)}: ${describeInspection(page)}`);
      assert(target.origin === new URL(baseUrl).origin, `next=${JSON.stringify(next)} redirected off-site to ${target.href}`);
      assert(!/evil\.example\.com/.test(target.pathname.replace(/^\/%2F%2F/i, "")) || target.pathname.startsWith("/%2F"), `suspicious target ${target.href}`);
      results.push(`${JSON.stringify(next)}->${page.location}`);
    }
    return results.join(" ");
  });

  // ---- Admin pages ---------------------------------------------------------------------------------
  const dailyA = state.dailyA;
  const dailyB = state.dailyB;
  const visitorA = state.visitorA;
  const visitorB = state.visitorB;
  const adminPages: PageSpec[] = [
    { path: "/dashboard", expect: "rendered" },
    { path: `/dashboard?officeId=${A.id}`, expect: "rendered", contains: [A.name] },
    { path: "/dashboard?officeId=not-an-id", expect: "rendered" },
    { path: "/daily-updates", expect: "rendered", contains: [kw.a, kw.b] },
    { path: "/daily-updates?view=milestones", expect: "rendered", contains: [kw.milestone] },
    { path: `/daily-updates?date=${DATE}&q=${kw.a}`, expect: "rendered", contains: [kw.a], notContains: [kw.b] },
    { path: `/daily-updates?officeId=${B.id}`, expect: "rendered", contains: [kw.b], notContains: [kw.a] },
    { path: "/daily-updates?from=2026-09-10&to=2026-09-01", expect: "rendered" },
    { path: "/daily-updates/new", expect: "rendered" },
    { path: `/daily-updates/new?officeId=${A.id}&date=2026-09-20`, expect: "rendered" },
    { path: `/visitors`, expect: "rendered", contains: ["Ravi Kumar"] },
    { path: `/visitors?q=Ravi&importance=HIGH&date=${DATE}`, expect: "rendered", contains: ["Ravi Kumar"], notContains: ["Sita Devi"] },
    { path: `/visitors?officeId=${B.id}`, expect: "rendered", contains: [kw.b], notContains: ["Ravi Kumar"] },
    { path: "/visitors?date=garbage&importance=URGENT", expect: "rendered" },
    { path: "/visitors/new", expect: "rendered" },
    { path: "/reports", expect: "rendered" },
    { path: `/reports?type=daily&date=${DATE}&officeId=all`, expect: "rendered", contains: [kw.a, kw.b] },
    { path: `/reports?type=weekly&date=${DATE}&officeId=${A.id}`, expect: "rendered", contains: [kw.a], notContains: [kw.b] },
    { path: "/reports?type=monthly&month=2026-09", expect: "rendered" },
    { path: "/reports?type=custom&from=2026-09-01&to=2026-09-30", expect: "rendered" },
    { path: "/reports?type=monthly&month=2026-13", expect: "rendered" },
    { path: `/reports/print?type=daily&date=${DATE}`, expect: "rendered", contains: [kw.a] },
    { path: `/reports/print?type=daily&date=${DATE}&officeId=${B.id}`, expect: "rendered", contains: [kw.b], notContains: [kw.a] },
    { path: "/offices", expect: "rendered", contains: [A.name, seed.offices.inactive.name] },
    { path: "/offices?status=zzz", expect: "rendered" },
    { path: "/offices/new", expect: "rendered" },
    { path: `/offices/${A.id}/edit`, expect: "rendered", contains: [A.code] },
    { path: "/users", expect: "rendered", contains: [seed.users.userA.email] },
    { path: "/users?role=superuser", expect: "rendered" },
    { path: "/users/new", expect: "rendered" },
    { path: `/users/${seed.users.userA.id}/edit`, expect: "rendered", contains: [seed.users.userA.email] },
    { path: "/profile", expect: "rendered", contains: [seed.users.admin.email] },
    { path: "/visitors/0123456789abcdef01234567", expect: "not-found" },
    { path: "/daily-updates/not-an-id", expect: "not-found" },
  ];
  if (dailyA) adminPages.push({ path: `/daily-updates/${dailyA}`, expect: "rendered", contains: [kw.a] }, { path: `/daily-updates/${dailyA}/edit`, expect: "rendered" });
  if (dailyB) adminPages.push({ path: `/daily-updates/${dailyB}`, expect: "rendered", contains: [kw.b] });
  if (visitorA) adminPages.push({ path: `/visitors/${visitorA}`, expect: "rendered", contains: ["Ravi Kumar"] }, { path: `/visitors/${visitorA}/edit`, expect: "rendered" });
  if (visitorB) adminPages.push({ path: `/visitors/${visitorB}`, expect: "rendered", contains: [kw.b] });
  for (const spec of adminPages) await checkPage(admin, spec);

  // ---- User A pages --------------------------------------------------------------------------------
  const userPages: PageSpec[] = [
    { path: "/dashboard", expect: "rendered", contains: [A.name], notContains: [kw.b] },
    { path: `/dashboard?officeId=${B.id}`, expect: "rendered", contains: [A.name], notContains: [kw.b] },
    { path: "/daily-updates", expect: "rendered", contains: [kw.a], notContains: [kw.b] },
    { path: "/daily-updates?view=milestones", expect: "rendered", contains: [kw.milestone], notContains: [kw.b] },
    { path: `/daily-updates?date=${DATE}&q=${kw.a}`, expect: "rendered", contains: [kw.a] },
    { path: "/daily-updates/new", expect: "rendered" },
    { path: "/visitors", expect: "rendered", contains: ["Ravi Kumar"], notContains: [kw.b] },
    { path: `/visitors?q=Ravi&importance=HIGH&date=${DATE}`, expect: "rendered", contains: ["Ravi Kumar"] },
    { path: "/visitors?page=2&pageSize=2", expect: "rendered" },
    { path: "/visitors/new", expect: "rendered" },
    { path: "/reports", expect: "rendered" },
    { path: `/reports?type=daily&date=${DATE}`, expect: "rendered", contains: [kw.a], notContains: [kw.b] },
    { path: `/reports?type=weekly&date=${DATE}`, expect: "rendered", notContains: [kw.b] },
    { path: `/reports/print?type=daily&date=${DATE}`, expect: "rendered", contains: [kw.a], notContains: [kw.b] },
    { path: "/profile", expect: "rendered", contains: [seed.users.userA.email] },
    // Admin-only pages
    { path: "/users", expect: "denied", notContains: [seed.users.admin.email] },
    { path: "/offices", expect: "denied", notContains: [seed.offices.inactive.code] },
    { path: "/users/new", expect: "denied-or-404" },
    { path: `/users/${seed.users.admin.id}/edit`, expect: "denied-or-404", notContains: [seed.users.admin.email] },
    { path: "/offices/new", expect: "denied-or-404" },
    { path: `/offices/${B.id}/edit`, expect: "denied-or-404" },
    // Other office through query parameters
    { path: `/reports?type=daily&date=${DATE}&officeId=${B.id}`, expect: "denied", notContains: [kw.b] },
    { path: `/reports?type=daily&date=${DATE}&officeId=all`, expect: "denied", notContains: [kw.b] },
    { path: `/reports/print?type=daily&date=${DATE}&officeId=${B.id}`, expect: "denied", notContains: [kw.b] },
    { path: `/daily-updates?officeId=${B.id}`, expect: "no-leak", notContains: [kw.b] },
    { path: `/visitors?officeId=${B.id}`, expect: "no-leak", notContains: [kw.b] },
    { path: `/daily-updates/new?officeId=${B.id}`, expect: "denied-or-404" },
  ];
  if (dailyA) userPages.push({ path: `/daily-updates/${dailyA}`, expect: "rendered", contains: [kw.a] }, { path: `/daily-updates/${dailyA}/edit`, expect: "rendered" });
  if (visitorA) userPages.push({ path: `/visitors/${visitorA}`, expect: "rendered", contains: ["Ravi Kumar"] }, { path: `/visitors/${visitorA}/edit`, expect: "rendered" });
  for (const spec of userPages) await checkPage(userA, spec);

  // Other office through URL ids
  await h.check("User A /visitors/<Office B id> (+ /edit) -> not rendered (Access denied or 404)", async () => {
    const id = need(visitorB, "Office B visitor");
    const results: string[] = [];
    for (const path of [`/visitors/${id}`, `/visitors/${id}/edit`]) {
      const response = await userA.get(path);
      const page = inspectPage(response);
      assert(page.accessDenied || page.notFound, `${path}: ${describeInspection(page)}`);
      assert(!response.text.includes(kw.b), `${path} leaks Office B visitor data`);
      assert(!page.errorBoundary && page.errorDigests.length === 0, `${path}: ${describeInspection(page)}`);
      results.push(`${path}: ${describeInspection(page)}`);
    }
    return results.join("; ");
  });

  await h.check("User A /daily-updates/<Office B id> (+ /edit) -> not rendered (Access denied or 404)", async () => {
    const id = need(dailyB, "Office B record");
    const results: string[] = [];
    for (const path of [`/daily-updates/${id}`, `/daily-updates/${id}/edit`]) {
      const response = await userA.get(path);
      const page = inspectPage(response);
      assert(page.accessDenied || page.notFound, `${path}: ${describeInspection(page)}`);
      assert(!response.text.includes(kw.b), `${path} leaks Office B record data`);
      assert(!page.errorBoundary && page.errorDigests.length === 0, `${path}: ${describeInspection(page)}`);
      results.push(`${path}: ${describeInspection(page)}`);
    }
    return results.join("; ");
  });

  await h.check(`User A /daily-updates/new?date=${DATE} (record exists) -> redirect to its edit page`, async () => {
    const id = need(dailyA, "Office A record");
    const page = inspectPage(await userA.get(`/daily-updates/new?date=${DATE}`));
    const target = redirectTarget(page, baseUrl);
    assert(target?.pathname === `/daily-updates/${id}/edit`, `expected redirect to the edit page: ${describeInspection(page)}`);
    return describeInspection(page);
  });

  await h.check("invalid session cookie on a page -> redirect to /login and cookie removed", async () => {
    const client = ctx.newClient("stale-cookie");
    client.setCookie("odums_session", "stale.token.value");
    const response = await client.get("/visitors");
    const target = redirectTarget(inspectPage(response), baseUrl);
    assert(target?.pathname === "/login", `redirect ${response.location}`);
    assert(!client.cookie("odums_session"), `stale cookie not cleared: ${response.setCookies.join(" | ")}`);
  });
}
