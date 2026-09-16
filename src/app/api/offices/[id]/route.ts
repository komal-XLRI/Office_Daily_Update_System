import { getRouteId, jsonOk, parseJsonBody, withApi } from "@/lib/api/handler";
import { requireAdmin } from "@/lib/permissions";
import { getOffice, updateOffice } from "@/lib/services/offices";
import { officeUpdateSchema } from "@/lib/validation/office";

interface OfficeRouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/offices/:id — admin only. */
export const GET = withApi<OfficeRouteContext>(async (_request, context) => {
  const user = await requireAdmin();
  const id = await getRouteId(context, "Office");
  const office = await getOffice(user, id);
  return jsonOk(office);
});

/**
 * PATCH /api/offices/:id — admin only. Partial body, e.g. `{ isActive: false }` to deactivate.
 * There is intentionally no DELETE: offices are deactivated, never removed (spec §22, §43).
 */
export const PATCH = withApi<OfficeRouteContext>(async (request, context) => {
  const user = await requireAdmin();
  const id = await getRouteId(context, "Office");
  const patch = await parseJsonBody(request, officeUpdateSchema);
  const office = await updateOffice(user, id, patch);
  return jsonOk(office);
});
