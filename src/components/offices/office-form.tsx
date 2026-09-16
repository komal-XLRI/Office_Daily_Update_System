"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ApiClientError, apiRequest, applyFieldErrors, getErrorMessage } from "@/lib/api/client";
import { officeInputSchema, type OfficeInput } from "@/lib/validation/office";
import type { OfficeDTO } from "@/types";

import { OFFICE_DEACTIVATION_WARNING } from "./constants";

interface OfficeFormProps {
  /** Existing office to edit. Omit to create a new office. */
  office?: OfficeDTO;
}

/** Create/edit form for an office (admin only; the API enforces this). */
export function OfficeForm({ office }: OfficeFormProps) {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);
  const isEdit = Boolean(office);

  const form = useForm<OfficeInput>({
    resolver: zodResolver(officeInputSchema),
    defaultValues: {
      name: office?.name ?? "",
      code: office?.code ?? "",
      isActive: office?.isActive ?? true,
    },
  });

  const { isSubmitting } = form.formState;
  const busy = isSubmitting || redirecting;

  async function onSubmit(values: OfficeInput) {
    try {
      if (office) {
        // Office codes are immutable after creation; only send editable fields.
        const patch = { name: values.name, isActive: values.isActive };
        await apiRequest<OfficeDTO>(`/api/offices/${office.id}`, { method: "PATCH", body: patch });
      } else {
        await apiRequest<OfficeDTO>("/api/offices", { method: "POST", body: values });
      }
      setRedirecting(true);
      toast.success(isEdit ? "Office updated successfully." : "Office created successfully.");
      router.push("/offices");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        form.setError("code", { type: "server", message: error.message }, { shouldFocus: true });
      } else {
        applyFieldErrors(form.setError, error);
      }
      toast.error(getErrorMessage(error, "The office could not be saved. Please try again."));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate aria-busy={busy}>
      <FieldGroup>
        <Controller
          name="name"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="office-name">Office Name</FieldLabel>
              <Input
                {...field}
                id="office-name"
                autoComplete="off"
                maxLength={120}
                placeholder="e.g. Dean Academics"
                disabled={busy}
                aria-invalid={fieldState.invalid}
                aria-describedby={fieldState.invalid ? "office-name-error" : undefined}
              />
              <FieldError id="office-name-error" errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="code"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="office-code">Office Code</FieldLabel>
              <Input
                {...field}
                id="office-code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={30}
                placeholder="e.g. DEAN-ACA"
                className="font-mono uppercase"
                disabled={busy || isEdit}
                aria-invalid={fieldState.invalid}
                aria-describedby={
                  fieldState.invalid ? "office-code-help office-code-error" : "office-code-help"
                }
                onChange={(event) => {
                  const input = event.target;
                  const { selectionStart, selectionEnd } = input;
                  const upper = input.value.toUpperCase();
                  if (upper !== input.value) {
                    input.value = upper;
                    input.setSelectionRange(selectionStart, selectionEnd);
                  }
                  field.onChange(upper);
                }}
              />
              <FieldDescription id="office-code-help">
                {isEdit
                  ? "Office codes cannot be changed after the office is created."
                  : "A short unique code using letters, numbers and hyphens, for example DEAN-ADMIN. It cannot be changed later."}
              </FieldDescription>
              <FieldError id="office-code-error" errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="isActive"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid}>
              <FieldContent>
                <FieldLabel htmlFor="office-active">Active Status</FieldLabel>
                <FieldDescription id="office-active-help">
                  {field.value
                    ? "Active offices can be selected for users and new records."
                    : OFFICE_DEACTIVATION_WARNING}
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </FieldContent>
              <Switch
                id="office-active"
                name={field.name}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                disabled={busy}
                aria-describedby="office-active-help"
                aria-invalid={fieldState.invalid}
              />
            </Field>
          )}
        />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/offices">Cancel</Link>
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? "Saving..." : isEdit ? "Save changes" : "Create office"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
