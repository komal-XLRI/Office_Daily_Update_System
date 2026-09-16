import { Types } from "mongoose";

import type { ReportData } from "@/lib/reports/types";
import { DailyMilestone, Office, Visitor } from "@/models";

import { apiData, expectApiError, expectStatus, qs, sameMembers } from "../lib/assertions";
import type { E2EContext } from "../lib/context";
import { assert } from "../lib/harness";
import type { HttpClient } from "../lib/http";

/** Spec §59 reports: 4 types x (admin all, admin single office, user own office, user other office), exports, validation. */

interface ReportCase {
  type: "daily" | "weekly" | "monthly" | "custom";
  params: Record<string, string>;
  from: string;
  to: string;
}

const CASES: ReportCase[] = [
  { type: "daily", params: { type: "daily", date: "2026-09-08" }, from: "2026-09-08", to: "2026-09-08" },
  { type: "weekly", params: { type: "weekly", date: "2026-09-08" }, from: "2026-09-07", to: "2026-09-13" },
  { type: "monthly", params: { type: "monthly", month: "2026-09" }, from: "2026-09-01", to: "2026-09-30" },
  { type: "custom", params: { type: "custom", from: "2026-09-08", to: "2026-09-10" }, from: "2026-09-08", to: "2026-09-10" },
];

interface OfficeCounts {
  dailyRecords: number;
  milestones: number;
  visitors: number;
}

const DAY_MS = 86_400_000;
const utcMidnight = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** Expected totals straight from the in-memory database (independent of the app's report code). */
async function expectedCounts(from: string, to: string, officeId: string | null) {
  const filter: Record<string, unknown> = { date: { $gte: utcMidnight(from), $lt: new Date(utcMidnight(to).getTime() + DAY_MS) } };
  if (officeId) filter.officeId = new Types.ObjectId(officeId);
  const [daily, visitors] = await Promise.all([
    DailyMilestone.find(filter).select("officeId milestones").lean(),
    Visitor.find(filter).select("officeId").lean(),
  ]);
  const byOffice = new Map<string, OfficeCounts>();
  const entry = (id: string) => {
    let counts = byOffice.get(id);
    if (!counts) {
      counts = { dailyRecords: 0, milestones: 0, visitors: 0 };
      byOffice.set(id, counts);
    }
    return counts;
  };
  for (const record of daily) {
    const counts = entry(String(record.officeId));
    counts.dailyRecords += 1;
    counts.milestones += record.milestones.length;
  }
  for (const visitor of visitors) entry(String(visitor.officeId)).visitors += 1;
  const totals: OfficeCounts = { dailyRecords: daily.length, milestones: 0, visitors: visitors.length };
  for (const counts of byOffice.values()) totals.milestones += counts.milestones;
  return { totals, byOffice };
}

async function verifyReport(report: ReportData, testCase: ReportCase, scopeOfficeId: string | null, generatedBy: string): Promise<string> {
  const { meta } = report;
  assert(meta.type === testCase.type, `meta.type ${meta.type}`);
  assert(meta.from === testCase.from && meta.to === testCase.to, `range ${meta.from}..${meta.to} != ${testCase.from}..${testCase.to}`);
  assert(meta.officeId === scopeOfficeId, `meta.officeId ${meta.officeId} != ${scopeOfficeId}`);
  assert(meta.generatedBy === generatedBy, `generatedBy ${meta.generatedBy} != ${generatedBy}`);

  const expected = await expectedCounts(testCase.from, testCase.to, scopeOfficeId);
  const totals = report.totals;
  assert(
    totals.dailyRecords === expected.totals.dailyRecords &&
      totals.milestones === expected.totals.milestones &&
      totals.visitors === expected.totals.visitors,
    `totals ${JSON.stringify(totals)} != expected ${JSON.stringify(expected.totals)}`,
  );

  const sectionIds = report.sections.map((section) => section.office.id);
  if (scopeOfficeId) {
    assert(sectionIds.length === 1 && sectionIds[0] === scopeOfficeId, `single-office sections ${sectionIds.join()}`);
  } else {
    const active = await Office.find({ isActive: true }).select("_id").lean();
    const expectedIds = new Set([...active.map((office) => String(office._id)), ...expected.byOffice.keys()]);
    assert(sameMembers(sectionIds, expectedIds), `sections ${sectionIds.length} (${sectionIds.join()}) != active offices + offices with records (${expectedIds.size})`);
  }
  for (const section of report.sections) {
    const counts = expected.byOffice.get(section.office.id) ?? { dailyRecords: 0, milestones: 0, visitors: 0 };
    assert(
      section.dailyRecords.length === counts.dailyRecords && section.visitors.length === counts.visitors,
      `section ${section.office.name}: ${section.dailyRecords.length} records / ${section.visitors.length} visitors != ${JSON.stringify(counts)}`,
    );
    assert(section.totals.milestones === counts.milestones, `section ${section.office.name} milestones ${section.totals.milestones} != ${counts.milestones}`);
  }
  return `${report.sections.length} section(s), totals ${JSON.stringify(totals)}`;
}

async function getReport(client: HttpClient, params: Record<string, string>): Promise<ReportData> {
  return apiData<ReportData>(await client.get(`/api/reports${qs(params)}`), 200);
}

export async function runReportsSection(ctx: E2EContext): Promise<void> {
  const { h, seed, clients } = ctx;
  const { admin, userA } = clients;
  const { A, B } = seed.offices;
  h.section("REPORTS");

  for (const testCase of CASES) {
    await h.check(`${testCase.type}: Admin + all offices -> 200 with one section per office`, async () => {
      const report = await getReport(admin, { ...testCase.params, officeId: "all" });
      const details = await verifyReport(report, testCase, null, seed.users.admin.name);
      const implicit = await getReport(admin, testCase.params);
      assert(implicit.sections.length === report.sections.length && implicit.meta.officeId === null, "no officeId should mean all offices for admin");
      return details;
    });
    await h.check(`${testCase.type}: Admin + single office (A) -> 200 with one section`, async () => {
      const report = await getReport(admin, { ...testCase.params, officeId: A.id });
      return verifyReport(report, testCase, A.id, seed.users.admin.name);
    });
    await h.check(`${testCase.type}: User A + own office -> 200 limited to Office A`, async () => {
      const report = await getReport(userA, testCase.params);
      const details = await verifyReport(report, testCase, A.id, seed.users.userA.name);
      const explicit = await getReport(userA, { ...testCase.params, officeId: A.id });
      assert(explicit.meta.officeId === A.id, "explicit own officeId should be allowed");
      assert(!JSON.stringify(report).includes(seed.keywords.b), "User A report contains Office B data");
      return details;
    });
    await h.check(`${testCase.type}: User A + Office B -> 403 and officeId=all -> 403`, async () => {
      expectApiError(await userA.get(`/api/reports${qs({ ...testCase.params, officeId: B.id })}`), 403, "FORBIDDEN");
      expectApiError(await userA.get(`/api/reports${qs({ ...testCase.params, officeId: "all" })}`), 403, "FORBIDDEN");
    });
  }

  await h.check("daily report content: Office A section has the revised record, 3 milestones and 3 visitors", async () => {
    const report = await getReport(admin, { type: "daily", date: "2026-09-08", officeId: A.id });
    const section = report.sections[0];
    assert(section?.dailyRecords[0]?.dailyUpdate.title.includes(seed.keywords.a), `record title ${section?.dailyRecords[0]?.dailyUpdate.title}`);
    assert(section.dailyRecords[0].milestones.length === 3, `milestones ${section.dailyRecords[0].milestones.length}`);
    const visitorNames = section.visitors.map((visitor) => visitor.name);
    assert(sameMembers(visitorNames, ["Ravi Kumar", "Anita Sharma", "Sita Devi"]), `visitors ${visitorNames.join()}`);
    const arrivals = section.visitors.map((visitor) => visitor.timeArrived);
    assert(arrivals.every((value, index) => index === 0 || arrivals[index - 1] <= value), `visitors not sorted by arrival: ${arrivals.join()}`);
  });

  await h.check("format=pdf (admin all offices and User A) -> application/pdf attachment starting with %PDF-", async () => {
    for (const [client, params] of [
      [admin, { type: "weekly", date: "2026-09-08", officeId: "all", format: "pdf" }],
      [userA, { type: "daily", date: "2026-09-08", format: "pdf" }],
    ] as const) {
      const response = await client.get(`/api/reports${qs(params)}`);
      expectStatus(response, 200);
      assert(response.contentType.startsWith("application/pdf"), `content-type ${response.contentType}`);
      assert(response.bytes.subarray(0, 5).toString("latin1") === "%PDF-", `body starts with ${JSON.stringify(response.bytes.subarray(0, 8).toString("latin1"))}`);
      assert(/attachment;\s*filename=".+\.pdf"/.test(response.headers.get("content-disposition") ?? ""), `content-disposition ${response.headers.get("content-disposition")}`);
    }
  });

  await h.check("format=csv -> text/csv with UTF-8 BOM; User A export has no Office B data", async () => {
    const response = await userA.get(`/api/reports${qs({ type: "monthly", month: "2026-09", format: "csv" })}`);
    expectStatus(response, 200);
    assert(response.contentType.startsWith("text/csv"), `content-type ${response.contentType}`);
    assert(response.bytes[0] === 0xef && response.bytes[1] === 0xbb && response.bytes[2] === 0xbf, "missing UTF-8 BOM");
    const text = response.text;
    assert(text.includes("Daily Updates & Milestones") && text.includes("Ravi Kumar"), "CSV is missing expected content");
    assert(!text.includes(seed.keywords.b), "User A CSV contains Office B data");
    assert(/attachment;\s*filename=".+\.csv"/.test(response.headers.get("content-disposition") ?? ""), `content-disposition ${response.headers.get("content-disposition")}`);
    const adminCsv = await admin.get(`/api/reports${qs({ type: "daily", date: "2026-09-08", officeId: "all", format: "csv" })}`);
    expectStatus(adminCsv, 200);
    assert(adminCsv.text.includes(seed.keywords.b) && adminCsv.text.includes(seed.keywords.a), "admin all-offices CSV should contain both offices");
  });

  await h.check("format=xlsx -> spreadsheet content type, body starts with PK", async () => {
    const response = await admin.get(`/api/reports${qs({ type: "custom", from: "2026-09-08", to: "2026-09-10", officeId: B.id, format: "xlsx" })}`);
    expectStatus(response, 200);
    assert(response.contentType.includes("spreadsheetml.sheet"), `content-type ${response.contentType}`);
    assert(response.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), "body is not a ZIP/XLSX");
  });

  await h.check("User A export for Office B (pdf/csv/xlsx) -> 403 JSON, no file", async () => {
    for (const format of ["pdf", "csv", "xlsx"]) {
      const response = await userA.get(`/api/reports${qs({ type: "daily", date: "2026-09-08", officeId: B.id, format })}`);
      expectApiError(response, 403, "FORBIDDEN");
      assert(!response.headers.get("content-disposition"), `${format}: a file was returned`);
    }
  });

  await h.check("invalid report queries -> 400 INVALID_INPUT", async () => {
    const invalid: Array<Record<string, string>> = [
      { type: "daily" },
      { type: "quarterly", date: "2026-09-08" },
      { type: "monthly", month: "2026-13" },
      { type: "custom", from: "2026-09-10", to: "2026-09-01" },
      { type: "custom", from: "2025-01-01", to: "2026-09-01" },
      { type: "daily", date: "2026-09-08", format: "docx" },
      { type: "daily", date: "2026-09-08", officeId: "not-an-id" },
      { type: "weekly", date: "08-09-2026" },
    ];
    for (const params of invalid) {
      const error = expectApiError(await admin.get(`/api/reports${qs(params)}`), 400, "INVALID_INPUT");
      assert(error.fieldErrors && Object.keys(error.fieldErrors).length > 0, `no fieldErrors for ${JSON.stringify(params)}`);
    }
    return `${invalid.length} invalid queries rejected`;
  });

  await h.check("Admin report for a well-formed but unknown office id -> 404", async () => {
    expectApiError(await admin.get(`/api/reports${qs({ type: "daily", date: "2026-09-08", officeId: "0123456789abcdef01234567" })}`), 404, "NOT_FOUND");
  });
}
