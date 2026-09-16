import { ArrowLeftIcon, Building2Icon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DailyMilestoneForm } from "@/components/daily-updates/daily-milestone-form";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getMaxFileSizeMb } from "@/lib/env";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { findDailyMilestoneIdForDate } from "@/lib/services/daily-milestones";
import { listOfficeOptions } from "@/lib/services/office-options";
import { isValidBusinessDate, todayBusinessDate } from "@/lib/utils/dates";
import { normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import { isObjectId } from "@/lib/validation/common";
import type { OfficeOption } from "@/types";

export const metadata: Metadata = {
  title: "Add Daily Update",
};

export default async function NewDailyUpdatePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePageUser();
  const admin = isAdmin(user);
  const params = normalizeSearchParams(await searchParams);
  const date = isValidBusinessDate(params.date) ? params.date : todayBusinessDate();
  const requestedOfficeId = isObjectId(params.officeId) ? params.officeId : null;

  let offices: OfficeOption[] = [];
  let preselectedOfficeId: string | null = null;
  let existingId: string | null = null;

  try {
    if (admin) {
      offices = await listOfficeOptions();
      preselectedOfficeId = offices.some((office) => office.id === requestedOfficeId)
        ? requestedOfficeId
        : null;
      if (preselectedOfficeId)
        existingId = await findDailyMilestoneIdForDate(user, preselectedOfficeId, date);
    } else {
      // Normal users are always scoped to their own office; another office in the URL is refused (403).
      existingId = await findDailyMilestoneIdForDate(user, requestedOfficeId, date);
    }
  } catch (error) {
    return renderPageError(error);
  }

  // One record per office per date: continue with the existing record instead of creating a duplicate.
  if (existingId) redirect(`/daily-updates/${existingId}/edit`);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href="/daily-updates">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Back to daily updates
          </Link>
        </Button>
        <PageHeader
          title="Add Daily Update"
          description={
            admin
              ? "Record the daily update, milestones and attachments for an office."
              : `Record the daily update, milestones and attachments for ${user.officeName ?? "your office"}.`
          }
        />
      </div>

      {admin && offices.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title="No active offices"
          description="Activate or add an office before recording daily updates."
          action={
            <Button asChild variant="outline">
              <Link href="/offices">Manage offices</Link>
            </Button>
          }
        />
      ) : (
        <DailyMilestoneForm
          mode="create"
          offices={admin ? offices : undefined}
          officeId={admin ? preselectedOfficeId : user.officeId}
          officeName={admin ? null : user.officeName}
          defaultValues={{
            date,
            dailyUpdate: { title: "", description: "" },
            milestones: [],
            photos: [],
            documents: [],
          }}
          maxFileSizeMb={getMaxFileSizeMb()}
        />
      )}
    </>
  );
}
