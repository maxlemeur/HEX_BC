import { rm } from "node:fs/promises";

import { run } from "e2e/runner";

import { output } from "../../e2e-production-qa.config.ts";

const testFailures = new Set([
  "QA_ORIGIN", "QA_LOGIN", "QA_LOGIN_REJECTED", "QA_TENANT", "QA_ROLE", "QA_MEMBERSHIP", "QA_ESTIMATE",
]);

async function check() {
  if (!process.env.E2E_LOGIN_EMAIL || !process.env.E2E_LOGIN_PASSWORD) return "QA_SECRETS";

  try {
    const result = await run({ config: "e2e-production-qa.config.ts" });
    const [test] = result.report.run.results;
    const [attempt] = test?.attempts ?? [];
    if (result.exitCode === 0 && result.report.run.results.length === 1 && attempt?.status === "passed") {
      return "QA_OK";
    }
    const message = attempt?.error?.message;
    return message && testFailures.has(message) ? message : "QA_RUNNER";
  } finally {
    await rm(new URL(`../../${output}`, import.meta.url), { recursive: true, force: true });
  }
}

// The raw runner report, response bodies, and exception details stay out of Actions logs.
const result = await check().catch(() => "QA_RUNNER");
console.log(result);
process.exitCode = result === "QA_OK" ? 0 : 1;
