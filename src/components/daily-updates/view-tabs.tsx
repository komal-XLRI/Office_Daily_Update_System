import Link from "next/link";

import { cn } from "@/lib/utils";
import { buildHref } from "@/lib/utils/search-params";

export type DailyUpdatesView = "records" | "milestones" | "visitors";

/**
 * Views of one section. Visitors live on their own routes but are reached from here, so the sidebar
 * carries a single "Daily Updates" entry (spec §25 navigation, simplified at the client's request).
 */
const TABS: { view: DailyUpdatesView; label: string; pathname: string }[] = [
  { view: "records", label: "Daily records", pathname: "/daily-updates" },
  { view: "milestones", label: "Milestones", pathname: "/daily-updates" },
  { view: "visitors", label: "Visitors", pathname: "/visitors" },
];

/** Filters understood by every view, so switching tabs never produces an "invalid filter" notice. */
export interface SharedViewFilters {
  date?: string;
  from?: string;
  to?: string;
  officeId?: string;
  q?: string;
}

/** Link-based view switcher that keeps the shared filters (and resets the page). */
export function DailyUpdatesViewTabs({
  view,
  filters,
}: {
  view: DailyUpdatesView;
  filters: SharedViewFilters;
}) {
  const shared: SharedViewFilters = {
    date: filters.date,
    from: filters.from,
    to: filters.to,
    officeId: filters.officeId && filters.officeId !== "all" ? filters.officeId : undefined,
    q: filters.q,
  };

  return (
    <nav aria-label="Daily updates views">
      <ul className="bg-muted inline-flex h-9 items-center gap-1 rounded-lg p-[3px]">
        {TABS.map((tab) => {
          const active = tab.view === view;
          const href = buildHref(tab.pathname, {
            ...shared,
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
