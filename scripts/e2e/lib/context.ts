import type { Harness } from "./harness";
import type { HttpClient, RecordedResponse } from "./http";
import type { NextServer } from "./processes";
import type { SmtpCatcher } from "./smtp";

/** Shared state passed to every section of the end-to-end run. */

export interface SeedOffice {
  id: string;
  name: string;
  code: string;
}

export interface SeedUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  officeId: string | null;
}

export type SeedUserKey = "admin" | "userA" | "userB" | "inactive" | "inactiveOffice" | "expiry" | "attempts";

export interface SeedData {
  runId: string;
  emailDomain: string;
  offices: { A: SeedOffice; B: SeedOffice; inactive: SeedOffice };
  users: Record<SeedUserKey, SeedUser>;
  /** Unique words used to find (or prove the absence of) each office's data in responses. */
  keywords: { a: string; b: string; milestone: string };
}

/** Ids created during the run; undefined when the creating check failed. */
export interface E2EState {
  dailyA?: string;
  dailyB?: string;
  visitorA?: string;
  visitorANoDeparture?: string;
  visitorB?: string;
  visitorBName?: string;
}

export interface E2EClients {
  anon: HttpClient;
  admin: HttpClient;
  userA: HttpClient;
  userB: HttpClient;
}

export interface E2EContext {
  h: Harness;
  baseUrl: string;
  smtp: SmtpCatcher;
  server: NextServer;
  seed: SeedData;
  authSecret: string;
  memoryUri: string;
  responses: RecordedResponse[];
  clients: E2EClients;
  state: E2EState;
  /** A new cookie-less client with its own simulated client address. */
  newClient(label: string): HttpClient;
  /** Stop the run (cleanup and summary still happen). */
  abort(reason: string): never;
}

/** Fixed business dates used throughout (spec §57 example date). */
export const DATE = "2026-09-08";
export const NEXT_DAY = "2026-09-09";
export const LATER_DATE = "2026-09-10";
