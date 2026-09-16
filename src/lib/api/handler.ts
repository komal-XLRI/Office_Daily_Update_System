import "server-only";

import mongoose from "mongoose";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";

import {
  AppError,
  ConfigurationError,
  ConflictError,
  DatabaseError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type FieldErrors,
} from "@/lib/errors";
import { searchParamsToObject } from "@/lib/utils/search-params";
import { OBJECT_ID_RE } from "@/lib/validation/common";

/**
 * Route Handler helpers. Every API route should look like:
 *
 *   export const GET = withApi(async (request) => {
 *     const user = await requireAuth();                    // 1-2. authenticate + load user
 *     const query = parseQuery(request, someQuerySchema);  // 5. validate input
 *     const result = await someService(user, query);       // 3-4, 6. role/office scope + DB (in service)
 *     return jsonOk(result);                               // 7. safe output
 *   });
 *
 * Success body: `{ data }`. Error body: `{ error: { code, message, fieldErrors?, details? } }`.
 */

export function jsonOk<T>(data: T, init: ResponseInit = {}): NextResponse {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json({ data }, { ...init, headers });
}

export function jsonError(error: AppError): NextResponse {
  const headers = new Headers({ "Cache-Control": "no-store" });
  const retryAfter = error.details?.retryAfterSeconds;
  if (typeof retryAfter === "number" && retryAfter > 0) {
    headers.set("Retry-After", String(Math.ceil(retryAfter)));
  }
  return NextResponse.json(
    {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        ...(error.details ? { details: error.details } : {}),
      },
    },
    { status: error.status, headers },
  );
}

export function zodFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join(".") : "_form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === 11000
  );
}

const MONGO_INFRA_ERRORS = new Set([
  "MongoServerSelectionError",
  "MongooseServerSelectionError",
  "MongoNetworkError",
  "MongoNetworkTimeoutError",
  "MongoTimeoutError",
  "MongoNotConnectedError",
]);

/** Map any thrown value to a user-safe AppError. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) return new ValidationError(undefined, zodFieldErrors(error));
  if (error instanceof mongoose.Error.ValidationError) {
    const fieldErrors: FieldErrors = {};
    for (const [path, detail] of Object.entries(error.errors)) fieldErrors[path] = [detail.message];
    return new ValidationError(undefined, fieldErrors);
  }
  if (error instanceof mongoose.Error.CastError) return new ValidationError("Invalid value supplied.");
  // Date utilities throw RangeError for malformed/out-of-range input — a client error, not a 500.
  if (error instanceof RangeError) return new ValidationError("Invalid value supplied.");
  if (isDuplicateKeyError(error)) return new ConflictError("A record with the same unique value already exists.");
  if (error instanceof Error && MONGO_INFRA_ERRORS.has(error.name)) return new DatabaseError(error);
  return new AppError("INTERNAL_ERROR", "Something went wrong. Please try again.", 500);
}

/** Log server-side failures without request bodies, secrets or OTPs. */
export function logServerError(scope: string, error: unknown): void {
  if (error instanceof ConfigurationError) {
    console.error(`[${scope}] Configuration error: ${error.internalMessage}`);
    return;
  }
  if (error instanceof Error) {
    console.error(
      `[${scope}] ${error.name}: ${error.message}`,
      process.env.NODE_ENV === "production" ? "" : (error.stack ?? ""),
    );
    return;
  }
  console.error(`[${scope}] Unknown error`);
}

export function handleApiError(error: unknown): NextResponse {
  const appError = toAppError(error);
  if (appError.status >= 500) logServerError("api", error);
  return jsonError(appError);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence in depth (the session cookie is also SameSite=Lax): browsers always send Origin on
 * cross-site unsafe requests, so reject unsafe methods whose Origin does not match the host.
 */
export function assertSameOrigin(request: NextRequest): void {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("Invalid request origin.");
  }
  if (!host || originHost !== host) throw new ForbiddenError("Invalid request origin.");
}

type RouteHandler<C> = (request: NextRequest, context: C) => Promise<Response>;

/** Wrap a Route Handler with origin checks and uniform, leak-free error responses. */
export function withApi<C>(handler: RouteHandler<C>): RouteHandler<C> {
  return async (request, context) => {
    try {
      assertSameOrigin(request);
      return await handler(request, context);
    } catch (error) {
      return handleApiError(error);
    }
  };
}

/** Parse and validate a JSON body. Requires Content-Type: application/json. */
export async function parseJsonBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.output<S>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ValidationError("Expected a JSON request body.");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  return schema.parse(body);
}

/** Parse and validate URL query parameters. */
export function parseQuery<S extends z.ZodType>(request: NextRequest, schema: S): z.output<S> {
  return schema.parse(searchParamsToObject(request.nextUrl.searchParams));
}

/** Read and validate the `[id]` route param. Invalid ObjectIds are treated as not found. */
export async function getRouteId(context: { params: Promise<{ id: string }> }, resource = "Record"): Promise<string> {
  const { id } = await context.params;
  if (!OBJECT_ID_RE.test(id)) throw new NotFoundError(resource);
  return id;
}
