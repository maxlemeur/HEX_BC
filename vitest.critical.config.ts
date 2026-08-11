import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    maxWorkers: 2,
    include: [
      "src/lib/auth/tenant-context.test.ts",
      "src/lib/supabase/service-role.test.ts",
      "src/test/required-environment.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/auth/tenant-context.ts",
        "src/lib/supabase/service-role.ts",
        "src/test/required-environment.ts",
      ],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/critical",
      thresholds: {
        "src/lib/auth/tenant-context.ts": {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        "src/lib/supabase/service-role.ts": {
          statements: 80,
          branches: 75,
          functions: 100,
          lines: 90,
        },
        "src/test/required-environment.ts": {
          statements: 100,
          branches: 90,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
