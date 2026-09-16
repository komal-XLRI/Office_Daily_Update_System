/**
 * Minimal named-check harness for the end-to-end runner: every check is recorded as pass / fail / skip
 * with details, and a summary table is printed at the end.
 */

export type CheckStatus = "pass" | "fail" | "skip";

export interface CheckResult {
  section: string;
  name: string;
  status: CheckStatus;
  details: string;
  durationMs: number;
}

/** An expectation that did not hold. */
export class CheckFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckFailure";
  }
}

/** A check that cannot run (missing prerequisite or untestable in this environment). */
export class CheckSkipped extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckSkipped";
  }
}

/** A critical failure: stop running further sections (cleanup and the summary still run). */
export class AbortRun extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortRun";
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailure(message);
}

export function skip(reason: string): never {
  throw new CheckSkipped(reason);
}

/** Returns the value, or skips the current check when an earlier check did not produce it. */
export function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) skip(`prerequisite missing: ${what}`);
  return value;
}

export interface HarnessHooks {
  /** Called before each check; the returned marker is passed to `diagnostics` when the check fails. */
  mark?: () => number;
  /** Extra diagnostics for a failed check (e.g. server log lines written while it ran). */
  diagnostics?: (marker: number) => string;
}

function truncate(value: string, max: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 3)}...` : singleLine;
}

export class Harness {
  readonly results: CheckResult[] = [];
  private currentSection = "SETUP";

  constructor(private readonly hooks: HarnessHooks = {}) {}

  section(name: string): void {
    this.currentSection = name;
    console.log(`\n=== ${name}`);
  }

  /** Run one named check. Returns true when it passed. */
  async check(name: string, fn: () => Promise<string | void>): Promise<boolean> {
    const started = Date.now();
    const marker = this.hooks.mark?.() ?? 0;
    const record = (status: CheckStatus, details: string) => {
      this.results.push({
        section: this.currentSection,
        name,
        status,
        details,
        durationMs: Date.now() - started,
      });
    };

    try {
      const details = (await fn()) ?? "";
      record("pass", details);
      console.log(`  PASS  ${name}${details ? `  (${truncate(details, 160)})` : ""}`);
      return true;
    } catch (error) {
      if (error instanceof AbortRun) throw error;
      if (error instanceof CheckSkipped) {
        record("skip", error.message);
        console.log(`  SKIP  ${name}  (${truncate(error.message, 160)})`);
        return false;
      }
      let details =
        error instanceof CheckFailure
          ? error.message
          : error instanceof Error
            ? `${error.name}: ${error.message}${error.cause ? ` (cause: ${String((error.cause as Error).message ?? error.cause)})` : ""}\n${error.stack ?? ""}`
            : String(error);
      const extra = this.hooks.diagnostics?.(marker);
      if (extra) details += `\n--- server log during this check ---\n${extra}`;
      record("fail", details);
      console.log(`  FAIL  ${name}\n        ${details.split("\n").join("\n        ")}`);
      return false;
    }
  }

  counts(): Record<CheckStatus, number> {
    const counts: Record<CheckStatus, number> = { pass: 0, fail: 0, skip: 0 };
    for (const result of this.results) counts[result.status] += 1;
    return counts;
  }

  printSummary(): void {
    const rows = this.results.map((result, index) => ({
      n: String(index + 1),
      section: result.section,
      status: result.status.toUpperCase(),
      name: truncate(result.name, 90),
      details: truncate(result.details, 70),
    }));
    const widths = {
      n: Math.max(1, ...rows.map((row) => row.n.length)),
      section: Math.max(7, ...rows.map((row) => row.section.length)),
      status: 6,
      name: Math.max(5, ...rows.map((row) => row.name.length)),
    };
    const line = (n: string, section: string, status: string, name: string, details: string) =>
      `${n.padStart(widths.n)}  ${section.padEnd(widths.section)}  ${status.padEnd(widths.status)}  ${name.padEnd(widths.name)}  ${details}`;

    console.log("\n=== SUMMARY");
    console.log(line("#", "Section", "Status", "Check", "Details"));
    console.log("-".repeat(widths.n + widths.section + widths.status + widths.name + 20));
    for (const row of rows) console.log(line(row.n, row.section, row.status, row.name, row.details));

    const failures = this.results.filter((result) => result.status === "fail");
    if (failures.length > 0) {
      console.log("\n=== FAILURES");
      for (const failure of failures) {
        console.log(`\n[${failure.section}] ${failure.name}\n  ${failure.details.split("\n").join("\n  ")}`);
      }
    }

    const counts = this.counts();
    console.log(
      `\n${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped (${this.results.length} checks)`,
    );
  }
}
