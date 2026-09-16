import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { VisitorForm } from "@/components/visitors/visitor-form";
import { getMaxFileSizeMb } from "@/lib/env";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { listOfficeOptions } from "@/lib/services/office-options";
import { todayBusinessDate, toTimeInputValue } from "@/lib/utils/dates";
import type { VisitorInput } from "@/lib/validation/visitor";
import type { OfficeOption } from "@/types";

export const metadata: Metadata = {
  title: "Add visitor",
};

export default async function NewVisitorPage() {
  const user = await requirePageUser();
  const admin = isAdmin(user);

  let offices: OfficeOption[] | undefined;
  let maxFileSizeMb: number;
  try {
    offices = admin ? await listOfficeOptions() : undefined;
    maxFileSizeMb = getMaxFileSizeMb();
  } catch (error) {
    return renderPageError(error);
  }

  const now = new Date();
  const defaultValues: VisitorInput = {
    name: "",
    purpose: "",
    date: todayBusinessDate(now),
    timeArrived: toTimeInputValue(now),
    timeDeparted: "",
    importance: "MEDIUM",
    photos: [],
    documents: [],
    remarks: "",
  };

  return (
    <>
      <PageHeader
        title="Add visitor"
        description={admin ? "Record a visitor for an office." : `Record a visitor for ${user.officeName ?? "your office"}.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/visitors">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              Back to visitors
            </Link>
          </Button>
        }
      />
      <VisitorForm
        mode="create"
        offices={offices}
        officeId={admin ? null : user.officeId}
        defaultValues={defaultValues}
        maxFileSizeMb={maxFileSizeMb}
      />
    </>
  );
}
