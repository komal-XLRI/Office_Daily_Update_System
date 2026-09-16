import type { NextRequest } from "next/server";

import { getRouteId, jsonOk, parseJsonBody, withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/permissions";
import { deleteVisitor, getVisitor, updateVisitor } from "@/lib/services/visitors";
import { visitorUpdateSchema } from "@/lib/validation/visitor";

type VisitorRouteContext = { params: Promise<{ id: string }> };

/** GET /api/visitors/:id */
export const GET = withApi(async (_request: NextRequest, context: VisitorRouteContext) => {
  const user = await requireAuth();
  const id = await getRouteId(context, "Visitor");
  const visitor = await getVisitor(user, id);
  return jsonOk(visitor);
});

/**
 * PATCH /api/visitors/:id — full form payload plus `expectedUpdatedAt` (the record's updatedAt, ISO).
 * The visitor's office cannot be changed; a stale `expectedUpdatedAt` → 409 CONFLICT.
 */
export const PATCH = withApi(async (request: NextRequest, context: VisitorRouteContext) => {
  const user = await requireAuth();
  const id = await getRouteId(context, "Visitor");
  const input = await parseJsonBody(request, visitorUpdateSchema);
  const visitor = await updateVisitor(user, id, input);
  return jsonOk(visitor);
});

/** DELETE /api/visitors/:id */
export const DELETE = withApi(async (_request: NextRequest, context: VisitorRouteContext) => {
  const user = await requireAuth();
  const id = await getRouteId(context, "Visitor");
  await deleteVisitor(user, id);
  return jsonOk({ id });
});
