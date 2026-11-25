import fs from "node:fs";

import { runDependencyAuditGate } from "../src/test/dependency-audit";
import { dependencyAuditVerdict, resolveDependencyAuditScope } from "../src/test/dependency-audit-scope";

// Blocking only when the pull request or push changes a dependency file; otherwise a red audit
// is a warning (src/test/dependency-audit-scope.ts). Locally, it always blocks.
const scope = resolveDependencyAuditScope();
let failure: string | null = null;
try {
  const result = runDependencyAuditGate();
  console.log(
    `Dependency audit passed (${result.findings.length} blocking advisories, ${result.exceptedFindings.length} active exceptions).`
  );
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const verdict = dependencyAuditVerdict(scope, failure);
if (failure !== null) {
  if (verdict.exitCode === 0) {
    console.log(verdict.annotation);
    console.log(`Not blocking: ${scope.reason}.`);
  } else {
    console.error(failure);
    console.error(`Blocking: ${scope.reason}.`);
  }
}
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, verdict.summary);
}
process.exitCode = verdict.exitCode;
