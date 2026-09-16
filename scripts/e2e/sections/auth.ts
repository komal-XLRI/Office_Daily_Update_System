import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";

import { SignJWT } from "jose";

import { User } from "@/models";

import { apiData, expectApiError, expectStatus } from "../lib/assertions";
import type { E2EContext } from "../lib/context";
import { assert, need } from "../lib/harness";
import type { HttpClient } from "../lib/http";

/** Spec §56 authentication: OTP request/verify rules, session cookie, logout. */

export const SESSION_COOKIE = "odums_session";
const JWT_ISSUER = "office-daily-update-system";
const JWT_AUDIENCE = "office-daily-update-system:web";

interface RequestOtpData {
  message: string;
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
}

interface SessionData {
  id: string;
  name: string;
  email: string;
  role: string;
  officeId: string | null;
  officeName: string | null;
}

function wrongCode(code: string, offset = 1): string {
  return String((Number(code) + offset) % 1_000_000).padStart(6, "0");
}

function cookieAttributes(setCookie: string): string[] {
  return setCookie.split(";").map((part) => part.trim().toLowerCase());
}

function sessionSetCookie(setCookies: string[]): string | undefined {
  return setCookies.find((header) => header.startsWith(`${SESSION_COOKIE}=`));
}

/** Request + receive + verify an OTP; leaves the session cookie in the client's jar. */
export async function signIn(ctx: E2EContext, client: HttpClient, email: string): Promise<void> {
  const mark = ctx.smtp.emails.length;
  const requested = await client.post("/api/auth/request-otp", { email });
  expectStatus(requested, 200, `request-otp for ${email}`);
  const mail = await ctx.smtp.waitForEmail(email, mark);
  const code = mail.codes[0];
  assert(code, `no 6-digit code found in the email to ${email}`);
  const verified = await client.post("/api/auth/verify-otp", { email, otp: code });
  expectStatus(verified, 200, `verify-otp for ${email}`);
  assert(client.cookie(SESSION_COOKIE), `no ${SESSION_COOKIE} cookie after verify-otp for ${email}`);
}

export async function runAuthSection(ctx: E2EContext): Promise<void> {
  const { h, smtp, seed, clients } = ctx;
  const { anon, userA, admin, userB } = clients;
  const users = seed.users;
  h.section("AUTH");

  let codeA: string | undefined;

  const isolated = await h.check(
    "request-otp for a registered active user -> 200, code emailed via SMTP (server uses the in-memory DB)",
    async () => {
      const email = users.userA.email;
      const mark = smtp.emails.length;
      const response = await userA.post("/api/auth/request-otp", { email });
      const data = apiData<RequestOtpData>(response, 200);
      assert(data.expiresInSeconds === 300, `expiresInSeconds should be 300, got ${data.expiresInSeconds}`);
      assert(!("otp" in data) && !("code" in data), `request-otp response exposes a code field: ${response.describe()}`);

      const mail = await smtp.waitForEmail(email, mark);
      assert(mail.codes.length === 1, `expected exactly one 6-digit code in the email, found ${mail.codes.length}`);
      codeA = mail.codes[0];
      assert(!response.text.includes(codeA), "request-otp response body contains the emailed code");
      assert(mail.to.length === 1 && mail.to[0] === email, `email recipients ${mail.to.join(",")} != ${email}`);

      // Proof that the server wrote to the in-memory database (never the database in .env.local).
      const stored = await User.findOne({ email }).select("+otp").lean();
      const otp = stored?.otp;
      assert(
        otp?.lastSentAt instanceof Date && typeof otp.codeHash === "string",
        "users.otp was not written in the in-memory MongoDB - the server is NOT using MONGODB_URI from the runner",
      );
      assert(/^[a-f0-9]{64}$/.test(otp.codeHash ?? "") && otp.codeHash !== codeA, "users.otp.codeHash is not an HMAC");
      return `email "${mail.subject}" from ${mail.from}; memory DB holds only an HMAC`;
    },
  );
  if (!isolated) {
    ctx.abort("could not verify that the server under test uses the in-memory MongoDB and SMTP catcher");
  }

  await h.check("resend during the cooldown -> 429 RATE_LIMITED with Retry-After and no email", async () => {
    const mark = smtp.emails.length;
    const response = await userA.post("/api/auth/request-otp", { email: users.userA.email });
    const error = expectApiError(response, 429, "RATE_LIMITED");
    const retryAfter = Number(response.headers.get("retry-after"));
    assert(retryAfter >= 1 && retryAfter <= 60, `Retry-After should be 1..60, got ${response.headers.get("retry-after")}`);
    await delay(750);
    assert(smtp.emails.length === mark, "an email was sent during the cooldown");
    return `${error.message} (Retry-After: ${retryAfter})`;
  });

  await h.check("request-otp for an unregistered email -> 404 'This email is not registered.'", async () => {
    const email = `nobody@${seed.emailDomain}`;
    const response = await anon.post("/api/auth/request-otp", { email });
    const error = expectApiError(response, 404, "INVALID_USER");
    assert(error.message === "This email is not registered.", `unexpected message: ${error.message}`);
    return error.message;
  });

  await h.check("request-otp for an inactive user -> 403 and no email", async () => {
    const response = await anon.post("/api/auth/request-otp", { email: users.inactive.email });
    const error = expectApiError(response, 403, "INVALID_USER");
    await delay(300);
    assert(smtp.emailsTo(users.inactive.email).length === 0, "an OTP email was sent to an inactive user");
    return error.message;
  });

  await h.check("request-otp for a user whose office is inactive -> 403 and no email", async () => {
    const response = await anon.post("/api/auth/request-otp", { email: users.inactiveOffice.email });
    const error = expectApiError(response, 403, "INVALID_USER");
    await delay(300);
    assert(smtp.emailsTo(users.inactiveOffice.email).length === 0, "an OTP email was sent to a user of an inactive office");
    return error.message;
  });

  await h.check("request-otp with a malformed email / non-JSON body -> 400 INVALID_INPUT", async () => {
    const malformed = await anon.post("/api/auth/request-otp", { email: "not-an-email" });
    const error = expectApiError(malformed, 400, "INVALID_INPUT");
    assert(error.fieldErrors?.email?.length, `expected fieldErrors.email: ${malformed.describe()}`);
    const nonJson = await anon.request("POST", "/api/auth/request-otp", {
      body: `email=${encodeURIComponent(users.userA.email)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    expectApiError(nonJson, 400, "INVALID_INPUT");
  });

  await h.check("verify-otp when no code was requested -> 400 OTP_EXPIRED", async () => {
    const response = await userB.post("/api/auth/verify-otp", { email: users.userB.email, otp: "123456" });
    const error = expectApiError(response, 400, "OTP_EXPIRED");
    return error.message;
  });

  await h.check("verify-otp with a wrong code -> 400 INVALID_OTP (attempts remaining 4), no session", async () => {
    const code = need(codeA, "User A's emailed code");
    const response = await userA.post("/api/auth/verify-otp", { email: users.userA.email, otp: wrongCode(code) });
    const error = expectApiError(response, 400, "INVALID_OTP");
    assert(error.details?.attemptsRemaining === 4, `attemptsRemaining should be 4: ${response.describe()}`);
    assert(!sessionSetCookie(response.setCookies), "a session cookie was set for a wrong code");
    return error.message;
  });

  await h.check("verify-otp with the correct code -> 200 + httpOnly SameSite=Lax session cookie", async () => {
    const code = need(codeA, "User A's emailed code");
    const response = await userA.post("/api/auth/verify-otp", { email: users.userA.email, otp: code });
    const data = apiData<{ redirectTo: string }>(response, 200);
    assert(data.redirectTo === "/dashboard", `redirectTo should be /dashboard, got ${data.redirectTo}`);
    assert(!response.text.includes(code), "verify-otp response contains the code");

    const setCookie = sessionSetCookie(response.setCookies);
    assert(setCookie, `no ${SESSION_COOKIE} Set-Cookie header: ${response.setCookies.join(" | ")}`);
    const attributes = cookieAttributes(setCookie);
    assert(attributes.includes("httponly"), `cookie is not HttpOnly: ${setCookie}`);
    assert(attributes.includes("samesite=lax"), `cookie is not SameSite=Lax: ${setCookie}`);
    assert(attributes.includes("path=/"), `cookie path is not /: ${setCookie}`);
    assert(attributes.includes("secure"), `cookie is not Secure in production: ${setCookie}`);
    assert(attributes.includes("max-age=28800"), `cookie Max-Age should be 28800 (8 h): ${setCookie}`);

    const token = need(userA.cookie(SESSION_COOKIE), "session cookie in the jar");
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    assert(claims.sub === users.userA.id, `JWT sub ${String(claims.sub)} != User A id`);
    assert(!JSON.stringify(claims).toLowerCase().includes("otp"), `JWT claims mention otp: ${JSON.stringify(claims)}`);
    return setCookie.replace(/=[^;]+/, "=<token>");
  });

  await h.check("GET /api/auth/session returns the signed-in user from the database", async () => {
    const response = await userA.get("/api/auth/session");
    const data = apiData<SessionData>(response, 200);
    assert(data.id === users.userA.id && data.email === users.userA.email, `wrong user: ${response.describe()}`);
    assert(data.role === "user" && data.officeId === seed.offices.A.id, `wrong role/office: ${response.describe()}`);
    assert(data.officeName === seed.offices.A.name, `officeName should be ${seed.offices.A.name}: ${response.describe()}`);
    assert(!/otp|codeHash/i.test(response.text), `session response mentions otp: ${response.describe()}`);
    return `${data.email} role=${data.role} office=${data.officeName}`;
  });

  await h.check("re-using an already used code -> rejected (400) and no new session", async () => {
    const code = need(codeA, "User A's emailed code");
    const replay = anon.clone("replay");
    const response = await replay.post("/api/auth/verify-otp", { email: users.userA.email, otp: code });
    const error = expectApiError(response, 400);
    assert(["OTP_EXPIRED", "INVALID_OTP"].includes(error.code), `unexpected code ${error.code}`);
    assert(!sessionSetCookie(response.setCookies), "a session cookie was issued for a used code");
    return `${error.code}: ${error.message}`;
  });

  await h.check("expired code (users.otp.expiresAt moved into the past) -> 400 OTP_EXPIRED", async () => {
    const client = ctx.newClient("expiry");
    const email = users.expiry.email;
    const mark = smtp.emails.length;
    expectStatus(await client.post("/api/auth/request-otp", { email }), 200, "request-otp");
    const mail = await smtp.waitForEmail(email, mark);
    const code = need(mail.codes[0], "emailed code");
    const updated = await User.updateOne({ email }, { $set: { "otp.expiresAt": new Date(Date.now() - 60_000) } });
    assert(updated.modifiedCount === 1, "could not expire the OTP in the in-memory DB");
    const response = await client.post("/api/auth/verify-otp", { email, otp: code });
    const error = expectApiError(response, 400, "OTP_EXPIRED");
    assert(!client.cookie(SESSION_COOKIE), "a session cookie was issued for an expired code");
    return error.message;
  });

  await h.check("5 wrong attempts -> TOO_MANY_ATTEMPTS, and the correct code is then rejected", async () => {
    const client = ctx.newClient("attempts");
    const email = users.attempts.email;
    const mark = smtp.emails.length;
    expectStatus(await client.post("/api/auth/request-otp", { email }), 200, "request-otp");
    const code = need((await smtp.waitForEmail(email, mark)).codes[0], "emailed code");

    const observed: string[] = [];
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await client.post("/api/auth/verify-otp", { email, otp: wrongCode(code, attempt) });
      const body = response.json<{ error?: { code: string; details?: { attemptsRemaining?: number } } }>();
      observed.push(`${response.status}:${body.error?.code}:${body.error?.details?.attemptsRemaining ?? "-"}`);
    }
    const expected = ["400:INVALID_OTP:4", "400:INVALID_OTP:3", "400:INVALID_OTP:2", "400:INVALID_OTP:1", "429:TOO_MANY_ATTEMPTS:-"];
    assert(observed.join(" ") === expected.join(" "), `attempt sequence ${observed.join(" ")} != ${expected.join(" ")}`);

    const afterLockout = await client.post("/api/auth/verify-otp", { email, otp: code });
    expectStatus(afterLockout, [400, 429], "correct code after lockout");
    assert(!client.cookie(SESSION_COOKIE), "the correct code still signed in after too many attempts");
    return `${observed.join(" ")}; correct code afterwards -> ${afterLockout.status}`;
  });

  await h.check("per-IP limiter: 11th request-otp from one client address within 15 min -> 429", async () => {
    const client = ctx.newClient("ip-limit");
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await client.post("/api/auth/request-otp", { email: `flood${index}@${seed.emailDomain}` });
      statuses.push(response.status);
    }
    assert(statuses.slice(0, 10).every((status) => status === 404), `first 10 should be 404: ${statuses.join(",")}`);
    assert(statuses[10] === 429, `11th should be 429: ${statuses.join(",")}`);
    return statuses.join(",");
  });

  await h.check("Admin (no office) and User B can sign in with emailed codes", async () => {
    await signIn(ctx, admin, users.admin.email);
    await signIn(ctx, userB, users.userB.email);
    const adminSession = apiData<SessionData>(await admin.get("/api/auth/session"), 200);
    assert(adminSession.role === "admin" && adminSession.officeId === null, `admin session: ${JSON.stringify(adminSession)}`);
    const userBSession = apiData<SessionData>(await userB.get("/api/auth/session"), 200);
    assert(userBSession.officeId === seed.offices.B.id, `user B office: ${JSON.stringify(userBSession)}`);
  });

  await h.check("POST /api/auth/logout clears the cookie; the cleared jar is then unauthenticated", async () => {
    const token = need(userA.cookie(SESSION_COOKIE), "User A session");
    const loggingOut = userA.clone("userA-logout");
    const response = await loggingOut.request("POST", "/api/auth/logout");
    expectStatus(response, 200);
    const cleared = sessionSetCookie(response.setCookies);
    assert(cleared, `logout did not send a ${SESSION_COOKIE} Set-Cookie: ${response.setCookies.join(" | ")}`);
    const attributes = cookieAttributes(cleared);
    const expired =
      attributes.includes("max-age=0") ||
      attributes.some((attribute) => attribute.startsWith("expires=") && Date.parse(attribute.slice(8)) < Date.now());
    assert(expired, `logout cookie is not expired: ${cleared}`);
    assert(!loggingOut.cookie(SESSION_COOKIE), "cookie still present after logout");
    expectApiError(await loggingOut.get("/api/auth/session"), 401, "UNAUTHORIZED");

    const replayed = ctx.newClient("logout-replay");
    replayed.setCookie(SESSION_COOKIE, token);
    const stillAccepted = await replayed.get("/api/auth/session");
    return `cookie cleared (${cleared.split(";").slice(1).join(";").trim()}); the logged-out JWT replayed manually -> ${stillAccepted.status} (stateless session, no server-side revocation)`;
  });

  await h.check("tampered or forged session tokens -> 401", async () => {
    const token = need(userA.cookie(SESSION_COOKIE), "User A session");
    const [header, payload, signature] = token.split(".");
    const middle = Math.floor(signature.length / 2);
    const flipped = `${signature.slice(0, middle)}${signature[middle] === "A" ? "B" : "A"}${signature.slice(middle + 1)}`;

    const base64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const adminClaims = {
      sub: users.admin.id,
      name: users.admin.name,
      email: users.admin.email,
      role: "admin",
      officeId: null,
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now,
      exp: now + 3600,
    };
    const unsigned = `${base64({ alg: "none", typ: "JWT" })}.${base64(adminClaims)}.`;
    const wrongSecret = await new SignJWT({ name: users.admin.name, email: users.admin.email, role: "admin", officeId: null })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(users.admin.id)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("not-the-server-secret-0123456789-abcdefghijklmnop"));

    const variants: Record<string, string> = {
      "flipped signature": `${header}.${payload}.${flipped}`,
      "alg none": unsigned,
      "wrong secret": wrongSecret,
      garbage: "garbage",
    };
    const results: string[] = [];
    for (const [label, value] of Object.entries(variants)) {
      const client = ctx.newClient(`forged-${label}`);
      client.setCookie(SESSION_COOKIE, value);
      const response = await client.get("/api/auth/session");
      results.push(`${label}=${response.status}`);
      expectApiError(response, 401, "UNAUTHORIZED");
    }
    return results.join(", ");
  });

  await h.check("role/office claims in a validly signed JWT are not trusted (DB role wins)", async () => {
    const forged = await new SignJWT({ name: users.userA.name, email: users.userA.email, role: "admin", officeId: null })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(users.userA.id)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(ctx.authSecret));
    const client = ctx.newClient("claims-escalation");
    client.setCookie(SESSION_COOKIE, forged);
    const session = apiData<SessionData>(await client.get("/api/auth/session"), 200);
    assert(session.role === "user" && session.officeId === seed.offices.A.id, `claims were trusted: ${JSON.stringify(session)}`);
    expectApiError(await client.get("/api/users"), 403, "FORBIDDEN");
    expectApiError(await client.get(`/api/visitors?officeId=${seed.offices.B.id}`), 403, "FORBIDDEN");
    return "role=admin claim ignored; /api/users -> 403";
  });
}
