import { Buffer } from "node:buffer";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { SMTPServer } from "smtp-server";

/**
 * In-process SMTP catcher (no TLS, no AUTH) that stores every received message and extracts 6-digit
 * sign-in codes. The app under test is pointed at it with SMTP_HOST=127.0.0.1 / SMTP_PORT=<port>.
 */

export interface CapturedEmail {
  from: string;
  to: string[];
  subject: string;
  raw: string;
  codes: string[];
  receivedAt: number;
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** The raw message plus quoted-printable and base64 decodings of its parts. */
function decodedViews(raw: string): string[] {
  const views = [raw, decodeQuotedPrintable(raw)];
  const base64Blocks = raw.match(/(?:^[A-Za-z0-9+/]{20,}={0,2}\r?\n)+/gm) ?? [];
  for (const block of base64Blocks) {
    views.push(Buffer.from(block.replace(/\s+/g, ""), "base64").toString("utf8"));
  }
  return views;
}

const CODE_PATTERNS = [/sign-in code is:?\s*(\d{6})(?!\d)/gi, /letter-spacing:\s*8px[^>]*>\s*(\d{6})\s*</gi];

export function extractCodes(raw: string): string[] {
  const codes = new Set<string>();
  for (const view of decodedViews(raw)) {
    for (const pattern of CODE_PATTERNS) {
      for (const match of view.matchAll(pattern)) codes.add(match[1]);
    }
  }
  return [...codes];
}

export class SmtpCatcher {
  readonly emails: CapturedEmail[] = [];
  port = 0;
  private server: SMTPServer | null = null;

  async start(): Promise<number> {
    const server = new SMTPServer({
      disabledCommands: ["STARTTLS", "AUTH"],
      authOptional: true,
      logger: false,
      banner: "odums e2e catcher",
      onData: (stream, session, callback) => {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("error", (error: Error) => callback(error));
        stream.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const subject = /^Subject:\s*(.*)$/im.exec(raw)?.[1]?.trim() ?? "";
          this.emails.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
            to: session.envelope.rcptTo.map((address) => address.address.toLowerCase()),
            subject,
            raw,
            codes: extractCodes(raw),
            receivedAt: Date.now(),
          });
          callback();
        });
      },
    });
    server.on("error", (error: Error) => console.error(`[smtp-catcher] ${error.message}`));

    await new Promise<void>((resolve, reject) => {
      server.server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    this.server = server;
    this.port = (server.server.address() as AddressInfo).port;
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Emails to `address` received after index `after`. */
  emailsTo(address: string, after = 0): CapturedEmail[] {
    const wanted = address.toLowerCase();
    return this.emails.slice(after).filter((email) => email.to.includes(wanted));
  }

  async waitForEmail(address: string, after: number, timeoutMs = 20_000): Promise<CapturedEmail> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [email] = this.emailsTo(address, after);
      if (email) return email;
      await delay(100);
    }
    throw new Error(`No email to ${address} arrived within ${timeoutMs} ms`);
  }

  allCodes(): string[] {
    return [...new Set(this.emails.flatMap((email) => email.codes))];
  }
}
