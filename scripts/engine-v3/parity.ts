// Lot 2, sub-lot 2.4: TS/SQL parity of engine 3 (design D12, §5.5 "TS contre SQL : 0 écart sur
// 10 000 lignes et 300 devis", §14 "2.4"), run in WSL like `npm run db:ci:local`:
// `npm run engine:v3:parity [-- --seed <n>]`.
//
// 1. generate the seeded cases (scripts/engine-v3/parity-cases.ts): 10 000 random lines priced
//    alone, 300 random estimates and named edge cases;
// 2. compute every case with the TS canonical adapter (computeEstimateV3Canonical) on the very
//    JSON text the SQL side reads;
// 3. own a disposable native stack with every repository migration (owned-native-stack.ts) and
//    compute the same JSON with private.estimate_v3_compute_items, as `postgres`, through the
//    native psql; a named SQL error is captured per case (message = code, SQLSTATE);
// 4. compare: canonical JSON deep-equal, or the same error code and SQLSTATE. Zero difference
//    is required.
// Evidence (outside the tracked tree): .e2e/engine-v3/parity/<timestamp>-seed-<n>/ with
// report.json, psql.log and the gzipped cases and outcomes. Secrets never reach the evidence.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { gzipSync } from "node:zlib";

import {
  assertRecipeHost,
  buildSourceEvidence,
  newEvidenceDirectory,
} from "../tester-army/local-recipe-common.mjs";
import { NEVER_ALLOCATED_PORTS, withOwnedNativeStack } from "./owned-native-stack";
import {
  computeTsOutcome,
  DEFAULT_PARITY_SEED,
  describeParityCoverage,
  generateParityCases,
  type ParityCase,
  type ParityOutcome,
} from "./parity-cases";

const WORKDIR_PREFIX = "miaouffrage-supabase-ci-parity-";

type Difference = { caseId: number; family: string; label: string; ts: unknown; sql: unknown };

function parseSeed(args: string[]) {
  if (args.length === 0) return DEFAULT_PARITY_SEED;
  if (args.length === 2 && args[0] === "--seed" && /^\d{1,9}$/.test(args[1])) return Number(args[1]);
  throw new Error("Usage: npm run engine:v3:parity [-- --seed <n>] (n: up to 9 digits)");
}

function copyText(value: string, label: string) {
  // COPY text format: our canonical JSON never carries a backslash, tab or line break.
  if (/[\\\t\r\n]/.test(value)) throw new Error(`Case ${label} cannot be written as COPY text`);
  return value;
}

function unescapeCopy(value: string) {
  return value.replace(/\\(.)/g, (_match, char: string) =>
    char === "t" ? "\t" : char === "n" ? "\n" : char === "r" ? "\r" : char
  );
}

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function summarize(outcome: ParityOutcome) {
  return "ok" in outcome ? "ok" : `${outcome.error.code} (${outcome.error.sqlstate})`;
}

async function main() {
  const seed = parseSeed(process.argv.slice(2));
  assertRecipeHost();
  const startedAt = new Date();
  const evidence = await newEvidenceDirectory(
    "engine-v3/parity",
    `${startedAt.toISOString().replace(/[:.]/g, "-")}-seed-${seed}`
  );
  const log = (message: string) => console.log(`Engine v3 parity: ${message}`);
  const report: Record<string, unknown> = {
    schemaVersion: "engine-v3-parity-1",
    seed,
    status: "running",
    startedAt: startedAt.toISOString(),
    command: [process.execPath, ...process.argv.slice(1)],
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
  const writeReport = () => fs.writeFileSync(path.join(evidence, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  const source = await buildSourceEvidence();
  report.source = {
    revision: source.revision,
    diffSha256: source.diffSha256,
    inputsSha256: sha256(JSON.stringify(source.inputs)),
  };

  const cases = generateParityCases(seed);
  const tsStarted = performance.now();
  const tsOutcomes = cases.map((entry) => computeTsOutcome(entry));
  const tsDurationMs = Math.round(performance.now() - tsStarted);
  const casesText = cases
    .map((entry) => `${entry.id}\t${copyText(entry.text.items, entry.label)}\t${copyText(entry.text.params, entry.label)}`)
    .join("\n");
  fs.writeFileSync(path.join(evidence, "cases.tsv.gz"), gzipSync(`${casesText}\n`));
  const count = (family: ParityCase["family"]) => cases.filter((entry) => entry.family === family).length;
  report.cases = {
    total: cases.length,
    lines: count("line"),
    estimates: count("estimate"),
    edge: count("edge"),
    linesInEstimates: cases
      .filter((entry) => entry.family === "estimate")
      .reduce((total, entry) => total + entry.input.items.filter((item) => item.item_type === "line").length, 0),
    sha256: sha256(casesText),
  };
  report.ts = { durationMs: tsDurationMs };
  report.coverage = describeParityCoverage(cases, tsOutcomes);
  log(`${cases.length} cases generated (seed ${seed}); TS computed them in ${tsDurationMs} ms.`);

  const owned = await withOwnedNativeStack(
    { prefix: WORKDIR_PREFIX, psqlLog: path.join(evidence, "psql.log"), log },
    (stack) => {
      report.stack = { projectId: stack.projectId, ports: stack.ports, neverAllocated: NEVER_ALLOCATED_PORTS };
      report.psql = stack.psqlVersion;
      const directory = path.join(stack.rootDirectory, "parity");
      fs.mkdirSync(directory);
      const casesFile = path.join(directory, "cases.tsv");
      const outcomesFile = path.join(directory, "sql-outcomes.tsv");
      const scriptFile = path.join(directory, "parity.sql");
      fs.writeFileSync(casesFile, `${casesText}\n`);
      fs.writeFileSync(
        scriptFile,
        [
          "create temporary table parity_case (case_id integer primary key, items jsonb not null, params jsonb not null);",
          `\\copy parity_case (case_id, items, params) from '${casesFile}'`,
          "create function pg_temp.parity_run(p_items jsonb, p_params jsonb) returns jsonb language plpgsql as $$",
          "begin",
          "  return jsonb_build_object('ok', private.estimate_v3_compute_items(p_items, p_params));",
          "exception when others then",
          "  return jsonb_build_object('error', jsonb_build_object('code', sqlerrm, 'sqlstate', sqlstate));",
          "end;",
          "$$;",
          `\\copy (select case_id, pg_temp.parity_run(items, params)::text from parity_case order by case_id) to '${outcomesFile}'`,
          "",
        ].join("\n")
      );
      const sqlStarted = performance.now();
      stack.psql(["-q", "-f", scriptFile], "compute every case with private.estimate_v3_compute_items");
      const sqlDurationMs = Math.round(performance.now() - sqlStarted);
      const text = fs.readFileSync(outcomesFile, "utf8");
      fs.writeFileSync(path.join(evidence, "sql-outcomes.tsv.gz"), gzipSync(text));
      return { text, sqlDurationMs };
    }
  );
  report.cleanup = owned.cleanup;
  if (owned.error || owned.cleanupErrors.length > 0 || !owned.result) {
    report.status = "failed";
    report.error = [owned.error instanceof Error ? owned.error.message : undefined, ...owned.cleanupErrors]
      .filter(Boolean)
      .join("\n");
    report.finishedAt = new Date().toISOString();
    writeReport();
    throw new Error(`${String(report.error)}\nEvidence: ${evidence}`);
  }

  const sqlOutcomes = new Map<number, ParityOutcome>();
  for (const row of owned.result.text.split("\n").filter(Boolean)) {
    const tab = row.indexOf("\t");
    const parsed = JSON.parse(unescapeCopy(row.slice(tab + 1))) as ParityOutcome;
    sqlOutcomes.set(Number(row.slice(0, tab)), parsed);
  }
  const differences: Difference[] = [];
  const outcomeCounts: Record<string, number> = {};
  cases.forEach((entry, index) => {
    const ts = tsOutcomes[index];
    const sql = sqlOutcomes.get(entry.id);
    const key = `${entry.family}: ${summarize(ts)}`;
    outcomeCounts[key] = (outcomeCounts[key] ?? 0) + 1;
    if (!sql || !isDeepStrictEqual(ts, sql)) {
      differences.push({ caseId: entry.id, family: entry.family, label: entry.label, ts, sql: sql ?? "missing" });
    }
  });
  // Negative control: one cent changed in one SQL outcome must be reported by the comparison.
  const controlIndex = cases.findIndex((entry, index) => entry.family === "estimate" && "ok" in tsOutcomes[index]);
  const controlOutcome = structuredClone(sqlOutcomes.get(cases[controlIndex].id)) as {
    ok: { totals: { total_ht_cents: number } };
  };
  controlOutcome.ok.totals.total_ht_cents += 1;
  report.negativeControl = {
    caseId: cases[controlIndex].id,
    mutation: "totals.total_ht_cents + 1 in the SQL outcome",
    verdict: isDeepStrictEqual(tsOutcomes[controlIndex], controlOutcome) ? "missed" : "detected",
  };
  report.sql = { durationMs: owned.result.sqlDurationMs, outcomes: sqlOutcomes.size };
  report.outcomes = outcomeCounts;
  report.differenceCount = differences.length;
  report.differences = differences.slice(0, 50);
  report.verdict = differences.length === 0 && sqlOutcomes.size === cases.length ? "identical" : "different";
  report.status =
    report.verdict === "identical" && (report.negativeControl as { verdict: string }).verdict === "detected"
      ? "passed"
      : "failed";
  report.finishedAt = new Date().toISOString();
  writeReport();
  log(`SQL computed ${sqlOutcomes.size} cases in ${owned.result.sqlDurationMs} ms.`);
  log(`outcomes: ${JSON.stringify(outcomeCounts)}`);
  if (report.status !== "passed") {
    for (const difference of differences.slice(0, 5)) {
      log(`difference in case ${difference.caseId} (${difference.label}): ${JSON.stringify(difference).slice(0, 600)}`);
    }
    throw new Error(`TS/SQL parity failed: ${differences.length} difference(s). Evidence: ${evidence}`);
  }
  log(`passed: ${cases.length} cases, 0 difference. Evidence: ${evidence}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
