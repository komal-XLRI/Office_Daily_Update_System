import { assert } from "./harness";
import type { HttpResponse } from "./http";

/** Assertion helpers for the app's API envelope: `{ data }` / `{ error: { code, message, fieldErrors?, details? } }`. */

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  details?: Record<string, unknown>;
}

export function expectStatus(response: HttpResponse, expected: number | number[], context = ""): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert(
    allowed.includes(response.status),
    `${context ? `${context}: ` : ""}expected HTTP ${allowed.join(" or ")} but got ${response.describe()}`,
  );
}

export function apiData<T>(response: HttpResponse, status: number | number[] = [200, 201]): T {
  expectStatus(response, status);
  const body = response.json<{ data?: T }>();
  assert(body.data !== undefined, `response has no "data": ${response.describe()}`);
  return body.data;
}

export function expectApiError(response: HttpResponse, status: number, code?: string): ApiErrorBody {
  expectStatus(response, status);
  const body = response.json<{ error?: ApiErrorBody }>();
  assert(
    body.error && typeof body.error.code === "string" && typeof body.error.message === "string",
    `expected an { error: { code, message } } body: ${response.describe()}`,
  );
  if (code) {
    assert(body.error.code === code, `expected error code ${code} but got ${body.error.code}: ${response.describe()}`);
  }
  return body.error;
}

/** Search-param string for API/page URLs. */
export function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

export function sameMembers(actual: Iterable<string>, expected: Iterable<string>): boolean {
  const a = [...new Set(actual)].sort();
  const b = [...new Set(expected)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
