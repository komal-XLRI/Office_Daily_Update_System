import { FileTextIcon } from "lucide-react";
import Image from "next/image";

import { cloudinaryThumbnailUrl } from "@/lib/cloudinary/url";
import { getFileExtension } from "@/lib/uploads/constants";
import type { Attachment } from "@/types";

/** Read-only photo grid with optimized thumbnails linking to the full image. */
export function PhotoGallery({
  photos,
  emptyText = "No photos attached.",
}: {
  photos: Attachment[];
  emptyText?: string;
}) {
  if (photos.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo, index) => (
        <li key={`${photo.fileUrl}-${index}`}>
          <a
            href={photo.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group block overflow-hidden rounded-lg border bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span className="relative block aspect-square">
              <Image
                src={cloudinaryThumbnailUrl(photo.fileUrl, 320)}
                alt={photo.fileName}
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                className="object-cover transition-opacity group-hover:opacity-90"
                loading="lazy"
                unoptimized
              />
            </span>
            <span className="block truncate border-t bg-background px-2 py-1 text-xs" title={photo.fileName}>
              {photo.fileName}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Read-only document list with links that open in a new tab. */
export function DocumentList({
  documents,
  emptyText = "No documents attached.",
}: {
  documents: Attachment[];
  emptyText?: string;
}) {
  if (documents.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ul className="divide-y rounded-lg border">
      {documents.map((document, index) => (
        <li key={`${document.fileUrl}-${index}`} className="flex items-center gap-3 px-3 py-2">
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <a
            href={document.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-sm underline-offset-4 hover:underline"
          >
            {document.fileName}
          </a>
          <span className="text-xs text-muted-foreground uppercase">{getFileExtension(document.fileName)}</span>
        </li>
      ))}
    </ul>
  );
}
