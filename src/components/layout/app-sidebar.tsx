"use client";

import {
  Building2Icon,
  CircleUserIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  FileTextIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/shared/badges";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { apiRequest, getErrorMessage } from "@/lib/api/client";
import type { Role } from "@/types";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Extra route prefixes that keep this item highlighted (sections with more than one route). */
  alsoMatches?: string[];
}

// Spec §25. Admin-only items are hidden for users; the pages and APIs also enforce this server-side.
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  // Visitors are a view inside Daily Updates, so they share this entry instead of having their own.
  { href: "/daily-updates", label: "Daily Updates", icon: ClipboardListIcon, alsoMatches: ["/visitors"] },
  { href: "/reports", label: "Reports", icon: FileTextIcon },
  { href: "/offices", label: "Offices", icon: Building2Icon, adminOnly: true },
  { href: "/users", label: "Users", icon: UsersIcon, adminOnly: true },
  { href: "/profile", label: "Profile", icon: CircleUserIcon },
];

export interface SidebarUser {
  name: string;
  email: string;
  role: Role;
  officeName: string | null;
}

export function AppSidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const [signingOut, setSigningOut] = useState(false);

  const items = NAV_ITEMS.filter((item) => !item.adminOnly || user.role === "admin");

  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

  async function handleLogout() {
    setSigningOut(true);
    try {
      await apiRequest<unknown>("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not sign out. Please try again."));
      setSigningOut(false);
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard" onClick={closeOnMobile}>
                <Image
                  src="/xlri-logo.png"
                  alt="XLRI"
                  width={676}
                  height={290}
                  className="h-8 w-auto shrink-0 group-data-[collapsible=icon]:hidden"
                />
                <span className="hidden aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground group-data-[collapsible=icon]:flex">
                  <ClipboardCheckIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Office Daily Updates</span>
                  <span className="truncate text-xs text-muted-foreground">Milestone Management</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Main">
              <SidebarMenu>
                {items.map((item) => {
                  const active = [item.href, ...(item.alsoMatches ?? [])].some(
                    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
                  );
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href} aria-current={active ? "page" : undefined} onClick={closeOnMobile}>
                          <item.icon aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="flex flex-col gap-1 rounded-lg border bg-background px-3 py-2 text-sm group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium" title={user.name}>
              {user.name}
            </span>
            <RoleBadge role={user.role} />
          </div>
          <span className="truncate text-xs text-muted-foreground" title={user.email}>
            {user.email}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {user.officeName ?? (user.role === "admin" ? "All offices" : "No office")}
          </span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} disabled={signingOut} tooltip="Logout">
              <LogOutIcon aria-hidden="true" />
              <span>{signingOut ? "Signing out..." : "Logout"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
