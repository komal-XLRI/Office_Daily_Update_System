import { CircleCheckIcon, CircleDashedIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OfficeActivityRow } from "@/lib/services/dashboard";
import { formatBusinessDate, formatMonth } from "@/lib/utils/dates";
import { buildHref } from "@/lib/utils/search-params";

interface OfficeActivityTableProps {
  rows: OfficeActivityRow[];
  today: string;
  month: string;
}

export function OfficeActivityTable({ rows, today, month }: OfficeActivityTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Office-wise activity</h2>
        </CardTitle>
        <CardDescription>
          Daily updates, milestones and visitors for {formatBusinessDate(today)}, with records for {formatMonth(month)}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active offices found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Office</TableHead>
                <TableHead scope="col">Today&apos;s update</TableHead>
                <TableHead scope="col" className="text-right">
                  Today&apos;s visitors
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Today&apos;s milestones
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Records this month
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.office.id}>
                  <TableHead scope="row" className="font-medium">
                    {row.office.name}
                  </TableHead>
                  <TableCell>
                    {row.todayRecordId ? (
                      <Badge
                        asChild
                        variant="outline"
                        className="border-emerald-200 bg-emerald-50 text-emerald-800"
                      >
                        <Link
                          href={`/daily-updates/${row.todayRecordId}`}
                          aria-label={`Recorded: view today's update for ${row.office.name}`}
                        >
                          <CircleCheckIcon aria-hidden="true" />
                          Recorded
                        </Link>
                      </Badge>
                    ) : (
                      <Badge asChild variant="outline" className="text-muted-foreground">
                        <Link
                          href={buildHref("/daily-updates/new", { officeId: row.office.id, date: today })}
                          aria-label={`Not recorded: add today's update for ${row.office.name}`}
                        >
                          <CircleDashedIcon aria-hidden="true" />
                          Not recorded
                        </Link>
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{row.todaysVisitors}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.todaysMilestones}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.recordsThisMonth}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function OfficeActivityTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card aria-hidden="true">
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}
