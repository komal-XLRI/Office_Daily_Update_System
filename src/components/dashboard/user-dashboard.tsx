import { ClipboardPlusIcon, FileTextIcon, PencilIcon, UserPlusIcon } from "lucide-react";
import Link from "next/link";

import { ImportanceBadge } from "@/components/shared/badges";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RecentRecordItem, UserDashboardData } from "@/lib/services/dashboard";
import { formatBusinessDate, formatTime } from "@/lib/utils/dates";
import { buildHref } from "@/lib/utils/search-params";
import type { DailyMilestoneDTO, VisitorDTO } from "@/types";

const MILESTONES_PREVIEW_LIMIT = 6;

const inlineLinkClass =
  "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function UserDashboard({ data }: { data: UserDashboardData }) {
  const { today, office, todayRecord } = data;
  const recordHref = todayRecord
    ? `/daily-updates/${todayRecord.id}/edit`
    : buildHref("/daily-updates/new", { date: today });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={office.name}
        description={<time dateTime={today}>{formatBusinessDate(today, "long")}</time>}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/visitors/new">
                <UserPlusIcon data-icon="inline-start" aria-hidden="true" />
                Add visitor
              </Link>
            </Button>
            <Button asChild>
              <Link href={recordHref}>
                {todayRecord ? (
                  <PencilIcon data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <ClipboardPlusIcon data-icon="inline-start" aria-hidden="true" />
                )}
                {todayRecord ? "Update today's record" : "Add today's update"}
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={buildHref("/reports", { type: "daily", date: today })}>
                <FileTextIcon data-icon="inline-start" aria-hidden="true" />
                Office report
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <TodayUpdateCard record={todayRecord} today={today} />
        <TodayMilestonesCard record={todayRecord} />
        <TodayVisitorsCard visitors={data.todaysVisitors} count={data.todaysVisitorCount} today={today} />
        <RecentRecordsCard records={data.recentRecords} today={today} />
      </div>
    </div>
  );
}

function TodayUpdateCard({ record, today }: { record: DailyMilestoneDTO | null; today: string }) {
  const attachmentSummary = record
    ? [
        record.photos.length > 0 ? plural(record.photos.length, "photo") : null,
        record.documents.length > 0 ? plural(record.documents.length, "document") : null,
      ].filter(Boolean)
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Today&apos;s update</h2>
        </CardTitle>
        <CardDescription>{formatBusinessDate(today)}</CardDescription>
        {record ? (
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/daily-updates/${record.id}`}>View record</Link>
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {record ? (
          <div className="space-y-2">
            {record.dailyUpdates.map((update, index) => (
              <div key={`${index}-${update.title}`} className="space-y-1">
                <h3 className="font-medium break-words">{update.title}</h3>
                <p className="line-clamp-6 break-words whitespace-pre-line text-muted-foreground">
                  {update.description}
                </p>
              </div>
            ))}
            {record.createdBy || attachmentSummary.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {[record.createdBy ? `Recorded by ${record.createdBy.name}` : null, ...attachmentSummary]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">No daily update has been recorded for this date.</p>
            <Button asChild size="sm" variant="outline">
              <Link href={buildHref("/daily-updates/new", { date: today })}>
                <ClipboardPlusIcon data-icon="inline-start" aria-hidden="true" />
                Add today&apos;s update
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TodayMilestonesCard({ record }: { record: DailyMilestoneDTO | null }) {
  const milestones = record?.milestones ?? [];
  const preview = milestones.slice(0, MILESTONES_PREVIEW_LIMIT);
  const hiddenCount = milestones.length - preview.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Today&apos;s milestones</h2>
        </CardTitle>
        <CardDescription>
          {milestones.length > 0 ? plural(milestones.length, "milestone") : "Milestones in today's record"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {preview.length === 0 ? (
          <p className="text-sm text-muted-foreground">No milestones have been added yet.</p>
        ) : (
          <div className="space-y-3">
            <ol className="space-y-3">
              {preview.map((milestone, index) => (
                <li key={index} className="flex gap-3">
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium break-words">{milestone.title}</p>
                    {milestone.description ? (
                      <p className="line-clamp-2 break-words text-muted-foreground">{milestone.description}</p>
                    ) : null}
                    {milestone.remarks ? (
                      <p className="line-clamp-2 text-xs break-words text-muted-foreground">
                        Remarks: {milestone.remarks}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
            {record && hiddenCount > 0 ? (
              <Link href={`/daily-updates/${record.id}`} className={`text-sm ${inlineLinkClass}`}>
                View {plural(hiddenCount, "more milestone")}
              </Link>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TodayVisitorsCard({ visitors, count, today }: { visitors: VisitorDTO[]; count: number; today: string }) {
  const description =
    count > visitors.length
      ? `Showing the first ${visitors.length} of ${count} visitors by arrival`
      : `${plural(count, "visitor")} on ${formatBusinessDate(today)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Today&apos;s visitors</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href={buildHref("/visitors", { date: today })}>View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {visitors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No visitors found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col">Purpose</TableHead>
                <TableHead scope="col">Arrival</TableHead>
                <TableHead scope="col">Importance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visitors.map((visitor) => (
                <TableRow key={visitor.id}>
                  <TableHead scope="row" className="font-medium">
                    <Link href={`/visitors/${visitor.id}`} className={inlineLinkClass}>
                      {visitor.name}
                    </Link>
                  </TableHead>
                  <TableCell className="max-w-48 truncate" title={visitor.purpose}>
                    {visitor.purpose}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <time dateTime={visitor.timeArrived}>{formatTime(visitor.timeArrived)}</time>
                  </TableCell>
                  <TableCell>
                    <ImportanceBadge importance={visitor.importance} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function RecentRecordsCard({ records, today }: { records: RecentRecordItem[]; today: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Recent records</h2>
        </CardTitle>
        <CardDescription>Latest daily records for your office.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href="/daily-updates">View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {records.length === 0 ? (
          <p className="text-sm text-muted-foreground">No daily updates have been recorded yet.</p>
        ) : (
          <ul className="divide-y">
            {records.map((record) => (
              <li key={record.id}>
                <Link
                  href={`/daily-updates/${record.id}`}
                  className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2.5 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{record.title || "Untitled record"}</span>
                    <span className="block text-xs text-muted-foreground">
                      <time dateTime={record.date}>{formatBusinessDate(record.date)}</time>
                      {record.date === today ? " · Today" : null}
                    </span>
                  </span>
                  <Badge variant="secondary" className="tabular-nums">
                    {plural(record.milestoneCount, "milestone")}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
