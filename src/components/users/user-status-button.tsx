"use client";

import { UserCheckIcon, UserXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest, getErrorMessage } from "@/lib/api/client";
import type { UserDTO } from "@/types";

interface UserStatusButtonProps {
  userId: string;
  userName: string;
  isActive: boolean;
}

/** Activate/deactivate a user after confirmation (spec §41, §43). Users are never deleted. */
export function UserStatusButton({ userId, userName, isActive }: UserStatusButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const actionLabel = isActive ? "Deactivate" : "Activate";

  async function handleConfirm() {
    setPending(true);
    try {
      await apiRequest<UserDTO>(`/api/users/${userId}`, { method: "PATCH", body: { isActive: !isActive } });
      toast.success(isActive ? "User deactivated successfully." : "User activated successfully.");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error, "The user status could not be updated. Please try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={isActive ? "destructive" : "outline"}
          size="sm"
          className={isActive ? "text-red-700 dark:text-red-300" : undefined}
        >
          {isActive ? (
            <UserXIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <UserCheckIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {actionLabel}
          <span className="sr-only"> {userName}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isActive ? "Deactivate this user?" : "Activate this user?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {isActive
              ? `${userName} will no longer be able to sign in. Their historical records will be kept.`
              : `${userName} will be able to sign in again.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant={isActive ? "destructive" : "default"}
            className={isActive ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {actionLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
