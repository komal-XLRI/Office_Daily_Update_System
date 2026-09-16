import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { requirePageUser } from "@/lib/permissions";

/**
 * Authenticated application shell. Layouts do not re-render on client navigation, so every page
 * must still call requirePageUser() (and services enforce office scope) on its own.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar
        user={{ name: user.name, email: user.email, role: user.role, officeName: user.officeName }}
      />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <p className="min-w-0 truncate text-sm font-medium">
            {user.role === "admin" ? "Administrator · All offices" : (user.officeName ?? "Office")}
          </p>
        </header>
        <main id="main-content" className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 p-4 md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
