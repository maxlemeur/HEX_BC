import { execFileSync } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import { assertLocalChatGptOverride, callLocalChatGptStructured, type LocalChatGptOverride } from "@/lib/ai/chatgpt-local-inference";
import { readChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { BENCH_USAGE, BenchUsageError, benchCouples, parseBenchArgs, parseBenchOwner } from "@/lib/takeoff/bench/args";
import { BenchDatasetError, loadBenchDataset } from "@/lib/takeoff/bench/dataset";
import { buildBenchReport, renderBenchReportMarkdown, type BenchReportMetadata } from "@/lib/takeoff/bench/report";
import {
  classifyCallError,
  describeError,
  planBenchDocuments,
  runTakeoffBench,
  stoppedBeforeRun,
  type BenchCouple,
  type BenchRunResult,
  type PlannedDocument,
  type RequestedCouple,
  type StopReason,
} from "@/lib/takeoff/bench/run";
import { buildScoreScopes } from "@/lib/takeoff/bench/score";

// `npm run takeoff:bench -- --dataset <dir> --docs <ids|all> --models <...> --efforts <...> [--repeat <n>] --out <run_path>`
// (TI-660): the production level C reading of the private bench plans through the
// local ChatGPT profile, scored per key, without persistence. Run it alone (the
// durations are the bench clock's) from the checkout that holds the ChatGPT store
// (.private/chatgpt-local under the working directory). From another checkout,
// TSX_TSCONFIG_PATH must point to this script's tsconfig.json, so that `@/` is
// this checkout's code. The model and effort of the profile are never written:
// a couple other than the profile's is sent as an override, validated against
// the account's models before the first call (read-only, once per couple and
// run, so that no chunk's time includes a model listing). Writes report.json and
// report.md to --out only; the operator wraps the run with storage-guard begin
// / finish. The report records the command with its working directory and the
// variables it needs, so that it reruns as is.
// Exit 0: complete run, whatever the score. 1: bench error (usage, dataset,
// crash). 2: stopped by ChatGPT (quota, rate limit, authorisation, missing
// account or model, changed profile), with a partial report.

const SCRIPT_ROOT = path.resolve(import.meta.dirname, "..");
const REPORT_FILES = ["report.json", "report.md"] as const;
/** The variables a run needs, recorded with its command so that it reruns as is. */
const RUN_ENV = ["TAKEOFF_BENCH_CHATGPT_OWNER", "TSX_TSCONFIG_PATH"] as const;

/** This script, relative to the working directory when under it (main's checkout), absolute otherwise (a worktree). */
function scriptPath() {
  const script = path.resolve(process.argv[1] ?? "");
  const relative = path.relative(process.cwd(), script);
  return relative.startsWith("..") || path.isAbsolute(relative) ? script : relative;
}

class BenchRefusal extends Error {}

function git(args: string[]) {
  try {
    return execFileSync("git", ["-C", import.meta.dirname, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function assertOwnCode() {
  const expected = path.join(SCRIPT_ROOT, "tsconfig.json");
  const effective = path.resolve(process.env.TSX_TSCONFIG_PATH ?? path.join(process.cwd(), "tsconfig.json"));
  if (effective !== expected) {
    throw new BenchRefusal(`@/ would resolve to another checkout (${path.dirname(effective)}): set TSX_TSCONFIG_PATH=${expected}.`);
  }
}

async function assertOutput(out: string) {
  const stats = await stat(out).catch(() => null);
  if (!stats?.isDirectory()) throw new BenchRefusal(`--out ${out} is not a directory (storage-guard begin creates the run_path).`);
  for (const file of REPORT_FILES) {
    if (await stat(path.join(out, file)).catch(() => null)) throw new BenchRefusal(`${path.join(out, file)} already exists: use a new run.`);
  }
}

type Profile = { profileId: string; model: string; reasoningEffort: BenchCouple["reasoningEffort"] };

/** Read-only check that the selected profile kept its model and effort. */
async function profileUnchanged(owner: ChatGptOwner, before: Profile) {
  try {
    const store = await readChatGptStore(owner);
    const profile = store.profiles.find((entry) => entry.id === store.selectedId);
    return store.selectedId === before.profileId && profile?.model === before.model
      && (profile?.reasoningEffort ?? null) === before.reasoningEffort;
  } catch {
    return null;
  }
}

type Preflight = { profile: Profile; couples: BenchCouple[]; overrides: Map<string, Readonly<LocalChatGptOverride>> }
  | { stopped: BenchRunResult; profile: Profile | null };

function coupleId(couple: Omit<BenchCouple, "override">) {
  return JSON.stringify([couple.model, couple.reasoningEffort]);
}

async function preflight(owner: ChatGptOwner, plans: PlannedDocument[], requested: Array<Omit<BenchCouple, "override">>,
  repeat: number): Promise<Preflight> {
  const asCouples = (profile: Profile): BenchCouple[] => requested.map((couple) => ({
    ...couple, override: !(couple.model === profile.model && couple.reasoningEffort === profile.reasoningEffort),
  }));
  const stop = (reason: StopReason, error: unknown, profile: Profile | null = null): Preflight => {
    // Before the profile is read, no couple has a send mode yet.
    const couples: RequestedCouple[] = profile ? asCouples(profile) : requested.map((couple) => ({ ...couple, override: null }));
    return { stopped: stoppedBeforeRun(plans, couples, repeat, { kind: "provider", reason, error: describeError(error) }), profile };
  };
  const stopOn = (error: unknown, profile: Profile | null = null) => {
    const classified = classifyCallError(error);
    return stop(classified.outcome === "stop" ? classified.reason : "other", error, profile);
  };
  let credential: Awaited<ReturnType<typeof getLocalChatGptCredential>>;
  try {
    // Renews the access token if needed; never chooses a model.
    credential = await getLocalChatGptCredential(owner);
  } catch (error) {
    return stopOn(error);
  }
  if (!credential) return stop("account_missing", new Error("Aucun compte ChatGPT sélectionné pour ce propriétaire."));
  // A profile without model is refused: the bench never gives it one (listLocalChatGptModels would).
  if (!credential.model) return stop("model_missing", new Error("Le profil ChatGPT n’a pas de modèle : choisissez-le dans Mon profil."));
  const profile: Profile = { profileId: credential.profileId, model: credential.model, reasoningEffort: credential.reasoningEffort ?? null };
  const couples = asCouples(profile);
  const overrides = new Map<string, Readonly<LocalChatGptOverride>>();
  for (const couple of couples.filter((entry) => entry.override)) {
    try {
      // With the credential read above, never the store; the checked override then holds for every chunk of this run.
      overrides.set(coupleId(couple), await assertLocalChatGptOverride(owner, credential, { model: couple.model, reasoningEffort: couple.reasoningEffort }));
    } catch (error) {
      return stopOn(error, profile);
    }
  }
  return { profile, couples, overrides };
}

async function main() {
  if (process.env.CI !== undefined || process.env.VERCEL !== undefined) {
    throw new BenchRefusal("takeoff:bench refuses to start with CI or VERCEL set: it reads private plans through a local ChatGPT profile.");
  }
  const args = parseBenchArgs(process.argv.slice(2));
  const owner = parseBenchOwner(process.env.TAKEOFF_BENCH_CHATGPT_OWNER);
  assertOwnCode();
  await assertOutput(args.out);
  const startedAt = new Date().toISOString();
  const dataset = await loadBenchDataset(args.dataset, args.docs);
  const scopes = buildScoreScopes(dataset.truthFiles, dataset.manifest.documents);
  const plans = await planBenchDocuments(dataset.selected.map(({ document, bytes }) => ({
    id: document.id, lot: document.lot, role: document.role === "reserve" ? "reserve" as const : "truth" as const,
    bytes, sha256: document.sha256 as string,
  })));
  const checked = await preflight(owner, plans, benchCouples(args.models, args.efforts), args.repeat);
  let run: BenchRunResult;
  if ("stopped" in checked) {
    run = checked.stopped;
  } else {
    const { profile: selection, overrides } = checked;
    run = await runTakeoffBench({
      plans,
      couples: checked.couples,
      repeat: args.repeat,
      // A couple without its checked override would be listed again on each call, never sent unchecked.
      call: (options, couple) => callLocalChatGptStructured(owner, options, selection, couple.override
        ? overrides.get(coupleId(couple)) ?? { model: couple.model, reasoningEffort: couple.reasoningEffort } : undefined),
      log: (line) => console.error(line),
    });
  }
  const status = git(["status", "--porcelain"]);
  const metadata: BenchReportMetadata = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    command: ["node", ...process.execArgv, scriptPath(), ...process.argv.slice(2)],
    cwd: process.cwd(),
    env: Object.fromEntries(RUN_ENV.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name] as string]]))),
    node: process.version,
    commit: git(["rev-parse", "HEAD"]),
    dirty: status === null ? null : status.length > 0,
    dataset: {
      sha256: dataset.sha256,
      documents: dataset.selected.map(({ document }) => ({
        id: document.id, lot: document.lot, role: document.role, sha256: document.sha256 as string,
        bytes: document.file_size as number, pages: document.pages,
      })),
      skipped: dataset.skipped,
    },
    profile: {
      model: checked.profile?.model ?? null,
      reasoning_effort: checked.profile?.reasoningEffort ?? null,
      unchanged: checked.profile ? await profileUnchanged(owner, checked.profile) : null,
    },
  };
  const report = buildBenchReport({ metadata, run, scopes, noise: dataset.noise });
  await writeFile(path.join(args.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await writeFile(path.join(args.out, "report.md"), renderBenchReportMarkdown(report), { flag: "wx" });
  console.log(`Takeoff bench ${run.status}: ${run.calls_done}/${run.calls_planned} calls, reports in ${args.out}.`);
  if (metadata.profile.unchanged === false) console.error("The ChatGPT profile changed during the run: see report.md.");
  if (run.stop) {
    console.error(`Stopped (${run.stop.kind}): ${run.stop.reason}, ${run.stop.error.code ?? run.stop.error.name}: ${run.stop.error.message}`);
    process.exitCode = run.stop.kind === "provider" ? 2 : 1;
  }
}

void main().catch((error: unknown) => {
  if (error instanceof BenchUsageError) console.error(`${error.message}\n${BENCH_USAGE}`);
  else if (error instanceof BenchDatasetError || error instanceof BenchRefusal) console.error(error.message);
  else console.error(`takeoff:bench crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
