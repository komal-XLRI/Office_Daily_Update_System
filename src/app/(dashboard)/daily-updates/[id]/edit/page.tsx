import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DailyMilestoneForm } from "@/components/daily-updates/daily-milestone-form";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getMaxFileSizeMb } from "@/lib/env";
import { renderPageError } from "@/lib/page-errors";
import { requirePageUser } from "@/lib/permissions";
import { getDailyMilestone } from "@/lib/services/daily-milestones";
import { formatBusinessDate } from "@/lib/utils/dates";
import type { DailyMilestoneDTO } from "@/types";

export const metadata: Metadata = {
  title: "Edit Daily Update",
};

export default async function EditDailyUpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;

  let record: DailyMilestoneDTO;
  try {
    record = await getDailyMilestone(user, id);
  } catch (error) {
    return renderPageError(error);
  }

  const officeName = record.office?.name ?? "Unknown office";

  return (
    <>
      <div className="flex flex-col gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
          <Link href={`/daily-updates/${record.id}`}>
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Back to daily record
          </Link>
        </Button>
        <PageHeader
          title="Edit Daily Update"
          description={`${officeName} · ${formatBusinessDate(record.date, "long")}`}
        />
      </div>

      <DailyMilestoneForm
        mode="edit"
        recordId={record.id}
        expectedUpdatedAt={record.updatedAt}
        officeId={record.officeId}
        officeName={officeName}
        defaultValues={{
          date: record.date,
          dailyUpdates: record.dailyUpdates,
          milestones: record.milestones,
          photos: record.photos,
          documents: record.documents,
        }}
        maxFileSizeMb={getMaxFileSizeMb()}
      />
    </>
  );
}
