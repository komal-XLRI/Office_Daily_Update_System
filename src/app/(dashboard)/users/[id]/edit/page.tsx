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
import { getUser } from "@/lib/services/users";
import type { OfficeOption, UserDTO } from "@/types";

export const metadata: Metadata = {
  title: "Edit user",
};

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const currentUser = await requirePageUser();
  if (!isAdmin(currentUser)) return <AccessDenied message="Administrator access is required to manage users." />;

  const { id } = await params;
  let user: UserDTO;
  let offices: OfficeOption[];
  try {
    [user, offices] = await Promise.all([getUser(currentUser, id), listOfficeOptions({ includeInactive: true })]);
  } catch (error) {
    return renderPageError(error);
  }

  const isSelf = user.id === currentUser.id;

  return (
    <>
      <PageHeader
        title="Edit user"
        description={`Update the account details of ${user.name}.`}
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
          <CardTitle>User details</CardTitle>
          <CardDescription>
            {isSelf
              ? "You are editing your own account. Your role and active status can only be changed by another administrator."
              : "Deactivate a user instead of deleting them so their historical records stay intact."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserForm offices={offices} user={user} isSelf={isSelf} />
        </CardContent>
      </Card>
    </>
  );
}
