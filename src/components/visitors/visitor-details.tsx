import type { ReactNode } from "react";

import { PhotoGallery, DocumentList } from "@/components/shared/attachment-list";
import { ImportanceBadge } from "@/components/shared/badges";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatBusinessDate, formatDateTime, formatTime } from "@/lib/utils/dates";
import type { VisitorDTO } from "@/types";

function DetailItem({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/** Read-only visitor record: visit information, record information, photos and documents. */
export function VisitorDetails({ visitor }: { visitor: VisitorDTO }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>
            <h2>Visit information</h2>
          </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              <DetailItem label="Visitor name">{visitor.name}</DetailItem>
              <DetailItem label="Office">
                {visitor.office ? `${visitor.office.name} (${visitor.office.code})` : "—"}
              </DetailItem>
              <DetailItem label="Purpose" className="sm:col-span-2">
                <span className="whitespace-pre-wrap">{visitor.purpose}</span>
              </DetailItem>
              <DetailItem label="Date">{formatBusinessDate(visitor.date, "long")}</DetailItem>
              <DetailItem label="Importance">
                <ImportanceBadge importance={visitor.importance} />
              </DetailItem>
              <DetailItem label="Time arrived">
                <span className="tabular-nums">{formatTime(visitor.timeArrived)}</span>
              </DetailItem>
              <DetailItem label="Time departed">
                {visitor.timeDeparted ? (
                  <span className="tabular-nums">{formatTime(visitor.timeDeparted)}</span>
                ) : (
                  <span className="text-muted-foreground">Not recorded</span>
                )}
              </DetailItem>
              <DetailItem label="Remarks" className="sm:col-span-2">
                {visitor.remarks ? (
                  <span className="whitespace-pre-wrap">{visitor.remarks}</span>
                ) : (
                  <span className="text-muted-foreground">No remarks.</span>
                )}
              </DetailItem>
            </dl>
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>
            <h2>Record information</h2>
          </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-5">
              <DetailItem label="Created by">{visitor.createdBy?.name ?? "—"}</DetailItem>
              <DetailItem label="Created">
                <span className="tabular-nums">{formatDateTime(visitor.createdAt)}</span>
              </DetailItem>
              <DetailItem label="Last updated">
                <span className="tabular-nums">{formatDateTime(visitor.updatedAt)}</span>
              </DetailItem>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Photos</h2>
          </CardTitle>
          <CardDescription>
            {visitor.photos.length === 1 ? "1 photo" : `${visitor.photos.length} photos`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhotoGallery photos={visitor.photos} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Documents</h2>
          </CardTitle>
          <CardDescription>
            {visitor.documents.length === 1 ? "1 document" : `${visitor.documents.length} documents`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DocumentList documents={visitor.documents} />
        </CardContent>
      </Card>
    </div>
  );
}
