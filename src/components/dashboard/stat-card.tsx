import type { LucideIcon } from "lucide-react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const numberFormat = new Intl.NumberFormat("en-IN");

interface StatCardProps {
  title: string;
  value: number;
  caption?: string;
  icon: LucideIcon;
}

export function StatCard({ title, value, caption, icon: Icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          <h3>{title}</h3>
        </CardTitle>
        <CardAction>
          <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{numberFormat.format(value)}</p>
        {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
      </CardContent>
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardHeader>
        <Skeleton className="h-4 w-28" />
        <CardAction>
          <Skeleton className="size-8 rounded-lg" />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}
