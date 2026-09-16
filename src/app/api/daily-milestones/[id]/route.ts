import type { NextRequest } from "next/server";

import { getRouteId, jsonOk, parseJsonBody, withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/permissions";
import {
  deleteDailyMilestone,
  getDailyMilestone,
  updateDailyMilestone,
} from "@/lib/services/daily-milestones";
import { dailyMilestoneUpdateSchema } from "@/lib/validation/daily-milestone";

/**
 * GET    /api/daily-milestones/:id → DailyMilestoneDTO
 * PATCH  /api/daily-milestones/:id → DailyMilestoneDTO. Body includes `expectedUpdatedAt` (the record's updatedAt, ISO).
 *        Office cannot change; 409 with details.existingId on date clash; 409 without it when the record is stale.
 * DELETE /api/daily-milestones/:id → { id } (administrators only)
 */

type Context = { params: Promise<{ id: string }> };

const RESOURCE = "Daily record";

export const GET = withApi(async (_request: NextRequest, context: Context) => {
  const user = await requireAuth();
  const id = await getRouteId(context, RESOURCE);
  return jsonOk(await getDailyMilestone(user, id));
});

export const PATCH = withApi(async (request: NextRequest, context: Context) => {
  const user = await requireAuth();
  const id = await getRouteId(context, RESOURCE);
  const body = await parseJsonBody(request, dailyMilestoneUpdateSchema);
  return jsonOk(await updateDailyMilestone(user, id, body));
});

export const DELETE = withApi(async (_request: NextRequest, context: Context) => {
  const user = await requireAuth();
  const id = await getRouteId(context, RESOURCE);
  await deleteDailyMilestone(user, id);
  return jsonOk({ id });
});
