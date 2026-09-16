import { ArrowLeftIcon, FileTextIcon, PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DocumentList, PhotoGallery } from "@/components/shared/attachment-list";
import { DeleteRecordButton } from "@/components/shared/delete-record-button";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { getDailyMilestone } from "@/lib/services/daily-milestones";
import { formatBusinessDate, formatDateTime } from "@/lib/utils/dates";
import { buildHref } from "@/lib/utils/search-params";
import { pluralize } from "@/lib/utils/strings";
import type { DailyMilestoneDTO } from "@/types";

export const metadata: Metadata = {
  title: "Daily Record",
};

export default async function DailyRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;

  let record: DailyMilestoneDTO;
  try {
    record = await getDailyMilestone(user, id);
  } catch (error) {
    return renderPageError(error);
  }

  const officeName = record.office?.name ?? "Unknown office";
  const longDate = formatBusinessDate(record.date, "long");
  const reportHref = buildHref("/reports", { type: "daily", date: record.date, officeId: record.officeId });

  const summary = [
    { label: "Office", value: record.office ? `${record.office.name} (${record.office.code})` : officeName },
    { label: "Date", value: longDate },
    { label: "Created by", value: record.createdBy?.name ?? "—" },
    { label: "Last updated", value: formatDateTime(record.updatedAt) },
  ];

  return (
    <>
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/daily-updates">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Back to daily updates
          </Link>
        </Button>
        <PageHeader
          title={longDate}
          description={`Daily record · ${officeName}`}
          actions={
            <>
              <Button asChild variant="outline">
                <Link href={reportHref}>
                  <FileTextIcon data-icon="inline-start" aria-hidden="true" />
                  View daily report
                </Link>
              </Button>
              <Button asChild>
                <Link href={`/daily-updates/${record.id}/edit`}>
                  <PencilIcon data-icon="inline-start" aria-hidden="true" />
                  Edit
                </Link>
              </Button>
              {isAdmin(user) ? (
                <DeleteRecordButton
                  endpoint={`/api/daily-milestones/${record.id}`}
                  redirectTo="/daily-updates"
                  title="Delete this daily record?"
                  description="The daily update, its milestones and all attached files will be permanently deleted. This action cannot be undone."
                  successMessage="Daily record deleted."
                />
              ) : null}
            </>
          }
        />
      </div>

      <Card size="sm">
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {summary.map((item) => (
              <div key={item.label} className="min-w-0 space-y-1">
                <dt className="text-muted-foreground text-xs font-medium">{item.label}</dt>
                <dd className="text-sm font-medium break-words">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Daily update</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <h3 className="text-lg font-semibold break-words">{record.dailyUpdate.title}</h3>
          <p className="leading-relaxed break-words whitespace-pre-wrap">{record.dailyUpdate.description}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <h2>Milestones</h2>
            <Badge variant="secondary" className="tabular-nums">
              {record.milestones.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            {pluralize(record.milestones.length, "milestone")} recorded for this date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {record.milestones.length === 0 ? (
            <p className="text-muted-foreground text-sm">No milestones have been added yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {record.milestones.map((milestone, index) => (
                <li
                  key={index}
                  id={`milestone-${index + 1}`}
                  className="target:border-primary target:bg-primary/5 flex scroll-mt-20 gap-3 rounded-lg border p-4"
                >
                  <span
                    aria-hidden="true"
                    className="bg-muted flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="font-medium break-words">{milestone.title}</h3>
                    {milestone.description ? (
                      <p className="leading-relaxed break-words whitespace-pre-wrap">
                        {milestone.description}
                      </p>
                    ) : null}
                    {milestone.remarks ? (
                      <p className="text-muted-foreground break-words whitespace-pre-wrap">
                        <span className="text-foreground font-medium">Remarks: </span>
                        {milestone.remarks}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Photos</h2>
            </CardTitle>
            <CardDescription>{pluralize(record.photos.length, "photo")}</CardDescription>
          </CardHeader>
          <CardContent>
            <PhotoGallery photos={record.photos} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Documents</h2>
            </CardTitle>
            <CardDescription>{pluralize(record.documents.length, "document")}</CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentList documents={record.documents} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
