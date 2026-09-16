"use client";

import { PowerIcon, PowerOffIcon } from "lucide-react";
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
import type { OfficeDTO } from "@/types";

import { OFFICE_ACTIVATION_NOTE, OFFICE_DEACTIVATION_WARNING } from "./constants";

interface OfficeStatusToggleProps {
  office: Pick<OfficeDTO, "id" | "name" | "isActive">;
}

/** Activate/deactivate an office after confirmation (PATCH /api/offices/:id). */
export function OfficeStatusToggle({ office }: OfficeStatusToggleProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const deactivating = office.isActive;
  const actionLabel = deactivating ? "Deactivate" : "Activate";
  const Icon = deactivating ? PowerOffIcon : PowerIcon;

  async function handleConfirm() {
    setPending(true);
    try {
      await apiRequest<OfficeDTO>(`/api/offices/${office.id}`, {
        method: "PATCH",
        body: { isActive: !office.isActive },
      });
      toast.success(
        deactivating ? `${office.name} has been deactivated.` : `${office.name} has been activated.`,
      );
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error, "The office status could not be changed. Please try again."));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={`${actionLabel} ${office.name}`}>
          <Icon data-icon="inline-start" aria-hidden="true" />
          {actionLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {actionLabel} {office.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {deactivating ? OFFICE_DEACTIVATION_WARNING : OFFICE_ACTIVATION_NOTE}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant={deactivating ? "destructive" : "default"}
            className={deactivating ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
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
