import type { Metadata } from "next";

import { ProfileDetails } from "@/components/profile/profile-details";
import { PageHeader } from "@/components/shared/page-header";
import { renderPageError } from "@/lib/page-errors";
import { requirePageUser } from "@/lib/permissions";
import { getProfile } from "@/lib/services/users";
import type { UserDTO } from "@/types";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function ProfilePage() {
  const currentUser = await requirePageUser();

  let profile: UserDTO;
  try {
    profile = await getProfile(currentUser);
  } catch (error) {
    return renderPageError(error);
  }

  return (
    <>
      <PageHeader title="Profile" description="Your account details." />
      <ProfileDetails profile={profile} />
    </>
  );
}
