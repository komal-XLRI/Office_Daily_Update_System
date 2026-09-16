import { CalendarDaysIcon, CalendarIcon, CalendarRangeIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBusinessDate, formatBusinessDateRange, formatMonth, weekRange } from "@/lib/utils/dates";
import { buildHref } from "@/lib/utils/search-params";

interface QuickReportCardProps {
  today: string;
  month: string;
  /** Office id or "all". Omit for normal users (the server always uses their own office). */
  officeId?: string;
  /** Scope shown to the reader, e.g. "All Offices" or the office name. */
  scopeLabel: string;
  className?: string;
}

export function QuickReportCard({ today, month, officeId, scopeLabel, className }: QuickReportCardProps) {
  const week = weekRange(today);
  const links = [
    {
      label: "Today",
      detail: formatBusinessDate(today),
      icon: CalendarIcon,
      href: buildHref("/reports", { type: "daily", date: today, officeId }),
    },
    {
      label: "This week",
      detail: formatBusinessDateRange(week.from, week.to),
      icon: CalendarRangeIcon,
      href: buildHref("/reports", { type: "weekly", date: today, officeId }),
    },
    {
      label: "This month",
      detail: formatMonth(month),
      icon: CalendarDaysIcon,
      href: buildHref("/reports", { type: "monthly", month, officeId }),
    },
  ];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>Quick report</h2>
        </CardTitle>
        <CardDescription>Open a report for {scopeLabel}.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {links.map(({ label, detail, icon: Icon, href }) => (
            <li key={label}>
              <Link
                href={href}
                className="flex items-center gap-3 rounded-lg border px-3 py-2.5 outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter>
        <Link
          href={buildHref("/reports", { officeId })}
          className="rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Custom date range and export options
        </Link>
      </CardFooter>
    </Card>
  );
}
