import { decodeJwt, decodeProtectedHeader, SignJWT, type JWTPayload } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/auth/session-token";
import { ConfigurationError } from "@/lib/errors";
import { resetServerEnvCache } from "@/lib/env";

// Spec §12 (session contents), §45.10 (secure sessions), §55.6 (session security).

const SECRET = "unit-test-session-secret-0123456789-abcdefghijklmnop";
const OTHER_SECRET = "a-completely-different-secret-0123456789-zyxwvutsrq";
const ISSUER = "office-daily-update-system";
const AUDIENCE = "office-daily-update-system:web";

const USER_PAYLOAD: SessionPayload = {
  userId: "64f1a0000000000000000c01",
  name: "User A",
  email: "user.a@example.com",
  role: "user",
  officeId: "64f1a0000000000000000a01",
  sessionVersion: 0,
};

const ADMIN_PAYLOAD: SessionPayload = {
  userId: "64f1a0000000000000000c02",
  name: "Admin",
  email: "admin@example.com",
  role: "admin",
  officeId: null,
  sessionVersion: 0,
};

function useSecret(secret: string) {
  vi.stubEnv("AUTH_SECRET", secret);
  resetServerEnvCache();
}

interface CraftOptions {
  claims?: JWTPayload;
  subject?: string | null;
  issuer?: string | null;
  audience?: string | null;
  expiresAt?: number | null;
  alg?: "HS256" | "HS384" | "HS512";
  secret?: string;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Sign an arbitrary token with jose directly (bypassing signSessionToken's guarantees). */
async function craftToken(options: CraftOptions = {}): Promise<string> {
  const claims = options.claims ?? {
    name: USER_PAYLOAD.name,
    email: USER_PAYLOAD.email,
    role: USER_PAYLOAD.role,
    officeId: USER_PAYLOAD.officeId,
  };
  let jwt = new SignJWT(claims).setProtectedHeader({ alg: options.alg ?? "HS256", typ: "JWT" }).setIssuedAt();
  const subject = options.subject === undefined ? USER_PAYLOAD.userId : options.subject;
  if (subject !== null) jwt = jwt.setSubject(subject);
  const issuer = options.issuer === undefined ? ISSUER : options.issuer;
  if (issuer !== null) jwt = jwt.setIssuer(issuer);
  const audience = options.audience === undefined ? AUDIENCE : options.audience;
  if (audience !== null) jwt = jwt.setAudience(audience);
  const expiresAt = options.expiresAt === undefined ? nowSeconds() + 3600 : options.expiresAt;
  if (expiresAt !== null) jwt = jwt.setExpirationTime(expiresAt);
  return jwt.sign(new TextEncoder().encode(options.secret ?? SECRET));
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

beforeEach(() => {
  useSecret(SECRET);
});

afterEach(() => {
  vi.useRealTimers();
  resetServerEnvCache();
});

describe("session token constants", () => {
  it("uses a dedicated cookie name and an 8 hour lifetime", () => {
    expect(SESSION_COOKIE_NAME).toBe("odums_session");
    expect(SESSION_MAX_AGE_SECONDS).toBe(8 * 60 * 60);
  });
});

describe("signSessionToken / verifySessionToken round trip", () => {
  it("returns exactly the session payload for a normal user (spec §12)", async () => {
    const token = await signSessionToken(USER_PAYLOAD);
    await expect(verifySessionToken(token)).resolves.toEqual(USER_PAYLOAD);
  });

  it("round-trips an admin without an office", async () => {
    const token = await signSessionToken(ADMIN_PAYLOAD);
    const verified = await verifySessionToken(token);
    expect(verified).toEqual(ADMIN_PAYLOAD);
    expect(verified?.officeId).toBeNull();
  });

  it("signs HS256 with issuer, audience, subject and an 8 hour expiry, and nothing sensitive", async () => {
    const token = await signSessionToken(USER_PAYLOAD);
    expect(token.split(".")).toHaveLength(3);
    expect(decodeProtectedHeader(token)).toEqual({ alg: "HS256", typ: "JWT" });

    const claims = decodeJwt(token);
    expect(claims.sub).toBe(USER_PAYLOAD.userId);
    expect(claims.iss).toBe(ISSUER);
    expect(claims.aud).toBe(AUDIENCE);
    expect(typeof claims.iat).toBe("number");
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(SESSION_MAX_AGE_SECONDS);
    expect(Object.keys(claims).sort()).toEqual(
      ["aud", "email", "exp", "iat", "iss", "name", "officeId", "role", "sub", "sv"].sort(),
    );
    expect(token).not.toContain(SECRET);
  });

  it("still verifies just before expiry", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-08T04:00:00.000Z"));
    const token = await signSessionToken(USER_PAYLOAD);
    vi.setSystemTime(new Date(Date.parse("2026-09-08T04:00:00.000Z") + (SESSION_MAX_AGE_SECONDS - 5) * 1000));
    await expect(verifySessionToken(token)).resolves.toEqual(USER_PAYLOAD);
  });
});

describe("verifySessionToken rejects invalid tokens with null", () => {
  it.each([null, undefined, "", "not-a-jwt", "a.b.c", "....", "eyJhbGciOiJIUzI1NiJ9.e30."])(
    "missing or malformed token %j",
    async (token) => {
      await expect(verifySessionToken(token)).resolves.toBeNull();
    },
  );

  it("a token whose payload was tampered with (role escalation)", async () => {
    const token = await signSessionToken(USER_PAYLOAD);
    const [header, , signature] = token.split(".");
    const escalated = { ...decodeJwt(token), role: "admin", officeId: null };
    const tampered = `${header}.${base64UrlJson(escalated)}.${signature}`;
    await expect(verifySessionToken(tampered)).resolves.toBeNull();
  });

  it("a token whose office was swapped", async () => {
    const token = await signSessionToken(USER_PAYLOAD);
    const [header, , signature] = token.split(".");
    const swapped = { ...decodeJwt(token), officeId: "64f1b0000000000000000b02" };
    await expect(verifySessionToken(`${header}.${base64UrlJson(swapped)}.${signature}`)).resolves.toBeNull();
  });

  it("a token whose signature was altered", async () => {
    const token = await signSessionToken(USER_PAYLOAD);
    const [header, payload, signature] = token.split(".");
    const index = 10;
    const replacement = signature[index] === "A" ? "B" : "A";
    const altered = `${signature.slice(0, index)}${replacement}${signature.slice(index + 1)}`;
    await expect(verifySessionToken(`${header}.${payload}.${altered}`)).resolves.toBeNull();
    await expect(verifySessionToken(`${header}.${payload}.`)).resolves.toBeNull();
  });

  it("an unsigned (alg: none) token", async () => {
    const token = await signSessionToken(USER_PAYLOAD);
    const payload = token.split(".")[1];
    const unsigned = `${base64UrlJson({ alg: "none", typ: "JWT" })}.${payload}.`;
    await expect(verifySessionToken(unsigned)).resolves.toBeNull();
  });

  it("a token signed with a different algorithm, even with the right secret", async () => {
    await expect(verifySessionToken(await craftToken({ alg: "HS512" }))).resolves.toBeNull();
    await expect(verifySessionToken(await craftToken({ alg: "HS384" }))).resolves.toBeNull();
    // Control: the crafted token is otherwise valid.
    await expect(verifySessionToken(await craftToken())).resolves.toEqual(USER_PAYLOAD);
  });

  it("a token signed with the wrong secret", async () => {
    await expect(verifySessionToken(await craftToken({ secret: OTHER_SECRET }))).resolves.toBeNull();
  });

  it("a token issued before AUTH_SECRET was rotated", async () => {
    const token = await signSessionToken(USER_PAYLOAD);
    useSecret(OTHER_SECRET);
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("an expired token", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-08T04:00:00.000Z"));
    const token = await signSessionToken(USER_PAYLOAD);
    vi.setSystemTime(new Date(Date.parse("2026-09-08T04:00:00.000Z") + (SESSION_MAX_AGE_SECONDS + 1) * 1000));
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("an explicitly expired crafted token", async () => {
    await expect(verifySessionToken(await craftToken({ expiresAt: nowSeconds() - 1 }))).resolves.toBeNull();
  });

  it("wrong issuer or audience", async () => {
    await expect(verifySessionToken(await craftToken({ issuer: "someone-else" }))).resolves.toBeNull();
    await expect(verifySessionToken(await craftToken({ issuer: null }))).resolves.toBeNull();
    await expect(verifySessionToken(await craftToken({ audience: "someone-else" }))).resolves.toBeNull();
    await expect(verifySessionToken(await craftToken({ audience: null }))).resolves.toBeNull();
  });

  it.each<[string, CraftOptions]>([
    ["missing subject", { subject: null }],
    ["subject that is not an ObjectId", { subject: "not-an-object-id" }],
    ["subject with an operator payload", { subject: '{"$ne":null}' }],
    ["unknown role", { claims: { name: "X", email: "x@example.com", role: "superadmin", officeId: null } }],
    ["missing role", { claims: { name: "X", email: "x@example.com", officeId: null } }],
    ["invalid officeId", { claims: { name: "X", email: "x@example.com", role: "user", officeId: "123" } }],
    ["officeId as an object", { claims: { name: "X", email: "x@example.com", role: "user", officeId: { $ne: null } } }],
    ["missing officeId", { claims: { name: "X", email: "x@example.com", role: "user" } }],
    ["missing name", { claims: { email: "x@example.com", role: "user", officeId: null } }],
    ["non-string email", { claims: { name: "X", email: 42, role: "user", officeId: null } }],
  ])("malformed claims: %s", async (_label, options) => {
    await expect(verifySessionToken(await craftToken(options))).resolves.toBeNull();
  });
});

describe("AUTH_SECRET configuration", () => {
  it("verify returns null (does not throw) when AUTH_SECRET is missing", async () => {
    const token = await signSessionToken(USER_PAYLOAD);
    useSecret("");
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("verify returns null when AUTH_SECRET is too short", async () => {
    const shortSecret = "short-secret";
    const token = await craftToken({ secret: shortSecret });
    useSecret(shortSecret);
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it("sign refuses to issue a token without a strong AUTH_SECRET", async () => {
    useSecret("");
    await expect(signSessionToken(USER_PAYLOAD)).rejects.toBeInstanceOf(ConfigurationError);
    useSecret("too-short");
    await expect(signSessionToken(USER_PAYLOAD)).rejects.toBeInstanceOf(ConfigurationError);
  });
});
