import fs from "node:fs";
import path from "node:path";
import { copyScrubbed, scrubber } from "./calc-v3-campaign";

export async function runExplorationCampaign(input: {
  root: string; evidence: string; environment: NodeJS.ProcessEnv;
  run: (args: string[], environment: NodeJS.ProcessEnv, name: string) => Promise<void>;
  redact: (value: string) => string;
}) {
  const output = path.join(input.root, ".e2e/army/exploration", path.basename(input.evidence));
  const retained = path.join(input.evidence, "exploration");
  const business = path.join(input.root, ".e2e/army/critical/artifacts/business");
  const before = new Set(fs.existsSync(business) ? fs.readdirSync(business) : []);
  const env = { ...input.environment, E2E_ARMY_SUITE: "critical", E2E_ARMY_EXPLORATION_OWNED: "1",
    E2E_ARMY_EXPLORATION_OUTPUT: output, E2E_ARMY_ARTIFACT_ROOT: path.join(output, "results") };
  try {
    await input.run([path.join(input.root, "node_modules/e2e/dist/cli/bin.js"), "run", "--config", "e2e.exploration.config.ts",
      "--target", "chromium-desktop", "--workers", "1", "--retries", "0", "--no-cache", "--trace", "off"], env, "exploration");
    const report = JSON.parse(fs.readFileSync(path.join(output, "report.json"), "utf8"));
    const results = report.run?.results ?? [];
    if (results.length !== 4 || results.some((result: { status: string }) => result.status !== "passed")) {
      throw new Error("Exploration requires its setup and all three persona outcomes; blocked and skipped are not passes.");
    }
    return { status: "passed", scope: "three bounded read-only agent goals with exact destination assertions", report: "exploration/report.json" };
  } finally {
    const scrub = scrubber(input.redact);
    for (const name of ["report.json", "results", "logs", "summary.md"]) copyScrubbed(path.join(output, name), path.join(retained, name), scrub);
    for (const file of fs.existsSync(business) ? fs.readdirSync(business) : []) {
      if (!before.has(file)) copyScrubbed(path.join(business, file), path.join(retained, "business", file), scrub);
    }
  }
}
