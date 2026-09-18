import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { reportToCsv } from "@/lib/reports/csv";
import { reportToXlsx } from "@/lib/reports/xlsx";
import type { ReportData, ReportTotals } from "@/lib/reports/types";
import type { Attachment } from "@/types";

/**
 * Files can be attached to the day, to one daily update or to one milestone. Exports must say which,
 * so a reader can tell what a document belongs to.
 */

const file = (name: string, kind: "image" | "raw" = "image"): Attachment => ({
  fileName: name,
  fileUrl: `https://res.cloudinary.com/odums-demo/${kind}/upload/v1/office_updates/office-a/${name}`,
});

const TOTALS: ReportTotals = { dailyRecords: 1, milestones: 1, visitors: 0, photos: 4, documents: 1 };

const data: ReportData = {
  meta: {
    systemName: "Office Daily Update & Milestone Management System",
    officeLabel: "Office A",
    officeId: "64f000000000000000000001",
    type: "daily",
    typeLabel: "Daily Report",
    from: "2026-09-08",
    to: "2026-09-08",
    rangeLabel: "08 Sep 2026",
    generatedAt: "2026-09-08T10:00:00.000Z",
    generatedBy: "Admin",
  },
  sections: [
    {
      office: { id: "64f000000000000000000001", name: "Office A", code: "OFFICE-A" },
      dailyRecords: [
        {
          id: "d1",
          date: "2026-09-08",
          dailyUpdates: [
            {
              title: "Morning briefing",
              description: "Priorities agreed.",
              photos: [file("briefing.jpg")],
              documents: [],
            },
            {
              title: "Vendor meeting",
              description: "Canteen contract.",
              photos: [],
              documents: [file("contract.pdf", "raw")],
            },
          ],
          milestones: [
            {
              title: "Shortlist published",
              description: "",
              remarks: "",
              photos: [file("shortlist.jpg")],
              documents: [],
            },
          ],
          photos: [file("campus.jpg")],
          documents: [],
        },
      ],
      visitors: [],
      totals: TOTALS,
    },
  ],
  totals: TOTALS,
};

describe("exports name what each file is attached to", () => {
  it("lists every file with its source in the CSV Attachments block", () => {
    const rows = reportToCsv(data)
      .split("\r\n")
      .filter((line) => line !== "")
      .map((line) => line.split(","));
    const start = rows.findIndex((row) => row[0] === "Attachments");

    expect(rows[start + 1]?.slice(2, 6)).toEqual(["Attached To", "Title", "Type", "File Name"]);
    expect(rows.slice(start + 2).map((row) => row.slice(2, 6))).toEqual([
      ["Daily Update", "1. Morning briefing", "Photo", "briefing.jpg"],
      ["Daily Update", "2. Vendor meeting", "Document", "contract.pdf"],
      ["Milestone", "1. Shortlist published", "Photo", "shortlist.jpg"],
      ["Daily Record", "1. Morning briefing | 2. Vendor meeting", "Photo", "campus.jpg"],
    ]);
  });

  it("names the source of every file on the Excel Attachments sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await reportToXlsx(data)) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet("Attachments");

    const sources: string[][] = [];
    sheet?.eachRow((row, index) => {
      if (index === 1) return;
      sources.push([String(row.getCell(3).value), String(row.getCell(4).value)]);
    });

    expect(sources).toEqual([
      ["Daily Record", "1. Morning briefing | 2. Vendor meeting"],
      ["Daily Update", "Morning briefing"],
      ["Daily Update", "Vendor meeting"],
      ["Milestone", "Shortlist published"],
    ]);
  });
});
