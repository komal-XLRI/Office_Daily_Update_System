import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { VisitorForm } from "@/components/visitors/visitor-form";
import { getMaxFileSizeMb } from "@/lib/env";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { getVisitor } from "@/lib/services/visitors";
import { toTimeInputValue } from "@/lib/utils/dates";
import type { VisitorInput } from "@/lib/validation/visitor";
import type { VisitorDTO } from "@/types";

export const metadata: Metadata = {
  title: "Edit visitor",
};

export default async function EditVisitorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;

  let visitor: VisitorDTO;
  let maxFileSizeMb: number;
  try {
    visitor = await getVisitor(user, id);
    maxFileSizeMb = getMaxFileSizeMb();
  } catch (error) {
    return renderPageError(error);
  }

  const defaultValues: VisitorInput = {
    name: visitor.name,
    purpose: visitor.purpose,
    date: visitor.date,
    timeArrived: toTimeInputValue(visitor.timeArrived),
    timeDeparted: toTimeInputValue(visitor.timeDeparted),
    importance: visitor.importance,
    photos: visitor.photos,
    documents: visitor.documents,
    remarks: visitor.remarks,
  };

  return (
    <>
      <PageHeader
        title="Edit visitor"
        description={visitor.name}
        actions={
          <Button asChild variant="outline">
            <Link href={`/visitors/${visitor.id}`}>
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              Back to visitor
            </Link>
          </Button>
        }
      />
      <VisitorForm
        mode="edit"
        visitorId={visitor.id}
        officeId={visitor.officeId}
        officeName={isAdmin(user) ? (visitor.office?.name ?? null) : null}
        defaultValues={defaultValues}
        maxFileSizeMb={maxFileSizeMb}
        expectedUpdatedAt={visitor.updatedAt}
      />
    </>
  );
}
