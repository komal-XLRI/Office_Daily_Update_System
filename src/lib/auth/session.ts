import "server-only";

import { cookies } from "next/headers";

import { isProduction } from "@/lib/env";

import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session-token";

export { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS, type SessionPayload };

/** Set the session cookie. Call only from Route Handlers / Server Functions. */
export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await signSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
    priority: "high",
  });
}

/** Verified token claims, or null. Use getCurrentUser() for authorization decisions. */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  return verifySessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

/** Clear the session cookie. Call only from Route Handlers / Server Functions. */
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
