import { RateLimitError } from "@/lib/errors";

import { getClientIp, UNKNOWN_CLIENT_IP } from "./request-ip";

/**
 * Small in-memory fixed-window rate limiter.
 *
 * This is per-instance defence in depth only: counters are not shared between server instances and
 * are lost on restart. The authoritative, persistent OTP limits (resend cooldown, sends per window,
 * verification attempts) are stored on `users.otp` and enforced by src/lib/auth/otp.ts.
 */

export interface RateLimitOptions {
  /** Maximum number of hits allowed per window. */
  limit: number;
  windowSeconds: number;
  /** User-facing message; defaults to a generic "try again in ..." message. */
  message?: string;
  /** Current time in ms (tests). */
  now?: number;
}

export interface RateLimitResult {
  remaining: number;
  resetInSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

const buckets = new Map<string, Bucket>();
let lastSweepAt = 0;

function sweepExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  lastSweepAt = now;
}

function makeRoom(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  sweepExpired(now);
  // Still full: evict the oldest buckets (Map preserves insertion order).
  for (const key of buckets.keys()) {
    if (buckets.size < MAX_BUCKETS) break;
    buckets.delete(key);
  }
}

/** Human-readable wait, e.g. "1 second", "45 seconds", "3 minutes". */
export function describeWait(seconds: number): string {
  const safe = Math.max(1, Math.ceil(seconds));
  if (safe < 60) return `${safe} second${safe === 1 ? "" : "s"}`;
  const minutes = Math.ceil(safe / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Count one hit for `key`. Throws RateLimitError (429, with retryAfterSeconds) once `limit` hits
 * have been made in the current window. Rejected hits do not extend the window.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = options.now ?? Date.now();
  const windowMs = Math.max(1, options.windowSeconds) * 1000;

  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) sweepExpired(now);

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (bucket) buckets.delete(key);
    makeRoom(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  const resetInSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  if (bucket.count >= options.limit) {
    throw new RateLimitError(
      options.message ?? `Too many requests. Please try again in ${describeWait(resetInSeconds)}.`,
      resetInSeconds,
    );
  }

  bucket.count += 1;
  return { remaining: options.limit - bucket.count, resetInSeconds };
}

/**
 * Per-client-IP limit for a named endpoint scope. Requests without a usable IP header share one
 * bucket whose limit is multiplied by `unknownIpMultiplier`, so a missing proxy header cannot lock
 * every user out. IP headers are only trustworthy behind a proxy that sets them.
 */
export function checkIpRateLimit(
  request: Request,
  scope: string,
  options: RateLimitOptions & { unknownIpMultiplier?: number },
): RateLimitResult {
  const ip = getClientIp(request);
  const { unknownIpMultiplier = 10, ...rest } = options;
  const limit = ip === UNKNOWN_CLIENT_IP ? rest.limit * unknownIpMultiplier : rest.limit;
  return checkRateLimit(`${scope}:ip:${ip}`, { ...rest, limit });
}

/** Test helper: forget all counters. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweepAt = 0;
}

/**
 * Positive integer limit from an optional env var, else `fallback`. Per-IP auth limits are kept high
 * because many staff can share one campus NAT address; per-email limits on users.otp are the primary control.
 */
export function envLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
