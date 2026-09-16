"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { ROLE_LABELS } from "@/components/shared/badges";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ApiClientError, apiRequest, applyFieldErrors, getErrorMessage } from "@/lib/api/client";
import { ROLES } from "@/lib/constants";
import { userInputSchema, type UserInput } from "@/lib/validation/user";
import type { OfficeOption, UserDTO } from "@/types";

/** Radix Select items cannot use "" as a value, so "No office" (officeId: null) uses a sentinel. */
const NO_OFFICE_VALUE = "none";

interface UserFormProps {
  /** Offices for the picker, including inactive ones (they are labelled). */
  offices: OfficeOption[];
  /** Existing user to edit. Omit to create a new user. */
  user?: UserDTO;
  /** True when the admin is editing their own account (role and status are locked). */
  isSelf?: boolean;
}

/** Create/edit form for a user account (admin only; the API enforces this). */
export function UserForm({ offices, user, isSelf = false }: UserFormProps) {
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);
  const isEdit = Boolean(user);

  const form = useForm<UserInput>({
    resolver: zodResolver(userInputSchema),
    defaultValues: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      role: user?.role ?? "user",
      designation: user?.designation ?? "",
      officeId: user?.officeId ?? null,
      isActive: user?.isActive ?? true,
    },
  });

  const role = useWatch({ control: form.control, name: "role" });
  const { isSubmitting, isSubmitted } = form.formState;
  const busy = isSubmitting || redirecting;

  async function onSubmit(values: UserInput) {
    try {
      if (user) {
        await apiRequest<UserDTO>(`/api/users/${user.id}`, { method: "PATCH", body: values });
      } else {
        await apiRequest<UserDTO>("/api/users", { method: "POST", body: values });
      }
      setRedirecting(true);
      toast.success(isEdit ? "User updated successfully." : "User added successfully.");
      router.push("/users");
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409 && error.details?.field === "email") {
        form.setError("email", { type: "server", message: error.message }, { shouldFocus: true });
      } else {
        applyFieldErrors(form.setError, error);
      }
      toast.error(getErrorMessage(error, "The user could not be saved. Please try again."));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate aria-busy={busy}>
      <FieldGroup>
        <div className="grid gap-5 md:grid-cols-2">
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="user-name">Name</FieldLabel>
                <Input
                  {...field}
                  id="user-name"
                  autoComplete="off"
                  maxLength={120}
                  placeholder="Full name"
                  disabled={busy}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.invalid ? "user-name-error" : undefined}
                />
                <FieldError id="user-name-error" errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="user-email">Email</FieldLabel>
                <Input
                  {...field}
                  id="user-email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={254}
                  placeholder="name@example.com"
                  disabled={busy}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.invalid ? "user-email-help user-email-error" : "user-email-help"}
                />
                <FieldDescription id="user-email-help">
                  The user signs in with a one-time code sent to this address.
                </FieldDescription>
                <FieldError id="user-email-error" errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            name="role"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="user-role">Role</FieldLabel>
                <Select
                  name={field.name}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    if (isSubmitted) void form.trigger("officeId");
                  }}
                  disabled={busy || isSelf}
                >
                  <SelectTrigger
                    id="user-role"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    className="w-full"
                    aria-invalid={fieldState.invalid}
                    aria-describedby={fieldState.invalid ? "user-role-help user-role-error" : "user-role-help"}
                  >
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ROLE_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription id="user-role-help">
                  {isSelf
                    ? "You cannot change your own role."
                    : field.value === "admin"
                      ? "Administrators can view and manage all offices."
                      : "Normal users can only work with records of their assigned office."}
                </FieldDescription>
                <FieldError id="user-role-error" errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            name="designation"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="user-designation">Designation</FieldLabel>
                <Input
                  {...field}
                  id="user-designation"
                  autoComplete="off"
                  maxLength={120}
                  placeholder="e.g. Assistant"
                  disabled={busy}
                  aria-invalid={fieldState.invalid}
                  aria-describedby={fieldState.invalid ? "user-designation-error" : undefined}
                />
                <FieldError id="user-designation-error" errors={[fieldState.error]} />
              </Field>
            )}
          />

          <Controller
            name="officeId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="md:col-span-2">
                <FieldLabel htmlFor="user-office">Office</FieldLabel>
                <Select
                  name={field.name}
                  value={field.value ?? (role === "admin" ? NO_OFFICE_VALUE : "")}
                  onValueChange={(value) => field.onChange(value === NO_OFFICE_VALUE ? null : value)}
                  disabled={busy}
                >
                  <SelectTrigger
                    id="user-office"
                    ref={field.ref}
                    onBlur={field.onBlur}
                    className="w-full md:max-w-[calc(50%-0.625rem)]"
                    aria-invalid={fieldState.invalid}
                    aria-required={role === "user"}
                    aria-describedby={
                      fieldState.invalid ? "user-office-help user-office-error" : "user-office-help"
                    }
                  >
                    <SelectValue placeholder="Select office" />
                  </SelectTrigger>
                  <SelectContent>
                    {role === "admin" ? <SelectItem value={NO_OFFICE_VALUE}>No office</SelectItem> : null}
                    {offices.map((office) => (
                      <SelectItem key={office.id} value={office.id}>
                        {office.name}
                        {office.isActive ? "" : " (inactive)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription id="user-office-help">
                  {role === "admin"
                    ? "Optional for administrators, who can access all offices."
                    : "Required. Normal users can only view and add records for this office."}
                </FieldDescription>
                <FieldError id="user-office-error" errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>

        <Controller
          name="isActive"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid}>
              <FieldContent>
                <FieldLabel htmlFor="user-active">Active Status</FieldLabel>
                <FieldDescription id="user-active-help">
                  {isSelf
                    ? "You cannot deactivate your own account."
                    : field.value
                      ? "Active users can sign in."
                      : "Inactive users cannot sign in. Their historical records are kept."}
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </FieldContent>
              <Switch
                id="user-active"
                name={field.name}
                checked={field.value}
                onCheckedChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                disabled={busy || isSelf}
                aria-describedby="user-active-help"
                aria-invalid={fieldState.invalid}
              />
            </Field>
          )}
        />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="outline">
            <Link href="/users">Cancel</Link>
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {busy ? "Saving..." : isEdit ? "Save changes" : "Add user"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
