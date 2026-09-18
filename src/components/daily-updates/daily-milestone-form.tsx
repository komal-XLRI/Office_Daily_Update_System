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
import { MAX_DAILY_UPDATES_PER_RECORD, MAX_MILESTONES_PER_RECORD } from "@/lib/constants";
import {
  dailyMilestoneInputSchema,
  type DailyMilestoneFormInput,
  type DailyMilestoneInput,
} from "@/lib/validation/daily-milestone";
import type { DailyMilestoneDTO, OfficeOption } from "@/types";

export type DailyMilestoneFormValues = Omit<DailyMilestoneFormInput, "officeId">;

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

/** Every place a file list can live on the form. */
type AttachmentPath =
  | "photos"
  | "documents"
  | `dailyUpdates.${number}.photos`
  | `dailyUpdates.${number}.documents`
  | `milestones.${number}.photos`
  | `milestones.${number}.documents`;

interface ConflictState {
  message: string;
  existingId: string | null;
  /** True when the record was saved by someone else after the form was loaded. */
  stale?: boolean;
}

const EMPTY_MILESTONE = { title: "", description: "", remarks: "" };
const EMPTY_DAILY_UPDATE = { title: "", description: "" };

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

/** Create/edit form for a daily record: daily updates, milestones, photos and documents (spec §15). */
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
    // Input type in (nested file lists may be omitted), parsed output type out.
  } = useForm<DailyMilestoneFormInput, unknown, DailyMilestoneInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...defaultValues,
      officeId: chooseOffice ? (officeId ?? undefined) : undefined,
    },
  });

  const {
    fields: updateFields,
    append: appendUpdate,
    remove: removeUpdateAt,
  } = useFieldArray({ control, name: "dailyUpdates" });
  const addUpdateButtonRef = useRef<HTMLButtonElement>(null);

  /** Remove one of several updates, then move focus to the next update's Title (or the Add button). */
  function removeUpdate(index: number) {
    if (updateFields.length <= 1) return;
    const hasNext = index < updateFields.length - 1;
    removeUpdateAt(index);
    requestAnimationFrame(() => {
      const title = hasNext ? document.getElementById(`dailyUpdates-${index}-title`) : null;
      (title ?? addUpdateButtonRef.current)?.focus();
    });
  }

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

  // A new entry can only be started once the one before it is filled in, so no blank blocks pile up.
  const watchedUpdates = useWatch({ control, name: "dailyUpdates" });
  const lastUpdate = watchedUpdates?.[updateFields.length - 1];
  const canAddUpdate =
    updateFields.length === 0 || Boolean(lastUpdate?.title?.trim() && lastUpdate?.description?.trim());

  const watchedMilestones = useWatch({ control, name: "milestones" });
  const lastMilestone = watchedMilestones?.[fields.length - 1];
  const canAddMilestone = fields.length === 0 || Boolean(lastMilestone?.title?.trim());

  // One entry per uploader on the page, keyed by its id; the form cannot be submitted while any is busy.
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [navigating, setNavigating] = useState(false);

  const isUploading = Object.values(uploading).some(Boolean);
  const busy = isSubmitting || navigating;
  const uploadOfficeId = chooseOffice ? (selectedOfficeId ?? null) : (officeId ?? null);
  const uploadsBlocked = chooseOffice && !selectedOfficeId;
  const cancelHref = mode === "edit" && recordId ? `/daily-updates/${recordId}` : "/daily-updates";

  /** Photos or documents for the record, one daily update or one milestone. */
  function attachmentField(
    name: AttachmentPath,
    kind: "photos" | "documents",
    id: string,
    label: string,
  ) {
    return (
      <Controller
        control={control}
        name={name}
        render={({ field, fieldState }) => {
          const message = firstErrorMessage(fieldState.error);
          return (
            <Field data-invalid={message ? true : undefined}>
              <FieldLabel htmlFor={id}>{label}</FieldLabel>
              <FileUploader
                id={id}
                kind={kind}
                value={Array.isArray(field.value) ? field.value : []}
                onChange={field.onChange}
                officeId={uploadOfficeId}
                maxFileSizeMb={maxFileSizeMb}
                disabled={busy || uploadsBlocked}
                onUploadingChange={(value) =>
                  setUploading((previous) => ({ ...previous, [id]: value }))
                }
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? `${id}-error` : undefined}
              />
              <FieldError id={`${id}-error`} errors={[message ? { message } : undefined]} />
            </Field>
          );
        }}
      />
    );
  }

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
            <h2>Daily Updates</h2>
          </CardTitle>
          <CardDescription>
            Summarise the work carried out on this date. Use Add Daily Update to record more than one.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="flex flex-col gap-4">
            {updateFields.map((item, index) => {
              const itemErrors = errors.dailyUpdates?.[index];
              const base = `dailyUpdates-${index}`;
              const number = index + 1;
              const single = updateFields.length === 1;
              return (
                <li key={item.id}>
                  <div
                    role="group"
                    aria-labelledby={`${base}-heading`}
                    className="flex flex-col gap-4 rounded-lg border p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 id={`${base}-heading`} className="text-sm font-medium">
                        {single ? "Daily update" : `Daily update ${number}`}
                      </h3>
                      {single ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => removeUpdate(index)}
                          aria-label={`Remove daily update ${number}`}
                        >
                          <Trash2Icon data-icon="inline-start" aria-hidden="true" />
                          Remove
                        </Button>
                      )}
                    </div>
                    <Field data-invalid={itemErrors?.title ? true : undefined}>
                      <FieldLabel htmlFor={`${base}-title`}>Title</FieldLabel>
                      <Input
                        id={`${base}-title`}
                        maxLength={200}
                        disabled={busy}
                        aria-invalid={itemErrors?.title ? true : undefined}
                        aria-describedby={itemErrors?.title ? `${base}-title-error` : undefined}
                        {...register(`dailyUpdates.${index}.title`)}
                      />
                      <FieldError id={`${base}-title-error`} errors={[itemErrors?.title]} />
                    </Field>
                    <Field data-invalid={itemErrors?.description ? true : undefined}>
                      <FieldLabel htmlFor={`${base}-description`}>Description</FieldLabel>
                      <Textarea
                        id={`${base}-description`}
                        rows={6}
                        maxLength={10000}
                        className="min-h-32"
                        disabled={busy}
                        aria-invalid={itemErrors?.description ? true : undefined}
                        aria-describedby={itemErrors?.description ? `${base}-description-error` : undefined}
                        {...register(`dailyUpdates.${index}.description`)}
                      />
                      <FieldError id={`${base}-description-error`} errors={[itemErrors?.description]} />
                    </Field>
                    <div className="grid gap-4 md:grid-cols-2">
                      {attachmentField(
                        `dailyUpdates.${index}.photos`,
                        "photos",
                        `${base}-photos`,
                        "Photos for this update",
                      )}
                      {attachmentField(
                        `dailyUpdates.${index}.documents`,
                        "documents",
                        `${base}-documents`,
                        "Documents for this update",
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          <FieldError
            errors={[{ message: errors.dailyUpdates?.message ?? errors.dailyUpdates?.root?.message }]}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              ref={addUpdateButtonRef}
              type="button"
              variant="outline"
              disabled={busy || !canAddUpdate || updateFields.length >= MAX_DAILY_UPDATES_PER_RECORD}
              aria-describedby={canAddUpdate ? undefined : "add-update-hint"}
              onClick={() => appendUpdate({ ...EMPTY_DAILY_UPDATE })}
            >
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add Daily Update
            </Button>
            {updateFields.length >= MAX_DAILY_UPDATES_PER_RECORD ? (
              <p className="text-muted-foreground text-sm">
                A maximum of {MAX_DAILY_UPDATES_PER_RECORD} daily updates is allowed.
              </p>
            ) : canAddUpdate ? null : (
              <p id="add-update-hint" className="text-muted-foreground text-sm">
                Fill in the title and description above before adding another update.
              </p>
            )}
          </div>
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
                      <div className="grid gap-4 md:grid-cols-2">
                        {attachmentField(
                          `milestones.${index}.photos`,
                          "photos",
                          `${base}-photos`,
                          "Photos for this milestone",
                        )}
                        {attachmentField(
                          `milestones.${index}.documents`,
                          "documents",
                          `${base}-documents`,
                          "Documents for this milestone",
                        )}
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
              disabled={busy || !canAddMilestone || fields.length >= MAX_MILESTONES_PER_RECORD}
              aria-describedby={canAddMilestone ? undefined : "add-milestone-hint"}
              onClick={() => append({ ...EMPTY_MILESTONE })}
            >
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Add Milestone
            </Button>
            {fields.length >= MAX_MILESTONES_PER_RECORD ? (
              <p className="text-muted-foreground text-sm">
                A maximum of {MAX_MILESTONES_PER_RECORD} milestones is allowed.
              </p>
            ) : canAddMilestone ? null : (
              <p id="add-milestone-hint" className="text-muted-foreground text-sm">
                Give the milestone above a title before adding another one.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Other files for this day</h2>
          </CardTitle>
          <CardDescription>
            {uploadsBlocked
              ? "Select an office before uploading files."
              : "Optional. Files that belong to the day as a whole rather than to one update or milestone."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {attachmentField("photos", "photos", "photos-upload", "Photos")}
            {attachmentField("documents", "documents", "documents-upload", "Documents")}
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
