import "server-only";

import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

import type { Types } from "mongoose";

import { logServerError } from "@/lib/api/handler";
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
} from "@/lib/auth/constants";
import type { SessionPayload } from "@/lib/auth/session-token";
import { connectDB } from "@/lib/db/connect";
import { getAuthSecret, getMasterOtp } from "@/lib/env";
import {
  AppError,
  InvalidOtpError,
  InvalidUserError,
  OtpExpiredError,
  RateLimitError,
  ServiceUnavailableError,
  TooManyAttemptsError,
} from "@/lib/errors";
import { requestOtpSchema, verifyOtpSchema } from "@/lib/validation/auth";
import { Office } from "@/models/Office";
import { User, type IUserOtp } from "@/models/User";
import type { Role } from "@/types";

import { sendOtpEmail } from "./mailer";
import { describeWait } from "./rate-limit";

/**
 * OTP email authentication (spec §10). All policy is enforced here, server-side:
 * 6-digit random code, 5-minute expiry, single use, 5 verification attempts, 60 s resend cooldown and a
 * per-email send window. Only an HMAC of the code is stored (users.otp.codeHash). Codes and hashes are
 * never returned or logged. Independent of the Next.js request context so it can be tested directly.
 */

const SECOND_MS = 1000;

interface LeanOtpUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  officeId?: Types.ObjectId | null;
  isActive: boolean;
  sessionVersion?: number;
  otp?: Partial<IUserOtp> | null;
}

export interface RequestOtpResult {
  expiresInSeconds: number;
  resendAvailableInSeconds: number;
}

// ---------------------------------------------------------------------------------------------------
// Code generation and hashing
// ---------------------------------------------------------------------------------------------------

/** Cryptographically random, zero-padded 6-digit code. */
export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

/** Sub-key derived from AUTH_SECRET so OTP hashes are domain-separated from session signatures. */
function otpHmacKey(): Buffer {
  return createHmac("sha256", getAuthSecret()).update("odums:otp-hmac:v1").digest();
}

/** HMAC-SHA256 (hex) binding the code to the user and the moment it was issued. */
export function hashOtp(userId: string, issuedAt: Date, otp: string): string {
  return createHmac("sha256", otpHmacKey()).update(`${userId}:${issuedAt.getTime()}:${otp}`).digest("hex");
}

/** Constant-time comparison of a candidate code against a stored hash. */
export function otpMatchesHash(storedHash: string, userId: string, issuedAt: Date, otp: string): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashOtp(userId, issuedAt, otp), "hex");
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Constant-time check of a candidate against the configured master OTP (false when disabled). */
function matchesMasterOtp(otp: string): boolean {
  const master = getMasterOtp();
  if (!master) return false;
  const expected = Buffer.from(master);
  const actual = Buffer.from(otp);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------

async function findUserForOtp(email: string): Promise<LeanOtpUser> {
  await connectDB();
  const user = await User.findOne({ email })
    .select("name email role officeId isActive sessionVersion +otp")
    .lean<LeanOtpUser>();

  if (!user) throw new InvalidUserError("This email is not registered.", 404);
  if (!user.isActive) {
    throw new InvalidUserError("Your account is inactive. Please contact the administrator.", 403);
  }
  if (user.role === "user") {
    const office = user.officeId
      ? await Office.findById(user.officeId).select("isActive").lean<{ isActive: boolean }>()
      : null;
    if (!office || !office.isActive) {
      throw new InvalidUserError("Your office is inactive. Please contact the administrator.", 403);
    }
  }
  return user;
}

function toDate(value: unknown): Date | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
}

function cooldownRemainingSeconds(lastSentAt: Date | null, now: Date): number {
  if (!lastSentAt) return 0;
  const remainingMs = lastSentAt.getTime() + OTP_RESEND_COOLDOWN_SECONDS * SECOND_MS - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.min(OTP_RESEND_COOLDOWN_SECONDS, Math.ceil(remainingMs / SECOND_MS));
}

function cooldownError(seconds: number): RateLimitError {
  return new RateLimitError(`Please wait ${describeWait(seconds)} before requesting a new OTP.`, seconds);
}

/** Invalidate the current code, but only if it is still the one we evaluated. */
async function clearOtpCode(userId: Types.ObjectId, codeHash: string): Promise<void> {
  await User.updateOne(
    { _id: userId, "otp.codeHash": codeHash },
    { $set: { "otp.codeHash": null, "otp.expiresAt": null, "otp.attempts": 0 } },
  );
}

async function readOtpState(userId: Types.ObjectId): Promise<Partial<IUserOtp> | null> {
  const doc = await User.findById(userId).select("+otp").lean<{ otp?: Partial<IUserOtp> | null }>();
  return doc?.otp ?? null;
}

// ---------------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------------

/**
 * Issue and email a new OTP to a registered, active user. Returns timing information only, never the code.
 * Throws InvalidUserError (404/403), RateLimitError (cooldown / send window) or ServiceUnavailableError.
 */
export async function requestOtp(input: { email: string; now?: Date }): Promise<RequestOtpResult> {
  const { email } = requestOtpSchema.parse({ email: input.email });
  const now = input.now ?? new Date();
  const user = await findUserForOtp(email);

  const state = user.otp ?? {};
  const previousLastSentAt = toDate(state.lastSentAt);
  const previousWindowStartedAt = toDate(state.sendWindowStartedAt);
  const previousSendCount = typeof state.sendCount === "number" ? state.sendCount : 0;

  const cooldown = cooldownRemainingSeconds(previousLastSentAt, now);
  if (cooldown > 0) throw cooldownError(cooldown);

  const windowMs = OTP_SEND_WINDOW_SECONDS * SECOND_MS;
  const windowActive =
    previousWindowStartedAt !== null &&
    previousWindowStartedAt.getTime() <= now.getTime() &&
    now.getTime() - previousWindowStartedAt.getTime() < windowMs;
  const sendCountInWindow = windowActive ? previousSendCount : 0;

  if (windowActive && sendCountInWindow >= OTP_MAX_SENDS_PER_WINDOW) {
    const retryAfter = Math.max(
      1,
      Math.ceil((previousWindowStartedAt.getTime() + windowMs - now.getTime()) / SECOND_MS),
    );
    throw new RateLimitError(
      `Too many OTP requests for this email. Please try again in ${describeWait(retryAfter)}.`,
      retryAfter,
    );
  }

  const otp = generateOtp();
  const codeHash = hashOtp(String(user._id), now, otp);
  const cooldownThreshold = new Date(now.getTime() - OTP_RESEND_COOLDOWN_SECONDS * SECOND_MS);

  // Atomic claim: the filter re-checks the cooldown, so concurrent requests cannot both issue a code.
  const claimed = await User.updateOne(
    {
      _id: user._id,
      isActive: true,
      $or: [{ "otp.lastSentAt": null }, { "otp.lastSentAt": { $lte: cooldownThreshold } }],
    },
    {
      $set: {
        "otp.codeHash": codeHash,
        "otp.expiresAt": new Date(now.getTime() + OTP_TTL_SECONDS * SECOND_MS),
        "otp.attempts": 0,
        "otp.lastSentAt": now,
        "otp.sendWindowStartedAt": windowActive ? previousWindowStartedAt : now,
        "otp.sendCount": sendCountInWindow + 1,
      },
    },
  );

  if (claimed.matchedCount !== 1) {
    const latest = await readOtpState(user._id);
    throw cooldownError(
      cooldownRemainingSeconds(toDate(latest?.lastSentAt), now) || OTP_RESEND_COOLDOWN_SECONDS,
    );
  }

  try {
    await sendOtpEmail({ to: user.email, name: user.name, otp });
  } catch (error) {
    // Roll back so the user can retry immediately (only if our code is still the current one).
    try {
      await User.updateOne(
        { _id: user._id, "otp.codeHash": codeHash },
        {
          $set: {
            "otp.codeHash": null,
            "otp.expiresAt": null,
            "otp.attempts": 0,
            "otp.lastSentAt": previousLastSentAt,
            "otp.sendWindowStartedAt": previousWindowStartedAt,
            "otp.sendCount": previousSendCount,
          },
        },
      );
    } catch (rollbackError) {
      logServerError("auth:otp-rollback", rollbackError);
    }

    if (error instanceof AppError) throw error;
    logServerError("auth:otp-email", error);
    throw new ServiceUnavailableError("Could not send the OTP email. Please try again.");
  }

  return {
    expiresInSeconds: OTP_TTL_SECONDS,
    resendAvailableInSeconds: OTP_RESEND_COOLDOWN_SECONDS,
  };
}

// ---------------------------------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------------------------------

/**
 * Verify and consume an OTP. Returns the session payload for createSession().
 * Throws InvalidUserError, OtpExpiredError (none/expired/used), InvalidOtpError (with attempts remaining)
 * or TooManyAttemptsError.
 */
export async function verifyOtp(input: { email: string; otp: string; now?: Date }): Promise<SessionPayload> {
  const { email, otp } = verifyOtpSchema.parse({ email: input.email, otp: input.otp });
  const now = input.now ?? new Date();
  const user = await findUserForOtp(email);
  const userId = String(user._id);

  const state = user.otp ?? {};
  const storedHash = typeof state.codeHash === "string" && state.codeHash.length > 0 ? state.codeHash : null;
  const issuedAt = toDate(state.lastSentAt);
  const expiresAt = toDate(state.expiresAt);

  if (!storedHash || !issuedAt) {
    if (getMasterOtp()) return verifyMasterOnly(user, otp);
    throw new OtpExpiredError("No active OTP. Please request a new one.");
  }
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
    await clearOtpCode(user._id, storedHash);
    if (getMasterOtp()) return verifyMasterOnly(user, otp);
    throw new OtpExpiredError();
  }
  if ((state.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
    await clearOtpCode(user._id, storedHash);
    throw new TooManyAttemptsError();
  }

  // Reserve one attempt atomically before comparing, so parallel guesses cannot exceed the limit.
  const counted = await User.findOneAndUpdate(
    { _id: user._id, "otp.codeHash": storedHash, "otp.attempts": { $lt: OTP_MAX_ATTEMPTS } },
    { $inc: { "otp.attempts": 1 } },
    { returnDocument: "after" },
  )
    .select({ "otp.attempts": 1 })
    .lean<{ otp?: { attempts?: number } | null }>();

  if (!counted) {
    const latest = await readOtpState(user._id);
    if (latest?.codeHash === storedHash && (latest.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
      await clearOtpCode(user._id, storedHash);
      throw new TooManyAttemptsError();
    }
    throw new OtpExpiredError("This OTP is no longer valid. Please request a new one.");
  }

  const usedMaster = !otpMatchesHash(storedHash, userId, issuedAt, otp) && matchesMasterOtp(otp);
  if (!usedMaster && !otpMatchesHash(storedHash, userId, issuedAt, otp)) {
    const attempts = counted.otp?.attempts ?? OTP_MAX_ATTEMPTS;
    const remaining = OTP_MAX_ATTEMPTS - attempts;
    if (remaining <= 0) {
      await clearOtpCode(user._id, storedHash);
      throw new TooManyAttemptsError();
    }
    throw new InvalidOtpError(remaining);
  }

  // Consume atomically: only one concurrent verification of the same code can succeed.
  const consumed = await User.updateOne(
    { _id: user._id, "otp.codeHash": storedHash, "otp.expiresAt": { $gt: now } },
    { $set: { "otp.codeHash": null, "otp.expiresAt": null, "otp.attempts": 0 } },
  );
  if (consumed.modifiedCount !== 1) {
    throw new OtpExpiredError("This OTP has already been used. Please request a new one.");
  }
  if (usedMaster) logMasterOtpUse(userId);

  return {
    userId,
    name: user.name,
    email: user.email,
    role: user.role,
    officeId: user.officeId ? String(user.officeId) : null,
    sessionVersion: user.sessionVersion ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------
// Master OTP (optional, see getMasterOtp)
// ---------------------------------------------------------------------------------------------------

function logMasterOtpUse(userId: string): void {
  console.warn(`[auth] Master OTP used to sign in user ${userId}`);
}

function toSessionPayload(user: LeanOtpUser): SessionPayload {
  return {
    userId: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    officeId: user.officeId ? String(user.officeId) : null,
    sessionVersion: user.sessionVersion ?? 0,
  };
}

/**
 * Verify the master OTP when the user has no active emailed code. Guesses share users.otp.attempts, so the
 * normal 5-attempt limit applies; attempts reset when a new code is requested or on success.
 */
async function verifyMasterOnly(user: LeanOtpUser, otp: string): Promise<SessionPayload> {
  const counted = await User.findOneAndUpdate(
    { _id: user._id, "otp.attempts": { $not: { $gte: OTP_MAX_ATTEMPTS } } },
    { $inc: { "otp.attempts": 1 } },
    { returnDocument: "after" },
  )
    .select({ "otp.attempts": 1 })
    .lean<{ otp?: { attempts?: number } | null }>();
  if (!counted) throw new TooManyAttemptsError();

  if (!matchesMasterOtp(otp)) {
    const remaining = OTP_MAX_ATTEMPTS - (counted.otp?.attempts ?? OTP_MAX_ATTEMPTS);
    if (remaining <= 0) throw new TooManyAttemptsError();
    throw new InvalidOtpError(remaining);
  }

  await User.updateOne({ _id: user._id }, { $set: { "otp.attempts": 0 } });
  logMasterOtpUse(String(user._id));
  return toSessionPayload(user);
}
