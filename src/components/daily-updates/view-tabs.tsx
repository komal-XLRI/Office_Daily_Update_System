import Link from "next/link";

import { cn } from "@/lib/utils";
import { buildHref } from "@/lib/utils/search-params";

export type DailyUpdatesView = "records" | "milestones";

const TABS: { view: DailyUpdatesView; label: string }[] = [
  { view: "records", label: "Daily records" },
  { view: "milestones", label: "Milestones" },
];

/** Link-based view switcher for /daily-updates that keeps the current filters (and resets the page). */
export function DailyUpdatesViewTabs({
  view,
  filters,
}: {
  view: DailyUpdatesView;
  filters: Record<string, string | undefined>;
}) {
  return (
    <nav aria-label="Daily updates views">
      <ul className="bg-muted inline-flex h-9 items-center gap-1 rounded-lg p-[3px]">
        {TABS.map((tab) => {
          const active = tab.view === view;
          const href = buildHref("/daily-updates", {
            ...filters,
            page: undefined,
            view: tab.view === "milestones" ? "milestones" : undefined,
          });
          return (
            <li key={tab.view} className="h-full">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-full items-center rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-foreground/70 hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
