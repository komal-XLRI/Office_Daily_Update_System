import type { NextRequest } from "next/server";

import { jsonOk, parseJsonBody, parseQuery, withApi } from "@/lib/api/handler";
import { requireAuth } from "@/lib/permissions";
import { createDailyMilestone, listDailyMilestones, listMilestones } from "@/lib/services/daily-milestones";
import { dailyMilestoneInputSchema, dailyMilestoneListQuerySchema } from "@/lib/validation/daily-milestone";

/**
 * GET  /api/daily-milestones                  → Paginated<DailyMilestoneDTO>
 * GET  /api/daily-milestones?view=milestones  → Paginated<MilestoneListItem>
 *      filters: officeId (admin only), date | from/to, q, page, pageSize
 * POST /api/daily-milestones                  → DailyMilestoneDTO (201); 409 with details.existingId on duplicates
 */

export const GET = withApi(async (request: NextRequest) => {
  const user = await requireAuth();
  const query = parseQuery(request, dailyMilestoneListQuerySchema);
  const result =
    query.view === "milestones" ? await listMilestones(user, query) : await listDailyMilestones(user, query);
  return jsonOk(result);
});

export const POST = withApi(async (request: NextRequest) => {
  const user = await requireAuth();
  const body = await parseJsonBody(request, dailyMilestoneInputSchema);
  const record = await createDailyMilestone(user, body);
  return jsonOk(record, { status: 201 });
});
