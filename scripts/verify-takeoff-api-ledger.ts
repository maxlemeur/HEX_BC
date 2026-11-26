import { execFileSync } from "node:child_process";
import { runLocalSupabaseCi } from "../src/test/local-supabase-ci";

runLocalSupabaseCi({
  pgTapFiles: ["takeoff-personal-api-mandate.test.sql"],
  async runApplication(environment) {
    execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", "node",
      "src/test/takeoff-api-ledger.integration.test.ts"], {
      env: { ...environment, NODE_ENV: "test", MERGEONE_TEST_TAKEOFF_API_LEDGER: "1" },
      stdio: "inherit",
    });
  },
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
