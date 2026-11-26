import { execFileSync } from "node:child_process";
import { runLocalSupabaseCi } from "../src/test/local-supabase-ci";

// The standard runner owns the native stack and destroys it even on test failure.
runLocalSupabaseCi({
  pgTapFiles: ["intake-ai-request-settings.test.sql"],
  async runApplication(environment) {
    execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "node",
      "src/test/intake-ai-ledger.integration.test.ts"], {
      env: { ...environment, NODE_ENV: "test", MERGEONE_TEST_INTAKE_AI_LEDGER: "1" },
      stdio: "inherit",
    });
  },
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
