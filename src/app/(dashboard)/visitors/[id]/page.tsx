import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DeleteRecordButton } from "@/components/shared/delete-record-button";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { VisitorDetails } from "@/components/visitors/visitor-details";
import { renderPageError } from "@/lib/page-errors";
import { requirePageUser } from "@/lib/permissions";
import { getVisitor } from "@/lib/services/visitors";
import { formatBusinessDate } from "@/lib/utils/dates";
import type { VisitorDTO } from "@/types";

export const metadata: Metadata = {
  title: "Visitor details",
};

export default async function VisitorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;

  let visitor: VisitorDTO;
  try {
    visitor = await getVisitor(user, id);
  } catch (error) {
    return renderPageError(error);
  }

  return (
    <>
      <PageHeader
        title={visitor.name}
        description={`Visitor on ${formatBusinessDate(visitor.date)}${visitor.office ? ` · ${visitor.office.name}` : ""}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/visitors">
                <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
                Back to visitors
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/visitors/${visitor.id}/edit`}>
                <PencilIcon data-icon="inline-start" aria-hidden="true" />
                Edit
              </Link>
            </Button>
            <DeleteRecordButton
              endpoint={`/api/visitors/${visitor.id}`}
              redirectTo="/visitors"
              title="Delete this visitor?"
              successMessage="Visitor deleted."
            />
          </>
        }
      />
      <VisitorDetails visitor={visitor} />
    </>
  );
}
