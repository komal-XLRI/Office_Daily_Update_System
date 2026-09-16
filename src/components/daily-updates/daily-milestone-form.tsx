"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { FileUploader } from "@/components/shared/file-uploader";
import { OfficeSelect } from "@/components/shared/office-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, apiRequest, applyFieldErrors, getErrorMessage } from "@/lib/api/client";
import { MAX_MILESTONES_PER_RECORD } from "@/lib/constants";
import { dailyMilestoneInputSchema, type DailyMilestoneInput } from "@/lib/validation/daily-milestone";
import type { DailyMilestoneDTO, OfficeOption } from "@/types";

export type DailyMilestoneFormValues = Omit<DailyMilestoneInput, "officeId">;

export interface DailyMilestoneFormProps {
  mode: "create" | "edit";
  /** Required in edit mode. */
  recordId?: string;
  /** Admin create only: offices to choose from. When provided, the Office field is shown and required. */
  offices?: OfficeOption[];
  /** Read-only office name, shown when the office cannot be chosen (normal users, edit mode). */
  officeName?: string | null;
  /** The record's office (edit), the user's office, or the preselected office for an admin create. */
  officeId?: string | null;
  defaultValues: DailyMilestoneFormValues;
  /** Pass getMaxFileSizeMb() from the server page. */
  maxFileSizeMb: number;
  /** Edit mode: the record's updatedAt (ISO) when the form was loaded; a newer save on the server -> 409. */
  expectedUpdatedAt?: string;
}

interface ConflictState {
  message: string;
  existingId: string | null;
  /** True when the record was saved by someone else after the form was loaded. */
  stale?: boolean;
}

const EMPTY_MILESTONE = { title: "", description: "", remarks: "" };

/** First error message in a (possibly nested) React Hook Form error object, e.g. for array fields. */
function firstErrorMessage(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== "object" || depth > 3) return undefined;
  const record = error as Record<string, unknown>;
  if (typeof record.message === "string" && record.message) return record.message;
  for (const [key, value] of Object.entries(record)) {
    if (key === "ref" || key === "types" || key === "type") continue;
    const nested = firstErrorMessage(value, depth + 1);
    if (nested) return nested;
  }
  return undefined;
}

/** Create/edit form for a daily record: daily update, dynamic milestones, photos and documents (spec §15). */
export function DailyMilestoneForm({
  mode,
  recordId,
  offices,
  officeName,
  officeId,
  defaultValues,
  maxFileSizeMb,
  expectedUpdatedAt,
}: DailyMilestoneFormProps) {
  const router = useRouter();
  const chooseOffice = mode === "create" && offices !== undefined;

  const schema = useMemo(
    () =>
      chooseOffice
        ? dailyMilestoneInputSchema.refine((value) => Boolean(value?.officeId), {
            message: "Select an office",
            path: ["officeId"],
            when: () => true,
          })
        : dailyMilestoneInputSchema,
    [chooseOffice],
  );

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DailyMilestoneInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...defaultValues,
      officeId: chooseOffice ? (officeId ?? undefined) : undefined,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "milestones" });
  const addMilestoneButtonRef = useRef<HTMLButtonElement>(null);

  /** Remove a milestone, then move focus to the next milestone's Title (or the "Add Milestone" button). */
  function removeMilestone(index: number) {
    const hasNext = index < fields.length - 1;
    remove(index);
    // After re-render the milestone that followed takes this index.
    requestAnimationFrame(() => {
      const title = hasNext ? document.getElementById(`milestones-${index}-title`) : null;
      (title ?? addMilestoneButtonRef.current)?.focus();
    });
  }
  const selectedOfficeId = useWatch({ control, name: "officeId" });

  const [uploading, setUploading] = useState({ photos: false, documents: false });
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [navigating, setNavigating] = useState(false);

  const isUploading = uploading.photos || uploading.documents;
  const busy = isSubmitting || navigating;
  const uploadOfficeId = chooseOffice ? (selectedOfficeId ?? null) : (officeId ?? null);
  const uploadsBlocked = chooseOffice && !selectedOfficeId;
  const cancelHref = mode === "edit" && recordId ? `/daily-updates/${recordId}` : "/daily-updates";

  async function onSubmit(values: DailyMilestoneInput) {
    if (isUploading) {
      toast.error("Please wait for the uploads to finish.");
      return;
    }
    setConflict(null);

    const { officeId: chosenOfficeId, ...rest } = values;
    const isCreate = mode === "create";
    const body = isCreate ? (chooseOffice ? { ...rest, officeId: chosenOfficeId } : rest) : { ...rest, expectedUpdatedAt };

    try {
      const record = await apiRequest<DailyMilestoneDTO>(
        isCreate ? "/api/daily-milestones" : `/api/daily-milestones/${recordId}`,
        { method: isCreate ? "POST" : "PATCH", body },
      );
      toast.success(isCreate ? "Daily update saved." : "Daily update updated.");
      setNavigating(true);
      router.push(`/daily-updates/${record.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409) {
        const existingId = typeof error.details?.existingId === "string" ? error.details.existingId : null;
        if (existingId === null && !isCreate) {
          // Stale edit: someone else saved this record after the form was loaded.
          setConflict({ message: error.message, existingId: null, stale: true });
          toast.error(error.message);
          return;
        }
        setConflict({ message: error.message, existingId: existingId === recordId ? null : existingId });
        setError("date", { type: "server", message: "A daily record already exists for this date." });
        toast.error(error.message);
        return;
      }
      const applied = applyFieldErrors(setError, error);
      toast.error(applied ? "Please correct the highlighted fields." : getErrorMessage(error));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Record details</h2>
          </CardTitle>
          <CardDescription>Only one daily record is allowed per office per date.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-5 sm:grid-cols-2">
            {chooseOffice ? (
              <Controller
                control={control}
                name="officeId"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="officeId">Office</FieldLabel>
                    <OfficeSelect
                      id="officeId"
                      offices={offices ?? []}
                      value={field.value ?? ""}
                      onValueChange={(value) => field.onChange(value)}
                      disabled={busy}
                      aria-invalid={fieldState.invalid}
                      aria-describedby={fieldState.error ? "officeId-error" : undefined}
                    />
                    <FieldError id="officeId-error" errors={[fieldState.error]} />
                  </Field>
                )}
              />
            ) : officeName ? (
              <Field>
                <FieldLabel htmlFor="office-name">Office</FieldLabel>
                <Input id="office-name" value={officeName} readOnly className="bg-muted/50" />
                {mode === "edit" ? (
                  <FieldDescription>The office of a daily record cannot be changed.</FieldDescription>
                ) : null}
              </Field>
            ) : null}

            <Field data-invalid={errors.date ? true : undefined}>
              <FieldLabel htmlFor="date">Date</FieldLabel>
              <Input
                id="date"
                type="date"
                disabled={busy}
                aria-invalid={errors.date ? true : undefined}
                aria-describedby={errors.date ? "date-error" : undefined}
                {...register("date")}
              />
              <FieldError id="date-error" errors={[errors.date]} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Daily update</h2>
          </CardTitle>
          <CardDescription>Summarise the work carried out on this date.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={errors.dailyUpdate?.title ? true : undefined}>
              <FieldLabel htmlFor="dailyUpdate-title">Daily Update Title</FieldLabel>
              <Input
                id="dailyUpdate-title"
                maxLength={200}
                disabled={busy}
                aria-invalid={errors.dailyUpdate?.title ? true : undefined}
                aria-describedby={errors.dailyUpdate?.title ? "dailyUpdate-title-error" : undefined}
                {...register("dailyUpdate.title")}
              />
              <FieldError id="dailyUpdate-title-error" errors={[errors.dailyUpdate?.title]} />
            </Field>
            <Field data-invalid={errors.dailyUpdate?.description ? true : undefined}>
              <FieldLabel htmlFor="dailyUpdate-description">Daily Update Description</FieldLabel>
              <Textarea
                id="dailyUpdate-description"
                rows={6}
                maxLength={10000}
                className="min-h-32"
                disabled={busy}
                aria-invalid={errors.dailyUpdate?.description ? true : undefined}
                aria-describedby={
                  errors.dailyUpdate?.description ? "dailyUpdate-description-error" : undefined
                }
                {...register("dailyUpdate.description")}
              />
              <FieldError id="dailyUpdate-description-error" errors={[errors.dailyUpdate?.description]} />
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Milestones</h2>
          </CardTitle>
          <CardDescription>Add each milestone with its title, description and remarks.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {fields.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
              No milestones have been added yet.
            </p>
          ) : (
            <ol className="flex flex-col gap-4">
              {fields.map((item, index) => {
                const itemErrors = errors.milestones?.[index];
                const base = `milestones-${index}`;
                const number = index + 1;
                return (
                  <li key={item.id}>
                    <div
                      role="group"
                      aria-labelledby={`${base}-heading`}
                      className="flex flex-col gap-4 rounded-lg border p-4"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 id={`${base}-heading`} className="text-sm font-medium">
                          Milestone {number}
                        </h3>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => removeMilestone(index)}
                          aria-label={`Remove milestone ${number}`}
                        >
                          <Trash2Icon data-icon="inline-start" aria-hidden="true" />
                          Remove
                        </Button>
                      </div>
                      <Field data-invalid={itemErrors?.title ? true : undefined}>
                        <FieldLabel htmlFor={`${base}-title`}>Title</FieldLabel>
                        <Input
                          id={`${base}-title`}
                          maxLength={200}
                          disabled={busy}
                          aria-invalid={itemErrors?.title ? true : undefined}
                          aria-describedby={itemErrors?.title ? `${base}-title-error` : undefined}
                          {...register(`milestones.${index}.title`)}
                        />
                        <FieldError id={`${base}-title-error`} errors={[itemErrors?.title]} />
                      </Field>
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field data-invalid={itemErrors?.description ? true : undefined}>
                          <FieldLabel htmlFor={`${base}-description`}>Description</FieldLabel>
                          <Textarea
                            id={`${base}-description`}
                            rows={3}
                            maxLength={5000}
                            disabled={busy}
                            aria-invalid={itemErrors?.description ? true : undefined}
                            aria-describedby={
                              itemErrors?.description ? `${base}-description-error` : undefined
                            }
                            {...register(`milestones.${index}.description`)}
                          />
                          <FieldError id={`${base}-description-error`} errors={[itemErrors?.description]} />
                        </Field>
                        <Field data-invalid={itemErrors?.remarks ? true : undefined}>
                          <FieldLabel htmlFor={`${base}-remarks`}>Remarks</FieldLabel>
                          <Textarea
                            id={`${base}-remarks`}
                            rows={3}
                            maxLength={2000}
                            disabled={busy}
                            aria-invalid={itemErrors?.remarks ? true : undefined}
                            aria-describedby={itemErrors?.remarks ? `${base}-remarks-error` : undefined}
                            {...register(`milestones.${index}.remarks`)}
                          />
                          <FieldError id={`${base}-remarks-error`} errors={[itemErrors?.remarks]} />
                        </Field>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          <FieldError
            errors={[{ message: errors.milestones?.message ?? errors.milestones?.root?.message }]}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={addMilestoneButtonRef}
              type="button"
              variant="outline"
              disabled={busy || fields.length >= MAX_MILESTONES_PER_RECORD}
              onClick={() => append({ ...EMPTY_MILESTONE })}
            >
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add Milestone
            </Button>
            {fields.length >= MAX_MILESTONES_PER_RECORD ? (
              <p className="text-muted-foreground text-sm">
                A maximum of {MAX_MILESTONES_PER_RECORD} milestones is allowed.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Attachments</h2>
          </CardTitle>
          <CardDescription>
            {uploadsBlocked
              ? "Select an office before uploading files."
              : "Upload photos and supporting documents for this record."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Controller
              control={control}
              name="photos"
              render={({ field, fieldState }) => {
                const message = firstErrorMessage(fieldState.error);
                return (
                  <Field data-invalid={message ? true : undefined}>
                    <FieldLabel htmlFor="photos-upload">Photos</FieldLabel>
                    <FileUploader
                      id="photos-upload"
                      kind="photos"
                      value={field.value}
                      onChange={field.onChange}
                      officeId={uploadOfficeId}
                      maxFileSizeMb={maxFileSizeMb}
                      disabled={busy || uploadsBlocked}
                      onUploadingChange={(value) =>
                        setUploading((previous) => ({ ...previous, photos: value }))
                      }
                      aria-invalid={message ? true : undefined}
                      aria-describedby={message ? "photos-error" : undefined}
                    />
                    <FieldError id="photos-error" errors={[message ? { message } : undefined]} />
                  </Field>
                );
              }}
            />
            <Controller
              control={control}
              name="documents"
              render={({ field, fieldState }) => {
                const message = firstErrorMessage(fieldState.error);
                return (
                  <Field data-invalid={message ? true : undefined}>
                    <FieldLabel htmlFor="documents-upload">Documents</FieldLabel>
                    <FileUploader
                      id="documents-upload"
                      kind="documents"
                      value={field.value}
                      onChange={field.onChange}
                      officeId={uploadOfficeId}
                      maxFileSizeMb={maxFileSizeMb}
                      disabled={busy || uploadsBlocked}
                      onUploadingChange={(value) =>
                        setUploading((previous) => ({ ...previous, documents: value }))
                      }
                      aria-invalid={message ? true : undefined}
                      aria-describedby={message ? "documents-error" : undefined}
                    />
                    <FieldError id="documents-error" errors={[message ? { message } : undefined]} />
                  </Field>
                );
              }}
            />
          </FieldGroup>
        </CardContent>
      </Card>

      {conflict ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{conflict.message}</AlertTitle>
          <AlertDescription>
            {conflict.stale ? (
              <p>Your changes were not saved. Copy anything you need, then reload the page.</p>
            ) : conflict.existingId ? (
              <p>
                <Link href={`/daily-updates/${conflict.existingId}`}>View the existing record</Link> or{" "}
                <Link href={`/daily-updates/${conflict.existingId}/edit`}>edit it</Link> instead.
              </p>
            ) : (
              <p>Choose a different date, or update the existing record instead.</p>
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={busy || isUploading}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {isUploading
            ? "Uploading files..."
            : busy
              ? "Saving..."
              : mode === "create"
                ? "Save daily update"
                : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
