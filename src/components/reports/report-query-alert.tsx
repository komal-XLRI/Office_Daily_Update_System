import { TriangleAlertIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Inline list of report query validation messages. */
export function ReportQueryAlert({ messages }: { messages: string[] }) {
  return (
    <Alert variant="destructive">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>The report could not be generated</AlertTitle>
      <AlertDescription>
        <span className="block">Please correct the report options and try again.</span>
        {messages.length > 0 ? (
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
