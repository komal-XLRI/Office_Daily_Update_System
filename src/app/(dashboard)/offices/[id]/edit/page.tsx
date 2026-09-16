import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { OfficeForm } from "@/components/offices/office-form";
import { AccessDenied } from "@/components/shared/access-denied";
import { StatusBadge } from "@/components/shared/badges";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { getOffice } from "@/lib/services/offices";
import { formatDateTime } from "@/lib/utils/dates";
import type { OfficeDTO } from "@/types";

export const metadata: Metadata = { title: "Edit office" };

export default async function EditOfficePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  if (!isAdmin(user)) return <AccessDenied message="Administrator access is required." />;

  const { id } = await params;
  let office: OfficeDTO;
  try {
    office = await getOffice(user, id);
  } catch (error) {
    return renderPageError(error);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Edit office"
        description={`Update the details for ${office.name}.`}
        actions={
          <Button asChild variant="outline">
            <Link href="/offices">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              Back to offices
            </Link>
          </Button>
        }
      />
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Office details</CardTitle>
          <CardDescription>Last updated {formatDateTime(office.updatedAt)}</CardDescription>
          <CardAction>
            <StatusBadge isActive={office.isActive} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <OfficeForm office={office} />
        </CardContent>
      </Card>
    </div>
  );
}
