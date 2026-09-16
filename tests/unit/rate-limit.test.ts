import { beforeEach, describe, expect, it } from "vitest";

import { checkIpRateLimit, checkRateLimit, describeWait, resetRateLimits } from "@/lib/auth/rate-limit";
import { getClientIp, UNKNOWN_CLIENT_IP } from "@/lib/auth/request-ip";
import { RateLimitError } from "@/lib/errors";

// Spec §10 "Rate limit OTP requests", §45.8, §55.4 (resend abuse). Per-instance in-memory limiter.

const T0 = 1_000_000_000_000;

function captureSync(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw");
}

function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost:3000/api/auth/request-otp", { method: "POST", headers });
}

beforeEach(() => {
  resetRateLimits();
});

describe("describeWait", () => {
  it.each([
    [0, "1 second"],
    [-5, "1 second"],
    [0.2, "1 second"],
    [1, "1 second"],
    [2, "2 seconds"],
    [45, "45 seconds"],
    [59, "59 seconds"],
    [59.5, "1 minute"],
    [60, "1 minute"],
    [61, "2 minutes"],
    [180, "3 minutes"],
    [3300, "55 minutes"],
  ])("%d seconds → %j", (seconds, expected) => {
    expect(describeWait(seconds)).toBe(expected);
  });
});

describe("checkRateLimit", () => {
  it("allows `limit` hits per window and reports what remains", () => {
    const options = { limit: 3, windowSeconds: 60, now: T0 };
    expect(checkRateLimit("k", options)).toEqual({ remaining: 2, resetInSeconds: 60 });
    expect(checkRateLimit("k", { ...options, now: T0 + 10_000 })).toEqual({ remaining: 1, resetInSeconds: 50 });
    expect(checkRateLimit("k", { ...options, now: T0 + 20_000 })).toEqual({ remaining: 0, resetInSeconds: 40 });
  });

  it("throws RateLimitError (429) with retryAfterSeconds once the limit is reached", () => {
    const options = { limit: 2, windowSeconds: 60, now: T0 };
    checkRateLimit("k", options);
    checkRateLimit("k", options);

    const error = captureSync(() => checkRateLimit("k", { ...options, now: T0 + 15_500 }));
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      details: { retryAfterSeconds: 45 },
      message: "Too many requests. Please try again in 45 seconds.",
    });
  });

  it("uses a custom message when given", () => {
    const options = { limit: 1, windowSeconds: 900, now: T0, message: "Slow down." };
    checkRateLimit("k", options);
    expect(() => checkRateLimit("k", options)).toThrow("Slow down.");
  });

  it("does not extend the window with rejected hits, and resets after the window", () => {
    const options = { limit: 1, windowSeconds: 60 };
    checkRateLimit("k", { ...options, now: T0 });
    for (const offset of [1_000, 30_000, 59_000, 59_999]) {
      expect(() => checkRateLimit("k", { ...options, now: T0 + offset })).toThrow(RateLimitError);
    }
    const last = captureSync(() => checkRateLimit("k", { ...options, now: T0 + 59_999 }));
    expect(last).toMatchObject({ details: { retryAfterSeconds: 1 } });

    expect(checkRateLimit("k", { ...options, now: T0 + 60_000 })).toEqual({ remaining: 0, resetInSeconds: 60 });
    expect(() => checkRateLimit("k", { ...options, now: T0 + 60_001 })).toThrow(RateLimitError);
  });

  it("keeps separate counters per key", () => {
    const options = { limit: 1, windowSeconds: 60, now: T0 };
    checkRateLimit("a", options);
    expect(() => checkRateLimit("a", options)).toThrow(RateLimitError);
    expect(() => checkRateLimit("b", options)).not.toThrow();
  });

  it("treats a non-positive window as one second", () => {
    const options = { limit: 1, windowSeconds: 0, now: T0 };
    checkRateLimit("k", options);
    expect(() => checkRateLimit("k", { ...options, now: T0 + 999 })).toThrow(RateLimitError);
    expect(() => checkRateLimit("k", { ...options, now: T0 + 1000 })).not.toThrow();
  });

  it("a zero limit rejects every hit", () => {
    expect(() => checkRateLimit("k", { limit: 0, windowSeconds: 60, now: T0 })).toThrow(RateLimitError);
  });

  it("resetRateLimits forgets every counter", () => {
    const options = { limit: 1, windowSeconds: 60, now: T0 };
    checkRateLimit("k", options);
    resetRateLimits();
    expect(() => checkRateLimit("k", options)).not.toThrow();
  });

  it("bounds memory: evicts the oldest live bucket once 10,000 keys are tracked", () => {
    const options = { limit: 1, windowSeconds: 3600, now: T0 };
    for (let i = 0; i < 10_000; i += 1) checkRateLimit(`key-${i}`, options);
    expect(() => checkRateLimit("key-0", options)).toThrow(RateLimitError);

    checkRateLimit("key-new", options); // evicts key-0 (oldest)
    expect(() => checkRateLimit("key-0", options)).not.toThrow(); // fresh bucket again (evicts key-1)
    expect(() => checkRateLimit("key-2", options)).toThrow(RateLimitError); // still tracked
  });

  it("sweeps expired buckets before evicting live ones", () => {
    checkRateLimit("long-lived", { limit: 1, windowSeconds: 3600, now: T0 });
    for (let i = 1; i < 10_000; i += 1) checkRateLimit(`short-${i}`, { limit: 1, windowSeconds: 60, now: T0 });

    const later = T0 + 61_000;
    checkRateLimit("another", { limit: 1, windowSeconds: 60, now: later });
    expect(() => checkRateLimit("long-lived", { limit: 1, windowSeconds: 3600, now: later })).toThrow(
      RateLimitError,
    );
  });
});

describe("checkIpRateLimit", () => {
  it("counts per client IP and per scope", () => {
    const options = { limit: 2, windowSeconds: 900, now: T0 };
    const ipA = requestWith({ "x-forwarded-for": "203.0.113.10" });
    const ipB = requestWith({ "x-forwarded-for": "203.0.113.11" });

    checkIpRateLimit(ipA, "auth:request-otp", options);
    checkIpRateLimit(ipA, "auth:request-otp", options);
    expect(() => checkIpRateLimit(ipA, "auth:request-otp", options)).toThrow(RateLimitError);

    expect(() => checkIpRateLimit(ipB, "auth:request-otp", options)).not.toThrow();
    expect(() => checkIpRateLimit(ipA, "auth:verify-otp", options)).not.toThrow();
  });

  it("identifies the client by the first x-forwarded-for entry", () => {
    const options = { limit: 1, windowSeconds: 900, now: T0 };
    checkIpRateLimit(requestWith({ "x-forwarded-for": "203.0.113.10, 10.0.0.1" }), "s", options);
    expect(() =>
      checkIpRateLimit(requestWith({ "x-forwarded-for": "203.0.113.10, 10.0.0.2" }), "s", options),
    ).toThrow(RateLimitError);
    expect(() => checkIpRateLimit(requestWith({ "x-real-ip": "203.0.113.10" }), "s", options)).toThrow(
      RateLimitError,
    );
  });

  it("gives requests without a usable IP a shared bucket with a 10x limit by default", () => {
    const options = { limit: 2, windowSeconds: 900, now: T0 };
    for (let i = 0; i < 20; i += 1) {
      expect(checkIpRateLimit(requestWith({}), "s", options).remaining).toBe(19 - i);
    }
    const error = captureSync(() => checkIpRateLimit(requestWith({ "x-forwarded-for": "garbage!" }), "s", options));
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error).toMatchObject({ details: { retryAfterSeconds: 900 } });
  });

  it("honours a custom unknown-IP multiplier", () => {
    const options = { limit: 2, windowSeconds: 900, now: T0, unknownIpMultiplier: 1 };
    checkIpRateLimit(requestWith({}), "s", options);
    checkIpRateLimit(requestWith({}), "s", options);
    expect(() => checkIpRateLimit(requestWith({}), "s", options)).toThrow(RateLimitError);
  });
});

describe("getClientIp", () => {
  it.each<[string, Record<string, string>, string]>([
    ["first forwarded entry", { "x-forwarded-for": "203.0.113.5, 10.0.0.1, 10.0.0.2" }, "203.0.113.5"],
    ["trimmed entry", { "x-forwarded-for": "   198.51.100.20   " }, "198.51.100.20"],
    ["IPv4 with port", { "x-forwarded-for": "203.0.113.5:8080" }, "203.0.113.5"],
    ["IPv6 lowercased", { "x-forwarded-for": "2001:DB8::1" }, "2001:db8::1"],
    ["bracketed IPv6 with port", { "x-forwarded-for": "[2001:DB8::2]:443" }, "2001:db8::2"],
    ["bracketed IPv6 without port", { "x-forwarded-for": "[::1]" }, "::1"],
    ["IPv4-mapped IPv6", { "x-forwarded-for": "::ffff:192.0.2.1" }, "::ffff:192.0.2.1"],
    ["x-real-ip when no forwarded header", { "x-real-ip": "192.0.2.44" }, "192.0.2.44"],
    ["forwarded wins over x-real-ip", { "x-forwarded-for": "192.0.2.1", "x-real-ip": "192.0.2.2" }, "192.0.2.1"],
    ["x-real-ip when forwarded is invalid", { "x-forwarded-for": "not an ip", "x-real-ip": "192.0.2.3" }, "192.0.2.3"],
    ["x-real-ip when first forwarded entry is empty", { "x-forwarded-for": ", 192.0.2.9", "x-real-ip": "192.0.2.4" }, "192.0.2.4"],
    ["unknown without headers", {}, UNKNOWN_CLIENT_IP],
    ["unknown for script injection", { "x-forwarded-for": "<script>alert(1)</script>" }, UNKNOWN_CLIENT_IP],
    ["unknown for a hostname", { "x-forwarded-for": "evil.example.com" }, UNKNOWN_CLIENT_IP],
    ["unknown for whitespace", { "x-forwarded-for": "   ", "x-real-ip": " " }, UNKNOWN_CLIENT_IP],
    ["unknown for an over-long value", { "x-forwarded-for": "1".repeat(46) }, UNKNOWN_CLIENT_IP],
    ["unknown for key-injection characters", { "x-real-ip": "1.2.3.4:ip:5.6.7.8" }, UNKNOWN_CLIENT_IP],
  ])("%s", (_label, headers, expected) => {
    expect(getClientIp(requestWith(headers))).toBe(expected);
  });
});
