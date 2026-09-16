import { describe, expect, it } from "vitest";

import { APP_NAME } from "@/lib/constants";
import { renderReportPdf } from "@/lib/reports/pdf";
import type { ReportData, ReportDailyRecord, ReportVisitor } from "@/lib/reports/types";
import { addDays } from "@/lib/utils/dates";

import { computeTotals, LONG_TEXT } from "../setup/report-fixtures";

// Regression (F01): a fixed View with a `render` prop returning a bordered View crashed pdfkit
// with "unsupported number: 1.37e+21" once a report ran past ~9 pages.
describe("renderReportPdf on long reports", () => {
  it("renders a 20+ page report", async () => {
    const description = LONG_TEXT.repeat(4).slice(0, 600);
    const dailyRecords: ReportDailyRecord[] = Array.from({ length: 31 }, (_, index) => ({
      id: `d${index}`,
      date: addDays("2026-08-01", index),
      dailyUpdate: { title: `Update ${index + 1}`, description },
      milestones: Array.from({ length: 3 }, (__, m) => ({
        title: `Milestone ${m + 1}`,
        description,
        remarks: "On track",
      })),
      photos: [],
      documents: [],
    }));
    const visitors: ReportVisitor[] = Array.from({ length: 600 }, (_, index) => ({
      id: `v${index}`,
      date: addDays("2026-08-01", index % 31),
      name: `Visitor ${index + 1}`,
      purpose: "Meeting regarding MoU renewal",
      timeArrived: new Date(Date.UTC(2026, 7, 1 + (index % 31), 4, 0)).toISOString(),
      timeDeparted: null,
      importance: "MEDIUM",
      remarks: "",
      photos: [],
      documents: [],
    }));
    const totals = computeTotals(dailyRecords, visitors);
    const data: ReportData = {
      meta: {
        systemName: APP_NAME,
        officeLabel: "Registrar",
        officeId: "64f000000000000000000009",
        type: "monthly",
        typeLabel: "Monthly Report",
        from: "2026-08-01",
        to: "2026-08-31",
        rangeLabel: "August 2026",
        generatedAt: "2026-09-01T06:00:00.000Z",
        generatedBy: "User A",
      },
      sections: [
        { office: { id: "64f000000000000000000009", name: "Registrar", code: "REG" }, dailyRecords, visitors, totals },
      ],
      totals,
    };

    const buffer = await renderReportPdf(data);
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const pages = buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pages.length).toBeGreaterThanOrEqual(20);
  }, 120_000);
});
