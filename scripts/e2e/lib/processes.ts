import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Build/start helpers for the Next.js production server under test. */

export interface LogLine {
  stream: "stdout" | "stderr";
  text: string;
  at: number;
}

export function nextBin(root: string): string {
  return path.join(root, "node_modules", "next", "dist", "bin", "next");
}

/** Equivalent of `npx next build` (run through node directly so no shell is involved). Returns the exit code. */
export function runNextBuild(root: string, env: NodeJS.ProcessEnv): number {
  const result = spawnSync(process.execPath, [nextBin(root), "build"], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** True when something already accepts connections on the port (IPv4 or IPv6 loopback). */
export async function isPortInUse(port: number): Promise<boolean> {
  const probe = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host });
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
  const results = await Promise.all([probe("127.0.0.1"), probe("::1")]);
  return results.some(Boolean);
}

export interface NextServerOptions {
  root: string;
  port: number;
  env: NodeJS.ProcessEnv;
  logFile: string;
}

/** `next start -p <port>` with captured stdout/stderr. */
export class NextServer {
  readonly lines: LogLine[] = [];
  exited = false;
  exitCode: number | null = null;
  private child: ChildProcess | null = null;
  private log: WriteStream | null = null;

  constructor(private readonly options: NextServerOptions) {}

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    const { root, port, env, logFile } = this.options;
    this.log = createWriteStream(logFile, { flags: "w" });
    const child = spawn(process.execPath, [nextBin(root), "start", "-p", String(port)], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    this.child = child;

    const capture = (stream: "stdout" | "stderr") => {
      let pending = "";
      return (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        const parts = pending.split(/\r?\n/);
        pending = parts.pop() ?? "";
        for (const text of parts) this.push(stream, text);
      };
    };
    child.stdout?.on("data", capture("stdout"));
    child.stderr?.on("data", capture("stderr"));
    child.on("exit", (code, signal) => {
      this.exited = true;
      this.exitCode = code;
      this.push("stdout", `[e2e-runner] server process exited (code ${code}, signal ${signal})`);
    });
  }

  private push(stream: "stdout" | "stderr", text: string): void {
    this.lines.push({ stream, text, at: Date.now() });
    this.log?.write(`[${stream}] ${text}\n`);
  }

  async waitUntilReady(url: string, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exited) throw new Error(`next start exited early with code ${this.exitCode}`);
      try {
        const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
        await response.arrayBuffer();
        if (response.status < 500) return;
      } catch {
        // not listening yet
      }
      await delay(500);
    }
    throw new Error(`Server did not become ready at ${url} within ${timeoutMs} ms`);
  }

  /** Kill the server and its process tree. Safe to call repeatedly. */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || child.pid === undefined) return;
    if (!this.exited) {
      this.killTree(child.pid);
      const deadline = Date.now() + 10_000;
      while (!this.exited && Date.now() < deadline) await delay(100);
      if (!this.exited) child.kill("SIGKILL");
    }
    this.child = null;
    await new Promise<void>((resolve) => {
      if (!this.log) return resolve();
      this.log.end(() => resolve());
      this.log = null;
    });
  }

  /** Synchronous best-effort kill for process "exit" handlers. */
  stopSync(): void {
    const child = this.child;
    if (!child || child.pid === undefined || this.exited) return;
    this.killTree(child.pid);
  }

  private killTree(pid: number): void {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      return;
    }
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }
}
