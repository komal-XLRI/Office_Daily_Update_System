"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { IMPORTANCE_LABELS } from "@/components/shared/badges";
import { FileUploader } from "@/components/shared/file-uploader";
import { OfficeSelect } from "@/components/shared/office-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, apiRequest, applyFieldErrors, getErrorMessage } from "@/lib/api/client";
import { IMPORTANCE_LEVELS } from "@/lib/constants";
import type { UploadKind } from "@/lib/uploads/constants";
import { visitorInputSchema, type VisitorInput } from "@/lib/validation/visitor";
import type { OfficeOption, VisitorDTO } from "@/types";

interface VisitorFormBaseProps {
  /** Form values: date "YYYY-MM-DD", times "HH:mm" (timeDeparted "" when not departed). */
  defaultValues: VisitorInput;
  /** Server limit from getMaxFileSizeMb(). */
  maxFileSizeMb: number;
}

interface CreateVisitorFormProps extends VisitorFormBaseProps {
  mode: "create";
  /** Admins: active offices for the Office select. Omit for normal users (the server uses their office). */
  offices?: OfficeOption[];
  /** Normal users: their own office, used for uploads. */
  officeId?: string | null;
}

interface EditVisitorFormProps extends VisitorFormBaseProps {
  mode: "edit";
  visitorId: string;
  /** The visitor's (immutable) office, used for uploads. */
  officeId: string;
  /** Shown read-only when provided (admins). */
  officeName?: string | null;
  /** The visitor's updatedAt (ISO) when the form was loaded; a newer save on the server -> 409. */
  expectedUpdatedAt: string;
}

export type VisitorFormProps = CreateVisitorFormProps | EditVisitorFormProps;

function errorId(name: string) {
  return `visitor-${name}-error`;
}

export function VisitorForm(props: VisitorFormProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState<Record<UploadKind, boolean>>({ photos: false, documents: false });
  const [staleMessage, setStaleMessage] = useState<string | null>(null);

  const form = useForm<VisitorInput>({
    resolver: zodResolver(visitorInputSchema),
    defaultValues: props.defaultValues,
  });

  const showOfficeSelect = props.mode === "create" && props.offices !== undefined;
  const selectedOfficeId = useWatch({ control: form.control, name: "officeId" });
  const uploadOfficeId = showOfficeSelect ? (selectedOfficeId ?? null) : (props.officeId ?? null);
  const uploadsBlocked = showOfficeSelect && !selectedOfficeId;
  const isUploading = uploading.photos || uploading.documents;
  const isSubmitting = form.formState.isSubmitting;
  const cancelHref = props.mode === "edit" ? `/visitors/${props.visitorId}` : "/visitors";

  function setKindUploading(kind: UploadKind, value: boolean) {
    setUploading((current) => ({ ...current, [kind]: value }));
  }

  async function onSubmit(values: VisitorInput) {
    if (isUploading) {
      toast.error("Please wait until the files finish uploading.");
      return;
    }
    if (showOfficeSelect && !values.officeId) {
      form.setError("officeId", { type: "manual", message: "Select an office." });
      return;
    }

    try {
      const visitor =
        props.mode === "create"
          ? await apiRequest<VisitorDTO>("/api/visitors", { method: "POST", body: values })
          : await apiRequest<VisitorDTO>(`/api/visitors/${props.visitorId}`, {
              method: "PATCH",
              // The office of an existing visitor cannot be changed.
              body: { ...values, officeId: undefined, expectedUpdatedAt: props.expectedUpdatedAt },
            });
      toast.success(props.mode === "create" ? "Visitor added successfully." : "Visitor updated successfully.");
      router.push(`/visitors/${visitor.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        // Someone else saved this visitor after the form was loaded.
        setStaleMessage(error.message);
        toast.error(error.message);
        return;
      }
      applyFieldErrors(form.setError, error);
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Visitor details</CardTitle>
          <CardDescription>Times are recorded in the institution&apos;s local time.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {showOfficeSelect ? (
              <Controller
                name="officeId"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="visitor-office">Office</FieldLabel>
                    <OfficeSelect
                      id="visitor-office"
                      offices={props.mode === "create" ? (props.offices ?? []) : []}
                      value={field.value ?? ""}
                      onValueChange={(value) => {
                        field.onChange(value);
                        form.clearErrors("officeId");
                      }}
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={fieldState.invalid ? errorId("office") : "visitor-office-description"}
                    />
                    <FieldDescription id="visitor-office-description">
                      Choose the office before uploading photos or documents.
                    </FieldDescription>
                    {fieldState.invalid ? <FieldError id={errorId("office")} errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
            ) : null}

            {props.mode === "edit" && props.officeName ? (
              <Field>
                <FieldLabel htmlFor="visitor-office-readonly">Office</FieldLabel>
                <Input
                  id="visitor-office-readonly"
                  value={props.officeName}
                  readOnly
                  aria-describedby="visitor-office-readonly-description"
                  className="bg-muted/50"
                />
                <FieldDescription id="visitor-office-readonly-description">
                  The office cannot be changed after a visitor is recorded.
                </FieldDescription>
              </Field>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <Controller
                name="name"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="visitor-name">Visitor Name</FieldLabel>
                    <Input
                      {...field}
                      id="visitor-name"
                      autoComplete="off"
                      maxLength={120}
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={fieldState.invalid ? errorId("name") : undefined}
                    />
                    {fieldState.invalid ? <FieldError id={errorId("name")} errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="importance"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="visitor-importance">Importance</FieldLabel>
                    <Select
                      name={field.name}
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger
                        id="visitor-importance"
                        ref={field.ref}
                        onBlur={field.onBlur}
                        className="w-full"
                        aria-invalid={fieldState.invalid}
                        aria-describedby={fieldState.invalid ? errorId("importance") : undefined}
                      >
                        <SelectValue placeholder="Select importance" />
                      </SelectTrigger>
                      <SelectContent>
                        {IMPORTANCE_LEVELS.map((level) => (
                          <SelectItem key={level} value={level}>
                            {IMPORTANCE_LABELS[level]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {fieldState.invalid ? (
                      <FieldError id={errorId("importance")} errors={[fieldState.error]} />
                    ) : null}
                  </Field>
                )}
              />
            </div>

            <Controller
              name="purpose"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="visitor-purpose">Purpose</FieldLabel>
                  <Input
                    {...field}
                    id="visitor-purpose"
                    autoComplete="off"
                    maxLength={500}
                    disabled={isSubmitting}
                    aria-invalid={fieldState.invalid}
                    aria-describedby={fieldState.invalid ? errorId("purpose") : undefined}
                  />
                  {fieldState.invalid ? <FieldError id={errorId("purpose")} errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />

            <div className="grid gap-5 sm:grid-cols-3">
              <Controller
                name="date"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="visitor-date">Date</FieldLabel>
                    <Input
                      {...field}
                      id="visitor-date"
                      type="date"
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={fieldState.invalid ? errorId("date") : undefined}
                    />
                    {fieldState.invalid ? <FieldError id={errorId("date")} errors={[fieldState.error]} /> : null}
                  </Field>
                )}
              />
              <Controller
                name="timeArrived"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="visitor-time-arrived">Time Arrived</FieldLabel>
                    <Input
                      {...field}
                      id="visitor-time-arrived"
                      type="time"
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={fieldState.invalid ? errorId("time-arrived") : undefined}
                    />
                    {fieldState.invalid ? (
                      <FieldError id={errorId("time-arrived")} errors={[fieldState.error]} />
                    ) : null}
                  </Field>
                )}
              />
              <Controller
                name="timeDeparted"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="visitor-time-departed">
                      Time Departed <span className="font-normal text-muted-foreground">(optional)</span>
                    </FieldLabel>
                    <Input
                      {...field}
                      id="visitor-time-departed"
                      type="time"
                      disabled={isSubmitting}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={
                        fieldState.invalid
                          ? `${errorId("time-departed")} visitor-time-departed-description`
                          : "visitor-time-departed-description"
                      }
                    />
                    <FieldDescription id="visitor-time-departed-description">
                      Leave blank if the visitor has not left yet.
                      {field.value ? (
                        <>
                          {" "}
                          <Button
                            type="button"
                            variant="link"
                            size="xs"
                            className="h-auto p-0 align-baseline"
                            disabled={isSubmitting}
                            onClick={() => field.onChange("")}
                          >
                            Clear time
                          </Button>
                        </>
                      ) : null}
                    </FieldDescription>
                    {fieldState.invalid ? (
                      <FieldError id={errorId("time-departed")} errors={[fieldState.error]} />
                    ) : null}
                  </Field>
                )}
              />
            </div>

            <Controller
              name="remarks"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="visitor-remarks">
                    Remarks <span className="font-normal text-muted-foreground">(optional)</span>
                  </FieldLabel>
                  <Textarea
                    {...field}
                    id="visitor-remarks"
                    rows={4}
                    maxLength={2000}
                    disabled={isSubmitting}
                    aria-invalid={fieldState.invalid}
                    aria-describedby={fieldState.invalid ? errorId("remarks") : undefined}
                  />
                  {fieldState.invalid ? <FieldError id={errorId("remarks")} errors={[fieldState.error]} /> : null}
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Attachments</CardTitle>
          <CardDescription>
            {uploadsBlocked
              ? "Select an office above to enable uploads."
              : "Upload photos and documents related to this visit."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {(["photos", "documents"] as const).map((kind) => (
              <Controller
                key={kind}
                name={kind}
                control={form.control}
                render={({ field, fieldState }) => {
                  const message =
                    fieldState.error?.message ??
                    fieldState.error?.root?.message ??
                    (fieldState.invalid ? "One or more files are invalid. Please upload them again." : undefined);
                  return (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={`visitor-${kind}`}>{kind === "photos" ? "Photos" : "Documents"}</FieldLabel>
                      <FileUploader
                        id={`visitor-${kind}`}
                        kind={kind}
                        value={field.value}
                        onChange={field.onChange}
                        officeId={uploadOfficeId}
                        maxFileSizeMb={props.maxFileSizeMb}
                        disabled={isSubmitting || uploadsBlocked}
                        onUploadingChange={(value) => setKindUploading(kind, value)}
                        aria-invalid={fieldState.invalid}
                        aria-describedby={fieldState.invalid ? errorId(kind) : undefined}
                      />
                      {message ? <FieldError id={errorId(kind)}>{message}</FieldError> : null}
                    </Field>
                  );
                }}
              />
            ))}
          </FieldGroup>
        </CardContent>
      </Card>

      {staleMessage ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{staleMessage}</AlertTitle>
          <AlertDescription>
            <p>Your changes were not saved. Copy anything you need, then reload the page.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={isSubmitting || isUploading}>
          {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {isUploading ? "Uploading files..." : props.mode === "create" ? "Add visitor" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
