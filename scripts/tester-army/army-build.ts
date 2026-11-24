// The army-build job of an Army workflow run (docs/testing/tester-army-ci.md, "Pile, confidentialité et diagnostic"):
// builds the production application once, for the origin and anon key of a bare native stack started only for that,
// and packages it for the shards and groups of the same run (scripts/tester-army/prebuilt-build.ts). The stack holds no
// migration, data or account and stays up while Next builds, as a shard's stack does. A shard serves this build only
// when the reuse rule proves it is its own checkout's build for its own backend; a failure here only makes it build.
//
// node --import tsx scripts/tester-army/army-build.ts --out DIRECTORY
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertLoopbackSupabaseUrl, withBareLocalStack } from "../../src/test/local-supabase-ci";
import { createLocalCiEnvironment } from "../../src/test/supabase-cli";
import { ARMY_DEFAULT_APP_PORT, armyApplicationEnvironment } from "./application-environment";
import { assertInstalledDependencies } from "./installed-dependencies.mjs";
import { redactOutput } from "./local-recipe-common.mjs";
import { packagePrebuiltBuild, PREBUILT_ARTIFACT } from "./prebuilt-build";

function outputTail(text: string, lines = 60) {
  return text.trimEnd().split(/\r?\n/u).slice(-lines).join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out" || !args[1].trim()) throw new Error("Usage: army-build.ts --out DIRECTORY");
  const out = path.resolve(args[1]);
  const root = process.cwd();
  assertInstalledDependencies(root);
  // The same refusals as run-tester-army-ci.ts: no inherited backend target, no ambient .env file.
  createLocalCiEnvironment(process.env);
  if (fs.readdirSync(root).some((name) => /^\.env(?:\.(?:local|production|development|test)(?:\.local)?)?$/.test(name))) {
    throw new Error("CI refuses ambient .env files; use a clean checkout without shared backend credentials.");
  }
  // A secret of this job only: it must never reach the published output (checked when packaging).
  const recoverySecret = randomUUID();
  const record = await withBareLocalStack(async (status) => {
    const backend = new URL(status.url);
    assertLoopbackSupabaseUrl(backend.href);
    const secrets = { NODE_ENV: "production" as const, SECRET_ANON: status.anonKey, SECRET_SERVICE: status.serviceRoleKey, SECRET_RECOVERY: recoverySecret };
    const redact = (text: string) => redactOutput(text, secrets);
    const environment = armyApplicationEnvironment({ root, backend, anonKey: status.anonKey, serviceRoleKey: status.serviceRoleKey,
      appPort: ARMY_DEFAULT_APP_PORT, recoverySecret });
    console.log(`TesterArmy build: building for ${backend.origin}`);
    const startedAt = Date.now();
    const output = await new Promise<{ code: number; text: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/tester-army/build-local.mjs", "--execute"], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code: code ?? (signal ? 130 : 3), text: Buffer.concat(chunks).toString("utf8") }));
    });
    const summaryLine = output.text.trimEnd().split(/\r?\n/u).reverse().find((line) => line.startsWith("{"));
    let summary: { status?: string; manifest?: string } = {};
    try { summary = summaryLine ? JSON.parse(summaryLine) : {}; } catch { /* reported below */ }
    if (output.code !== 0 || summary.status !== "built" || typeof summary.manifest !== "string") {
      const log = typeof summary.manifest === "string" ? path.join(root, path.dirname(summary.manifest), "build.log") : undefined;
      const detail = log && fs.existsSync(log) ? fs.readFileSync(log, "utf8") : output.text;
      throw new Error(`The production build failed (exit ${output.code}); last lines:\n${redact(outputTail(detail))}`);
    }
    console.log(`TesterArmy build: built in ${Math.round((Date.now() - startedAt) / 1000)} s (${summary.manifest})`);
    return packagePrebuiltBuild({
      root, out, buildManifestPath: path.join(root, summary.manifest), anonKey: status.anonKey,
      artifact: { name: PREBUILT_ARTIFACT, runId: process.env.GITHUB_RUN_ID ?? "local", runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1" },
      forbidden: [status.serviceRoleKey, recoverySecret],
    });
  }, { log: console.log });
  console.log(`TesterArmy build: packaged ${path.relative(root, out) || out} for ${record.backend} (output ${record.compiledOutputDigest.slice(0, 12)}, build manifest ${record.buildManifestSha256.slice(0, 12)})`);
}

main().catch((error) => {
  console.error(`TesterArmy build failed: ${redactOutput(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
