import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";

import { RoleBadge, StatusBadge } from "@/components/shared/badges";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { initials } from "@/lib/utils/strings";
import type { UserDTO } from "@/types";

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children}</dd>
    </div>
  );
}

function officeLabel(profile: UserDTO): ReactNode {
  if (profile.office) {
    return (
      <>
        {profile.office.name}
        {profile.office.code ? <span className="ml-1 text-muted-foreground">({profile.office.code})</span> : null}
      </>
    );
  }
  if (profile.role === "admin") return "All offices (administrator)";
  return <span className="text-muted-foreground">Not assigned</span>;
}

/** Read-only account details for the signed-in user (spec §24). Role and office are managed by admins only. */
export function ProfileDetails({ profile }: { profile: UserDTO }) {
  return (
    <Card className="w-full max-w-3xl">
      <CardHeader className="border-b">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-foreground"
          >
            {initials(profile.name)}
          </span>
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="truncate text-lg">
              <h2 className="truncate">{profile.name}</h2>
            </CardTitle>
            <CardDescription className="truncate">{profile.email}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
          <DetailItem label="Name">{profile.name}</DetailItem>
          <DetailItem label="Email">{profile.email}</DetailItem>
          <DetailItem label="Designation">
            {profile.designation || <span className="text-muted-foreground">Not specified</span>}
          </DetailItem>
          <DetailItem label="Role">
            <RoleBadge role={profile.role} />
          </DetailItem>
          <DetailItem label="Office">{officeLabel(profile)}</DetailItem>
          <DetailItem label="Account status">
            <StatusBadge isActive={profile.isActive} />
          </DetailItem>
        </dl>
      </CardContent>
      <CardFooter className="gap-2 text-sm text-muted-foreground">
        <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
        <p>Contact the administrator to change your role or office.</p>
      </CardFooter>
    </Card>
  );
}
