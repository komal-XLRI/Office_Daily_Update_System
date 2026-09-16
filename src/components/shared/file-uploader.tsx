"use client";

import { FileTextIcon, Trash2Icon, UploadIcon } from "lucide-react";
import Image from "next/image";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest, getErrorMessage } from "@/lib/api/client";
import { cloudinaryThumbnailUrl } from "@/lib/cloudinary/url";
import { MAX_ATTACHMENTS_PER_FIELD } from "@/lib/constants";
import {
  acceptAttribute,
  DEFAULT_MAX_FILE_SIZE_MB,
  getFileExtension,
  MAX_FILES_PER_UPLOAD,
  UPLOAD_RULES,
  type UploadKind,
} from "@/lib/uploads/constants";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types";

export interface FileUploaderProps {
  kind: UploadKind;
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
  /** Office the files belong to. Admins must pass it; the server ignores it for normal users. */
  officeId?: string | null;
  /** Pass getMaxFileSizeMb() from the server page so the client pre-check matches the server limit. */
  maxFileSizeMb?: number;
  disabled?: boolean;
  /** Called with true while uploading so forms can block submission. */
  onUploadingChange?: (uploading: boolean) => void;
  /** Id for the "Select files" button; use it as the htmlFor of the field label. */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/**
 * Uploads files to /api/uploads (validated server-side, stored in Cloudinary) and keeps the resulting
 * { fileName, fileUrl } list in `value`. Removing a file only removes it from the form; the server
 * deletes unreferenced Cloudinary files when the record is saved.
 */
export function FileUploader({
  kind,
  value,
  onChange,
  officeId,
  maxFileSizeMb = DEFAULT_MAX_FILE_SIZE_MB,
  disabled = false,
  onUploadingChange,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectButtonRef = useRef<HTMLButtonElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const rule = UPLOAD_RULES[kind];
  const noun = rule.label.toLowerCase();
  const isDisabled = disabled || uploading;
  const remainingSlots = MAX_ATTACHMENTS_PER_FIELD - value.length;

  function setBusy(busy: boolean) {
    setUploading(busy);
    onUploadingChange?.(busy);
  }

  function findProblem(files: File[]): string | null {
    if (files.length > MAX_FILES_PER_UPLOAD) {
      return `You can upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`;
    }
    if (files.length > remainingSlots) {
      return `You can attach up to ${MAX_ATTACHMENTS_PER_FIELD} ${noun}.`;
    }
    for (const file of files) {
      if (!rule.mimeTypesByExtension[getFileExtension(file.name)]) {
        return `"${file.name}" is not a supported file. Allowed: ${rule.description}.`;
      }
      if (file.size === 0) return `"${file.name}" is empty.`;
      if (file.size > maxFileSizeMb * 1024 * 1024) {
        return `"${file.name}" is larger than ${maxFileSizeMb} MB.`;
      }
    }
    return null;
  }

  async function upload(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : [];
    if (inputRef.current) inputRef.current.value = "";
    if (files.length === 0 || isDisabled) return;

    const problem = findProblem(files);
    if (problem) {
      toast.error(problem);
      return;
    }

    const formData = new FormData();
    formData.set("kind", kind);
    if (officeId) formData.set("officeId", officeId);
    for (const file of files) formData.append("files", file);

    setBusy(true);
    try {
      const result = await apiRequest<{ files: Attachment[] }>("/api/uploads", {
        method: "POST",
        body: formData,
      });
      onChange([...value, ...result.files]);
      toast.success(`${result.files.length} file${result.files.length === 1 ? "" : "s"} uploaded.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Upload failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  function remove(index: number) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index));
    // The removed button unmounts; focus the next remove button, else the previous, else "Select files".
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove-file]") ?? [];
      const next = buttons[Math.min(index, buttons.length - 1)];
      (next ?? selectButtonRef.current)?.focus();
    });
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!isDisabled) setDragActive(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void upload(event.dataTransfer.files);
  }

  return (
    <div ref={listRef} className="space-y-3">
      <div
        onDragOver={handleDragOver}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        aria-invalid={ariaInvalid}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
          dragActive && "border-primary bg-primary/5",
          ariaInvalid && "border-destructive",
          isDisabled && "opacity-70",
        )}
      >
        {uploading ? (
          <Spinner className="size-5" />
        ) : (
          <UploadIcon className="size-5 text-muted-foreground" aria-hidden="true" />
        )}
        <p className="text-sm font-medium" aria-live="polite">
          {uploading ? "Uploading files..." : `Drag and drop ${noun} here, or`}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptAttribute(kind)}
          className="hidden"
          tabIndex={-1}
          disabled={isDisabled}
          onChange={(event) => void upload(event.target.files)}
        />
        <Button
          ref={selectButtonRef}
          id={id}
          type="button"
          variant="outline"
          size="sm"
          disabled={isDisabled || remainingSlots <= 0}
          aria-describedby={ariaDescribedBy}
          onClick={() => inputRef.current?.click()}
        >
          Select {noun}
        </Button>
        <p className="text-xs text-muted-foreground">
          {rule.description} · up to {maxFileSizeMb} MB each · {MAX_FILES_PER_UPLOAD} files per upload
        </p>
      </div>

      {value.length > 0 && kind === "photos" ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Attached photos">
          {value.map((file, index) => (
            <li key={`${file.fileUrl}-${index}`} className="overflow-hidden rounded-lg border bg-muted">
              <a
                href={file.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block aspect-square"
              >
                <Image
                  src={cloudinaryThumbnailUrl(file.fileUrl, 320)}
                  alt={file.fileName}
                  fill
                  sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  className="object-cover"
                  unoptimized
                />
              </a>
              <div className="flex items-center justify-between gap-1 border-t bg-background px-2 py-1">
                <span className="truncate text-xs" title={file.fileName}>
                  {file.fileName}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={isDisabled}
                  data-remove-file
                  onClick={() => remove(index)}
                  aria-label={`Remove ${file.fileName}`}
                >
                  <Trash2Icon aria-hidden="true" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {value.length > 0 && kind === "documents" ? (
        <ul className="divide-y rounded-lg border" aria-label="Attached documents">
          {value.map((file, index) => (
            <li key={`${file.fileUrl}-${index}`} className="flex items-center gap-3 px-3 py-2">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <a
                href={file.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-sm underline-offset-4 hover:underline"
              >
                {file.fileName}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={isDisabled}
                data-remove-file
                  onClick={() => remove(index)}
                aria-label={`Remove ${file.fileName}`}
              >
                <Trash2Icon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
