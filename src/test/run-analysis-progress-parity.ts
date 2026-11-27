import { execFileSync } from "node:child_process";
import { runLocalSupabaseCi } from "./local-supabase-ci";

// node --import tsx src/test/run-analysis-progress-parity.ts

// The standard runner owns the native stack and destroys it even on test failure.
runLocalSupabaseCi({
  pgTapFiles: ["takeoff-progress-poll-indexes.test.sql"],
  async runApplication(environment) {
    execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "node",
      "src/test/analysis-progress-jobs.integration.test.ts"], {
      env: {
        ...environment, NODE_ENV: "test", MERGEONE_TEST_ANALYSIS_PROGRESS_PARITY: "1",
        ANALYSIS_PROGRESS_PARITY_EVIDENCE: process.env.ANALYSIS_PROGRESS_PARITY_EVIDENCE,
      },
      stdio: "inherit",
    });
  },
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
