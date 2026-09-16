import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

import { ROLES } from "@/lib/constants";
import { getAuthSecretKey } from "@/lib/env";
import type { Role } from "@/types";

/**
 * Stateless signed session token (HS256 JWT in an httpOnly cookie). Kept free of `next/headers`
 * so it can be used by src/proxy.ts. Authorization never relies on these claims alone:
 * getCurrentUser() reloads the user from MongoDB on every request.
 */

export const SESSION_COOKIE_NAME = "odums_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

const ISSUER = "office-daily-update-system";
const AUDIENCE = "office-daily-update-system:web";

export interface SessionPayload {
  userId: string;
  name: string;
  email: string;
  role: Role;
  officeId: string | null;
  /** users.sessionVersion at sign-in; missing claims are treated as 0. */
  sessionVersion?: number;
}

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const claimsSchema = z.object({
  sub: objectId,
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  officeId: objectId.nullable(),
  sv: z.number().int().min(0).optional(),
});

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    name: payload.name,
    email: payload.email,
    role: payload.role,
    officeId: payload.officeId,
    sv: payload.sessionVersion ?? 0,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(payload.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getAuthSecretKey());
}

/** Returns null for missing, expired, tampered or malformed tokens (and when AUTH_SECRET is unset). */
export async function verifySessionToken(token: string | null | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getAuthSecretKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ["HS256"],
    });
    const claims = claimsSchema.safeParse(payload);
    if (!claims.success) return null;
    return {
      userId: claims.data.sub,
      name: claims.data.name,
      email: claims.data.email,
      role: claims.data.role,
      officeId: claims.data.officeId,
      sessionVersion: claims.data.sv ?? 0,
    };
  } catch {
    return null;
  }
}
