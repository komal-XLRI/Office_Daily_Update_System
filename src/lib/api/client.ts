import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import type { ApiErrorBody, ApiSuccessBody } from "@/types";

/** Browser-side helper for calling this app's JSON API routes. */

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.details = details;
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface ApiRequestOptions {
  method?: Method;
  /** Plain objects are sent as JSON; FormData is sent as multipart. */
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const hasBody = options.body !== undefined;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (hasBody ? "POST" : "GET"),
      headers: hasBody && !isFormData ? { "Content-Type": "application/json" } : undefined,
      body: !hasBody ? undefined : isFormData ? (options.body as FormData) : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiClientError(0, "NETWORK_ERROR", "Unable to reach the server. Check your connection and try again.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as ApiErrorBody | null)?.error;
    if (response.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
      window.location.replace(new URL("/login?expired=1", window.location.origin).toString());
    }
    throw new ApiClientError(
      response.status,
      error?.code ?? "INTERNAL_ERROR",
      error?.message ?? "Something went wrong. Please try again.",
      error?.fieldErrors,
      error?.details,
    );
  }

  return (payload as ApiSuccessBody<T>).data;
}

/** Copy server field errors onto a React Hook Form. Returns true if any were applied. */
export function applyFieldErrors<T extends FieldValues>(setError: UseFormSetError<T>, error: unknown): boolean {
  if (!(error instanceof ApiClientError) || !error.fieldErrors) return false;
  let applied = false;
  for (const [key, messages] of Object.entries(error.fieldErrors)) {
    if (key === "_form" || !messages[0]) continue;
    setError(key as Path<T>, { type: "server", message: messages[0] });
    applied = true;
  }
  return applied;
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiClientError) return error.message;
  return fallback;
}
