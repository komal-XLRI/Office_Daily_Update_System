import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_WINDOW,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_SEND_WINDOW_SECONDS,
  OTP_TTL_SECONDS,
} from "@/lib/auth/constants";
import { setOtpMailerForTesting, type OtpEmailMessage, type OtpMailer } from "@/lib/auth/mailer";
import { generateOtp, hashOtp, otpMatchesHash, requestOtp, verifyOtp } from "@/lib/auth/otp";
import { resetServerEnvCache } from "@/lib/env";
import {
  AppError,
  InvalidOtpError,
  InvalidUserError,
  OtpExpiredError,
  RateLimitError,
  ServiceUnavailableError,
  TooManyAttemptsError,
} from "@/lib/errors";
import { Office } from "@/models/Office";
import { User, type IUserOtp } from "@/models/User";

import { createOffice, createUser, registerTestDatabase, type IdLike, toObjectId } from "../setup/db";

// Spec §10 (OTP authentication), §12 (session payload), §45.6-8, §50, §55 items 1-5, §56 Authentication.

registerTestDatabase();

const T0 = new Date("2026-09-08T04:30:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let sent: OtpEmailMessage[] = [];
const captureMailer: OtpMailer = async (message) => {
  sent.push(message);
};

beforeEach(() => {
  sent = [];
  setOtpMailerForTesting(captureMailer);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
  setOtpMailerForTesting(null);
});

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail");
}

async function readOtpState(userId: IdLike): Promise<Partial<IUserOtp> | undefined> {
  const doc = await User.findById(toObjectId(userId)).select("+otp").lean<{ otp?: Partial<IUserOtp> }>();
  return doc?.otp;
}

/** Request an OTP and return the code captured from the email. */
async function sendCode(email: string, now: Date = T0): Promise<string> {
  const before = sent.length;
  await requestOtp({ email, now });
  expect(sent).toHaveLength(before + 1);
  return sent[sent.length - 1].otp;
}

function wrongCodeFor(code: string): string {
  return code === "000000" ? "111111" : "000000";
}

function consoleSpies() {
  return (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
}

function loggedText(spies: ReturnType<typeof consoleSpies>): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : String(arg))).join(" "))
    .join("\n");
}

describe("request OTP (spec §56: registered active email → OTP sent)", () => {
  it("emails a 6-digit code to a registered active user and stores OTP state", async () => {
    const user = await createUser({ name: "User A", email: "user.a@example.com" });

    const result = await requestOtp({ email: "user.a@example.com", now: T0 });

    expect(result).toEqual({ expiresInSeconds: OTP_TTL_SECONDS, resendAvailableInSeconds: OTP_RESEND_COOLDOWN_SECONDS });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ to: "user.a@example.com", name: "User A", otp: expect.stringMatching(/^\d{6}$/) });

    const state = await readOtpState(user);
    expect(state).toMatchObject({
      codeHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: at(OTP_TTL_SECONDS),
      attempts: 0,
      lastSentAt: T0,
      sendWindowStartedAt: T0,
      sendCount: 1,
    });
  });

  it("matches the email case-insensitively and ignores surrounding whitespace", async () => {
    await createUser({ email: "ayushi@example.com" });
    await requestOtp({ email: "  AYUSHI@Example.COM ", now: T0 });
    expect(sent.map((message) => message.to)).toEqual(["ayushi@example.com"]);
  });

  it("uses the policy constants from spec §10", () => {
    expect(OTP_LENGTH).toBe(6);
    expect(OTP_TTL_SECONDS).toBe(300);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(OTP_MAX_SENDS_PER_WINDOW).toBe(5);
    expect(OTP_SEND_WINDOW_SECONDS).toBe(3600);
  });

  it("rejects an unregistered email with 404 and sends nothing", async () => {
    await createUser({ email: "someone.else@example.com" });

    const error = await capture(requestOtp({ email: "nobody@example.com", now: T0 }));

    expect(error).toBeInstanceOf(InvalidUserError);
    expect(error).toMatchObject({ status: 404, code: "INVALID_USER", message: "This email is not registered." });
    expect(sent).toHaveLength(0);
    expect(await User.countDocuments({ email: "nobody@example.com" })).toBe(0);
  });

  it("rejects a malformed email before touching the database", async () => {
    await expect(requestOtp({ email: "not-an-email", now: T0 })).rejects.toBeInstanceOf(ZodError);
    await expect(requestOtp({ email: { $ne: null } as unknown as string, now: T0 })).rejects.toBeInstanceOf(ZodError);
    expect(sent).toHaveLength(0);
  });

  it("rejects an inactive user with 403 and stores no OTP", async () => {
    const user = await createUser({ email: "inactive@example.com", isActive: false });

    const error = await capture(requestOtp({ email: "inactive@example.com", now: T0 }));

    expect(error).toBeInstanceOf(InvalidUserError);
    expect(error).toMatchObject({
      status: 403,
      code: "INVALID_USER",
      message: "Your account is inactive. Please contact the administrator.",
    });
    expect(sent).toHaveLength(0);
    expect(await readOtpState(user)).toBeUndefined();
  });

  it("rejects a normal user whose office is inactive", async () => {
    const office = await createOffice({ isActive: false });
    const user = await createUser({ email: "office.inactive@example.com", officeId: office });

    const error = await capture(requestOtp({ email: "office.inactive@example.com", now: T0 }));

    expect(error).toBeInstanceOf(InvalidUserError);
    expect(error).toMatchObject({
      status: 403,
      message: "Your office is inactive. Please contact the administrator.",
    });
    expect(sent).toHaveLength(0);
    expect(await readOtpState(user)).toBeUndefined();
  });

  it("rejects a normal user whose office no longer exists", async () => {
    const office = await createOffice();
    await createUser({ email: "office.deleted@example.com", officeId: office });
    await Office.deleteOne({ _id: office._id });

    await expect(requestOtp({ email: "office.deleted@example.com", now: T0 })).rejects.toMatchObject({
      status: 403,
      code: "INVALID_USER",
    });
    expect(sent).toHaveLength(0);
  });

  it("allows an admin without an office", async () => {
    await createUser({ email: "admin@example.com", role: "admin", officeId: null });
    await expect(requestOtp({ email: "admin@example.com", now: T0 })).resolves.toBeDefined();
    expect(sent).toHaveLength(1);
  });

  it("allows an admin whose optional office is inactive", async () => {
    const office = await createOffice({ isActive: false });
    await createUser({ email: "admin.office@example.com", role: "admin", officeId: office });
    await expect(requestOtp({ email: "admin.office@example.com", now: T0 })).resolves.toBeDefined();
    expect(sent).toHaveLength(1);
  });
});

describe("verify OTP (spec §56: correct / wrong / expired / used / too many attempts)", () => {
  it("returns the session payload for the correct code and consumes it", async () => {
    const office = await createOffice({ name: "Office A" });
    const user = await createUser({ name: "User A", email: "user.a@example.com", officeId: office });
    const code = await sendCode("user.a@example.com");

    const session = await verifyOtp({ email: "user.a@example.com", otp: code, now: at(30) });

    expect(session).toEqual({
      userId: String(user._id),
      name: "User A",
      email: "user.a@example.com",
      role: "user",
      officeId: String(office._id),
      sessionVersion: 0,
    });
    const state = await readOtpState(user);
    expect(state).toMatchObject({ codeHash: null, expiresAt: null, attempts: 0 });
  });

  it("returns an admin session with a null officeId", async () => {
    const admin = await createUser({ name: "Admin", email: "admin@example.com", role: "admin", officeId: null });
    const code = await sendCode("admin@example.com");

    await expect(verifyOtp({ email: "ADMIN@example.com", otp: ` ${code} `, now: at(1) })).resolves.toEqual({
      userId: String(admin._id),
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      officeId: null,
      sessionVersion: 0,
    });
  });

  it("rejects a wrong code with InvalidOtpError and the attempts remaining", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");

    const error = await capture(verifyOtp({ email: "user.a@example.com", otp: wrongCodeFor(code), now: at(5) }));

    expect(error).toBeInstanceOf(InvalidOtpError);
    expect(error).toMatchObject({
      status: 400,
      code: "INVALID_OTP",
      message: "Invalid OTP. 4 attempts remaining.",
      details: { attemptsRemaining: 4 },
    });
    expect(JSON.stringify({ message: (error as AppError).message, details: (error as AppError).details })).not.toContain(
      code,
    );
    expect((await readOtpState(user))?.attempts).toBe(1);

    // The real code still works after a wrong guess.
    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(10) })).resolves.toMatchObject({
      userId: String(user._id),
    });
  });

  it("does not count malformed codes as attempts", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    await sendCode("user.a@example.com");

    for (const otp of ["12345", "1234567", "12a456", "", "      "]) {
      await expect(verifyOtp({ email: "user.a@example.com", otp, now: at(5) })).rejects.toBeInstanceOf(ZodError);
    }
    expect((await readOtpState(user))?.attempts).toBe(0);
  });

  it("rejects verification when no OTP was requested", async () => {
    await createUser({ email: "user.a@example.com" });
    const error = await capture(verifyOtp({ email: "user.a@example.com", otp: "123456", now: T0 }));
    expect(error).toBeInstanceOf(OtpExpiredError);
    expect(error).toMatchObject({ code: "OTP_EXPIRED", message: "No active OTP. Please request a new one." });
  });

  it("rejects an unregistered email at verification", async () => {
    await expect(verifyOtp({ email: "nobody@example.com", otp: "123456", now: T0 })).rejects.toMatchObject({
      status: 404,
      code: "INVALID_USER",
    });
  });

  it("accepts the code just before the 5-minute expiry", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");
    await expect(
      verifyOtp({ email: "user.a@example.com", otp: code, now: at(OTP_TTL_SECONDS - 1) }),
    ).resolves.toBeDefined();
  });

  it("rejects an expired code (spec §55.1) and invalidates it", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");

    const error = await capture(verifyOtp({ email: "user.a@example.com", otp: code, now: at(OTP_TTL_SECONDS) }));
    expect(error).toBeInstanceOf(OtpExpiredError);
    expect(error).toMatchObject({ status: 400, code: "OTP_EXPIRED" });

    const state = await readOtpState(user);
    expect(state?.codeHash).toBeNull();
    // Even with a clock inside the original window, the invalidated code cannot be used any more.
    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(10) })).rejects.toBeInstanceOf(
      OtpExpiredError,
    );
  });

  it("rejects a used code (spec §55.2, single use)", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");

    await verifyOtp({ email: "user.a@example.com", otp: code, now: at(5) });
    const error = await capture(verifyOtp({ email: "user.a@example.com", otp: code, now: at(6) }));

    expect(error).toBeInstanceOf(OtpExpiredError);
    expect(error).toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("allows the correct code on the fifth attempt", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");
    const wrong = wrongCodeFor(code);

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      await expect(verifyOtp({ email: "user.a@example.com", otp: wrong, now: at(attempt) })).rejects.toBeInstanceOf(
        InvalidOtpError,
      );
    }
    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(10) })).resolves.toBeDefined();
  });

  it("locks the code after 5 wrong attempts; even the correct code is then refused (spec §55.3)", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");
    const wrong = wrongCodeFor(code);

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      const error = await capture(verifyOtp({ email: "user.a@example.com", otp: wrong, now: at(attempt) }));
      expect(error).toBeInstanceOf(InvalidOtpError);
      expect((error as InvalidOtpError).details).toEqual({ attemptsRemaining: OTP_MAX_ATTEMPTS - attempt });
    }

    const fifth = await capture(verifyOtp({ email: "user.a@example.com", otp: wrong, now: at(5) }));
    expect(fifth).toBeInstanceOf(TooManyAttemptsError);
    expect(fifth).toMatchObject({
      status: 429,
      code: "TOO_MANY_ATTEMPTS",
      message: "Too many incorrect attempts. Please request a new OTP.",
    });

    const correctAfterLockout = await capture(verifyOtp({ email: "user.a@example.com", otp: code, now: at(6) }));
    expect(correctAfterLockout).toBeInstanceOf(AppError);
    expect(["TOO_MANY_ATTEMPTS", "OTP_EXPIRED"]).toContain((correctAfterLockout as AppError).code);
    expect((await readOtpState(user))?.codeHash).toBeNull();
  });

  it("refuses the correct code when the stored attempt counter is already exhausted", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");
    await User.updateOne({ _id: user._id }, { $set: { "otp.attempts": OTP_MAX_ATTEMPTS } });

    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(5) })).rejects.toBeInstanceOf(
      TooManyAttemptsError,
    );
    expect((await readOtpState(user))?.codeHash).toBeNull();
  });

  it("a new code after a lockout (and cooldown) starts with fresh attempts", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const oldCode = await sendCode("user.a@example.com");
    for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS; attempt += 1) {
      await capture(verifyOtp({ email: "user.a@example.com", otp: wrongCodeFor(oldCode), now: at(attempt) }));
    }

    await expect(requestOtp({ email: "user.a@example.com", now: at(10) })).rejects.toBeInstanceOf(RateLimitError);

    const newCode = await sendCode("user.a@example.com", at(OTP_RESEND_COOLDOWN_SECONDS));
    expect((await readOtpState(user))?.attempts).toBe(0);
    await expect(
      verifyOtp({ email: "user.a@example.com", otp: newCode, now: at(OTP_RESEND_COOLDOWN_SECONDS + 5) }),
    ).resolves.toMatchObject({ userId: String(user._id) });
  });

  it("rejects the code when the user was deactivated after it was sent (spec §55.5)", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");
    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });

    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(5) })).rejects.toMatchObject({
      status: 403,
      code: "INVALID_USER",
    });
  });

  it("rejects the code when the user's office was deactivated after it was sent", async () => {
    const office = await createOffice();
    await createUser({ email: "user.a@example.com", officeId: office });
    const code = await sendCode("user.a@example.com");
    await Office.updateOne({ _id: office._id }, { $set: { isActive: false } });

    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(5) })).rejects.toMatchObject({
      status: 403,
      message: "Your office is inactive. Please contact the administrator.",
    });
  });

  it("rejects the code when the user was deleted after it was sent", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");
    await User.deleteOne({ _id: user._id });

    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(5) })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("builds the session from the database at verification time (role/office changes apply)", async () => {
    const officeA = await createOffice();
    const officeB = await createOffice();
    const user = await createUser({ email: "user.a@example.com", officeId: officeA });
    const code = await sendCode("user.a@example.com");
    await User.updateOne({ _id: user._id }, { $set: { officeId: officeB._id, name: "Renamed" } });

    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(5) })).resolves.toEqual({
      userId: String(user._id),
      name: "Renamed",
      email: "user.a@example.com",
      role: "user",
      officeId: String(officeB._id),
      sessionVersion: 0,
    });
  });
});

describe("resend cooldown and send window (spec §10, §55.4, §56: resend during cooldown → rejected)", () => {
  it("rejects a resend during the 60 s cooldown with retryAfterSeconds and sends nothing", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");

    const error = await capture(requestOtp({ email: "user.a@example.com", now: at(10) }));
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      message: "Please wait 50 seconds before requesting a new OTP.",
      details: { retryAfterSeconds: 50 },
    });

    const almost = await capture(requestOtp({ email: "user.a@example.com", now: new Date(at(59).getTime() + 500) }));
    expect(almost).toMatchObject({ details: { retryAfterSeconds: 1 }, message: "Please wait 1 second before requesting a new OTP." });

    expect(sent).toHaveLength(1);
    expect(await readOtpState(user)).toMatchObject({ lastSentAt: T0, sendCount: 1 });

    // The rejected resend did not disturb the active code.
    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(20) })).resolves.toBeDefined();
  });

  it("allows a resend once the cooldown has elapsed; the new code replaces the old one", async () => {
    await createUser({ email: "user.a@example.com" });
    const oldCode = await sendCode("user.a@example.com");
    const newCode = await sendCode("user.a@example.com", at(OTP_RESEND_COOLDOWN_SECONDS));

    if (oldCode !== newCode) {
      await expect(
        verifyOtp({ email: "user.a@example.com", otp: oldCode, now: at(70) }),
      ).rejects.toBeInstanceOf(InvalidOtpError);
    }
    await expect(verifyOtp({ email: "user.a@example.com", otp: newCode, now: at(71) })).resolves.toBeDefined();
  });

  it("the new code gets its own 5-minute expiry", async () => {
    await createUser({ email: "user.a@example.com" });
    await sendCode("user.a@example.com");
    const newCode = await sendCode("user.a@example.com", at(240));

    // 6 minutes after the first code, but only 2 minutes after the second.
    await expect(verifyOtp({ email: "user.a@example.com", otp: newCode, now: at(360) })).resolves.toBeDefined();
  });

  it("limits sends per email to 5 per hour", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW; i += 1) {
      await sendCode("user.a@example.com", at(i * OTP_RESEND_COOLDOWN_SECONDS));
    }
    expect(await readOtpState(user)).toMatchObject({ sendCount: 5, sendWindowStartedAt: T0 });

    const sixth = await capture(requestOtp({ email: "user.a@example.com", now: at(300) }));
    expect(sixth).toBeInstanceOf(RateLimitError);
    expect(sixth).toMatchObject({
      status: 429,
      message: "Too many OTP requests for this email. Please try again in 55 minutes.",
      details: { retryAfterSeconds: 3300 },
    });

    const lastSecond = await capture(requestOtp({ email: "user.a@example.com", now: at(OTP_SEND_WINDOW_SECONDS - 1) }));
    expect(lastSecond).toMatchObject({ details: { retryAfterSeconds: 1 } });
    expect(sent).toHaveLength(5);
    expect(await readOtpState(user)).toMatchObject({ sendCount: 5 });

    await sendCode("user.a@example.com", at(OTP_SEND_WINDOW_SECONDS));
    expect(await readOtpState(user)).toMatchObject({
      sendCount: 1,
      sendWindowStartedAt: at(OTP_SEND_WINDOW_SECONDS),
      lastSentAt: at(OTP_SEND_WINDOW_SECONDS),
    });
  });

  it("keeps the window count when the window has not elapsed", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    await sendCode("user.a@example.com", T0);
    await sendCode("user.a@example.com", at(1800));
    expect(await readOtpState(user)).toMatchObject({ sendCount: 2, sendWindowStartedAt: T0 });
  });
});

describe("mailer failure", () => {
  it("rolls back a failed first send so the user can retry immediately, without leaking or logging the code", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const spies = consoleSpies();
    const failedCodes: string[] = [];
    setOtpMailerForTesting(async (message) => {
      failedCodes.push(message.otp);
      throw new Error("SMTP connection refused (password=smtp-secret)");
    });

    const error = await capture(requestOtp({ email: "user.a@example.com", now: T0 }));

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Could not send the OTP email. Please try again.",
    });
    expect((error as Error).message).not.toContain("smtp-secret");
    expect(failedCodes).toHaveLength(1);
    expect(loggedText(spies)).not.toContain(failedCodes[0]);

    expect(await readOtpState(user)).toMatchObject({
      codeHash: null,
      expiresAt: null,
      attempts: 0,
      lastSentAt: null,
      sendWindowStartedAt: null,
      sendCount: 0,
    });
    // The undelivered code is not usable.
    await expect(
      verifyOtp({ email: "user.a@example.com", otp: failedCodes[0], now: at(1) }),
    ).rejects.toBeInstanceOf(OtpExpiredError);

    setOtpMailerForTesting(captureMailer);
    const code = await sendCode("user.a@example.com", T0);
    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(2) })).resolves.toBeDefined();
  });

  it("restores the previous cooldown and window counters after a failed resend", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    await sendCode("user.a@example.com", T0);

    vi.spyOn(console, "error").mockImplementation(() => {});
    setOtpMailerForTesting(async () => {
      throw new Error("timeout");
    });
    await expect(requestOtp({ email: "user.a@example.com", now: at(61) })).rejects.toBeInstanceOf(
      ServiceUnavailableError,
    );
    expect(await readOtpState(user)).toMatchObject({
      codeHash: null,
      lastSentAt: T0,
      sendWindowStartedAt: T0,
      sendCount: 1,
    });

    setOtpMailerForTesting(captureMailer);
    await sendCode("user.a@example.com", at(61));
    expect(await readOtpState(user)).toMatchObject({ sendCount: 2, lastSentAt: at(61) });
  });

  it("failed sends do not consume the hourly quota", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    setOtpMailerForTesting(async () => {
      throw new Error("down");
    });
    for (let i = 0; i < OTP_MAX_SENDS_PER_WINDOW + 2; i += 1) {
      await expect(requestOtp({ email: "user.a@example.com", now: at(i) })).rejects.toBeInstanceOf(
        ServiceUnavailableError,
      );
    }
    setOtpMailerForTesting(captureMailer);
    await sendCode("user.a@example.com", at(10));
    expect(await readOtpState(user)).toMatchObject({ sendCount: 1 });
  });

  it("rethrows AppErrors from the mailer unchanged and still rolls back", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const mailerError = new ServiceUnavailableError("Email service is not configured. Please contact the administrator.");
    setOtpMailerForTesting(async () => {
      throw mailerError;
    });

    await expect(requestOtp({ email: "user.a@example.com", now: T0 })).rejects.toBe(mailerError);
    expect(await readOtpState(user)).toMatchObject({ codeHash: null, lastSentAt: null, sendCount: 0 });
  });
});

describe("OTP secrecy (spec §10, §45.6-7)", () => {
  it("generates random, zero-padded 6-digit codes", () => {
    const codes = Array.from({ length: 2000 }, () => generateOtp());
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(1900);
    expect(codes.some((code) => code.startsWith("0"))).toBe(true);
    expect(new Set(codes.map((code) => code[0])).size).toBe(10);
  });

  it("stores only an HMAC bound to the user and issue time, never the code", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");

    const state = await readOtpState(user);
    const codeHash = state?.codeHash ?? "";
    expect(codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(codeHash).not.toBe(code);
    expect(codeHash).not.toContain(code);
    expect(codeHash).toBe(hashOtp(String(user._id), T0, code));

    expect(otpMatchesHash(codeHash, String(user._id), T0, code)).toBe(true);
    expect(otpMatchesHash(codeHash, String(user._id), T0, wrongCodeFor(code))).toBe(false);
    expect(otpMatchesHash(codeHash, String(user._id), at(1), code)).toBe(false);
    expect(otpMatchesHash(codeHash, "64f1a0000000000000000c99", T0, code)).toBe(false);
    expect(otpMatchesHash("", String(user._id), T0, code)).toBe(false);
    expect(otpMatchesHash("abcd", String(user._id), T0, code)).toBe(false);

    const raw = await User.collection.findOne({ _id: user._id });
    expect(JSON.stringify(raw)).not.toContain(code);
    expect(Object.keys(raw?.otp ?? {}).sort()).toEqual(
      ["attempts", "codeHash", "expiresAt", "lastSentAt", "sendCount", "sendWindowStartedAt"].sort(),
    );
  });

  it("derives the hash from AUTH_SECRET (a different secret gives a different hash)", () => {
    const hash = hashOtp("64f1a0000000000000000c01", T0, "123456");
    vi.stubEnv("AUTH_SECRET", "another-secret-for-hmac-domain-0123456789-xyz");
    resetServerEnvCache();
    expect(hashOtp("64f1a0000000000000000c01", T0, "123456")).not.toBe(hash);
  });

  it("hides the otp sub-document from default queries and serialization", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    await sendCode("user.a@example.com");

    const lean = await User.findById(user._id).lean();
    expect(lean).not.toHaveProperty("otp");
    const byEmail = await User.findOne({ email: "user.a@example.com" }).lean();
    expect(byEmail).not.toHaveProperty("otp");
    const all = await User.find().lean();
    expect(all.every((doc) => !("otp" in doc))).toBe(true);

    const hydrated = await User.findById(user._id);
    expect(hydrated?.otp).toBeUndefined();

    const selected = await User.findById(user._id).select("+otp");
    expect(selected?.otp?.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(selected?.toJSON()).not.toHaveProperty("otp");
    expect(selected?.toObject()).not.toHaveProperty("otp");
    expect(JSON.stringify(selected)).not.toContain("codeHash");
  });

  it("never returns the code from requestOtp", async () => {
    await createUser({ email: "user.a@example.com" });
    const result = await requestOtp({ email: "user.a@example.com", now: T0 });
    const code = sent[0].otp;

    expect(Object.keys(result).sort()).toEqual(["expiresInSeconds", "resendAvailableInSeconds"]);
    expect(JSON.stringify(result)).not.toContain(code);
    expect(Object.values(result)).not.toContain(code);
  });

  it("never returns the code or hash from verifyOtp", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");
    const hash = (await readOtpState(user))?.codeHash ?? "";

    const session = await verifyOtp({ email: "user.a@example.com", otp: code, now: at(1) });
    const serialized = JSON.stringify(session);
    expect(Object.keys(session).sort()).toEqual(["email", "name", "officeId", "role", "sessionVersion", "userId"]);
    expect(serialized).not.toContain(hash);
    expect(serialized).not.toContain(`"${code}"`);
  });
});

describe("concurrency", () => {
  it("concurrent verification of the correct code succeeds exactly once", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");

    const results = await Promise.allSettled(
      Array.from({ length: OTP_MAX_ATTEMPTS }, () => verifyOtp({ email: "user.a@example.com", otp: code, now: at(5) })),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(OTP_MAX_ATTEMPTS - 1);
    for (const result of rejected) expect(result.reason).toBeInstanceOf(OtpExpiredError);
    expect((await readOtpState(user))?.codeHash).toBeNull();
  });

  it("never yields more than one session under heavy parallel verification", async () => {
    await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => verifyOtp({ email: "user.a@example.com", otp: code, now: at(5) })),
    );

    expect(results.filter((result) => result.status === "fulfilled").length).toBeLessThanOrEqual(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(AppError);
    }
  });

  it("parallel wrong guesses cannot exceed the attempt limit", async () => {
    const user = await createUser({ email: "user.a@example.com" });
    const code = await sendCode("user.a@example.com");
    const wrong = wrongCodeFor(code);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => verifyOtp({ email: "user.a@example.com", otp: wrong, now: at(5) })),
    );

    const reasons = results.map((result) => (result.status === "rejected" ? result.reason : null));
    expect(reasons.every((reason) => reason instanceof AppError)).toBe(true);
    const invalidOtp = reasons.filter((reason) => reason instanceof InvalidOtpError);
    expect(invalidOtp.length).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS - 1);
    expect(reasons.some((reason) => reason instanceof TooManyAttemptsError)).toBe(true);

    expect((await readOtpState(user))?.attempts ?? 0).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    await expect(verifyOtp({ email: "user.a@example.com", otp: code, now: at(6) })).rejects.toBeInstanceOf(AppError);
  });

  it("concurrent OTP requests send exactly one email", async () => {
    const user = await createUser({ email: "user.a@example.com" });

    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => requestOtp({ email: "user.a@example.com", now: T0 })),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toBeInstanceOf(RateLimitError);
    }
    expect(sent).toHaveLength(1);
    expect(await readOtpState(user)).toMatchObject({ sendCount: 1, lastSentAt: T0 });
    await expect(verifyOtp({ email: "user.a@example.com", otp: sent[0].otp, now: at(1) })).resolves.toBeDefined();
  });
});

describe("mailer delivery modes", () => {
  it("development without SMTP prints the code once to the server console, and that code works", async () => {
    await createUser({ email: "dev.user@example.com" });
    setOtpMailerForTesting(null);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SMTP_HOST", "");
    resetServerEnvCache();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await requestOtp({ email: "dev.user@example.com", now: T0 });

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain("[DEV ONLY - SMTP not configured]");
    expect(line).toContain("dev.user@example.com");
    const code = /(\d{6})$/.exec(line)?.[1];
    expect(code).toBeDefined();
    await expect(verifyOtp({ email: "dev.user@example.com", otp: code ?? "", now: at(1) })).resolves.toBeDefined();
  });

  it("production without SMTP fails safely, logs no code and rolls back", async () => {
    const user = await createUser({ email: "prod.user@example.com" });
    setOtpMailerForTesting(null);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "");
    resetServerEnvCache();
    const spies = consoleSpies();

    const error = await capture(requestOtp({ email: "prod.user@example.com", now: T0 }));

    expect(error).toBeInstanceOf(ServiceUnavailableError);
    expect(error).toMatchObject({ message: "Email service is not configured. Please contact the administrator." });
    expect(loggedText(spies)).not.toMatch(/\b\d{6}\b/);
    expect(await readOtpState(user)).toMatchObject({ codeHash: null, lastSentAt: null, sendCount: 0 });
  });

  it("refuses to install a test mailer in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => setOtpMailerForTesting(captureMailer)).toThrow(/not available in production/);
    vi.unstubAllEnvs();
  });
});
