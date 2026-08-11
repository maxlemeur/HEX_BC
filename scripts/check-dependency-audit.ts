import { runDependencyAuditGate } from "../src/test/dependency-audit";

try {
  const result = runDependencyAuditGate();
  console.log(
    `Dependency audit passed (${result.findings.length} blocking advisories, ${result.exceptedFindings.length} active exceptions).`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
