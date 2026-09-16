import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z, ZodError } from "zod";

import {
  assertSameOrigin,
  getRouteId,
  handleApiError,
  jsonError,
  jsonOk,
  parseJsonBody,
  toAppError,
  withApi,
} from "@/lib/api/handler";
import {
  AppError,
  ConfigurationError,
  ConflictError,
  DatabaseError,
  ForbiddenError,
  InvalidOtpError,
  NotFoundError,
  RateLimitError,
  TooManyAttemptsError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";
import { requestOtpSchema } from "@/lib/validation/auth";
import { User } from "@/models/User";

// Spec §29 (error handling), §37 (API rules), §45.2/§45.12 (validate inputs, no stack-trace leakage), §55.16.

const GENERIC_MESSAGE = "Something went wrong. Please try again.";
const BASE_URL = "http://localhost:3000/api/test";

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

function captureSync(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the call to throw");
}

async function captureAsync(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the promise to reject");
}

function makeRequest(
  method: string,
  headers: Record<string, string> = {},
  body?: string,
  url: string = BASE_URL,
): NextRequest {
  return new NextRequest(url, { method, headers, body });
}

describe("toAppError", () => {
  it("returns AppErrors unchanged", () => {
    const original = new ForbiddenError();
    expect(toAppError(original)).toBe(original);
    const rateLimited = new RateLimitError("Wait.", 30);
    expect(toAppError(rateLimited)).toBe(rateLimited);
  });

  it("maps a ZodError to 400 INVALID_INPUT with field errors keyed by path", () => {
    const schema = z.object({
      email: z.email("Enter a valid email address"),
      profile: z.object({ name: z.string().min(1, "Name is required") }),
      tags: z.array(z.string().min(2, "Tag too short")),
    });
    const result = schema.safeParse({ email: "nope", profile: { name: "" }, tags: ["ok", "x"] });
    expect(result.success).toBe(false);

    const appError = toAppError(result.error);
    expect(appError).toBeInstanceOf(ValidationError);
    expect(appError.status).toBe(400);
    expect(appError.code).toBe("INVALID_INPUT");
    expect(appError.message).toBe("Please correct the highlighted fields.");
    expect(appError.fieldErrors).toEqual({
      email: ["Enter a valid email address"],
      "profile.name": ["Name is required"],
      "tags.1": ["Tag too short"],
    });
  });

  it("collects several messages for one field and uses _form for root issues", () => {
    const multi = z
      .string()
      .min(5, "Too short")
      .regex(/^\d+$/, "Digits only")
      .safeParse("ab");
    expect(toAppError(multi.error).fieldErrors).toEqual({ _form: ["Too short", "Digits only"] });

    const otp = requestOtpSchema.safeParse({ email: "" });
    expect(toAppError(otp.error).fieldErrors?.email?.length).toBeGreaterThan(0);
  });

  it("maps a mongoose ValidationError to 400 with per-path messages", async () => {
    const validationError = await captureAsync(new User({ role: "admin" }).validate());
    expect(validationError).toBeInstanceOf(mongoose.Error.ValidationError);

    const appError = toAppError(validationError);
    expect(appError).toBeInstanceOf(ValidationError);
    expect(appError.status).toBe(400);
    expect(appError.fieldErrors).toMatchObject({
      name: ["Name is required"],
      email: ["Email is required"],
    });
  });

  it("maps a mongoose CastError to 400 without echoing the value", () => {
    const castError = new mongoose.Error.CastError("ObjectId", "$where: sleep(1000)", "_id");
    const appError = toAppError(castError);
    expect(appError).toBeInstanceOf(ValidationError);
    expect(appError.status).toBe(400);
    expect(appError.code).toBe("INVALID_INPUT");
    expect(appError.message).toBe("Invalid value supplied.");
    expect(appError.message).not.toContain("sleep");
  });

  it("maps an E11000 duplicate key error to 409 without leaking index details", () => {
    const duplicate = Object.assign(
      new Error('E11000 duplicate key error collection: odums.users index: email_1 dup key: { email: "a@b.com" }'),
      { name: "MongoServerError", code: 11000 },
    );
    const appError = toAppError(duplicate);
    expect(appError).toBeInstanceOf(ConflictError);
    expect(appError.status).toBe(409);
    expect(appError.code).toBe("CONFLICT");
    expect(appError.message).not.toMatch(/E11000|email_1|a@b\.com|odums/);

    expect(toAppError({ code: 11000 })).toBeInstanceOf(ConflictError);
    expect(toAppError({ code: "11000" })).not.toBeInstanceOf(ConflictError);
  });

  it.each(["MongoServerSelectionError", "MongooseServerSelectionError", "MongoNetworkError", "MongoNotConnectedError"])(
    "maps %s to a generic 503 DatabaseError",
    (name) => {
      const infra = Object.assign(new Error("connect ECONNREFUSED mongodb://admin:hunter2@db.internal:27017"), { name });
      const appError = toAppError(infra);
      expect(appError).toBeInstanceOf(DatabaseError);
      expect(appError.status).toBe(503);
      expect(appError.message).toBe("A database error occurred. Please try again.");
      expect(appError.message).not.toContain("hunter2");
    },
  );

  it.each<[string, unknown]>([
    ["Error", new Error("secret: mongodb://admin:hunter2@db")],
    ["TypeError", new TypeError("Cannot read properties of undefined (reading 'officeId')")],
    ["string", "raw string failure"],
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["plain object", { message: "object message", stack: "at secret.ts:1:1" }],
  ])("maps an unknown %s to a generic 500", (_label, thrown) => {
    const appError = toAppError(thrown);
    expect(appError).toBeInstanceOf(AppError);
    expect(appError.status).toBe(500);
    expect(appError.code).toBe("INTERNAL_ERROR");
    expect(appError.message).toBe(GENERIC_MESSAGE);
    expect(appError.fieldErrors).toBeUndefined();
    expect(appError.details).toBeUndefined();
  });
});

describe("jsonOk / jsonError", () => {
  it("jsonOk wraps data and disables caching", async () => {
    const response = jsonOk({ ok: true }, { status: 201, headers: { "X-Test": "1" } });
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Test")).toBe("1");
    await expect(response.json()).resolves.toEqual({ data: { ok: true } });
  });

  it("jsonError returns { error: { code, message } } only when there are no extras", async () => {
    const response = jsonError(new UnauthorizedError());
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBeNull();
    const body = await response.json();
    expect(body).toEqual({ error: { code: "UNAUTHORIZED", message: "Please sign in to continue." } });
    expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  });

  it("jsonError includes fieldErrors and details when present", async () => {
    const withFields = await jsonError(new ValidationError(undefined, { email: ["Required"] })).json();
    expect(withFields).toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "Please correct the highlighted fields.",
        fieldErrors: { email: ["Required"] },
      },
    });

    const invalidOtp = jsonError(new InvalidOtpError(3));
    expect(invalidOtp.status).toBe(400);
    expect(invalidOtp.headers.get("Retry-After")).toBeNull();
    await expect(invalidOtp.json()).resolves.toEqual({
      error: { code: "INVALID_OTP", message: "Invalid OTP. 3 attempts remaining.", details: { attemptsRemaining: 3 } },
    });
  });

  it("jsonError sets Retry-After (rounded up) for rate limits", async () => {
    const response = jsonError(new RateLimitError("Please wait 42 seconds.", 42));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    await expect(response.json()).resolves.toEqual({
      error: { code: "RATE_LIMITED", message: "Please wait 42 seconds.", details: { retryAfterSeconds: 42 } },
    });

    expect(jsonError(new RateLimitError("x", 1.2)).headers.get("Retry-After")).toBe("2");
    expect(jsonError(new RateLimitError("x", 0)).headers.get("Retry-After")).toBeNull();
    expect(jsonError(new RateLimitError("x")).headers.get("Retry-After")).toBeNull();
    expect(jsonError(new TooManyAttemptsError()).status).toBe(429);
    expect(
      jsonError(new AppError("RATE_LIMITED", "x", 429, { details: { retryAfterSeconds: "10" } })).headers.get(
        "Retry-After",
      ),
    ).toBeNull();
  });

  it("ConfigurationError responses never include the internal message", async () => {
    const response = jsonError(new ConfigurationError("AUTH_SECRET must be configured"));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("AUTH_SECRET");
  });
});

describe("handleApiError", () => {
  it("logs server-side only for 5xx errors", async () => {
    const response = handleApiError(new NotFoundError("Visitor"));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "NOT_FOUND", message: "Visitor not found." } });
    expect(consoleError).not.toHaveBeenCalled();

    const failure = handleApiError(new Error("boom"));
    expect(failure.status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("logs only the internal message of a ConfigurationError", () => {
    handleApiError(new ConfigurationError("MONGODB_URI is not configured."));
    expect(consoleError).toHaveBeenCalledWith("[api] Configuration error: MONGODB_URI is not configured.");
  });
});

describe("assertSameOrigin (CSRF defence in depth)", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("allows safe method %s from any origin", (method) => {
    const request = makeRequest(method, { origin: "https://evil.example.com", host: "localhost:3000" });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it.each(["POST", "PATCH", "PUT", "DELETE"])("rejects %s with a foreign Origin", (method) => {
    const request = makeRequest(method, { origin: "https://evil.example.com", host: "localhost:3000" });
    const error = captureSync(() => assertSameOrigin(request));
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ status: 403, message: "Invalid request origin." });
  });

  it("allows an Origin that matches the Host header", () => {
    expect(() =>
      assertSameOrigin(makeRequest("POST", { origin: "http://localhost:3000", host: "localhost:3000" })),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        makeRequest("DELETE", { origin: "https://odums.example.edu", host: "odums.example.edu" }, undefined,
          "https://odums.example.edu/api/visitors/1"),
      ),
    ).not.toThrow();
  });

  it("allows unsafe requests without an Origin header (same-origin non-browser clients)", () => {
    expect(() => assertSameOrigin(makeRequest("POST", { host: "localhost:3000" }))).not.toThrow();
    expect(() => assertSameOrigin(makeRequest("POST"))).not.toThrow();
  });

  it("prefers x-forwarded-host over host behind a proxy", () => {
    expect(() =>
      assertSameOrigin(
        makeRequest("POST", {
          origin: "https://odums.example.edu",
          host: "internal:3000",
          "x-forwarded-host": "odums.example.edu",
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        makeRequest("POST", {
          origin: "http://internal:3000",
          host: "internal:3000",
          "x-forwarded-host": "odums.example.edu",
        }),
      ),
    ).toThrow(ForbiddenError);
  });

  it.each([
    ["a different port", "http://localhost:4000"],
    ["a subdomain", "http://evil.localhost:3000"],
    ["an opaque null origin", "null"],
    ["a malformed origin", "not a url"],
  ])("rejects %s", (_label, origin) => {
    expect(() => assertSameOrigin(makeRequest("POST", { origin, host: "localhost:3000" }))).toThrow(ForbiddenError);
  });

  it("rejects a POST with an Origin but no Host information", () => {
    expect(() => assertSameOrigin(makeRequest("POST", { origin: "http://localhost:3000" }))).toThrow(ForbiddenError);
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ email: z.email("Enter a valid email address") });

  it("parses and validates a JSON body", async () => {
    const request = makeRequest("POST", { "content-type": "application/json" }, JSON.stringify({ email: "a@b.com" }));
    await expect(parseJsonBody(request, schema)).resolves.toEqual({ email: "a@b.com" });
  });

  it("accepts a charset parameter and case-insensitive type", async () => {
    const withCharset = makeRequest(
      "POST",
      { "content-type": "Application/JSON; charset=utf-8" },
      JSON.stringify({ email: "a@b.com" }),
    );
    await expect(parseJsonBody(withCharset, schema)).resolves.toEqual({ email: "a@b.com" });
  });

  it.each([
    ["no content type", {}],
    ["text/plain", { "content-type": "text/plain" }],
    ["form encoded", { "content-type": "application/x-www-form-urlencoded" }],
    ["multipart", { "content-type": "multipart/form-data; boundary=x" }],
  ])("requires application/json (%s)", async (_label, headers) => {
    const request = makeRequest("POST", headers, JSON.stringify({ email: "a@b.com" }));
    const error = await captureAsync(parseJsonBody(request, schema));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ status: 400, message: "Expected a JSON request body." });
  });

  // Regression: the MIME essence must be compared exactly, so a CORS-safelisted text/plain type that
  // merely mentions application/json (sendable cross-site without a preflight) is rejected.
  it("rejects a text/plain content type that merely mentions application/json", async () => {
    const request = makeRequest(
      "POST",
      { "content-type": "text/plain; application/json" },
      JSON.stringify({ email: "a@b.com" }),
    );
    const error = await captureAsync(parseJsonBody(request, schema));
    expect(error).toBeInstanceOf(ValidationError);
  });

  it.each(["{bad json", "", "undefined"])("rejects invalid JSON %j", async (body) => {
    const request = makeRequest("POST", { "content-type": "application/json" }, body);
    const error = await captureAsync(parseJsonBody(request, schema));
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ message: "Request body must be valid JSON." });
  });

  it("throws the ZodError for schema violations", async () => {
    const request = makeRequest("POST", { "content-type": "application/json" }, JSON.stringify({ email: "nope" }));
    const error = await captureAsync(parseJsonBody(request, schema));
    expect(error).toBeInstanceOf(ZodError);
  });
});

describe("getRouteId", () => {
  it("returns a valid ObjectId and treats anything else as not found", async () => {
    const id = "64f1a0000000000000000a01";
    await expect(getRouteId({ params: Promise.resolve({ id }) })).resolves.toBe(id);
    for (const bad of ["123", "../64f1a0000000000000000a01", '{"$ne":null}', ""]) {
      const error = await captureAsync(getRouteId({ params: Promise.resolve({ id: bad }) }, "Visitor"));
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error).toMatchObject({ status: 404, message: "Visitor not found." });
    }
  });
});

describe("withApi", () => {
  it("passes successful responses through", async () => {
    const handler = withApi(async () => jsonOk({ value: 1 }));
    const response = await handler(makeRequest("GET"), undefined);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { value: 1 } });
  });

  it("renders AppErrors with their status and safe message", async () => {
    const handler = withApi(async () => {
      throw new RateLimitError("Please wait 30 seconds before requesting a new OTP.", 30);
    });
    const response = await handler(makeRequest("POST"), undefined);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RATE_LIMITED",
        message: "Please wait 30 seconds before requesting a new OTP.",
        details: { retryAfterSeconds: 30 },
      },
    });
  });

  it("renders thrown ZodErrors as 400 with fieldErrors", async () => {
    const handler = withApi(async (request) => {
      await parseJsonBody(request, requestOtpSchema);
      return jsonOk({});
    });
    const response = await handler(
      makeRequest("POST", { "content-type": "application/json" }, JSON.stringify({ email: "bad" })),
      undefined,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.fieldErrors.email).toEqual(["Enter a valid email address"]);
  });

  it("never leaks the message or stack of unknown errors", async () => {
    const secretMessage = "MongoParseError: mongodb+srv://admin:hunter2@cluster0.example.net SMTP_PASSWORD=pw";
    const handler = withApi(async () => {
      throw new Error(secretMessage);
    });
    const response = await handler(makeRequest("POST"), undefined);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "INTERNAL_ERROR", message: GENERIC_MESSAGE } });
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("SMTP_PASSWORD");
    expect(text).not.toMatch(/stack|at .*\.ts/i);
    // Logged server-side instead.
    expect(consoleError).toHaveBeenCalled();
  });

  it("never leaks non-Error throwables", async () => {
    const handler = withApi(async () => {
      throw { message: "internal detail", stack: "at secret.ts:10:5" };
    });
    const response = await handler(makeRequest("POST"), undefined);
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain("internal detail");
    expect(text).not.toContain("secret.ts");
  });

  it("rejects cross-origin unsafe requests before running the handler", async () => {
    const inner = vi.fn(async () => jsonOk({ changed: true }));
    const handler = withApi(inner);
    const response = await handler(
      makeRequest("POST", { origin: "https://evil.example.com", host: "localhost:3000" }),
      undefined,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: { code: "FORBIDDEN", message: "Invalid request origin." },
    });
    expect(inner).not.toHaveBeenCalled();
  });

  it("passes the route context through", async () => {
    const handler = withApi(async (_request, context: { params: Promise<{ id: string }> }) => {
      const id = await getRouteId(context);
      return jsonOk({ id });
    });
    const response = await handler(makeRequest("GET"), { params: Promise.resolve({ id: "64f1a0000000000000000a01" }) });
    await expect(response.json()).resolves.toEqual({ data: { id: "64f1a0000000000000000a01" } });
  });
});
