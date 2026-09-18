import { describe, expect, it } from "vitest";

import {
  IMPORTANCE_LEVELS,
  MAX_ATTACHMENTS_PER_FIELD,
  MAX_MILESTONES_PER_RECORD,
  ROLES,
} from "@/lib/constants";
import { requestOtpSchema, verifyOtpSchema } from "@/lib/validation/auth";
import {
  emailSchema,
  importanceSchema,
  isObjectId,
  objectIdSchema,
  officeFilterParam,
  pageParam,
  pageSizeParam,
  roleSchema,
} from "@/lib/validation/common";
import { dailyMilestoneInputSchema, dailyMilestoneUpdateSchema } from "@/lib/validation/daily-milestone";
import { MAX_REPORT_RANGE_DAYS, reportQuerySchema, resolveReportRange } from "@/lib/validation/report";
import { userInputSchema } from "@/lib/validation/user";
import { visitorInputSchema, visitorListQuerySchema } from "@/lib/validation/visitor";

interface ParseResultLike {
  success: boolean;
  error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
}

/** Flatten Zod issues to { "a.0.b": ["message"] } for readable assertions. */
function fieldErrors(result: ParseResultLike): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of result.error?.issues ?? []) {
    const key = issue.path.map(String).join(".");
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

const VALID_ID = "507f1f77bcf86cd799439011";
const CLOUDINARY_FILE = {
  fileName: "meeting-photo.jpg",
  fileUrl: "https://res.cloudinary.com/demo/image/upload/v1/office-daily-updates/photos/meeting-photo.jpg",
};

describe("objectIdSchema", () => {
  it("accepts 24-character hex ids (trimmed)", () => {
    expect(objectIdSchema.parse(VALID_ID)).toBe(VALID_ID);
    expect(objectIdSchema.parse(VALID_ID.toUpperCase())).toBe(VALID_ID.toUpperCase());
    expect(objectIdSchema.parse(`  ${VALID_ID}  `)).toBe(VALID_ID);
    expect(isObjectId(VALID_ID)).toBe(true);
  });

  it.each([
    '{"$gt":""}',
    '{"$ne":null}',
    "$ne",
    "[$ne]=1",
    `${VALID_ID}'; db.users.drop()`,
    `${VALID_ID}\n{"$gt":""}`,
    `../${VALID_ID}`,
    "507f1f77bcf86cd79943901",
    "507f1f77bcf86cd7994390111",
    "507f1f77bcf86cd79943901z",
    "all",
    "",
  ])("rejects operator-injection and malformed string %j", (value) => {
    expect(objectIdSchema.safeParse(value).success).toBe(false);
    expect(isObjectId(value)).toBe(false);
  });

  it.each([{ $gt: "" }, { $ne: null }, [VALID_ID], 123, null, undefined])(
    "rejects non-string value %j",
    (value) => {
      expect(objectIdSchema.safeParse(value).success).toBe(false);
      expect(isObjectId(value)).toBe(false);
    },
  );
});

describe("emailSchema", () => {
  it("trims and lowercases emails", () => {
    expect(emailSchema.parse("  Ayushi@XLRI.Example.COM  ")).toBe("ayushi@xlri.example.com");
    expect(requestOtpSchema.parse({ email: " User@Example.com" }).email).toBe("user@example.com");
  });

  it.each(["", "   ", "not-an-email", "a@b", "user@example..com", `${"a".repeat(250)}@example.com`])(
    "rejects %j",
    (value) => {
      expect(emailSchema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects operator objects", () => {
    expect(requestOtpSchema.safeParse({ email: { $ne: "" } }).success).toBe(false);
  });
});

describe("verifyOtpSchema", () => {
  it("accepts exactly six digits", () => {
    expect(verifyOtpSchema.parse({ email: "user@example.com", otp: " 123456 " }).otp).toBe("123456");
  });

  it.each(["12345", "1234567", "12a456", "", "      "])("rejects OTP %j", (otp) => {
    expect(verifyOtpSchema.safeParse({ email: "user@example.com", otp }).success).toBe(false);
  });
});

describe("enumerations", () => {
  it("has exactly two roles and three importance levels", () => {
    expect(ROLES).toEqual(["admin", "user"]);
    expect(roleSchema.safeParse("superadmin").success).toBe(false);
    expect(IMPORTANCE_LEVELS).toEqual(["HIGH", "MEDIUM", "LOW"]);
    expect(importanceSchema.safeParse("CRITICAL").success).toBe(false);
  });

  it("requires normal users to have an office", () => {
    const base = { name: "Ayushi", email: "ayushi@example.com", designation: "Assistant", isActive: true };
    expect(fieldErrors(userInputSchema.safeParse({ ...base, role: "user", officeId: null }))).toEqual({
      officeId: ["Normal users must be assigned to an office"],
    });
    expect(userInputSchema.safeParse({ ...base, role: "admin", officeId: null }).success).toBe(true);
    expect(userInputSchema.safeParse({ ...base, role: "user", officeId: VALID_ID }).success).toBe(true);
  });
});

describe("visitorInputSchema", () => {
  const visitor = {
    name: "Ravi Kumar",
    purpose: "Admission enquiry",
    date: "2026-09-08",
    timeArrived: "10:00",
    timeDeparted: "11:15",
    importance: "HIGH",
    photos: [CLOUDINARY_FILE],
    documents: [],
    remarks: "",
  };

  it("accepts a valid visitor without officeId", () => {
    const result = visitorInputSchema.safeParse(visitor);
    expect(result.success).toBe(true);
  });

  it("rejects a departure before arrival", () => {
    const result = visitorInputSchema.safeParse({ ...visitor, timeArrived: "10:00", timeDeparted: "09:59" });
    expect(fieldErrors(result)).toEqual({ timeDeparted: ["Departure time cannot be before arrival time"] });
  });

  it("allows a departure equal to arrival or no departure yet", () => {
    expect(visitorInputSchema.safeParse({ ...visitor, timeDeparted: "10:00" }).success).toBe(true);
    expect(visitorInputSchema.safeParse({ ...visitor, timeDeparted: "" }).success).toBe(true);
  });

  it("validates required fields, dates, times, importance and officeId", () => {
    const result = visitorInputSchema.safeParse({
      ...visitor,
      officeId: '{"$ne":null}',
      name: "   ",
      purpose: "",
      date: "2026-02-30",
      timeArrived: "9:00",
      importance: "CRITICAL",
    });
    expect(Object.keys(fieldErrors(result)).sort()).toEqual(
      ["date", "importance", "name", "officeId", "purpose", "timeArrived"].sort(),
    );
    expect(fieldErrors(result).name).toEqual(["Visitor name is required"]);
  });

  it("validates attachments", () => {
    const insecure = { fileName: "a.jpg", fileUrl: "http://res.cloudinary.com/demo/image/upload/a.jpg" };
    expect(fieldErrors(visitorInputSchema.safeParse({ ...visitor, photos: [insecure] }))).toEqual({
      "photos.0.fileUrl": ["Invalid file URL"],
    });
    const tooMany = Array.from({ length: MAX_ATTACHMENTS_PER_FIELD + 1 }, () => CLOUDINARY_FILE);
    expect(
      Object.keys(fieldErrors(visitorInputSchema.safeParse({ ...visitor, documents: tooMany }))),
    ).toEqual(["documents"]);
  });
});

describe("dailyMilestoneInputSchema", () => {
  const record = {
    date: "2026-09-08",
    dailyUpdates: [{ title: "Admissions review", description: "Reviewed pending admissions." }],
    milestones: [{ title: "Shortlist published", description: "", remarks: "" }],
    photos: [],
    documents: [],
  };

  it("accepts a valid record and trims text", () => {
    const result = dailyMilestoneInputSchema.parse({
      ...record,
      dailyUpdates: [{ title: "  Admissions review  ", description: " Reviewed. " }],
    });
    expect(result.dailyUpdates).toEqual([
      { title: "Admissions review", description: "Reviewed.", photos: [], documents: [] },
    ]);
    expect(dailyMilestoneInputSchema.safeParse({ ...record, milestones: [] }).success).toBe(true);
  });

  it("requires the date and daily update title and description", () => {
    const result = dailyMilestoneInputSchema.safeParse({
      ...record,
      date: undefined,
      dailyUpdates: [{ title: "   ", description: "" }],
    });
    expect(fieldErrors(result)).toMatchObject({
      "dailyUpdates.0.title": ["Daily update title is required"],
      "dailyUpdates.0.description": ["Daily update description is required"],
    });
    expect(fieldErrors(result).date).toBeDefined();
    expect(
      fieldErrors(dailyMilestoneInputSchema.safeParse({ ...record, dailyUpdates: undefined })),
    ).toHaveProperty("dailyUpdates");
    expect(
      fieldErrors(dailyMilestoneInputSchema.safeParse({ ...record, dailyUpdates: [] })),
    ).toMatchObject({ dailyUpdates: ["At least one daily update is required"] });
    expect(fieldErrors(dailyMilestoneInputSchema.safeParse({ ...record, date: "2026-9-8" }))).toEqual({
      date: ["Enter a valid date"],
    });
  });

  it("requires a title for every milestone", () => {
    const result = dailyMilestoneInputSchema.safeParse({
      ...record,
      milestones: [
        { title: "First", description: "", remarks: "" },
        { title: "   ", description: "Details", remarks: "Remarks" },
      ],
    });
    expect(fieldErrors(result)).toEqual({ "milestones.1.title": ["Milestone title is required"] });
  });

  it("limits the number of milestones", () => {
    const milestones = Array.from({ length: MAX_MILESTONES_PER_RECORD + 1 }, (_, i) => ({
      title: `Milestone ${i}`,
      description: "",
      remarks: "",
    }));
    expect(Object.keys(fieldErrors(dailyMilestoneInputSchema.safeParse({ ...record, milestones })))).toEqual([
      "milestones",
    ]);
  });

  it("rejects an injected officeId and drops officeId from edits", () => {
    expect(
      fieldErrors(dailyMilestoneInputSchema.safeParse({ ...record, officeId: { $ne: null } })),
    ).toHaveProperty("officeId");
    const edit = { ...record, officeId: VALID_ID, expectedUpdatedAt: "2026-09-08T10:00:00.000Z" };
    expect(dailyMilestoneUpdateSchema.parse(edit)).not.toHaveProperty("officeId");
    // Edits must carry the version the form loaded.
    expect(fieldErrors(dailyMilestoneUpdateSchema.safeParse({ ...record }))).toHaveProperty("expectedUpdatedAt");
  });
});

describe("reportQuerySchema", () => {
  it("defaults to a daily JSON report that requires a date", () => {
    expect(fieldErrors(reportQuerySchema.safeParse({}))).toEqual({ date: ["Select a date"] });
    const query = reportQuerySchema.parse({ date: "2026-09-08" });
    expect(query).toMatchObject({ type: "daily", format: "json" });
    expect(resolveReportRange(query)).toEqual({ from: "2026-09-08", to: "2026-09-08" });
  });

  it("weekly uses the Monday–Sunday week of the selected date", () => {
    expect(fieldErrors(reportQuerySchema.safeParse({ type: "weekly" }))).toEqual({ date: ["Select a date"] });
    const query = reportQuerySchema.parse({ type: "weekly", date: "2026-09-10" });
    expect(resolveReportRange(query)).toEqual({ from: "2026-09-07", to: "2026-09-13" });
  });

  it("monthly requires a valid month", () => {
    expect(fieldErrors(reportQuerySchema.safeParse({ type: "monthly" }))).toEqual({
      month: ["Select a month"],
    });
    expect(fieldErrors(reportQuerySchema.safeParse({ type: "monthly", month: "2026-13" }))).toHaveProperty(
      "month",
    );
    expect(resolveReportRange(reportQuerySchema.parse({ type: "monthly", month: "2024-02" }))).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
  });

  it("custom requires both dates", () => {
    expect(fieldErrors(reportQuerySchema.safeParse({ type: "custom" }))).toEqual({
      from: ["Select a From date"],
      to: ["Select a To date"],
    });
  });

  it("custom rejects To before From", () => {
    expect(
      fieldErrors(reportQuerySchema.safeParse({ type: "custom", from: "2026-09-10", to: "2026-09-01" })),
    ).toEqual({
      to: ["To date must be on or after From date"],
    });
  });

  it(`custom allows at most ${MAX_REPORT_RANGE_DAYS} days`, () => {
    expect(MAX_REPORT_RANGE_DAYS).toBe(366);
    expect(
      reportQuerySchema.safeParse({ type: "custom", from: "2026-09-08", to: "2026-09-08" }).success,
    ).toBe(true);
    expect(
      reportQuerySchema.safeParse({ type: "custom", from: "2024-01-01", to: "2024-12-31" }).success,
    ).toBe(true);
    expect(
      fieldErrors(reportQuerySchema.safeParse({ type: "custom", from: "2026-01-01", to: "2027-01-02" })),
    ).toEqual({
      to: ["Custom reports can cover at most 366 days"],
    });
    const query = reportQuerySchema.parse({ type: "custom", from: "2026-09-01", to: "2026-09-30" });
    expect(resolveReportRange(query)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("treats blank GET form fields as missing", () => {
    const query = reportQuerySchema.parse({
      type: "custom",
      date: "",
      month: "",
      from: "2026-09-01",
      to: "2026-09-30",
      officeId: "",
      format: "",
    });
    expect(query).toMatchObject({ type: "custom", officeId: undefined, date: undefined, format: "json" });
  });

  it("validates the office filter, type and format", () => {
    expect(reportQuerySchema.parse({ date: "2026-09-08", officeId: "all" }).officeId).toBe("all");
    expect(reportQuerySchema.parse({ date: "2026-09-08", officeId: VALID_ID }).officeId).toBe(VALID_ID);
    expect(
      fieldErrors(reportQuerySchema.safeParse({ date: "2026-09-08", officeId: '{"$ne":null}' })),
    ).toHaveProperty("officeId");
    expect(fieldErrors(reportQuerySchema.safeParse({ type: "yearly", date: "2026-09-08" }))).toHaveProperty(
      "type",
    );
    expect(fieldErrors(reportQuerySchema.safeParse({ date: "2026-09-08", format: "docx" }))).toHaveProperty(
      "format",
    );
    expect(reportQuerySchema.parse({ date: "2026-09-08", format: "pdf" }).format).toBe("pdf");
    expect(officeFilterParam.safeParse({ $ne: null }).success).toBe(false);
  });
});

describe("pagination params", () => {
  it.each([
    [undefined, 1],
    ["", 1],
    ["2", 2],
    [7, 7],
    ["0", 1],
    ["-1", 1],
    ["1.5", 1],
    ["abc", 1],
    ["100001", 1],
  ])("page %j → %i", (input, expected) => {
    expect(pageParam.parse(input)).toBe(expected);
  });

  it.each([
    [undefined, 20],
    ["", 20],
    ["50", 50],
    ["100", 100],
    ["101", 20],
    ["0", 20],
    ["ten", 20],
  ])("pageSize %j → %i", (input, expected) => {
    expect(pageSizeParam.parse(input)).toBe(expected);
  });

  it("coerces list queries and falls back on invalid values", () => {
    expect(
      visitorListQuerySchema.parse({ page: "3", pageSize: "abc", q: "   ", importance: "" }),
    ).toMatchObject({
      page: 3,
      pageSize: 20,
      q: undefined,
      importance: undefined,
    });
  });
});
