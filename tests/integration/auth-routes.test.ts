import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as requestOtpPost } from "@/app/api/auth/request-otp/route";
import { GET as sessionGet } from "@/app/api/auth/session/route";
import { POST as verifyOtpPost } from "@/app/api/auth/verify-otp/route";
import { setOtpMailerForTesting, type OtpEmailMessage } from "@/lib/auth/mailer";
import { resetRateLimits } from "@/lib/auth/rate-limit";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSessionToken,
  verifySessionToken,
} from "@/lib/auth/session-token";
import { resetServerEnvCache } from "@/lib/env";
import { User } from "@/models/User";

import { createOffice, createUser, registerTestDatabase } from "../setup/db";

// Spec §10 (never return OTP, rate limiting), §12 (session), §37 (API rules), §45.6/8/10/12, §55.3-6.

/** Cookie store behind the mocked next/headers `cookies()`; a NextResponse's ResponseCookies per test. */
const cookieJar = vi.hoisted(() => ({ response: null as NextResponse | null }));

vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!cookieJar.response) throw new Error("Cookie store not initialised");
    return cookieJar.response.cookies;
  },
  headers: async () => new Headers(),
}));

registerTestDatabase();

const ORIGIN = "http://localhost:3000";
const DEFAULT_IP = "198.51.100.1";

let sent: OtpEmailMessage[] = [];

beforeEach(() => {
  sent = [];
  cookieJar.response = new NextResponse(null);
  resetRateLimits();
  setOtpMailerForTesting(async (message) => {
    sent.push(message);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
  setOtpMailerForTesting(null);
  cookieJar.response = null;
});

function jar() {
  if (!cookieJar.response) throw new Error("Cookie store not initialised");
  return cookieJar.response;
}

interface RequestOptions {
  ip?: string;
  headers?: Record<string, string>;
  rawBody?: string;
}

function postJson(path: string, body: unknown, options: RequestOptions = {}): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      host: "localhost:3000",
      origin: ORIGIN,
      "content-type": "application/json",
      "x-forwarded-for": options.ip ?? DEFAULT_IP,
      ...options.headers,
    },
    body: options.rawBody ?? JSON.stringify(body),
  });
}

function getRequest(path: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { method: "GET", headers: { host: "localhost:3000" } });
}

const callRequestOtp = (body: unknown, options?: RequestOptions) =>
  requestOtpPost(postJson("/api/auth/request-otp", body, options), undefined);
const callVerifyOtp = (body: unknown, options?: RequestOptions) =>
  verifyOtpPost(postJson("/api/auth/verify-otp", body, options), undefined);
const callLogout = (options?: RequestOptions) => logoutPost(postJson("/api/auth/logout", {}, options), undefined);
const callSession = () => sessionGet(getRequest("/api/auth/session"), undefined);

/** Loose view of `{ data }` / `{ error }` bodies for assertions (fields may be absent at runtime). */
interface JsonBody {
  data: Record<string, unknown>;
  error: {
    code: string;
    message: string;
    fieldErrors: Record<string, string[]>;
    details: Record<string, unknown>;
  };
}

async function readBody(response: Response): Promise<{ text: string; json: JsonBody }> {
  const text = await response.text();
  return { text, json: JSON.parse(text) as JsonBody };
}

/** Request an OTP through the route and return the emailed code. */
async function obtainCode(email: string): Promise<string> {
  const response = await callRequestOtp({ email });
  expect(response.status).toBe(200);
  return sent[sent.length - 1].otp;
}

describe("POST /api/auth/request-otp", () => {
  it("sends the OTP by email and never includes it in the response", async () => {
    await createUser({ email: "user.a@example.com" });

    const response = await callRequestOtp({ email: "User.A@example.com" });
    const { text, json } = await readBody(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(json).toEqual({
      data: { message: "OTP sent to your email.", expiresInSeconds: 300, resendAvailableInSeconds: 60 },
    });
    expect(sent).toHaveLength(1);
    expect(text).not.toContain(sent[0].otp);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(jar().headers.getSetCookie()).toEqual([]);
  });

  it("rejects an unregistered email with 404", async () => {
    const response = await callRequestOtp({ email: "nobody@example.com" });
    expect(response.status).toBe(404);
    expect((await readBody(response)).json).toEqual({
      error: { code: "INVALID_USER", message: "This email is not registered." },
    });
    expect(sent).toHaveLength(0);
  });

  it("rejects an inactive user with 403", async () => {
    await createUser({ email: "inactive@example.com", isActive: false });
    const response = await callRequestOtp({ email: "inactive@example.com" });
    expect(response.status).toBe(403);
    expect((await readBody(response)).json.error.code).toBe("INVALID_USER");
    expect(sent).toHaveLength(0);
  });

  it("rejects a user whose office is inactive with 403", async () => {
    const office = await createOffice({ isActive: false });
    await createUser({ email: "closed@example.com", officeId: office });
    const response = await callRequestOtp({ email: "closed@example.com" });
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await callRequestOtp(undefined, { rawBody: "{ email: nope" });
    expect(response.status).toBe(400);
    expect((await readBody(response)).json).toEqual({
      error: { code: "INVALID_INPUT", message: "Request body must be valid JSON." },
    });
  });

  it("returns 400 when the body is not declared as JSON", async () => {
    const response = await callRequestOtp({ email: "a@example.com" }, { headers: { "content-type": "text/plain" } });
    expect(response.status).toBe(400);
    expect((await readBody(response)).json.error.message).toBe("Expected a JSON request body.");
  });

  it.each([{}, { email: "not-an-email" }, { email: { $ne: null } }, { email: ["a@example.com"] }])(
    "returns 400 with field errors for invalid input %j",
    async (body) => {
      const response = await callRequestOtp(body);
      expect(response.status).toBe(400);
      const { json } = await readBody(response);
      expect(json.error.code).toBe("INVALID_INPUT");
      expect(json.error.fieldErrors.email.length).toBeGreaterThan(0);
      expect(sent).toHaveLength(0);
    },
  );

  it("returns 429 with Retry-After during the resend cooldown", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");

    const response = await callRequestOtp({ email: "user.a@example.com" });
    const { text, json } = await readBody(response);

    expect(response.status).toBe(429);
    expect(json.error.code).toBe("RATE_LIMITED");
    const retryAfter = Number(response.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(json.error.details).toEqual({ retryAfterSeconds: retryAfter });
    expect(text).not.toContain(code);
    expect(sent).toHaveLength(1);
  });

  it("rejects a cross-origin request with 403 and sends nothing", async () => {
    await createUser({ email: "user.a@example.com" });
    const response = await callRequestOtp(
      { email: "user.a@example.com" },
      { headers: { origin: "https://evil.example.com" } },
    );
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });

  it("rate-limits by client IP: the 11th request in 15 minutes gets 429", async () => {
    vi.stubEnv("AUTH_REQUEST_OTP_IP_LIMIT", "10");
    await createUser({ email: "user.a@example.com" });
    const ip = "203.0.113.77";

    for (let i = 0; i < 10; i += 1) {
      const response = await callRequestOtp({ email: `unknown.${i}@example.com` }, { ip });
      expect(response.status).toBe(404);
    }

    const limited = await callRequestOtp({ email: "user.a@example.com" }, { ip });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("900");
    expect((await readBody(limited)).json).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again in 15 minutes.",
        details: { retryAfterSeconds: 900 },
      },
    });
    expect(sent).toHaveLength(0);

    // Invalid bodies from the limited IP are also refused before parsing.
    expect((await callRequestOtp(undefined, { ip, rawBody: "not json" })).status).toBe(429);

    // Another client is unaffected.
    const other = await callRequestOtp({ email: "user.a@example.com" }, { ip: "203.0.113.78" });
    expect(other.status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

describe("POST /api/auth/verify-otp", () => {
  it("creates an httpOnly, SameSite=Lax session cookie and never returns the OTP", async () => {
    const office = await createOffice({ name: "Office A" });
    const user = await createUser({ name: "User A", email: "user.a@example.com", officeId: office });
    const code = await obtainCode("user.a@example.com");

    const response = await callVerifyOtp({ email: "user.a@example.com", otp: code });
    const { text, json } = await readBody(response);

    expect(response.status).toBe(200);
    expect(json).toEqual({ data: { redirectTo: "/dashboard" } });
    expect(text).not.toContain(code);
    expect(text).not.toContain(SESSION_COOKIE_NAME);

    const cookie = jar().cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toMatchObject({
      name: SESSION_COOKIE_NAME,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
      secure: false,
    });
    expect(cookie?.value).not.toContain(code);

    const [setCookie] = jar().headers.getSetCookie();
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(setCookie).not.toContain("Domain=");

    await expect(verifySessionToken(cookie?.value)).resolves.toEqual({
      userId: String(user._id),
      name: "User A",
      email: "user.a@example.com",
      role: "user",
      officeId: String(office._id),
      sessionVersion: 0,
    });
  });

  it("marks the session cookie Secure in production", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");
    vi.stubEnv("NODE_ENV", "production");

    const response = await callVerifyOtp({ email: "user.a@example.com", otp: code });

    expect(response.status).toBe(200);
    expect(jar().cookies.get(SESSION_COOKIE_NAME)).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax" });
    expect(jar().headers.getSetCookie()[0]).toContain("Secure");
  });

  it("returns 400 INVALID_OTP with attempts remaining for a wrong code and sets no cookie", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");
    const wrong = code === "000000" ? "111111" : "000000";

    const response = await callVerifyOtp({ email: "user.a@example.com", otp: wrong });
    const { text, json } = await readBody(response);

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: {
        code: "INVALID_OTP",
        message: "Invalid OTP. 4 attempts remaining.",
        details: { attemptsRemaining: 4 },
      },
    });
    expect(text).not.toContain(code);
    expect(jar().headers.getSetCookie()).toEqual([]);
  });

  it("returns 429 TOO_MANY_ATTEMPTS on the fifth wrong code, then refuses the correct code", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 4; i += 1) {
      expect((await callVerifyOtp({ email: "user.a@example.com", otp: wrong })).status).toBe(400);
    }
    const fifth = await callVerifyOtp({ email: "user.a@example.com", otp: wrong });
    expect(fifth.status).toBe(429);
    expect((await readBody(fifth)).json.error.code).toBe("TOO_MANY_ATTEMPTS");

    const correct = await callVerifyOtp({ email: "user.a@example.com", otp: code });
    expect(correct.status).toBeGreaterThanOrEqual(400);
    expect(jar().cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("returns 400 OTP_EXPIRED for an expired code", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");
    await User.updateOne({ _id: user._id }, { $set: { "otp.expiresAt": new Date(Date.now() - 1000) } });

    const response = await callVerifyOtp({ email: "user.a@example.com", otp: code });
    expect(response.status).toBe(400);
    expect((await readBody(response)).json.error.code).toBe("OTP_EXPIRED");
    expect(jar().cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("rejects a reused code", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");
    expect((await callVerifyOtp({ email: "user.a@example.com", otp: code })).status).toBe(200);

    cookieJar.response = new NextResponse(null);
    const reuse = await callVerifyOtp({ email: "user.a@example.com", otp: code });
    expect(reuse.status).toBe(400);
    expect((await readBody(reuse)).json.error.code).toBe("OTP_EXPIRED");
    expect(jar().cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("returns 400 for invalid JSON or a malformed code", async () => {
    const invalidJson = await callVerifyOtp(undefined, { rawBody: '{"email":' });
    expect(invalidJson.status).toBe(400);
    expect((await readBody(invalidJson)).json.error.message).toBe("Request body must be valid JSON.");

    const malformed = await callVerifyOtp({ email: "user.a@example.com", otp: "12ab" });
    expect(malformed.status).toBe(400);
    expect((await readBody(malformed)).json.error.fieldErrors).toEqual({ otp: ["Enter the 6-digit OTP"] });

    const injected = await callVerifyOtp({ email: "user.a@example.com", otp: { $gt: "" } });
    expect(injected.status).toBe(400);
    expect(jar().headers.getSetCookie()).toEqual([]);
  });

  it("rejects a cross-origin verification without consuming the code", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");

    const crossSite = await callVerifyOtp(
      { email: "user.a@example.com", otp: code },
      { headers: { origin: "https://evil.example.com" } },
    );
    expect(crossSite.status).toBe(403);
    expect(jar().headers.getSetCookie()).toEqual([]);

    expect((await callVerifyOtp({ email: "user.a@example.com", otp: code })).status).toBe(200);
  });

  it("rate-limits verification by client IP: the 31st request in 15 minutes gets 429", async () => {
    vi.stubEnv("AUTH_VERIFY_OTP_IP_LIMIT", "30");
    await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");
    const ip = "203.0.113.90";

    for (let i = 0; i < 30; i += 1) {
      const response = await callVerifyOtp({ email: "user.a@example.com", otp: "12" }, { ip });
      expect(response.status).toBe(400);
    }

    const limited = await callVerifyOtp({ email: "user.a@example.com", otp: code }, { ip });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("900");
    expect((await readBody(limited)).json.error.code).toBe("RATE_LIMITED");
    expect(jar().cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });
});

describe("GET /api/auth/session and POST /api/auth/logout", () => {
  it("full flow: request → verify → session → logout → signed out", async () => {
    const office = await createOffice({ name: "Office A" });
    const user = await createUser({ name: "User A", email: "user.a@example.com", officeId: office });
    const code = await obtainCode("user.a@example.com");
    expect((await callVerifyOtp({ email: "user.a@example.com", otp: code })).status).toBe(200);

    const session = await callSession();
    const { text, json } = await readBody(session);
    expect(session.status).toBe(200);
    expect(json).toEqual({
      data: {
        id: String(user._id),
        name: "User A",
        email: "user.a@example.com",
        role: "user",
        officeId: String(office._id),
        officeName: "Office A",
      },
    });
    expect(text).not.toMatch(/otp|codeHash/i);

    const logout = await callLogout();
    expect(logout.status).toBe(200);
    expect((await readBody(logout)).json).toEqual({ data: { ok: true } });

    const cookie = jar().cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("");
    expect(cookie?.expires).toEqual(new Date(0));
    const setCookies = jar().headers.getSetCookie();
    expect(setCookies[setCookies.length - 1]).toMatch(
      new RegExp(`^${SESSION_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`),
    );

    const afterLogout = await callSession();
    expect(afterLogout.status).toBe(401);
    expect((await readBody(afterLogout)).json).toEqual({
      error: { code: "UNAUTHORIZED", message: "Please sign in to continue." },
    });
  });

  it("GET /api/auth/session returns 401 without a cookie or with a forged cookie", async () => {
    expect((await callSession()).status).toBe(401);

    jar().cookies.set(SESSION_COOKIE_NAME, "forged.token.value");
    expect((await callSession()).status).toBe(401);
  });

  it("GET /api/auth/session reflects the database, not the token", async () => {
    const officeA = await createOffice({ name: "Office A" });
    const user = await createUser({ email: "user.a@example.com", officeId: officeA });
    const token = await signSessionToken({
      userId: String(user._id),
      name: "Claimed Admin",
      email: "user.a@example.com",
      role: "admin",
      officeId: null,
    });
    jar().cookies.set(SESSION_COOKIE_NAME, token);

    const response = await callSession();
    expect(response.status).toBe(200);
    expect((await readBody(response)).json.data).toMatchObject({
      role: "user",
      officeId: String(officeA._id),
      officeName: "Office A",
    });

    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });
    expect((await callSession()).status).toBe(401);
  });

  it("logout revokes copies of the token (sessionVersion)", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await obtainCode("user.a@example.com");
    expect((await callVerifyOtp({ email: "user.a@example.com", otp: code })).status).toBe(200);
    const token = jar().cookies.get(SESSION_COOKIE_NAME)?.value;
    expect(token).toBeTruthy();

    expect((await callLogout()).status).toBe(200);
    expect(await User.findOne({ email: "user.a@example.com" }).lean()).toMatchObject({ sessionVersion: 1 });

    // Replaying the old token no longer authenticates.
    jar().cookies.set(SESSION_COOKIE_NAME, token!);
    expect((await callSession()).status).toBe(401);
  });

    it("logout succeeds when already signed out", async () => {
    const response = await callLogout();
    expect(response.status).toBe(200);
    expect((await readBody(response)).json).toEqual({ data: { ok: true } });
  });

  it("logout rejects a cross-origin request and keeps the session", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const token = await signSessionToken({
      userId: String(user._id),
      name: user.name,
      email: user.email,
      role: "user",
      officeId: String(user.officeId),
    });
    jar().cookies.set(SESSION_COOKIE_NAME, token);

    const response = await callLogout({ headers: { origin: "https://evil.example.com" } });
    expect(response.status).toBe(403);
    expect(jar().cookies.get(SESSION_COOKIE_NAME)?.value).toBe(token);
    expect((await callSession()).status).toBe(200);
  });
});
