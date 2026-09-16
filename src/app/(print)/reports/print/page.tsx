import { FileTextIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { loadReport } from "@/components/reports/load-report";
import { PrintToolbar } from "@/components/reports/print-toolbar";
import { ReportDocument } from "@/components/reports/report-document";
import { ReportQueryAlert } from "@/components/reports/report-query-alert";
import { pickReportParams, toReportParams } from "@/components/reports/report-query";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { REPORT_TYPE_LABELS, reportRangeLabel } from "@/lib/reports/labels";
import { buildHref, normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import { reportQuerySchema, resolveReportRange } from "@/lib/validation/report";
import type { CurrentUser } from "@/types";

interface PrintReportPageProps {
  searchParams: Promise<RawSearchParams>;
}

/** The title becomes the default file name when the browser saves the page as PDF. */
export async function generateMetadata({ searchParams }: PrintReportPageProps): Promise<Metadata> {
  const parsed = reportQuerySchema.safeParse(pickReportParams(normalizeSearchParams(await searchParams)));
  if (!parsed.success) return { title: "Print report" };
  const { from, to } = resolveReportRange(parsed.data);
  return { title: `${REPORT_TYPE_LABELS[parsed.data.type]} · ${reportRangeLabel(parsed.data.type, from, to)}` };
}

interface PrintView {
  content: ReactNode;
  ready: boolean;
  backHref: string;
}

async function buildPrintView(user: CurrentUser, params: Record<string, string>): Promise<PrintView> {
  const admin = isAdmin(user);
  // Normal users never carry an officeId back into the reports page.
  const fallbackBackHref = buildHref("/reports", pickReportParams(params, { includeOffice: admin }));
  const heading = <h1 className="sr-only">Print report</h1>;

  try {
    const result = await loadReport(user, params);
    if (result.status === "ready") {
      return {
        content: <ReportDocument report={result.report} titleLevel={1} />,
        ready: true,
        backHref: buildHref("/reports", toReportParams(result.query, { includeOffice: admin })),
      };
    }
    if (result.status === "invalid") {
      return {
        content: (
          <>
            {heading}
            <ReportQueryAlert messages={result.messages} />
          </>
        ),
        ready: false,
        backHref: fallbackBackHref,
      };
    }
    return {
      content: (
        <>
          {heading}
          <EmptyState
            icon={FileTextIcon}
            title="No report selected"
            description="Choose the report options on the Reports page, then select Print."
            action={
              <Button asChild variant="outline">
                <Link href="/reports">Go to reports</Link>
              </Button>
            }
          />
        </>
      ),
      ready: false,
      backHref: "/reports",
    };
  } catch (error) {
    return {
      content: (
        <>
          {heading}
          {renderPageError(error)}
        </>
      ),
      ready: false,
      backHref: "/reports",
    };
  }
}

export default async function PrintReportPage({ searchParams }: PrintReportPageProps) {
  const user = await requirePageUser();
  const params = normalizeSearchParams(await searchParams);
  const view = await buildPrintView(user, params);

  return (
    <>
      <PrintToolbar backHref={view.backHref} canPrint={view.ready} autoPrint={view.ready} />
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 print:max-w-none print:p-0">{view.content}</div>
    </>
  );
}
