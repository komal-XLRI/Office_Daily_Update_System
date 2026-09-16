import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RecentMilestoneItem } from "@/lib/services/dashboard";
import { formatBusinessDate } from "@/lib/utils/dates";

interface RecentMilestonesCardProps {
  milestones: RecentMilestoneItem[];
  /** "View all" destination, e.g. /daily-updates?view=milestones. */
  viewAllHref: string;
  className?: string;
}

export function RecentMilestonesCard({ milestones, viewAllHref, className }: RecentMilestonesCardProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>
          <h2>Recent milestones</h2>
        </CardTitle>
        <CardDescription>Latest milestones from recent daily records.</CardDescription>
        <CardAction>
          <Button asChild variant="ghost" size="sm">
            <Link href={viewAllHref}>View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">No milestones have been added yet.</p>
        ) : (
          <ul className="divide-y">
            {milestones.map((milestone, index) => (
              <li
                key={`${milestone.recordId}-${index}`}
                className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/daily-updates/${milestone.recordId}`}
                    className="rounded-sm font-medium break-words underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {milestone.title}
                  </Link>
                  {milestone.remarks ? (
                    <p className="line-clamp-2 text-muted-foreground">{milestone.remarks}</p>
                  ) : null}
                </div>
                <p className="shrink-0 text-xs text-muted-foreground sm:text-right">
                  {milestone.office ? <span className="block">{milestone.office.name}</span> : null}
                  <time dateTime={milestone.date}>{formatBusinessDate(milestone.date)}</time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
