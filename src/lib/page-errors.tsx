import "server-only";

import { notFound } from "next/navigation";
import type { ReactElement } from "react";

import { AccessDenied } from "@/components/shared/access-denied";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

/**
 * For Server Component pages that call services:
 *
 *   let visitor;
 *   try { visitor = await getVisitor(user, id); } catch (error) { return renderPageError(error); }
 *
 * NotFoundError → notFound(); ForbiddenError → <AccessDenied />; anything else is rethrown to error.tsx.
 */
export function renderPageError(error: unknown): ReactElement {
  if (error instanceof NotFoundError) notFound();
  if (error instanceof ForbiddenError) return <AccessDenied message={error.message} />;
  throw error;
}
