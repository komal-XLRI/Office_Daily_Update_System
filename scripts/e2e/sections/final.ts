import { apiData, expectApiError } from "../lib/assertions";
import type { E2EContext } from "../lib/context";
import { assert, need } from "../lib/harness";
import { inspectPage, redirectTarget } from "../lib/pages";

/**
 * Runs last: account/office deactivation against live sessions, OTP leak scans over every response and the
 * server log, and a review of everything the server printed.
 */

/** Server log lines that are expected during this run. */
const EXPECTED_LOG_LINES: RegExp[] = [
  // Upload tests deliberately hit "storage not configured" (a 503 is logged by handleApiError).
  /\[api\] ServiceUnavailableError: File storage is not configured/,
];

const NOTABLE = /error|warn|⨯|exception|unhandled|fail|deprecat|cannot|invalid|refused|ECONN|timeout/i;

function codePattern(code: string): RegExp {
  return new RegExp(`(^|[^0-9A-Za-z])${code}([^0-9A-Za-z]|$)`);
}

export async function runFinalSection(ctx: E2EContext): Promise<void> {
  const { h, seed, clients, smtp, server, responses, baseUrl } = ctx;
  const { admin, userA, userB } = clients;
  h.section("LIFECYCLE & LEAKS");

  await h.check("deactivating User B rejects the existing session (API 401, pages -> /login)", async () => {
    need(userB.cookie("odums_session"), "User B session");
    apiData(await admin.patch(`/api/users/${seed.users.userB.id}`, { isActive: false }), 200);
    expectApiError(await userB.get("/api/auth/session"), 401, "UNAUTHORIZED");
    expectApiError(await userB.get("/api/visitors"), 401, "UNAUTHORIZED");
    const page = inspectPage(await userB.get("/dashboard"));
    const target = redirectTarget(page, baseUrl);
    assert(target?.pathname === "/login", `dashboard for a deactivated user: status ${page.status} location ${page.location}`);
    const otp = await ctx.newClient("deactivated-otp").post("/api/auth/request-otp", { email: seed.users.userB.email });
    expectApiError(otp, 403, "INVALID_USER");
    return `page -> ${page.location ?? page.metaRefreshUrl}`;
  });

  await h.check("deactivating Office A rejects its users' sessions (401) but not the admin", async () => {
    apiData(await admin.patch(`/api/offices/${seed.offices.A.id}`, { isActive: false }), 200);
    expectApiError(await userA.get("/api/auth/session"), 401, "UNAUTHORIZED");
    apiData(await admin.get("/api/auth/session"), 200);
    apiData(await admin.patch(`/api/offices/${seed.offices.A.id}`, { isActive: true }), 200);
    apiData(await userA.get("/api/auth/session"), 200);
    return "User A 401 while Office A inactive, 200 again after reactivation";
  });

  await h.check("no API or page response body ever contained an emailed OTP code", async () => {
    const codes = smtp.allCodes();
    assert(codes.length >= 5, `expected at least 5 emailed codes, got ${codes.length}`);
    const hits: string[] = [];
    for (const response of responses) {
      if (!response.text) continue;
      for (const code of codes) {
        if (codePattern(code).test(response.text)) hits.push(`code found in ${response.client} ${response.method} ${response.path} (${response.status})`);
      }
    }
    assert(hits.length === 0, hits.join("\n"));
    return `${codes.length} codes vs ${responses.length} responses`;
  });

  await h.check("no emailed OTP code appears in the server's stdout/stderr (production mode)", async () => {
    const codes = smtp.allCodes();
    const hits = server.lines.filter((line) => codes.some((code) => codePattern(code).test(line.text)));
    assert(hits.length === 0, `OTP code printed by the server: ${hits.map((line) => `[${line.stream}] ${line.text}`).join("\n")}`);
    const devFallback = server.lines.filter((line) => line.text.includes("[DEV ONLY"));
    assert(devFallback.length === 0, "development OTP fallback line printed in production");
    return `${server.lines.length} log lines scanned`;
  });

  await h.check("server log: no unexpected errors or warnings", async () => {
    const notable = server.lines.filter(
      (line) =>
        (line.stream === "stderr" || NOTABLE.test(line.text)) &&
        line.text.trim() !== "" &&
        !EXPECTED_LOG_LINES.some((pattern) => pattern.test(line.text)),
    );
    assert(notable.length === 0, notable.map((line) => `[${line.stream}] ${line.text}`).join("\n"));
    const expected = server.lines.filter((line) => EXPECTED_LOG_LINES.some((pattern) => pattern.test(line.text)));
    return `${expected.length} expected upload 503 log lines`;
  });
}
