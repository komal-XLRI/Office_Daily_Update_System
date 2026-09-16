import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { OfficeForm } from "@/components/offices/office-form";
import { AccessDenied } from "@/components/shared/access-denied";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isAdmin, requirePageUser } from "@/lib/permissions";

export const metadata: Metadata = { title: "Add office" };

export default async function NewOfficePage() {
  const user = await requirePageUser();
  if (!isAdmin(user)) return <AccessDenied message="Administrator access is required." />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add office"
        description="Create a new office. Users and records can be assigned to active offices."
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
          <CardTitle>
            <h2>Office details</h2>
          </CardTitle>
          <CardDescription>All fields are required.</CardDescription>
        </CardHeader>
        <CardContent>
          <OfficeForm />
        </CardContent>
      </Card>
    </div>
  );
}
