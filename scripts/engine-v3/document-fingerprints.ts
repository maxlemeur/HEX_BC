import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { runLocalSupabaseCi } from "../../src/test/local-supabase-ci";
import { createLocalCiEnvironment, type SupabaseEnvironment } from "../../src/test/supabase-cli";
import { buildSourceEvidence, redactOutput, sqlInventory } from "../tester-army/local-recipe-common.mjs";
import { corpusDigest, FAMILIES } from "./document-fingerprints-corpus";
import {
  aggregateFingerprints,
  assertComparatorSensitivity,
  canonicalize,
  compareFingerprints,
  DEFAULT_BASELINE_PATH,
  FINGERPRINT_SCHEMA_VERSION,
  sha256Hex,
  type FingerprintDocument,
  type FingerprintSet,
} from "./document-fingerprints-format";

/**
 * Lot 2, sub-lot 2.0 — document fingerprints (conception-lot2-moteur-v3.md
 * §10.3, invariant I3). On an owned disposable native stack
 * (runLocalSupabaseCi: db reset, pgTAP, RLS matrix, then this hook), the
 * worker seeds a fixed v1/v2 corpus and drives the real server functions; this
 * entry point records the baseline or compares a later run with it.
 *
 *   node --import tsx scripts/engine-v3/document-fingerprints.ts record [--out <file>] [--force]
 *   node --import tsx scripts/engine-v3/document-fingerprints.ts check [--baseline <file>]
 *
 * Linux or macOS only (native runtime), one owned stack at a time; on Windows,
 * inside WSL from a Linux clone. Never targets a shared or hosted Supabase.
 */

type Mode = "record" | "check";
type WorkerResult = {
  schemaVersion: string;
  corpusSha256: string;
  runtime: { node: string; icu: string | null; platform: string; timeZone: string; nodeEnv: string | null };
  families: FingerprintSet;
};

const usage = "Usage: document-fingerprints.ts record [--out <file>] [--force] | check [--baseline <file>]";

function parseArguments(argv: string[]) {
  const mode = argv[0];
  if (mode !== "record" && mode !== "check") throw new Error(usage);
  let file = DEFAULT_BASELINE_PATH;
  let force = false;
  const seen = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const option = argv[index];
    if (seen.has(option)) throw new Error(usage);
    seen.add(option);
    if (option === "--force" && mode === "record") {
      force = true;
    } else if ((option === "--out" && mode === "record") || (option === "--baseline" && mode === "check")) {
      const value = argv[index + 1];
      if (!value?.trim() || value.startsWith("--")) throw new Error(usage);
      file = value;
      index += 1;
    } else {
      throw new Error(usage);
    }
  }
  return { mode: mode as Mode, file, force };
}

function insideRoot(root: string, file: string) {
  const resolved = path.resolve(root, file);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !relative.endsWith(".json")) {
    throw new Error("Fingerprint files are JSON files inside the repository.");
  }
  return resolved;
}

function readBaseline(file: string): FingerprintDocument {
  const document = JSON.parse(fs.readFileSync(file, "utf8")) as FingerprintDocument;
  if (document.schemaVersion !== FINGERPRINT_SCHEMA_VERSION || !document.fingerprints ||
    aggregateFingerprints(document.fingerprints) !== document.aggregateSha256) {
    throw new Error("The baseline is not an intact fingerprint document of this schema.");
  }
  if (document.corpusSha256 !== corpusDigest()) {
    throw new Error("The corpus definition changed since the baseline was recorded; the baseline cannot prove anything.");
  }
  return document;
}

async function main() {
  const { mode, file, force } = parseArguments(process.argv.slice(2));
  const root = process.cwd();
  const directory = path.join(root, "scripts", "engine-v3");
  if (!fs.existsSync(path.join(directory, "document-fingerprints-worker.ts"))) {
    throw new Error("Run the document fingerprints from the repository root.");
  }
  const target = insideRoot(root, file);
  if (mode === "record" && fs.existsSync(target) && !force) {
    throw new Error("A baseline already exists. Record it again only on the unmodified 2.0 base, with --force.");
  }
  const baseline = mode === "check" ? readBaseline(target) : null;
  const evidence = path.join(root, ".e2e", "engine-v3", "document-fingerprints",
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${mode}`);
  fs.mkdirSync(evidence, { recursive: true });
  const ownerPassword = `Fp-${randomUUID()}-A1!`;
  const knownSecrets: string[] = [ownerPassword];
  const redact = (value: string) => redactOutput(value,
    { NODE_ENV: "production", ...Object.fromEntries(knownSecrets.map((secret, index) => [`SECRET_${index}`, secret])) });
  const migrations = await sqlInventory(path.join(root, "supabase", "migrations"));
  const manifest: Record<string, unknown> = {
    schemaVersion: "engine-document-fingerprints-run-1",
    mode,
    command: [process.execPath, ...process.argv.slice(1)],
    target: path.relative(root, target).replaceAll("\\", "/"),
    node: process.version,
    icu: process.versions.icu ?? null,
    platform: `${process.platform}-${process.arch}`,
    startedAt: new Date().toISOString(),
    corpusSha256: corpusDigest(),
    families: FAMILIES.map((family) => family.key),
    status: "preparing",
    source: await buildSourceEvidence(),
    database: { migrations },
  };

  async function runWorker(local: SupabaseEnvironment) {
    if (local.RLS_E2E_EPHEMERAL !== "1" || local.RLS_E2E_LOCAL !== "1") throw new Error("An owned ephemeral stack is required.");
    const api = new URL(local.NEXT_PUBLIC_SUPABASE_URL ?? "missing:");
    if (api.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(api.hostname) || api.username ||
      api.password || api.pathname !== "/" || api.search || api.hash) {
      throw new Error("Only the owned bare loopback HTTP backend is allowed.");
    }
    if (!local.NEXT_PUBLIC_SUPABASE_ANON_KEY || !local.SUPABASE_SERVICE_ROLE_KEY ||
      !local.E2E_ARMY_LOCAL_DB_URL || !local.E2E_ARMY_LOCAL_PSQL) {
      throw new Error("The owned stack keys and local SQL transport are required.");
    }
    knownSecrets.push(local.NEXT_PUBLIC_SUPABASE_ANON_KEY, local.SUPABASE_SERVICE_ROLE_KEY, local.E2E_ARMY_LOCAL_DB_URL,
      decodeURIComponent(new URL(local.E2E_ARMY_LOCAL_DB_URL).password),
      ...Object.entries(local).filter(([name, value]) => /^RLS_E2E_.*_(EMAIL|PASSWORD)$/.test(name) && value)
        .map(([, value]) => value as string));
    manifest.backend = api.origin;
    const environment: NodeJS.ProcessEnv = {
      ...createLocalCiEnvironment(process.env),
      NODE_ENV: "production",
      TZ: "UTC",
      LANG: "C.UTF-8",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: api.origin,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SUPABASE_SERVICE_ROLE_KEY,
      ENGINE_FP_DB_URL: local.E2E_ARMY_LOCAL_DB_URL,
      ENGINE_FP_PSQL: local.E2E_ARMY_LOCAL_PSQL,
      ENGINE_FP_EVIDENCE: evidence,
      ENGINE_FP_OWNER_PASSWORD: ownerPassword,
      RESEND_API_KEY: "", EMAIL_FROM: "", GEMINI_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "",
    };
    const args = ["--import", "tsx", "--import", pathToFileURL(path.join(directory, "document-fingerprints-hooks.mjs")).href,
      path.join(directory, "document-fingerprints-worker.ts")];
    manifest.worker = { command: [process.execPath, ...args], nodeEnv: "production", timeZone: "UTC" };
    const chunks: Buffer[] = [];
    let pending = "";
    // Whole lines only: a redaction must never straddle two chunks.
    const echo = (text: string, flush = false) => {
      pending += text;
      const lines = pending.split("\n");
      pending = flush ? "" : lines.pop() ?? "";
      for (const line of lines) if (line) console.log(redact(line));
    };
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
      let bytes = 0;
      const capture = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes <= 16 * 1024 * 1024) chunks.push(chunk);
        echo(chunk.toString("utf8"));
      };
      const timer = setTimeout(() => child.kill("SIGTERM"), 30 * 60_000);
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code, signal) => { clearTimeout(timer); resolve(code ?? (signal ? 130 : 3)); });
    });
    echo("", true);
    fs.writeFileSync(path.join(evidence, "worker.log"), redact(Buffer.concat(chunks).toString("utf8")));
    manifest.workerExitCode = exitCode;
    if (exitCode !== 0) throw new Error(`The fingerprint worker failed with exit code ${exitCode}; see worker.log.`);
  }

  try {
    await runLocalSupabaseCi({
      runApplication: runWorker,
      log: (message) => {
        const line = redact(message);
        fs.appendFileSync(path.join(evidence, "database.log"), `${line}\n`);
        console.log(line);
      },
    });
    const result = JSON.parse(fs.readFileSync(path.join(evidence, "worker-result.json"), "utf8")) as WorkerResult;
    if (result.schemaVersion !== "engine-document-fingerprints-worker-1" || result.corpusSha256 !== corpusDigest() ||
      Object.keys(result.families).sort().join() !== FAMILIES.map((family) => family.key).sort().join()) {
      throw new Error("The worker result does not cover exactly the corpus families.");
    }
    manifest.comparatorControl = assertComparatorSensitivity(result.families);
    const source = manifest.source as { revision: string; diffSha256: string };
    const document: FingerprintDocument = {
      schemaVersion: FINGERPRINT_SCHEMA_VERSION,
      description: "Empreintes SHA-256 des documents client v1/v2 (données préparées du PDF, contrat client, preuve et sceaux 1 à 5, export XLSX relu, montants persistés) sur le corpus figé de scripts/engine-v3/document-fingerprints-corpus.ts. Chaque sous-lot du lot 2 doit les reproduire à l'identique avec `check`.",
      generator: {
        script: "scripts/engine-v3/document-fingerprints.ts",
        design: "docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md §10.3",
      },
      recorded: {
        at: new Date().toISOString(),
        sourceRevision: source.revision,
        sourceDiffSha256: source.diffSha256,
        node: result.runtime.node,
        icu: result.runtime.icu,
        platform: result.runtime.platform,
        migrations: migrations.length,
        migrationsSha256: sha256Hex(JSON.stringify(migrations)),
      },
      corpusSha256: result.corpusSha256,
      aggregateSha256: aggregateFingerprints(result.families),
      fingerprints: result.families,
    };
    const text = `${JSON.stringify(canonicalize(document), null, 2)}\n`;
    manifest.aggregateSha256 = document.aggregateSha256;
    if (mode === "record") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
      fs.writeFileSync(path.join(evidence, "fingerprints.json"), text);
      manifest.status = "recorded";
    } else {
      fs.writeFileSync(path.join(evidence, "after.json"), text);
      const differences = compareFingerprints(baseline!.fingerprints, document.fingerprints);
      const runtimeWarnings = [
        ...(baseline!.recorded.node !== document.recorded.node ? [`node ${baseline!.recorded.node} -> ${document.recorded.node}`] : []),
        ...(baseline!.recorded.icu !== document.recorded.icu ? [`icu ${baseline!.recorded.icu} -> ${document.recorded.icu}`] : []),
      ];
      fs.writeFileSync(path.join(evidence, "comparison.json"), `${JSON.stringify({
        baseline: path.relative(root, target).replaceAll("\\", "/"),
        baselineAggregateSha256: baseline!.aggregateSha256,
        afterAggregateSha256: document.aggregateSha256,
        differences,
        runtimeWarnings,
      }, null, 2)}\n`);
      manifest.differences = differences.length;
      manifest.runtimeWarnings = runtimeWarnings;
      manifest.status = differences.length === 0 ? "identical" : "different";
      for (const difference of differences.slice(0, 50)) {
        console.error(`DIFF ${difference.path}: ${JSON.stringify(difference.before)} -> ${JSON.stringify(difference.after)}`);
      }
      if (differences.length > 0) process.exitCode = 1;
    }
  } catch (error) {
    manifest.status = "failed";
    manifest.error = redact(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    try {
      scanEvidence(evidence, knownSecrets);
      manifest.privacy = "passed";
    } catch (error) {
      manifest.privacy = "failed";
      manifest.status = "failed";
      manifest.error = error instanceof Error ? error.message : String(error);
      process.exitCode = 1;
    }
    fs.writeFileSync(path.join(evidence, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Document fingerprints ${String(manifest.status)}; evidence: ${path.relative(root, evidence)}`);
  }
}

/** No stack key, connection string, session or owner password may leave the run. */
function scanEvidence(directory: string, secrets: string[]) {
  const visit = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Fingerprint evidence must not contain symlinks.");
      if (entry.isDirectory()) { visit(file); continue; }
      const text = fs.readFileSync(file, "utf8");
      if (secrets.some((secret) => secret && (text.includes(secret) || text.includes(encodeURIComponent(secret)))) ||
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text) || /Bearer\s+[A-Za-z0-9._~+/-]+=*/i.test(text) ||
        /postgres(?:ql)?:\/\/[^\s"']+/.test(text)) {
        throw new Error(`Fingerprint evidence failed the privacy check: ${path.relative(directory, file)}.`);
      }
    }
  };
  visit(directory);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
