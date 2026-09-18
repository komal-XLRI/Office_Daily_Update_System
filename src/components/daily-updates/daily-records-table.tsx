import { EyeIcon, PencilIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBusinessDate, formatDateTime } from "@/lib/utils/dates";
import { pluralize, truncate } from "@/lib/utils/strings";
import type { DailyMilestoneDTO } from "@/types";

interface DailyRecordsTableProps {
  records: DailyMilestoneDTO[];
  /** Show the Office column (admins). */
  showOffice: boolean;
}

export function DailyRecordsTable({ records, showOffice }: DailyRecordsTableProps) {
  return (
    <div className="bg-card ring-foreground/10 overflow-x-auto rounded-xl ring-1">
      <Table>
        <TableCaption className="sr-only">Daily records</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Date</TableHead>
            {showOffice ? <TableHead>Office</TableHead> : null}
            <TableHead>Daily update</TableHead>
            <TableHead className="text-center">Milestones</TableHead>
            <TableHead>Attachments</TableHead>
            <TableHead>Last updated</TableHead>
            <TableHead className="pr-4 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => {
            const dateLabel = formatBusinessDate(record.date);
            const recordLabel =
              showOffice && record.office ? `${dateLabel}, ${record.office.name}` : dateLabel;
            return (
              <TableRow key={record.id}>
                <TableCell className="pl-4 font-medium tabular-nums">{dateLabel}</TableCell>
                {showOffice ? (
                  <TableCell>
                    <span className="block">{record.office?.name ?? "—"}</span>
                    {record.office?.code ? (
                      <span className="text-muted-foreground block text-xs">{record.office.code}</span>
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell className="max-w-md min-w-64 whitespace-normal">
                  <span className="block font-medium">{record.dailyUpdates[0]?.title ?? "—"}</span>
                  <span className="text-muted-foreground block">
                    {truncate(record.dailyUpdates[0]?.description ?? "", 140)}
                  </span>
                  {record.dailyUpdates.length > 1 ? (
                    <span className="text-muted-foreground block text-xs">
                      +{record.dailyUpdates.length - 1} more update
                      {record.dailyUpdates.length - 1 === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary" className="tabular-nums">
                    {record.milestones.length}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <span className="block">{pluralize(record.photos.length, "photo")}</span>
                  <span className="block">{pluralize(record.documents.length, "document")}</span>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {formatDateTime(record.updatedAt)}
                </TableCell>
                <TableCell className="pr-4">
                  <div className="flex justify-end gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/daily-updates/${record.id}`}
                        aria-label={`View daily record for ${recordLabel}`}
                      >
                        <EyeIcon data-icon="inline-start" aria-hidden="true" />
                        View
                      </Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={`/daily-updates/${record.id}/edit`}
                        aria-label={`Edit daily record for ${recordLabel}`}
                      >
                        <PencilIcon data-icon="inline-start" aria-hidden="true" />
                        Edit
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
