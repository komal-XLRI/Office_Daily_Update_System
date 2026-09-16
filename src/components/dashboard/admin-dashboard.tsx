import { Building2Icon, ClipboardListIcon, UserCheckIcon, UsersIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import type { AdminDashboardData } from "@/lib/services/dashboard";
import { formatBusinessDate } from "@/lib/utils/dates";
import { buildHref } from "@/lib/utils/search-params";
import type { OfficeOption } from "@/types";

import { OfficeActivityTable } from "./office-activity-table";
import { DashboardOfficeFilter } from "./office-filter-form";
import { QuickReportCard } from "./quick-report-card";
import { RecentMilestonesCard } from "./recent-milestones-card";
import { StatCard } from "./stat-card";

interface AdminDashboardProps {
  data: AdminDashboardData;
  /** Active offices for the selector, in seed order. */
  offices: OfficeOption[];
}

export function AdminDashboard({ data, offices }: AdminDashboardProps) {
  const { today, month, selectedOffice, stats } = data;
  const scopeLabel = selectedOffice ? selectedOffice.name : "All Offices";
  const scopeCaption = selectedOffice ? `In ${selectedOffice.name}` : "Across all offices";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description={
          <>
            <time dateTime={today}>{formatBusinessDate(today, "long")}</time> · {scopeLabel}
          </>
        }
        actions={<DashboardOfficeFilter offices={offices} selectedOffice={selectedOffice} />}
      />

      <section aria-labelledby="dashboard-summary-heading">
        <h2 id="dashboard-summary-heading" className="sr-only">
          Summary for {scopeLabel}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Total offices"
            value={stats.totalOffices}
            caption={`${stats.activeOffices} active`}
            icon={Building2Icon}
          />
          <StatCard title="Active users" value={stats.activeUsers} caption={scopeCaption} icon={UsersIcon} />
          <StatCard
            title="Today's daily updates"
            value={stats.todaysDailyUpdates}
            caption={`Records for ${formatBusinessDate(today)}`}
            icon={ClipboardListIcon}
          />
          <StatCard
            title="Today's visitors"
            value={stats.todaysVisitors}
            caption={scopeCaption}
            icon={UserCheckIcon}
          />
        </div>
      </section>

      <OfficeActivityTable rows={data.officeActivity} today={today} month={month} />

      <div className="grid gap-6 lg:grid-cols-3">
        <RecentMilestonesCard
          className="lg:col-span-2"
          milestones={data.recentMilestones}
          viewAllHref={buildHref("/daily-updates", { view: "milestones", officeId: selectedOffice?.id })}
        />
        <QuickReportCard
          today={today}
          month={month}
          officeId={selectedOffice?.id ?? "all"}
          scopeLabel={scopeLabel}
        />
      </div>
    </div>
  );
}
