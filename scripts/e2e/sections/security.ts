import { expectApiError, expectStatus } from "../lib/assertions";
import type { E2EContext } from "../lib/context";
import { assert } from "../lib/harness";
import type { HttpResponse } from "../lib/http";
import { SESSION_COOKIE } from "./auth";

/** Security headers, error-response hygiene and secret exposure. */

const STACK_PATTERNS = [
  /\n\s+at\s+\S+/,
  /\bat\s+[\w$.<>]+\s+\([^)]*:\d+:\d+\)/,
  /node_modules/,
  /[A-Za-z]:\\\\?Users\\\\?/,
  /\.next[\\/]server/,
  /Mongo(Server|Network)?Error/,
  /E11000/,
  /ZodError/,
  /CastError/,
];

function assertSecurityHeaders(response: HttpResponse): string {
  const get = (name: string) => response.headers.get(name);
  assert(get("x-frame-options")?.toUpperCase() === "DENY", `X-Frame-Options=${get("x-frame-options")} on ${response.path}`);
  assert(get("x-content-type-options")?.toLowerCase() === "nosniff", `X-Content-Type-Options=${get("x-content-type-options")} on ${response.path}`);
  assert(Boolean(get("referrer-policy")), `Referrer-Policy missing on ${response.path}`);
  assert(!get("x-powered-by"), `X-Powered-By present on ${response.path}: ${get("x-powered-by")}`);
  return `${response.path}: XFO=${get("x-frame-options")}, XCTO=${get("x-content-type-options")}, Referrer-Policy=${get("referrer-policy")}, Permissions-Policy=${get("permissions-policy") ?? "-"}`;
}

export async function runSecuritySection(ctx: E2EContext): Promise<void> {
  const { h, clients, responses, seed } = ctx;
  const { anon, userA, admin } = clients;
  h.section("SECURITY");

  await h.check("security headers on an HTML page, JSON API responses and a file download; no X-Powered-By", async () => {
    const details = [
      assertSecurityHeaders(await anon.get("/login")),
      assertSecurityHeaders(await userA.get("/dashboard")),
      assertSecurityHeaders(await anon.get("/api/auth/session")),
      assertSecurityHeaders(await admin.get("/api/visitors")),
      assertSecurityHeaders(await admin.get("/api/reports?type=daily&date=2026-09-08&format=csv")),
    ];
    return details.join(" | ");
  });

  await h.check("X-Powered-By absent on every recorded response (spot check of redirects and 404s)", async () => {
    for (const path of ["/", "/api/does-not-exist", "/no-such-page"]) {
      const response = await anon.get(path);
      assert(!response.headers.get("x-powered-by"), `X-Powered-By on ${path}`);
    }
  });

  await h.check("malformed JSON / wrong content type / oversized ids -> 400/404 JSON without internals", async () => {
    const malformed = await userA.request("POST", "/api/visitors", { body: "{not json", headers: { "Content-Type": "application/json" } });
    expectApiError(malformed, 400, "INVALID_INPUT");
    const text = await userA.request("POST", "/api/daily-milestones", { body: "hello", headers: { "Content-Type": "text/plain" } });
    expectApiError(text, 400, "INVALID_INPUT");
    const arrayBody = await userA.post("/api/visitors", [1, 2, 3]);
    expectApiError(arrayBody, 400, "INVALID_INPUT");
    const operator = await userA.get("/api/visitors?officeId[$ne]=x&q[$regex]=.*");
    expectStatus(operator, [200, 400]);
    const longId = await userA.get(`/api/visitors/${"a".repeat(5000)}`);
    expectStatus(longId, [404, 414, 431]);
  });

  await h.check("mass assignment: extra fields (createdBy, _id, otp) in bodies are ignored", async () => {
    const response = await userA.post("/api/visitors", {
      name: `Mass assignment ${seed.runId}`,
      purpose: "x",
      date: "2026-09-14",
      timeArrived: "10:00",
      timeDeparted: "",
      importance: "LOW",
      photos: [],
      documents: [],
      remarks: "",
      createdBy: seed.users.admin.id,
      _id: "0123456789abcdef01234567",
    });
    expectStatus(response, 201);
    const body = response.json<{ data: { id: string; createdBy: { id: string } | null } }>();
    assert(body.data.createdBy?.id === seed.users.userA.id, `createdBy overridden: ${JSON.stringify(body.data.createdBy)}`);
    assert(body.data.id !== "0123456789abcdef01234567", "_id taken from the body");
    await userA.delete(`/api/visitors/${body.data.id}`);
  });

  await h.check("every API error response is { error: { code, message } } with no stack trace or internals", async () => {
    const errors = responses.filter((response) => response.path.startsWith("/api/") && response.status >= 400);
    assert(errors.length > 50, `expected many recorded API errors, got ${errors.length}`);
    const problems: string[] = [];
    for (const response of errors) {
      const text = response.text ?? "";
      let parsed: { error?: { code?: unknown; message?: unknown } } | null = null;
      try {
        parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
      } catch {
        parsed = null;
      }
      const isEnvelope = parsed && typeof parsed.error?.code === "string" && typeof parsed.error.message === "string";
      const isNextNotFound = response.status === 404 && !response.contentType.includes("json");
      if (!isEnvelope && !isNextNotFound) problems.push(`${response.method} ${response.path} ${response.status}: not an error envelope: ${text.slice(0, 120)}`);
      const leak = STACK_PATTERNS.find((pattern) => pattern.test(text));
      if (leak) problems.push(`${response.method} ${response.path} ${response.status}: matches ${leak}: ${text.slice(0, 200)}`);
      if (response.status >= 500 && response.status !== 503) problems.push(`${response.method} ${response.path} -> ${response.status}: ${text.slice(0, 200)}`);
    }
    assert(problems.length === 0, problems.join("\n"));
    return `${errors.length} error responses inspected`;
  });

  await h.check("no response contains AUTH_SECRET, the MongoDB URI, codeHash or the users.otp sub-document", async () => {
    const needles: Array<[string, string]> = [
      [ctx.authSecret, "AUTH_SECRET"],
      [ctx.memoryUri, "MONGODB_URI"],
      [new URL(ctx.memoryUri).host, "MongoDB host:port"],
      ["codeHash", "codeHash"],
      ['"otp":{', "otp sub-document"],
      ["sendWindowStartedAt", "otp state"],
    ];
    const hits: string[] = [];
    for (const response of responses) {
      if (!response.text) continue;
      for (const [needle, label] of needles) {
        if (response.text.includes(needle)) hits.push(`${label} in ${response.method} ${response.path} (${response.status})`);
      }
    }
    assert(hits.length === 0, hits.join("\n"));
    return `${responses.length} responses scanned`;
  });

  await h.check("authenticated API responses are Cache-Control: no-store", async () => {
    for (const path of ["/api/auth/session", "/api/visitors", "/api/daily-milestones", "/api/reports?type=daily&date=2026-09-08"]) {
      const response = await userA.get(path);
      assert((response.headers.get("cache-control") ?? "").includes("no-store"), `${path}: Cache-Control=${response.headers.get("cache-control")}`);
    }
    const pdf = await userA.get("/api/reports?type=daily&date=2026-09-08&format=pdf");
    assert((pdf.headers.get("cache-control") ?? "").includes("no-store"), `pdf Cache-Control=${pdf.headers.get("cache-control")}`);
  });

  await h.check("session cookie is never readable from page HTML (httpOnly token not embedded)", async () => {
    const token = userA.cookie(SESSION_COOKIE);
    assert(token, "no session");
    const html = (await userA.get("/dashboard")).text;
    assert(!html.includes(token), "the session JWT is embedded in the page HTML");
  });
}
