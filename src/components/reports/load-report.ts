import "server-only";

import { ZodError } from "zod";

import { isAppError, NotFoundError } from "@/lib/errors";
import { generateReport } from "@/lib/reports/generate";
import type { ReportData } from "@/lib/reports/types";
import { reportQuerySchema, type ReportQuery } from "@/lib/validation/report";
import type { CurrentUser } from "@/types";

import { hasReportQuery, pickReportParams, uniqueMessages } from "./report-query";

export type ReportLoadResult =
  | { status: "empty" }
  | { status: "invalid"; messages: string[] }
  | { status: "ready"; query: ReportQuery; report: ReportData };

function zodMessages(error: ZodError): string[] {
  return uniqueMessages(error.issues.map((issue) => issue.message));
}

/**
 * Validate a report URL query and generate the report (for the /reports page and the print view).
 *
 * All authorization lives in generateReport(). The raw officeId is passed through unchanged, so a
 * normal user who asks for another office gets a ForbiddenError instead of a silently rewritten report.
 * Validation problems resolve to "invalid"; any other error (403, 404, 5xx) is rethrown for renderPageError().
 */
export async function loadReport(user: CurrentUser, params: Record<string, string>): Promise<ReportLoadResult> {
  if (!hasReportQuery(params)) return { status: "empty" };

  const rawQuery = pickReportParams(params);
  const parsed = reportQuerySchema.safeParse(rawQuery);
  if (!parsed.success) return { status: "invalid", messages: zodMessages(parsed.error) };

  try {
    const report = await generateReport(user, rawQuery);
    return { status: "ready", query: parsed.data, report };
  } catch (error) {
    if (error instanceof ZodError) return { status: "invalid", messages: zodMessages(error) };
    // e.g. an admin deep link to an office that no longer exists: keep the form usable instead of a 404 page.
    if (error instanceof NotFoundError) return { status: "invalid", messages: [error.message] };
    if (isAppError(error) && error.status === 400) {
      const fieldMessages = Object.values(error.fieldErrors ?? {}).flat();
      return {
        status: "invalid",
        messages: uniqueMessages(fieldMessages.length > 0 ? fieldMessages : [error.message]),
      };
    }
    throw error;
  }
}
