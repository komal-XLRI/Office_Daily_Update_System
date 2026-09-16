import { ArrowUpRightIcon } from "lucide-react";
import Link from "next/link";

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
import type { MilestoneListItem } from "@/lib/services/daily-milestones";
import { formatBusinessDate } from "@/lib/utils/dates";
import { truncate } from "@/lib/utils/strings";

interface MilestonesTableProps {
  milestones: MilestoneListItem[];
  /** Show the Office column (admins). */
  showOffice: boolean;
}

export function MilestonesTable({ milestones, showOffice }: MilestonesTableProps) {
  return (
    <div className="bg-card ring-foreground/10 overflow-x-auto rounded-xl ring-1">
      <Table>
        <TableCaption className="sr-only">Milestones</TableCaption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Date</TableHead>
            {showOffice ? <TableHead>Office</TableHead> : null}
            <TableHead>Milestone</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Remarks</TableHead>
            <TableHead className="pr-4 text-right">Record</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {milestones.map((milestone) => {
            const dateLabel = formatBusinessDate(milestone.date);
            return (
              <TableRow key={`${milestone.recordId}-${milestone.index}`}>
                <TableCell className="pl-4 font-medium tabular-nums">{dateLabel}</TableCell>
                {showOffice ? <TableCell>{milestone.office?.name ?? "—"}</TableCell> : null}
                <TableCell className="max-w-xs min-w-48 font-medium whitespace-normal">
                  {milestone.title}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-md min-w-56 whitespace-normal">
                  {milestone.description ? truncate(milestone.description, 160) : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-xs min-w-40 whitespace-normal">
                  {milestone.remarks ? truncate(milestone.remarks, 100) : "—"}
                </TableCell>
                <TableCell className="pr-4 text-right">
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      href={`/daily-updates/${milestone.recordId}#milestone-${milestone.index + 1}`}
                      aria-label={`Open record for milestone "${milestone.title}" on ${dateLabel}`}
                    >
                      Open record
                      <ArrowUpRightIcon data-icon="inline-end" aria-hidden="true" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
