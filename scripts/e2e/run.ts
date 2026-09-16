/**
 * End-to-end runtime verification of the real production build over HTTP (spec §56–§60, §62).
 *
 *   npm run e2e                      # next build + all checks
 *   npm run e2e -- --skip-build      # reuse the existing .next build
 *   npx tsx --conditions=react-server scripts/e2e/run.ts [--skip-build] [--port 3100]
 *
 * What it does:
 *   1. `next build` (unless --skip-build).
 *   2. Starts mongodb-memory-server and an in-process SMTP catcher.
 *   3. Seeds the seven offices ("OTHER" deactivated), Admin, User A (DEAN-ADMIN), User B (ADSA), an inactive
 *      user, a user of the inactive office and two users for OTP expiry/attempt tests.
 *   4. Spawns `next start -p <port>` with env overrides that take precedence over .env.local (Next never
 *      overrides variables that are already set), so the server uses ONLY the in-memory MongoDB, the SMTP
 *      catcher, a random AUTH_SECRET, no Cloudinary and MAX_FILE_SIZE_MB=1. The first AUTH check proves the
 *      server writes to the in-memory database and aborts the run otherwise.
 *   5. Runs the checks with per-user cookie jars and prints a summary; exits 1 on failures.
 * Everything started here is stopped on completion, errors and Ctrl+C.
 * Artifacts: .scratch/e2e/<timestamp>/{server.log,results.json}
 */
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

import { Office, User } from "@/models";

import { ensureIndexes, seedOffices } from "../seed-data/seed-database";
import type { E2EContext, SeedData, SeedOffice, SeedUser, SeedUserKey } from "./lib/context";
import { AbortRun, Harness } from "./lib/harness";
import { HttpClient, type RecordedResponse } from "./lib/http";
import { isPortInUse, NextServer, runNextBuild } from "./lib/processes";
import { SmtpCatcher } from "./lib/smtp";
import { runAuthSection } from "./sections/auth";
import { runAuthzSection } from "./sections/authz";
import { runDailySection } from "./sections/daily";
import { runFinalSection } from "./sections/final";
import { runPagesSection } from "./sections/pages";
import { runReportsSection } from "./sections/reports";
import { runSecuritySection } from "./sections/security";
import { runUploadsSection } from "./sections/uploads";
import { runVisitorsSection } from "./sections/visitors";

const ROOT = path.resolve(__dirname, "..", "..");

interface Options {
  skipBuild: boolean;
  port: number;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { skipBuild: false, port: 3100 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg.startsWith("--port=")) options.port = Number(arg.slice("--port=".length));
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: tsx --conditions=react-server scripts/e2e/run.ts [--skip-build] [--port 3100]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    throw new Error(`Invalid --port ${options.port}`);
  }
  return options;
}

function randomLetters(length: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

/** Environment for child processes: never leak the runner's own loader flags (tsx, react-server) into Next. */
function childBaseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
  if (env.NODE_OPTIONS && /tsx|conditions/.test(env.NODE_OPTIONS)) delete env.NODE_OPTIONS;
  return env;
}

async function seedDatabase(runId: string): Promise<SeedData> {
  await ensureIndexes();
  await seedOffices();
  await Office.updateOne({ code: "OTHER" }, { $set: { isActive: false } });

  const offices = await Office.find().select("name code isActive").lean();
  const office = (code: string): SeedOffice => {
    const found = offices.find((item) => item.code === code);
    if (!found) throw new Error(`Seed office ${code} missing`);
    return { id: String(found._id), name: found.name, code: found.code };
  };
  const A = office("DEAN-ADMIN");
  const B = office("ADSA");
  const inactive = office("OTHER");

  const emailDomain = `e2e-${runId}.example.org`;
  const specs: Record<SeedUserKey, { name: string; role: "admin" | "user"; officeId: string | null; isActive: boolean }> = {
    admin: { name: "E2E Administrator", role: "admin", officeId: null, isActive: true },
    userA: { name: "User A", role: "user", officeId: A.id, isActive: true },
    userB: { name: "User B", role: "user", officeId: B.id, isActive: true },
    inactive: { name: "Inactive User", role: "user", officeId: A.id, isActive: false },
    inactiveOffice: { name: "Other Office User", role: "user", officeId: inactive.id, isActive: true },
    expiry: { name: "Expiry Tester", role: "user", officeId: A.id, isActive: true },
    attempts: { name: "Attempts Tester", role: "user", officeId: A.id, isActive: true },
  };

  const users = {} as Record<SeedUserKey, SeedUser>;
  for (const [key, spec] of Object.entries(specs) as Array<[SeedUserKey, (typeof specs)[SeedUserKey]]>) {
    const email = `${key.replace(/[A-Z]/g, (letter) => `.${letter.toLowerCase()}`)}@${emailDomain}`;
    const doc = await User.create({ name: spec.name, email, role: spec.role, designation: "E2E", officeId: spec.officeId, isActive: spec.isActive });
    users[key] = { id: String(doc._id), name: spec.name, email, role: spec.role, officeId: spec.officeId };
  }

  return {
    runId,
    emailDomain,
    offices: { A, B, inactive },
    users,
    keywords: { a: `alpha${runId}`, b: `bravo${runId}`, milestone: `mile${runId}` },
  };
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(ROOT, ".scratch", "e2e", stamp);
  mkdirSync(outDir, { recursive: true });

  let mongo: MongoMemoryServer | null = null;
  let smtp: SmtpCatcher | null = null;
  let server: NextServer | null = null;
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await server?.stop().catch((error: unknown) => console.error("[e2e] stopping server:", error));
    await smtp?.stop().catch((error: unknown) => console.error("[e2e] stopping SMTP catcher:", error));
    await mongoose.disconnect().catch(() => undefined);
    await mongo?.stop().catch((error: unknown) => console.error("[e2e] stopping MongoDB:", error));
  };
  const onSignal = (signal: NodeJS.Signals) => {
    console.error(`\n[e2e] ${signal} received - cleaning up`);
    void cleanup().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  process.once("exit", () => server?.stopSync());

  try {
    if (!options.skipBuild) {
      console.log("=== BUILD: next build");
      const code = runNextBuild(ROOT, childBaseEnv());
      if (code !== 0) {
        console.error(`next build failed with exit code ${code}`);
        return 1;
      }
    } else if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
      console.error("--skip-build was given but .next/BUILD_ID does not exist. Run without --skip-build.");
      return 1;
    }

    if (await isPortInUse(options.port)) {
      console.error(`Port ${options.port} is already in use. Stop that process first: the runner only tests a server it started itself.`);
      return 1;
    }

    console.log("=== SETUP");
    mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
    const memoryUri = mongo.getUri("odums-e2e");
    if (!/^mongodb:\/\/(127\.0\.0\.1|localhost):\d+\//.test(memoryUri)) {
      throw new Error(`Refusing to continue: unexpected in-memory MongoDB URI ${memoryUri}`);
    }
    mongoose.set("strictQuery", true);
    await mongoose.connect(memoryUri, { serverSelectionTimeoutMS: 10_000 });

    const runId = randomLetters(8);
    const seed = await seedDatabase(runId);
    console.log(`  in-memory MongoDB ${memoryUri}; seeded run ${runId} (${seed.emailDomain})`);

    smtp = new SmtpCatcher();
    const smtpPort = await smtp.start();
    console.log(`  SMTP catcher on 127.0.0.1:${smtpPort}`);

    const authSecret = randomBytes(36).toString("base64url");
    const serverEnv: NodeJS.ProcessEnv = {
      ...childBaseEnv(),
      NODE_ENV: "production",
      // A server timezone far from Asia/Kolkata exposes accidental local-time date handling.
      TZ: "America/Los_Angeles",
      MONGODB_URI: memoryUri,
      AUTH_SECRET: authSecret,
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(smtpPort),
      SMTP_USER: "",
      SMTP_PASSWORD: "",
      OTP_EMAIL_FROM: "no-reply@test.local",
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
      MAX_FILE_SIZE_MB: "1",
    };
    const logFile = path.join(outDir, "server.log");
    server = new NextServer({ root: ROOT, port: options.port, env: serverEnv, logFile });
    const baseUrl = `http://localhost:${options.port}`;
    server.start();
    console.log(`  next start -p ${options.port} (pid ${server.pid}); log ${path.relative(ROOT, logFile)}`);
    await server.waitUntilReady(`${baseUrl}/login`);
    console.log("  server ready");

    const activeServer = server;
    const harness = new Harness({
      mark: () => activeServer.lines.length,
      diagnostics: (marker) =>
        activeServer.lines
          .slice(marker)
          .filter((line) => line.text.trim() !== "")
          .map((line) => `[${line.stream}] ${line.text}`)
          .slice(0, 40)
          .join("\n"),
    });

    const responses: RecordedResponse[] = [];
    const record = (response: RecordedResponse) => responses.push(response);
    let clientCounter = 20;
    const makeClient = (label: string) => new HttpClient(label, baseUrl, record, `198.51.100.${clientCounter++}`);

    const ctx: E2EContext = {
      h: harness,
      baseUrl,
      smtp,
      server,
      seed,
      authSecret,
      memoryUri,
      responses,
      clients: {
        anon: makeClient("anonymous"),
        admin: makeClient("admin"),
        userA: makeClient("userA"),
        userB: makeClient("userB"),
      },
      state: {},
      newClient: makeClient,
      abort: (reason: string) => {
        throw new AbortRun(reason);
      },
    };

    const sections = [
      runAuthSection,
      runDailySection,
      runVisitorsSection,
      runAuthzSection,
      runReportsSection,
      runUploadsSection,
      runPagesSection,
      runSecuritySection,
      runFinalSection,
    ];
    try {
      for (const section of sections) {
        if (activeServer.exited) throw new AbortRun(`the server process exited (code ${activeServer.exitCode})`);
        await section(ctx);
      }
    } catch (error) {
      if (!(error instanceof AbortRun)) throw error;
      console.error(`\n[e2e] RUN ABORTED: ${error.message}`);
      harness.results.push({ section: "RUN", name: "run aborted", status: "fail", details: error.message, durationMs: 0 });
    }

    harness.printSummary();
    const counts = harness.counts();
    writeFileSync(
      path.join(outDir, "results.json"),
      JSON.stringify({ runId, baseUrl, counts, results: harness.results }, null, 2),
    );
    console.log(`Results: ${path.relative(ROOT, path.join(outDir, "results.json"))}  Server log: ${path.relative(ROOT, logFile)}`);
    return counts.fail > 0 ? 1 : 0;
  } finally {
    await cleanup();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("[e2e] runner error:", error);
    process.exitCode = 1;
  });
