import { getRouteId, jsonOk, parseJsonBody, withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/permissions";
import { getUser, updateUser } from "@/lib/services/users";
import { userUpdateSchema } from "@/lib/validation/user";

interface UserRouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/users/:id — admin only. */
export const GET = withApi<UserRouteContext>(async (_request, context) => {
  const user = await requireAdmin();
  const id = await getRouteId(context, "User");
  const result = await getUser(user, id);
  return jsonOk(result);
});

/**
 * PATCH /api/users/:id — admin only. Partial body, e.g. `{ isActive: false }` to deactivate.
 * There is intentionally no DELETE (users are deactivated, spec §43) and no self-service endpoint
 * that accepts role or officeId.
 */
export const PATCH = withApi<UserRouteContext>(async (request, context) => {
  const user = await requireAdmin();
  const id = await getRouteId(context, "User");
  const patch = await parseJsonBody(request, userUpdateSchema);
  const result = await updateUser(user, id, patch);
  return jsonOk(result);
});
