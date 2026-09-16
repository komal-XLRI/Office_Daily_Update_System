import { EyeIcon, PencilIcon } from "lucide-react";
import Link from "next/link";

import { ImportanceBadge } from "@/components/shared/badges";
import { DeleteRecordButton } from "@/components/shared/delete-record-button";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDate, formatTime } from "@/lib/utils/dates";
import type { VisitorDTO } from "@/types";

interface VisitorTableProps {
  visitors: VisitorDTO[];
  /** Admins see the Office column (spec §16). */
  showOffice: boolean;
}

export function VisitorTable({ visitors, showOffice }: VisitorTableProps) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="px-3">Visitor</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Arrival</TableHead>
            <TableHead>Departure</TableHead>
            <TableHead>Importance</TableHead>
            {showOffice ? <TableHead>Office</TableHead> : null}
            <TableHead className="px-3 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visitors.map((visitor) => (
            <TableRow key={visitor.id}>
              <TableCell className="px-3 font-medium">
                <Link
                  href={`/visitors/${visitor.id}`}
                  className="rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {visitor.name}
                </Link>
              </TableCell>
              <TableCell>
                <span className="block max-w-64 truncate" title={visitor.purpose}>
                  {visitor.purpose}
                </span>
              </TableCell>
              <TableCell className="tabular-nums">{formatBusinessDate(visitor.date)}</TableCell>
              <TableCell className="tabular-nums">{formatTime(visitor.timeArrived)}</TableCell>
              <TableCell className="tabular-nums">
                {visitor.timeDeparted ? formatTime(visitor.timeDeparted) : "—"}
              </TableCell>
              <TableCell>
                <ImportanceBadge importance={visitor.importance} />
              </TableCell>
              {showOffice ? <TableCell>{visitor.office?.name ?? "—"}</TableCell> : null}
              <TableCell className="px-3">
                <div className="flex items-center justify-end gap-1">
                  <Button asChild variant="ghost" size="icon-sm">
                    <Link href={`/visitors/${visitor.id}`} aria-label={`View visitor ${visitor.name}`}>
                      <EyeIcon aria-hidden="true" />
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="icon-sm">
                    <Link href={`/visitors/${visitor.id}/edit`} aria-label={`Edit visitor ${visitor.name}`}>
                      <PencilIcon aria-hidden="true" />
                    </Link>
                  </Button>
                  <DeleteRecordButton
                    endpoint={`/api/visitors/${visitor.id}`}
                    title="Delete this visitor?"
                    successMessage="Visitor deleted."
                    label={`Delete visitor ${visitor.name}`}
                    variant="icon"
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
