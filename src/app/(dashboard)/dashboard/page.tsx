import type { Metadata } from "next";

import { AdminDashboard } from "@/components/dashboard/admin-dashboard";
import { UserDashboard } from "@/components/dashboard/user-dashboard";
import { renderPageError } from "@/lib/page-errors";
import { isAdmin, requirePageUser } from "@/lib/permissions";
import {
  getAdminDashboard,
  getUserDashboard,
  type AdminDashboardData,
  type UserDashboardData,
} from "@/lib/services/dashboard";
import { listOfficeOptions } from "@/lib/services/office-options";
import { normalizeSearchParams, type RawSearchParams } from "@/lib/utils/search-params";
import type { OfficeOption } from "@/types";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePageUser();

  if (!isAdmin(user)) {
    // Normal users only ever see their own office; any officeId in the URL is ignored.
    let data: UserDashboardData;
    try {
      data = await getUserDashboard(user);
    } catch (error) {
      return renderPageError(error);
    }
    return <UserDashboard data={data} />;
  }

  const { officeId } = normalizeSearchParams(await searchParams);
  let data: AdminDashboardData;
  let offices: OfficeOption[];
  try {
    [data, offices] = await Promise.all([getAdminDashboard(user, officeId), listOfficeOptions()]);
  } catch (error) {
    return renderPageError(error);
  }
  return <AdminDashboard data={data} offices={offices} />;
}
