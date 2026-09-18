import { APP_NAME } from "@/lib/constants";
import type {
  ReportData,
  ReportDailyRecord,
  ReportOfficeSection,
  ReportTotals,
  ReportVisitor,
} from "@/lib/reports/types";
import { combineDateAndTime } from "@/lib/utils/dates";
import type { Attachment, MilestoneDTO } from "@/types";

/**
 * Report helpers shared by the export and route suites: a realistic in-memory ReportData (spec §19) with
 * hostile text (formula injection, quotes, commas, new lines, Unicode) and a strict RFC 4180 CSV parser.
 */

export const SAMPLE_GENERATED_AT = "2026-09-15T04:35:00.000Z"; // 15 Sep 2026, 10:05 AM IST

const cdn = (type: "image" | "raw", path: string) =>
  `https://res.cloudinary.com/odums-demo/${type}/upload/v1757320000/office-daily-updates/${path}`;

export const LONG_TEXT =
  "The committee reviewed the admissions pipeline, faculty recruitment status and the campus infrastructure plan. " +
  "Action items were assigned to each department head with clear timelines. ";

/** Fixture input: nested `photos` / `documents` may be omitted and default to empty lists. */
type PartialFiles<T extends { photos: Attachment[]; documents: Attachment[] }> = Omit<
  T,
  "photos" | "documents"
> &
  Partial<Pick<T, "photos" | "documents">>;

interface DailyRecordFixture extends Partial<Omit<ReportDailyRecord, "dailyUpdates" | "milestones">> {
  dailyUpdates?: PartialFiles<ReportDailyRecord["dailyUpdates"][number]>[];
  milestones?: PartialFiles<MilestoneDTO>[];
}

const withFiles = <T extends { photos?: Attachment[]; documents?: Attachment[] }>(item: T) => ({
  ...item,
  photos: item.photos ?? [],
  documents: item.documents ?? [],
});

function dailyRecord(id: string, date: string, extra: DailyRecordFixture = {}): ReportDailyRecord {
  const { dailyUpdates, milestones, ...rest } = extra;
  return {
    id,
    date,
    photos: [],
    documents: [],
    ...rest,
    dailyUpdates: (
      dailyUpdates ?? [{ title: `Coordination meeting ${date}`, description: "Routine coordination." }]
    ).map(withFiles),
    milestones: (milestones ?? []).map(withFiles),
  };
}

function visitor(
  id: string,
  date: string,
  arrived: string,
  departed: string | null,
  extra: Partial<ReportVisitor> = {},
): ReportVisitor {
  return {
    id,
    date,
    name: `Visitor ${id}`,
    purpose: "Meeting regarding MoU renewal",
    timeArrived: combineDateAndTime(date, arrived).toISOString(),
    timeDeparted: departed ? combineDateAndTime(date, departed).toISOString() : null,
    importance: "MEDIUM",
    remarks: "",
    photos: [],
    documents: [],
    ...extra,
  };
}

export function computeTotals(dailyRecords: ReportDailyRecord[], visitors: ReportVisitor[]): ReportTotals {
  const items = [...dailyRecords, ...visitors];
  return {
    dailyRecords: dailyRecords.length,
    milestones: dailyRecords.reduce((sum, record) => sum + record.milestones.length, 0),
    visitors: visitors.length,
    photos: items.reduce((sum, item) => sum + item.photos.length, 0),
    documents: items.reduce((sum, item) => sum + item.documents.length, 0),
  };
}

function section(office: ReportOfficeSection["office"], dailyRecords: ReportDailyRecord[], visitors: ReportVisitor[]) {
  return { office, dailyRecords, visitors, totals: computeTotals(dailyRecords, visitors) };
}

export function sumTotals(sections: ReportOfficeSection[]): ReportTotals {
  return sections.reduce<ReportTotals>(
    (sum, item) => ({
      dailyRecords: sum.dailyRecords + item.totals.dailyRecords,
      milestones: sum.milestones + item.totals.milestones,
      visitors: sum.visitors + item.totals.visitors,
      photos: sum.photos + item.totals.photos,
      documents: sum.documents + item.totals.documents,
    }),
    { dailyRecords: 0, milestones: 0, visitors: 0, photos: 0, documents: 0 },
  );
}

/** Weekly "All Offices" report for 07–13 Sep 2026 with three offices (one empty). */
export function buildSampleReport(): ReportData {
  const dean = section(
    { id: "64f000000000000000000001", name: "Dean (Administration)", code: "DEAN-ADMIN" },
    [
      dailyRecord("d1", "2026-09-07", {
        dailyUpdates: [{ title: "Admissions review", description: "Reviewed, approved and \"signed\" the brochure." }],
        milestones: [
          { title: "Brochure finalised", description: "Final proof approved by the Dean.", remarks: "Print order placed" },
          {
            title: "=cmd|' /C calc'!A0",
            description: '+SUM(1,2) injection, "quoted" text, commas, and\nnew lines',
            remarks: "@remark -starts with a formula character",
          },
        ],
        photos: [{ fileName: "meeting-room.jpg", fileUrl: cdn("image", "DEAN-ADMIN/photos/meeting-room.jpg") }],
        documents: [
          { fileName: "minutes-07-sep.pdf", fileUrl: cdn("raw", "DEAN-ADMIN/documents/minutes-07-sep.pdf") },
          { fileName: "=bad-link.pdf", fileUrl: "javascript:alert(1)" },
        ],
      }),
      dailyRecord("d2", "2026-09-08", {
        dailyUpdates: [{
          title: "Unicode: é ü “smart quotes” – dashes — ₹ 5,000 日本 😀 مرحبا",
          description: `${LONG_TEXT}\r\n\r\n${LONG_TEXT.repeat(6)}`,
        }],
        milestones: Array.from({ length: 4 }, (_, index) => ({
          title: `Milestone ${index + 1}: infrastructure work package`,
          description: index % 2 === 0 ? LONG_TEXT : "",
          remarks: index % 3 === 0 ? "On track; vendor confirmed delivery." : "",
        })),
        photos: Array.from({ length: 3 }, (_, index) => ({
          fileName: `site-photo-${index + 1}.webp`,
          fileUrl: cdn("image", `DEAN-ADMIN/photos/site-photo-${index + 1}.webp`),
        })),
      }),
      dailyRecord("d3", "2026-09-10", {
        dailyUpdates: [{ title: "-Negative start", description: "\t=1+1 tab-prefixed formula" }],
      }),
    ],
    [
      visitor("v1", "2026-09-07", "09:05", "10:30", {
        name: "Dr. Anita Sharma",
        importance: "HIGH",
        remarks: "Discussed collaboration, executive education.",
        photos: [{ fileName: "visitor-badge.png", fileUrl: cdn("image", "DEAN-ADMIN/photos/visitor-badge.png") }],
      }),
      visitor("v2", "2026-09-07", "14:15", null, {
        name: '=HYPERLINK("http://evil.example","click")',
        purpose: "-2+3",
        remarks: " =1+1 leading space",
        importance: "LOW",
      }),
      visitor("v3", "2026-09-08", "23:45", "23:59", {
        name: "Mr. Rajesh Kumar Venkataraman",
        purpose: `Vendor presentation for the campus Wi-Fi upgrade. ${LONG_TEXT}`,
        remarks: LONG_TEXT,
        documents: [{ fileName: "proposal-wifi.docx", fileUrl: cdn("raw", "DEAN-ADMIN/documents/proposal-wifi.docx") }],
      }),
    ],
  );

  const hr = section(
    { id: "64f000000000000000000002", name: "Human Resources", code: "HR" },
    [],
    Array.from({ length: 30 }, (_, index) =>
      visitor(`h${index}`, index < 15 ? "2026-09-09" : "2026-09-11", `${String(9 + (index % 8)).padStart(2, "0")}:00`, index % 4 === 0 ? null : "17:00", {
        name: `Candidate ${index + 1}`,
        purpose: "Interview for administrative officer position",
        importance: (["HIGH", "MEDIUM", "LOW"] as const)[index % 3],
      }),
    ),
  );

  const empty = section(
    { id: "64f000000000000000000003", name: "XLRI Leadership & Excellence Academy", code: "XLEAD" },
    [],
    [],
  );

  const sections = [dean, hr, empty];
  return {
    meta: {
      systemName: APP_NAME,
      officeLabel: "All Offices",
      officeId: null,
      type: "weekly",
      typeLabel: "Weekly Report",
      from: "2026-09-07",
      to: "2026-09-13",
      rangeLabel: "07 Sep 2026 – 13 Sep 2026",
      generatedAt: SAMPLE_GENERATED_AT,
      generatedBy: "Komal Admin",
    },
    sections,
    totals: sumTotals(sections),
  };
}

/** A single-office daily report without any records. */
export function buildEmptyDailyReport(): ReportData {
  const office = section({ id: "64f000000000000000000009", name: "Registrar", code: "REG" }, [], []);
  return {
    meta: {
      systemName: APP_NAME,
      officeLabel: "Registrar",
      officeId: "64f000000000000000000009",
      type: "daily",
      typeLabel: "Daily Report",
      from: "2026-09-12",
      to: "2026-09-12",
      rangeLabel: "12 Sep 2026",
      generatedAt: SAMPLE_GENERATED_AT,
      generatedBy: "User A",
    },
    sections: [office],
    totals: office.totals,
  };
}

/**
 * Strict RFC 4180 parser: CRLF record separators, quoted fields with doubled quotes. Throws on a bare LF
 * or CR outside quotes, on text after a closing quote, or on an unterminated quoted field.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let index = 0;
  let quoted = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = "";
    quoted = false;
    fieldStarted = false;
  };

  while (index < text.length) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        const next = text[index];
        if (next !== undefined && next !== "," && next !== "\r") {
          throw new Error(`Unexpected character after closing quote at ${index}`);
        }
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && !fieldStarted && field === "") {
      quoted = true;
      fieldStarted = true;
      index += 1;
      continue;
    }
    if (char === ",") {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      if (text[index + 1] !== "\n") throw new Error(`Bare CR at ${index}`);
      endField();
      rows.push(row);
      row = [];
      index += 2;
      continue;
    }
    if (char === "\n") throw new Error(`Bare LF outside quotes at ${index}`);
    if (char === '"') throw new Error(`Unescaped quote inside unquoted field at ${index}`);
    field += char;
    fieldStarted = true;
    index += 1;
  }
  if (quoted) throw new Error("Unterminated quoted field");
  if (field !== "" || row.length > 0) {
    endField();
    rows.push(row);
  }
  return rows;
}

/** Characters that make a spreadsheet treat a cell as a formula (OWASP CSV injection). */
export const FORMULA_START = /^(?:[=+\-@\t\r\n]|\s+[=+\-@])/;
