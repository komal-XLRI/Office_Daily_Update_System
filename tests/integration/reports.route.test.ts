import ExcelJS from "exceljs";
import { Types } from "mongoose";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportData } from "@/lib/reports/types";
import type { CurrentUser } from "@/types";

import {
  createAuthorizationFixture,
  createDailyMilestone,
  createVisitor,
  registerTestDatabase,
  type AuthorizationFixture,
} from "../setup/db";
import { parseCsv } from "../setup/report-fixtures";

// GET /api/reports (spec §17–§20, §59): JSON / PDF / CSV / XLSX downloads, 400 for invalid queries,
// 403 when a normal user asks for another office or all offices.

const auth = vi.hoisted(() => ({ user: null as CurrentUser | null }));

vi.mock("@/lib/permissions", async () => {
  const scope = await import("@/lib/permissions/scope");
  const { UnauthorizedError } = await import("@/lib/errors");
  return {
    ...scope,
    requireAuth: async () => {
      if (!auth.user) throw new UnauthorizedError();
      return auth.user;
    },
  };
});

const { GET, runtime } = await import("@/app/api/reports/route");

registerTestDatabase();

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let fixture: AuthorizationFixture;

beforeEach(async () => {
  auth.user = null;
  fixture = await createAuthorizationFixture();
  await createDailyMilestone({
    officeId: fixture.officeA._id,
    date: "2026-09-08",
    dailyUpdates: [{ title: "Office A update", description: "Office A description" }],
    milestones: [{ title: "Office A milestone", description: "Done", remarks: "=1+1" }],
    photos: [
      {
        fileName: "a-photo.jpg",
        fileUrl: "https://res.cloudinary.com/odums-test/image/upload/v1/office-daily-updates/OFFICE-A/photos/a-photo.jpg",
      },
    ],
  });
  await createVisitor({ officeId: fixture.officeA._id, name: "Office A visitor", date: "2026-09-08", timeArrived: "10:00" });
  await createDailyMilestone({
    officeId: fixture.officeB._id,
    date: "2026-09-09",
    dailyUpdates: [{ title: "Office B update", description: "Office B description" }],
    milestones: [],
  });
  await createVisitor({ officeId: fixture.officeB._id, name: "Office B visitor", date: "2026-09-09", timeArrived: "11:00" });
});

async function get(query: Record<string, string>): Promise<Response> {
  const url = `http://localhost:3000/api/reports?${new URLSearchParams(query).toString()}`;
  return GET(new NextRequest(url), { params: Promise.resolve({}) });
}

interface ErrorBody {
  error: { code: string; message: string; fieldErrors?: Record<string, string[]> };
}

async function expectJsonError(response: Response, status: number, code: string): Promise<ErrorBody> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("content-disposition")).toBeNull();
  const body = (await response.json()) as ErrorBody;
  expect(body.error.code).toBe(code);
  return body;
}

function expectDownload(response: Response, contentType: string, fileName: string) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(contentType);
  expect(response.headers.get("content-disposition")).toBe(
    `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`,
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

describe("GET /api/reports", () => {
  it("runs on the Node.js runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("requires authentication (401)", async () => {
    await expectJsonError(await get({ type: "daily", date: "2026-09-08" }), 401, "UNAUTHORIZED");
  });

  describe("json", () => {
    it("returns { data: ReportData } for a user's own office by default", async () => {
      auth.user = fixture.userA;
      const response = await get({ type: "weekly", date: "2026-09-08" });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");

      const body = (await response.json()) as { data: ReportData };
      expect(Object.keys(body)).toEqual(["data"]);
      expect(Object.keys(body.data).sort()).toEqual(["meta", "sections", "totals"]);
      expect(body.data.meta).toMatchObject({
        officeLabel: "Office A",
        officeId: String(fixture.officeA._id),
        type: "weekly",
        from: "2026-09-07",
        to: "2026-09-13",
        generatedBy: "User A",
      });
      expect(body.data.sections).toHaveLength(1);
      expect(body.data.sections[0]?.dailyRecords.map((record) => record.dailyUpdates[0]?.title)).toEqual(["Office A update"]);
      expect(body.data.sections[0]?.visitors.map((visitor) => visitor.name)).toEqual(["Office A visitor"]);
      expect(JSON.stringify(body)).not.toContain("Office B");
    });

    it("returns every office for an admin", async () => {
      auth.user = fixture.admin;
      const response = await get({ type: "custom", from: "2026-09-08", to: "2026-09-09", officeId: "all", format: "json" });
      const body = (await response.json()) as { data: ReportData };
      expect(body.data.sections.map((section) => section.office.code)).toEqual(["OFFICE-A", "OFFICE-B"]);
      expect(body.data.totals).toEqual({ dailyRecords: 2, milestones: 1, visitors: 2, photos: 1, documents: 0 });
    });
  });

  describe("file downloads", () => {
    it("pdf: application/pdf attachment with a slugged file name", async () => {
      auth.user = fixture.userA;
      const response = await get({ type: "daily", date: "2026-09-08", format: "pdf" });
      expectDownload(response, "application/pdf", "report-daily-office-a-2026-09-08.pdf");
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(response.headers.get("content-length")).toBe(String(body.length));
    }, 60_000);

    it("csv: UTF-8 with BOM, all offices for an admin", async () => {
      auth.user = fixture.admin;
      const response = await get({ type: "weekly", date: "2026-09-09", officeId: "all", format: "csv" });
      expectDownload(response, "text/csv; charset=utf-8", "report-weekly-all-offices-2026-09-07-to-2026-09-13.csv");
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.subarray(0, 3).toString("hex")).toBe("efbbbf");
      expect(response.headers.get("content-length")).toBe(String(bytes.length));

      const rows = parseCsv(bytes.toString("utf8").slice(1));
      expect(rows[1]?.slice(0, 2)).toEqual(["Office", "All Offices"]);
      const dailyRow = rows.find((row) => row[2] === "Office A update");
      expect(dailyRow?.slice(0, 7)).toEqual([
        "Office A",
        "2026-09-08",
        "Office A update",
        "Office A description",
        "Office A milestone",
        "Done",
        "'=1+1",
      ]);
      expect(rows.some((row) => row[2] === "Office B update")).toBe(true);
      expect(rows.some((row) => row[2] === "Office B visitor" && row[4] === "11:00 AM")).toBe(true);
    });

    it("xlsx: a workbook for a single office chosen by an admin", async () => {
      auth.user = fixture.admin;
      const response = await get({ type: "monthly", month: "2026-09", officeId: String(fixture.officeB._id), format: "xlsx" });
      expectDownload(response, XLSX_TYPE, "report-monthly-office-b-2026-09.xlsx");
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
      expect(response.headers.get("content-length")).toBe(String(bytes.length));

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        "Summary",
        "Daily Updates",
        "Milestones",
        "Visitors",
        "Attachments",
      ]);
      expect(workbook.getWorksheet("Daily Updates")?.getRow(2).getCell(3).value).toBe("Office B update");
      expect(workbook.getWorksheet("Visitors")?.getRow(2).getCell(3).value).toBe("Office B visitor");
      expect(workbook.getWorksheet("Visitors")?.actualRowCount).toBe(2);
    });
  });

  describe("invalid queries (400)", () => {
    it.each([
      ["a daily report without a date", { type: "daily" }, { date: ["Select a date"] }],
      ["a monthly report without a month", { type: "monthly" }, { month: ["Select a month"] }],
      ["an impossible date", { type: "daily", date: "2026-02-30" }, { date: ["Enter a valid date"] }],
      ["To before From", { type: "custom", from: "2026-09-10", to: "2026-09-01" }, { to: ["To date must be on or after From date"] }],
      ["an unknown format", { type: "daily", date: "2026-09-08", format: "docx" }, { format: ["Invalid format"] }],
      ["an unknown type", { type: "yearly", date: "2026-09-08" }, { type: ["Select a report type"] }],
    ])("rejects %s", async (_label, query, fieldErrors) => {
      auth.user = fixture.admin;
      const body = await expectJsonError(await get(query), 400, "INVALID_INPUT");
      expect(body.error.message).toBe("Please correct the highlighted fields.");
      expect(body.error.fieldErrors).toEqual(fieldErrors);
    });

    it("rejects a malformed officeId", async () => {
      auth.user = fixture.admin;
      const body = await expectJsonError(await get({ type: "daily", date: "2026-09-08", officeId: "x" }), 400, "INVALID_INPUT");
      expect(Object.keys(body.error.fieldErrors ?? {})).toEqual(["officeId"]);
    });
  });

  describe("office scope", () => {
    it.each(["json", "pdf", "csv", "xlsx"])("forbids User A from downloading Office B as %s (403)", async (format) => {
      auth.user = fixture.userA;
      const body = await expectJsonError(
        await get({ type: "daily", date: "2026-09-09", officeId: String(fixture.officeB._id), format }),
        403,
        "FORBIDDEN",
      );
      expect(body.error.message).toBe("You do not have access to this office.");
      expect(JSON.stringify(body)).not.toContain("Office B update");
    });

    it("forbids a normal user from requesting all offices (403)", async () => {
      auth.user = fixture.userB;
      await expectJsonError(await get({ type: "weekly", date: "2026-09-09", officeId: "all", format: "csv" }), 403, "FORBIDDEN");
    });

    it("returns 404 when an admin asks for an office that does not exist", async () => {
      auth.user = fixture.admin;
      await expectJsonError(
        await get({ type: "daily", date: "2026-09-08", officeId: new Types.ObjectId().toHexString() }),
        404,
        "NOT_FOUND",
      );
    });
  });
});
