import Image from "next/image";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { logServerError } from "@/lib/api/handler";
import { APP_NAME } from "@/lib/constants";
import { getCurrentUser } from "@/lib/permissions";
import { safeRedirectPath } from "@/lib/utils/safe-redirect";
import { normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import type { CurrentUser } from "@/types";

export const metadata: Metadata = {
  title: "Sign in",
};

async function loadSignedInUser(): Promise<CurrentUser | null> {
  try {
    return await getCurrentUser();
  } catch (error) {
    // Still show the sign-in form if the session check fails (e.g. database unavailable).
    logServerError("login", error);
    return null;
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = normalizeSearchParams(await searchParams);
  const nextPath = safeRedirectPath(params.next);

  const user = await loadSignedInUser();
  if (user) redirect(nextPath);

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <Card>
        <CardHeader className="gap-3 text-center">
          <Image
            src="/xlri-logo.png"
            alt="XLRI – Xavier School of Management"
            width={676}
            height={290}
            priority
            className="mx-auto h-auto w-44"
          />
          <CardTitle>
            <h1 className="text-lg font-semibold text-balance">{APP_NAME}</h1>
          </CardTitle>
          <CardDescription>Sign in with a one-time code sent to your registered email.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm nextPath={nextPath} sessionExpired={params.expired === "1"} />
        </CardContent>
      </Card>
      <p className="text-muted-foreground px-4 text-center text-xs">
        Access is limited to registered staff. Contact the administrator if you need an account.
      </p>
    </div>
  );
}
