import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OTP_MAX_ATTEMPTS } from "@/lib/auth/constants";
import { setOtpMailerForTesting, type OtpEmailMessage } from "@/lib/auth/mailer";
import { requestOtp, verifyOtp } from "@/lib/auth/otp";
import { getMasterOtp, resetServerEnvCache } from "@/lib/env";
import { InvalidOtpError, InvalidUserError, OtpExpiredError, TooManyAttemptsError } from "@/lib/errors";

import { createUser, registerTestDatabase } from "../setup/db";

registerTestDatabase();

const MASTER = "482913";
const T0 = new Date("2026-09-08T04:30:00.000Z");

let sent: OtpEmailMessage[] = [];

beforeEach(() => {
  sent = [];
  setOtpMailerForTesting(async (message) => {
    sent.push(message);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEnvCache();
  setOtpMailerForTesting(null);
  vi.restoreAllMocks();
});

function enableMaster(value = MASTER) {
  vi.stubEnv("MASTER_OTP", value);
  resetServerEnvCache();
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the operation to fail");
}

describe("master OTP", () => {
  it("is disabled unless MASTER_OTP is configured", async () => {
    await createUser({ email: "admin@example.com", role: "admin", officeId: null });
    expect(getMasterOtp()).toBeNull();
    expect(await capture(verifyOtp({ email: "admin@example.com", otp: MASTER, now: T0 }))).toBeInstanceOf(
      OtpExpiredError,
    );
  });

  it("ignores values that are not exactly 6 digits", () => {
    enableMaster("12345");
    expect(getMasterOtp()).toBeNull();
    enableMaster("12345a");
    expect(getMasterOtp()).toBeNull();
  });

  it("signs in a registered active user without an emailed code and logs without the code", async () => {
    enableMaster();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const user = await createUser({ email: "staff@example.com" });

    const payload = await verifyOtp({ email: "staff@example.com", otp: MASTER, now: T0 });

    expect(payload.userId).toBe(String(user._id));
    expect(sent).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(call.join(" ")).not.toContain(MASTER);
  });

  it("works while an emailed code is active and consumes that code", async () => {
    // Once consumed, the emailed code is just a wrong guess (the master-only path answers INVALID_OTP).
    enableMaster();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await createUser({ email: "staff@example.com" });
    await requestOtp({ email: "staff@example.com", now: T0 });
    const emailed = sent[0].otp;

    await verifyOtp({ email: "staff@example.com", otp: MASTER, now: new Date(T0.getTime() + 10_000) });

    expect(
      await capture(
        verifyOtp({ email: "staff@example.com", otp: emailed, now: new Date(T0.getTime() + 20_000) }),
      ),
    ).toBeInstanceOf(InvalidOtpError);
  });

  it("still accepts the emailed code when a master OTP is configured", async () => {
    enableMaster();
    await createUser({ email: "staff@example.com" });
    await requestOtp({ email: "staff@example.com", now: T0 });
    const payload = await verifyOtp({ email: "staff@example.com", otp: sent[0].otp, now: T0 });
    expect(payload.email).toBe("staff@example.com");
  });

  it("counts wrong guesses toward the attempt limit", async () => {
    enableMaster();
    await createUser({ email: "staff@example.com" });
    const wrong = "000000";

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      expect(await capture(verifyOtp({ email: "staff@example.com", otp: wrong, now: T0 }))).toBeInstanceOf(
        InvalidOtpError,
      );
    }
    expect(await capture(verifyOtp({ email: "staff@example.com", otp: wrong, now: T0 }))).toBeInstanceOf(
      TooManyAttemptsError,
    );
    expect(await capture(verifyOtp({ email: "staff@example.com", otp: MASTER, now: T0 }))).toBeInstanceOf(
      TooManyAttemptsError,
    );
  });

  it("rejects inactive users", async () => {
    enableMaster();
    await createUser({ email: "inactive@example.com", isActive: false });
    expect(await capture(verifyOtp({ email: "inactive@example.com", otp: MASTER, now: T0 }))).toBeInstanceOf(
      InvalidUserError,
    );
  });

  it("is disabled in production unless explicitly allowed", () => {
    enableMaster();
    vi.stubEnv("NODE_ENV", "production");
    resetServerEnvCache();
    expect(getMasterOtp()).toBeNull();

    vi.stubEnv("MASTER_OTP_ALLOW_IN_PRODUCTION", "true");
    resetServerEnvCache();
    expect(getMasterOtp()).toBe(MASTER);
  });
});
