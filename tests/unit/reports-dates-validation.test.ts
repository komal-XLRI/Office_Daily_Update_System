import { describe, expect, it } from "vitest";

import { toAppError } from "@/lib/api/handler";
import { ValidationError } from "@/lib/errors";
import { businessDateRangeFilter } from "@/lib/utils/dates";
import { reportQuerySchema } from "@/lib/validation/report";

// Regression (F05): malformed dates must yield validation errors, never a thrown RangeError / 500.
describe("report date validation", () => {
  it.each([
    ["2026-13-45", "2026-09-01"],
    ["2026-09-01", "not-a-date"],
    ["2026-02-30", "2026-03-01"],
  ])("rejects malformed custom range %s..%s without throwing", (from, to) => {
    const result = reportQuerySchema.safeParse({ type: "custom", from, to });
    expect(result.success).toBe(false);
  });

  it("builds a range filter at the year upper bound", () => {
    const filter = businessDateRangeFilter("2999-12-01", "2999-12-31");
    expect(filter.$lt.toISOString()).toBe("3000-01-01T00:00:00.000Z");
  });

  it("maps RangeError to a ValidationError", () => {
    expect(toAppError(new RangeError("Invalid business date"))).toBeInstanceOf(ValidationError);
  });
});
