"use client";

import { Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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

/** Focus the page heading (or main landmark) so keyboard users are not dropped on <body>. */
function focusStableElement() {
  const target = document.querySelector<HTMLElement>("#main-content h1") ?? document.getElementById("main-content");
  if (!target) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

interface DeleteRecordButtonProps {
  /** API endpoint accepting DELETE, e.g. `/api/visitors/${id}`. */
  endpoint: string;
  /** Navigate here after deleting. Omit to stay on the page and refresh it. */
  redirectTo?: string;
  /** e.g. "Delete this visitor?" */
  title: string;
  description?: string;
  successMessage?: string;
  label?: string;
  /** "icon" renders a compact icon-only trigger (for table rows). */
  variant?: "button" | "icon";
}

/** Destructive action with an accessible confirmation dialog (spec §41). */
export function DeleteRecordButton({
  endpoint,
  redirectTo,
  title,
  description = "This action cannot be undone.",
  successMessage = "Deleted successfully.",
  label = "Delete",
  variant = "button",
}: DeleteRecordButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const restoreFocusRef = useRef(false);

  async function handleDelete() {
    setPending(true);
    try {
      await apiRequest<unknown>(endpoint, { method: "DELETE" });
      toast.success(successMessage);
      // The trigger usually disappears with the deleted record; move focus somewhere stable instead.
      if (!redirectTo) restoreFocusRef.current = true;
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <AlertDialogTrigger asChild>
        {variant === "icon" ? (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={label}>
            <Trash2Icon aria-hidden="true" />
          </Button>
        ) : (
          <Button type="button" variant="destructive" className="text-red-700 dark:text-red-300">
            <Trash2Icon data-icon="inline-start" aria-hidden="true" />
            {label}
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          if (!restoreFocusRef.current) return;
          restoreFocusRef.current = false;
          event.preventDefault();
          focusStableElement();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={pending}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
