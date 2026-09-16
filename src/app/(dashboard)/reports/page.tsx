import { FileDownIcon, FileSpreadsheetIcon, FileTextIcon, PrinterIcon, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { loadReport } from "@/components/reports/load-report";
import { ReportDocument } from "@/components/reports/report-document";
import { ReportForm } from "@/components/reports/report-form";
import { ReportQueryAlert } from "@/components/reports/report-query-alert";
import {
  initialReportFormValues,
  pickReportParams,
  toReportParams,
} from "@/components/reports/report-query";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import type { ReportData } from "@/lib/reports/types";
import { listOfficeOptions } from "@/lib/services/office-options";
import { formatDateTime } from "@/lib/utils/dates";
import { buildHref, normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import type { CurrentUser, OfficeOption, ReportFormat } from "@/types";

export const metadata: Metadata = {
  title: "Reports",
};

const DOWNLOADS: { format: Exclude<ReportFormat, "json">; label: string; icon: LucideIcon }[] = [
  { format: "pdf", label: "Download PDF", icon: FileDownIcon },
  { format: "csv", label: "Download CSV", icon: FileTextIcon },
  { format: "xlsx", label: "Download Excel", icon: FileSpreadsheetIcon },
];

function GeneratedReport({ report, params }: { report: ReportData; params: Record<string, string> }) {
  const { meta } = report;
  return (
    <section aria-label="Generated report" className="space-y-4">
      <Card size="sm">
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">
              {meta.typeLabel} · {meta.rangeLabel}
            </p>
            <p className="text-muted-foreground">
              {meta.officeLabel} · Generated on {formatDateTime(meta.generatedAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <a href={buildHref("/reports/print", params)} target="_blank" rel="noopener noreferrer">
                <PrinterIcon data-icon="inline-start" aria-hidden="true" />
                Print
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
            {DOWNLOADS.map(({ format, label, icon: Icon }) => (
              <Button key={format} asChild variant="outline">
                <a href={buildHref("/api/reports", { ...params, format })} download>
                  <Icon data-icon="inline-start" aria-hidden="true" />
                  {label}
                </a>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="rounded-xl border bg-card p-4 sm:p-8">
        <ReportDocument report={report} />
      </div>
    </section>
  );
}

async function renderReportResult(user: CurrentUser, params: Record<string, string>): Promise<ReactNode> {
  try {
    const result = await loadReport(user, params);
    if (result.status === "empty") {
      return (
        <EmptyState
          icon={FileTextIcon}
          title="No report generated yet"
          description="Choose the report type, date and office above, then select Generate report."
        />
      );
    }
    if (result.status === "invalid") return <ReportQueryAlert messages={result.messages} />;
    return (
      <GeneratedReport
        report={result.report}
        params={toReportParams(result.query, { includeOffice: isAdmin(user) })}
      />
    );
  } catch (error) {
    return renderPageError(error);
  }
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePageUser();
  const params = normalizeSearchParams(await searchParams);
  const admin = isAdmin(user);

  const [offices, result] = await Promise.all([
    admin ? listOfficeOptions({ includeInactive: true }) : Promise.resolve<OfficeOption[]>([]),
    renderReportResult(user, params),
  ]);

  // Remount the form whenever the URL query changes so it always reflects the report shown.
  const formKey = new URLSearchParams(pickReportParams(params, { includeOffice: admin })).toString();

  return (
    <>
      <PageHeader
        title="Reports"
        description="Reports are generated on demand from daily records and visitors."
      />
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Report options</h2>
          </CardTitle>
          <CardDescription>
            {admin
              ? "Choose a report type, the period and one office or all offices."
              : "Choose a report type and the period. Reports cover your assigned office."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReportForm
            key={formKey}
            initialValues={initialReportFormValues(params, admin)}
            canSelectOffice={admin}
            offices={offices}
            officeName={user.officeName}
          />
        </CardContent>
      </Card>
      {result}
    </>
  );
}
