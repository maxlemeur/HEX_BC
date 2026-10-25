import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { runLocalSupabaseCi } from "../src/test/local-supabase-ci";

const baselineArgument = process.argv.slice(2);
if (baselineArgument.length !== 1 || !/^[a-f0-9]{7,40}$/.test(baselineArgument[0])) {
  throw new Error("Usage: node --import tsx scripts/verify-shared-base-upgrade.ts <baseline-commit-sha>");
}
const baseline = execFileSync("git", ["rev-parse", "--verify", `${baselineArgument[0]}^{commit}`], { encoding: "utf8" }).trim();

// The normal runner owns the stack, verifies fresh types/RLS and destroys it
// even if the legacy-catalog upgrade fails. No ambient/shared connection is used.
runLocalSupabaseCi({
  pgTapFiles: ["shared-base-consolidation.test.sql"],
  async runApplication(environment) {
    const output = execFileSync(environment.E2E_ARMY_LOCAL_PSQL!, [
      "--dbname", environment.E2E_ARMY_LOCAL_DB_URL!, "-X", "--set", "ON_ERROR_STOP=1",
      "--file", path.resolve("supabase/tests/upgrade/shared-base-consolidation.sql"),
    ], { encoding: "utf8", env: { ...environment, NODE_ENV: "test" } });
    process.stdout.write(output);
    if (!output.includes("LOT33_UPGRADE_PASSED") || /\bnot ok \d+/.test(output)) {
      throw new Error("Legacy upgrade assertions failed or did not finish");
    }
    // These retained probes intentionally abort with P9001 after every case,
    // rolling back their users, data, triggers and session-local helper grants.
    console.log(`Retained probe baseline: ${baseline}`);
    for (const [file, marker, affectedCase] of [
      ["estimate-assembly-provenance-regression.sql", "ESTIMATE_ASSEMBLY_PROVENANCE_PROOF", "anonymous-refused"],
      ["estimate-batch-atomic-regression.sql", "ESTIMATE_BATCH_ATOMIC_PROOF", "anonymous"],
      ["estimate-generated-atomic-regression.sql", "ESTIMATE_GENERATED_ATOMIC_PROOF", "anonymous"],
      ["source-coverage-regression.sql", "SOURCE_COVERAGE_PROOF", "acl"],
    ]) {
      const runProbe = (sql: string, legacyDefaults: boolean) => {
        const result = spawnSync(environment.E2E_ARMY_LOCAL_PSQL!, [
          "--dbname", environment.E2E_ARMY_LOCAL_DB_URL!, "-X", "--set", "ON_ERROR_STOP=1",
          "--set", "VERBOSITY=verbose", "--file", "-",
        ], {
          encoding: "utf8", env: { ...environment, NODE_ENV: "test" }, maxBuffer: 8 * 1024 * 1024,
          input: `begin;\n${legacyDefaults ? "alter default privileges for role postgres grant execute on functions to public;" : ""}\n${sql}`,
        });
        const match = result.stderr?.match(new RegExp(`${marker}:(\\{[^\\n]+\\})`));
        if (result.error || result.status !== 3 || !/ERROR:\s+P9001:/.test(result.stderr) || !match) {
          throw new Error(`Retained SQL probe did not reach its mandatory rollback: ${file}`);
        }
        const proof = JSON.parse(match[1]) as { allPassed: boolean; cases: Array<{ case: string; passed: boolean; error: string | null }> };
        assert(proof.cases.length, `Empty probe: ${file}`);
        return proof;
      };
      const source = path.join("src/test/fixtures", file);
      const before = runProbe(execFileSync("git", ["show", `${baseline}:${source}`], { encoding: "utf8" }), true);
      const after = runProbe(fs.readFileSync(source, "utf8"), false);
      // Keep final product ACLs in both runs; restore only helper creation defaults
      // in the baseline transaction. Compare errors too, so an already-red case
      // cannot hide a new ACL failure. Existing obsolete expectations stay visible.
      assert.deepEqual(after.cases, before.cases, `Retained probe changed vs baseline: ${file}`);
      assert(after.cases.some((entry) => entry.case === affectedCase && entry.passed && entry.error === null),
        `Affected anonymous/ACL case did not pass: ${file}`);
      const existingFailures = after.cases.filter((entry) => !entry.passed || entry.error);
      console.log(`${file}: no regression vs baseline across ${after.cases.length} cases; ${existingFailures.length} existing failures; anonymous/ACL case passed; rollback confirmed.`);
      if (existingFailures.length) console.log(JSON.stringify({ file, existingFailures }));
    }
  },
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
