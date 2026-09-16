import type { NextRequest } from "next/server";

import { jsonOk, withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/permissions";
import { reportToCsv } from "@/lib/reports/csv";
import { reportFileName } from "@/lib/reports/filename";
import { generateReport } from "@/lib/reports/generate";
import { renderReportPdf } from "@/lib/reports/pdf";
import { reportToXlsx } from "@/lib/reports/xlsx";
import { searchParamsToObject } from "@/lib/utils/search-params";
import { reportQuerySchema } from "@/lib/validation/report";

// PDF and Excel rendering need Node.js APIs.
export const runtime = "nodejs";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function fileResponse(body: Uint8Array<ArrayBuffer>, contentType: string, fileName: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * GET /api/reports?type=&date=&month=&from=&to=&officeId=&format=json|pdf|csv|xlsx
 * Normal users are always limited to their own office (403 for another office or "all").
 */
export const GET = withApi(async (request: NextRequest) => {
  const user = await requireAuth();
  const params = searchParamsToObject(request.nextUrl.searchParams);
  const data = await generateReport(user, params);
  // Already validated by generateReport; parsed again only to read the output format.
  const { format } = reportQuerySchema.parse(params);

  switch (format) {
    case "csv":
      return fileResponse(
        new TextEncoder().encode(reportToCsv(data)),
        "text/csv; charset=utf-8",
        reportFileName(data.meta, "csv"),
      );
    case "xlsx":
      return fileResponse(new Uint8Array(await reportToXlsx(data)), XLSX_CONTENT_TYPE, reportFileName(data.meta, "xlsx"));
    case "pdf":
      return fileResponse(new Uint8Array(await renderReportPdf(data)), "application/pdf", reportFileName(data.meta, "pdf"));
    default:
      return jsonOk(data);
  }
});
