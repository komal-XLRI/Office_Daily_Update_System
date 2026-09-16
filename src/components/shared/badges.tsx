import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Importance, Role } from "@/types";

export const IMPORTANCE_LABELS: Record<Importance, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

const IMPORTANCE_STYLES: Record<Importance, string> = {
  HIGH: "border-red-200 bg-red-50 text-red-800",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-900",
  LOW: "border-slate-200 bg-slate-50 text-slate-700",
};

export function ImportanceBadge({ importance, className }: { importance: Importance; className?: string }) {
  return (
    <Badge variant="outline" className={cn(IMPORTANCE_STYLES[importance], className)}>
      {IMPORTANCE_LABELS[importance]}
    </Badge>
  );
}

export function StatusBadge({ isActive, className }: { isActive: boolean; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        isActive ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-100 text-slate-600",
        className,
      )}
    >
      {isActive ? "Active" : "Inactive"}
    </Badge>
  );
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  user: "User",
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <Badge variant={role === "admin" ? "default" : "secondary"} className={className}>
      {ROLE_LABELS[role]}
    </Badge>
  );
}
