import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/utils/safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/visitors?date=2026-09-08&importance=HIGH", "/visitors?date=2026-09-08&importance=HIGH"],
    ["/daily-updates/507f1f77bcf86cd799439011", "/daily-updates/507f1f77bcf86cd799439011"],
    ["/reports#print", "/reports"],
    ["/login/../visitors", "/visitors"],
  ])("keeps same-origin path %j", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    null,
    undefined,
    "",
    "dashboard",
    "https://evil.example.com",
    "http://evil.example.com/dashboard",
    "//evil.example.com",
    "//evil.example.com/dashboard",
    "/\\evil.example.com",
    "\\\\evil.example.com",
    "/\t/evil.example.com",
    "/\n/evil.example.com",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/login",
    "/login?next=/dashboard",
    "/api/auth/logout",
    "/api/../login",
    `/${"a".repeat(2048)}`,
  ])("falls back for unsafe target %j", (input) => {
    expect(safeRedirectPath(input)).toBe("/dashboard");
  });

  it("uses a custom fallback", () => {
    expect(safeRedirectPath("https://evil.example.com", "/profile")).toBe("/profile");
  });

  // Regression (fixed): dot segments are normalised by `new URL()` AFTER the "//" prefix check, so
  // "/.//evil.example.com" becomes the protocol-relative "//evil.example.com" (an open redirect).
  for (const input of ["/.//evil.example.com", "/..//evil.example.com", "/%2e//evil.example.com"]) {
    it(
      `never returns a protocol-relative URL after dot-segment normalisation (${JSON.stringify(input)})`,
      () => {
        expect(safeRedirectPath(input)).not.toMatch(/^\/\//);
      },
    );
  }
});
