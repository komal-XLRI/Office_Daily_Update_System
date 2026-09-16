import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const fromRoot = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // The real package throws outside React Server Components; tests import server modules directly.
      { find: /^server-only$/, replacement: fromRoot("./tests/stubs/server-only.ts") },
      { find: "@", replacement: fromRoot("./src") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every test file runs in its own child process. Database suites start their own in-memory MongoDB
    // (tests/setup/db.ts), so files never share a database or a mongoose connection.
    pool: "forks",
    isolate: true,
    env: {
      NODE_ENV: "test",
      NEXT_PUBLIC_APP_TIMEZONE: "Asia/Kolkata",
      // Run under a server timezone far from Asia/Kolkata so accidental use of local-time getters fails.
      TZ: "America/Los_Angeles",
    },
    unstubEnvs: true,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
  },
});
