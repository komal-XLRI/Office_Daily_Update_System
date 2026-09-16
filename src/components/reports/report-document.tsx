import Image from "next/image";
import type { ReactNode } from "react";

import { IMPORTANCE_LABELS } from "@/components/shared/badges";
import { REPORT_EMPTY_MESSAGES } from "@/lib/reports/labels";
import type {
  ReportDailyRecord,
  ReportData,
  ReportOfficeSection,
  ReportTotals,
  ReportVisitor,
} from "@/lib/reports/types";
import { cn } from "@/lib/utils";
import { formatBusinessDate, formatDateTime, formatTime } from "@/lib/utils/dates";
import type { Attachment } from "@/types";

/**
 * Print-friendly HTML report (spec §19, §20). Server-compatible: no hooks, no client-only APIs.
 * Used as the preview on /reports and as the document on /reports/print.
 */

type HeadingLevel = 1 | 2 | 3 | 4;

interface ReportDocumentProps {
  report: ReportData;
  /** Heading level of the report title: 1 on the standalone print view, 2 inside an app page (default). */
  titleLevel?: 1 | 2;
  className?: string;
}

const VISITOR_COLUMNS = ["Name", "Purpose", "Date", "Arrival", "Departure", "Importance", "Remarks"] as const;

const CELL = "border px-2 py-1.5 align-top";
/** On-screen/print preview cap per office section; CSV/XLSX/PDF exports stay complete. */
export const PREVIEW_ROW_LIMIT = 100;

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isSafeUrl(url: string): boolean {
  return /^https:\/\//i.test(url);
}

function Heading({
  level,
  id,
  className,
  children,
}: {
  level: HeadingLevel;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const Tag = `h${level}` as const;
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium wrap-break-word">{value}</dd>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

function Subsection({
  title,
  count,
  level,
  children,
}: {
  title: string;
  count?: string;
  level: HeadingLevel;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <Heading
        level={level}
        className="flex flex-wrap items-baseline gap-x-2 border-b pb-1 text-sm font-semibold break-after-avoid"
      >
        {title}
        {count ? <span className="text-xs font-normal text-muted-foreground">{count}</span> : null}
      </Heading>
      {children}
    </section>
  );
}

function summaryItems(totals: ReportTotals): { label: string; value: number }[] {
  return [
    { label: "Daily records", value: totals.dailyRecords },
    { label: "Milestones", value: totals.milestones },
    { label: "Visitors", value: totals.visitors },
    { label: "Photos", value: totals.photos },
    { label: "Documents", value: totals.documents },
  ];
}

function totalsSummary(totals: ReportTotals): string {
  return [
    countLabel(totals.dailyRecords, "daily record"),
    countLabel(totals.milestones, "milestone"),
    countLabel(totals.visitors, "visitor"),
    countLabel(totals.photos, "photo"),
    countLabel(totals.documents, "document"),
  ].join(" · ");
}

function RecordDate({ date }: { date: string }) {
  return (
    <p className="text-xs font-medium text-muted-foreground">
      <time dateTime={date}>{formatBusinessDate(date, "long")}</time>
    </p>
  );
}

function DailyUpdates({
  records,
  level,
  singleDate,
}: {
  records: ReportDailyRecord[];
  level: HeadingLevel;
  singleDate: boolean;
}) {
  return (
    <Subsection title="Daily Updates" count={records.length > 0 ? `(${records.length})` : undefined} level={level}>
      {records.length === 0 ? (
        <EmptyLine>
          {singleDate ? REPORT_EMPTY_MESSAGES.dailyUpdate : REPORT_EMPTY_MESSAGES.dailyUpdatesInPeriod}
        </EmptyLine>
      ) : (
        <ol className="space-y-4">
          {records.map((record) => (
            <li key={record.id} className="space-y-1 break-inside-avoid">
              <RecordDate date={record.date} />
              <p className="font-semibold wrap-break-word">{record.dailyUpdate.title}</p>
              <p className="wrap-break-word whitespace-pre-wrap">{record.dailyUpdate.description}</p>
            </li>
          ))}
        </ol>
      )}
    </Subsection>
  );
}

function Milestones({ records, level }: { records: ReportDailyRecord[]; level: HeadingLevel }) {
  const withMilestones = records.filter((record) => record.milestones.length > 0);
  const count = withMilestones.reduce((sum, record) => sum + record.milestones.length, 0);

  return (
    <Subsection title="Milestones" count={count > 0 ? `(${count})` : undefined} level={level}>
      {count === 0 ? (
        <EmptyLine>No milestones have been added yet.</EmptyLine>
      ) : (
        <div className="space-y-4">
          {withMilestones.map((record) => (
            <div key={record.id} className="space-y-2">
              <RecordDate date={record.date} />
              <ol className="list-decimal space-y-3 pl-5 marker:text-muted-foreground">
                {record.milestones.map((milestone, index) => (
                  <li key={index} className="space-y-0.5 pl-1 break-inside-avoid">
                    <p className="font-medium wrap-break-word">{milestone.title}</p>
                    {milestone.description ? (
                      <p className="wrap-break-word whitespace-pre-wrap">{milestone.description}</p>
                    ) : null}
                    {milestone.remarks ? (
                      <p className="wrap-break-word whitespace-pre-wrap text-muted-foreground">
                        <span className="font-medium text-foreground">Remarks: </span>
                        {milestone.remarks}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </Subsection>
  );
}

function Visitors({
  visitors,
  officeName,
  level,
}: {
  visitors: ReportVisitor[];
  officeName: string;
  level: HeadingLevel;
}) {
  return (
    <Subsection title="Visitors" count={visitors.length > 0 ? `(${visitors.length})` : undefined} level={level}>
      {visitors.length === 0 ? (
        <EmptyLine>No visitors found.</EmptyLine>
      ) : (
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-collapse text-left text-sm print:text-xs">
            <caption className="sr-only">Visitors, {officeName}</caption>
            <thead className="bg-muted/60 print:bg-transparent">
              <tr>
                {VISITOR_COLUMNS.map((column) => (
                  <th key={column} scope="col" className={cn(CELL, "font-semibold whitespace-nowrap")}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visitors.map((visitor) => (
                <tr key={visitor.id} className="break-inside-avoid">
                  <td className={cn(CELL, "min-w-32 font-medium wrap-break-word print:min-w-0")}>{visitor.name}</td>
                  <td className={cn(CELL, "min-w-44 wrap-break-word whitespace-pre-wrap print:min-w-0")}>
                    {visitor.purpose}
                  </td>
                  <td className={cn(CELL, "whitespace-nowrap")}>
                    <time dateTime={visitor.date}>{formatBusinessDate(visitor.date)}</time>
                  </td>
                  <td className={cn(CELL, "whitespace-nowrap")}>{formatTime(visitor.timeArrived)}</td>
                  <td className={cn(CELL, "whitespace-nowrap")}>{formatTime(visitor.timeDeparted)}</td>
                  <td className={cn(CELL, "whitespace-nowrap", visitor.importance === "HIGH" && "font-semibold")}>
                    {IMPORTANCE_LABELS[visitor.importance]}
                  </td>
                  <td className={cn(CELL, "min-w-44 wrap-break-word whitespace-pre-wrap print:min-w-0")}>
                    {visitor.remarks || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Subsection>
  );
}

interface AttachmentGroup {
  key: string;
  label: string;
  photos: Attachment[];
  documents: Attachment[];
}

function attachmentGroups(records: ReportDailyRecord[], visitors: ReportVisitor[]): AttachmentGroup[] {
  const groups: AttachmentGroup[] = [];
  for (const record of records) {
    if (record.photos.length === 0 && record.documents.length === 0) continue;
    groups.push({
      key: `record-${record.id}`,
      label: `Daily update · ${formatBusinessDate(record.date)}`,
      photos: record.photos,
      documents: record.documents,
    });
  }
  for (const visitor of visitors) {
    if (visitor.photos.length === 0 && visitor.documents.length === 0) continue;
    groups.push({
      key: `visitor-${visitor.id}`,
      label: `Visitor · ${visitor.name} · ${formatBusinessDate(visitor.date)}`,
      photos: visitor.photos,
      documents: visitor.documents,
    });
  }
  return groups;
}

function AttachmentLinks({ label, files }: { label: string; files: Attachment[] }) {
  if (files.length === 0) return null;
  return (
    <div className="grid gap-x-3 gap-y-0.5 @md:grid-cols-[7rem_1fr]">
      <p className="text-muted-foreground">
        {label} ({files.length})
      </p>
      <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-0.5">
        {files.map((file, index) => (
          <li key={`${file.fileUrl}-${index}`} className="min-w-0 break-all">
            {isSafeUrl(file.fileUrl) ? (
              <a
                href={file.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-sm text-primary underline underline-offset-4 outline-none hover:text-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 print:text-black print:no-underline"
              >
                {file.fileName}
              </a>
            ) : (
              <span>{file.fileName}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Attachments({
  records,
  visitors,
  level,
}: {
  records: ReportDailyRecord[];
  visitors: ReportVisitor[];
  level: HeadingLevel;
}) {
  const groups = attachmentGroups(records, visitors);
  const photoCount = groups.reduce((sum, group) => sum + group.photos.length, 0);
  const documentCount = groups.reduce((sum, group) => sum + group.documents.length, 0);

  return (
    <Subsection
      title="Attachments"
      count={
        groups.length > 0
          ? `(${countLabel(photoCount, "photo")}, ${countLabel(documentCount, "document")})`
          : undefined
      }
      level={level}
    >
      {groups.length === 0 ? (
        <EmptyLine>No photos or documents are attached.</EmptyLine>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => (
            <li key={group.key} className="space-y-1 break-inside-avoid">
              <p className="font-medium wrap-break-word">{group.label}</p>
              <AttachmentLinks label="Photos" files={group.photos} />
              <AttachmentLinks label="Documents" files={group.documents} />
            </li>
          ))}
        </ul>
      )}
    </Subsection>
  );
}

function OfficeSection({
  section,
  level,
  singleDate,
  pageBreak,
}: {
  section: ReportOfficeSection;
  level: HeadingLevel;
  singleDate: boolean;
  pageBreak: boolean;
}) {
  const headingId = `report-office-${section.office.id}`;
  const subLevel = Math.min(level + 1, 4) as HeadingLevel;
  const records = section.dailyRecords.slice(0, PREVIEW_ROW_LIMIT);
  const visitors = section.visitors.slice(0, PREVIEW_ROW_LIMIT);
  const truncated = records.length < section.dailyRecords.length || visitors.length < section.visitors.length;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("space-y-6", pageBreak && "border-t-2 pt-8 print:break-before-page print:border-t-0 print:pt-0")}
    >
      <div className="space-y-1 break-after-avoid">
        <Heading level={level} id={headingId} className="text-lg font-semibold wrap-break-word">
          {section.office.name}
          {section.office.code ? (
            <span className="font-normal text-muted-foreground"> ({section.office.code})</span>
          ) : null}
        </Heading>
        <p className="text-xs text-muted-foreground">{totalsSummary(section.totals)}</p>
      </div>
      {truncated ? (
        <p role="note" className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          This preview shows the first {PREVIEW_ROW_LIMIT} daily records and {PREVIEW_ROW_LIMIT} visitors for this
          office. Download the CSV, Excel or PDF export for the complete data.
        </p>
      ) : null}
      <DailyUpdates records={records} level={subLevel} singleDate={singleDate} />
      <Milestones records={records} level={subLevel} />
      <Visitors visitors={visitors} officeName={section.office.name} level={subLevel} />
      <Attachments records={records} visitors={visitors} level={subLevel} />
    </section>
  );
}

export function ReportDocument({ report, titleLevel = 2, className }: ReportDocumentProps) {
  const { meta, sections, totals } = report;
  const sectionLevel = (titleLevel + 1) as HeadingLevel;
  const singleDate = meta.from === meta.to;
  const generatedOn = formatDateTime(meta.generatedAt);

  return (
    <article
      aria-labelledby="report-title"
      className={cn(
        "@container space-y-8 text-sm leading-relaxed text-foreground",
        "print:space-y-6 print:text-black print:[--border:oklch(0.72_0_0)] print:[--muted-foreground:oklch(0.35_0_0)]",
        className,
      )}
    >
      <header className="space-y-5 border-b-2 border-foreground pb-5 break-inside-avoid print:border-black">
        <Image src="/xlri-logo.png" alt="XLRI – Xavier School of Management" width={676} height={290} className="h-14 w-auto" />
        <div className="space-y-1">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{meta.systemName}</p>
          <Heading level={titleLevel} id="report-title" className="text-2xl font-semibold tracking-tight text-balance">
            {meta.typeLabel}
          </Heading>
        </div>
        <dl className="grid gap-x-8 gap-y-3 @lg:grid-cols-2">
          <MetaItem label="Office" value={meta.officeLabel} />
          <MetaItem label={singleDate ? "Date" : "Date range"} value={meta.rangeLabel} />
          <MetaItem label="Generated on" value={generatedOn} />
          <MetaItem label="Generated by" value={meta.generatedBy} />
        </dl>
      </header>

      <section aria-labelledby="report-summary-title" className="space-y-3 break-inside-avoid">
        <Heading level={sectionLevel} id="report-summary-title" className="text-base font-semibold">
          Summary
        </Heading>
        <dl className="grid grid-cols-2 gap-3 @md:grid-cols-3 @xl:grid-cols-5">
          {summaryItems(totals).map((item) => (
            <div key={item.label} className="rounded-lg border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{item.value}</dd>
            </div>
          ))}
        </dl>
        {sections.length > 1 ? (
          <p className="text-xs text-muted-foreground">
            Covers {sections.length} offices. Each office is listed in its own section below.
          </p>
        ) : null}
      </section>

      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-muted-foreground">
          No offices match the selected report options.
        </p>
      ) : (
        sections.map((section, index) => (
          <OfficeSection
            key={section.office.id}
            section={section}
            level={sectionLevel}
            singleDate={singleDate}
            pageBreak={index > 0}
          />
        ))
      )}

      <footer className="border-t pt-3 text-xs text-muted-foreground">
        {meta.systemName} · {meta.typeLabel} · {meta.rangeLabel} · Generated on {generatedOn} by {meta.generatedBy}
      </footer>
    </article>
  );
}
