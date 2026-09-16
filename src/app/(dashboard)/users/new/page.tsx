import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UserForm } from "@/components/users/user-form";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import { listOfficeOptions } from "@/lib/services/office-options";
import type { OfficeOption } from "@/types";

export const metadata: Metadata = {
  title: "Add user",
};

export default async function NewUserPage() {
  const currentUser = await requirePageUser();
  if (!isAdmin(currentUser)) return <AccessDenied message="Administrator access is required to manage users." />;

  let offices: OfficeOption[];
  try {
    offices = await listOfficeOptions({ includeInactive: true });
  } catch (error) {
    return renderPageError(error);
  }

  return (
    <>
      <PageHeader
        title="Add user"
        description="Create an account. The user signs in with a one-time code sent to their email."
        actions={
          <Button asChild variant="outline">
            <Link href="/users">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              Back to users
            </Link>
          </Button>
        }
      />
      <Card className="w-full max-w-3xl">
        <CardHeader>
          <CardTitle>
            <h2>User details</h2>
          </CardTitle>
          <CardDescription>Normal users must be assigned to an office. Administrators can access all offices.</CardDescription>
        </CardHeader>
        <CardContent>
          <UserForm offices={offices} />
        </CardContent>
      </Card>
    </>
  );
}
