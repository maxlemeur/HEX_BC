// The production build of an Army workflow run, made once by its army-build job and reused by its shards and groups
// (docs/testing/tester-army-ci.md, "Pile, confidentialité et diagnostic"). A shard serves it only when it is provably the
// build of its own checkout for its own backend; otherwise it builds as before and records why. Nothing here fails a
// shard: a missing, partial or foreign download is a reason to build locally.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { IGNORED_OUTPUT_ENTRIES } from "./build-local.mjs";
import { CALC_V3_PHASE_DEFINITIONS, isCalcV3Phase } from "./calc-v3-phases.ts";
import { buildCommands } from "./local-recipe-common.mjs";

export const PREBUILT_SCHEMA = "army-prebuilt-build-1";
/** The artifact of the army-build job; one per workflow run (a rerun replaces it). */
export const PREBUILT_ARTIFACT = "army-prebuilt-build";
const DIST_DIRECTORY = ".build/tester-army/next";
const BUILDS_DIRECTORY = ".e2e/army/recipes/builds";
const BUILD_DIRECTORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

interface BuildManifest {
  schemaVersion?: unknown; revision?: unknown; diffSha256?: unknown; inputs?: unknown; inputsAfter?: unknown;
  backend?: unknown; node?: unknown; platform?: unknown; steps?: unknown; sourceChangedDuringBuild?: unknown;
  buildId?: unknown; compiledOutput?: { distDir?: unknown; inputs?: unknown; digest?: unknown };
}

/** prebuilt.json, written by the army-build job next to the output it packaged. */
export interface PrebuiltRecord {
  schemaVersion: string;
  /** The build's own directory name under .e2e/army/recipes/builds, kept in the shard's evidence. */
  buildDirectoryName: string;
  backend: string;
  /** The anon key baked into the client bundles, by digest: the record itself is published as an artifact. */
  anonKeySha256: string;
  arch: string;
  buildManifestSha256: string;
  compiledOutputDigest: string;
  artifact: { name: string; runId: string; runAttempt: string };
}

/** A downloaded prebuilt build: its record, its build manifest and where it lies. */
export interface PrebuiltCandidate {
  directory: string;
  buildDirectoryName: string;
  prebuilt: PrebuiltRecord;
  build: BuildManifest;
  buildManifestSha256: string;
}

export type PrebuiltDecision = { reuse: true } | { reuse: false; reason: string };

export interface SourceEvidence { revision: string; diffSha256: string; inputs: unknown }
export interface RuntimeIdentity { node: string; platform: string; arch: string }

/** The download, read without trusting it; any problem is a reason to build, never an error. */
export function readPrebuiltCandidate(directory: string | undefined): { candidate: PrebuiltCandidate } | { reason: string } {
  if (!directory) return { reason: "no prebuilt build was offered (ARMY_PREBUILT_BUILD_DIR unset)" };
  if (!fs.existsSync(directory)) return { reason: "the prebuilt build was not downloaded (army-build skipped, failed or expired)" };
  const recordPath = path.join(directory, "prebuilt.json");
  if (!fs.existsSync(recordPath)) return { reason: "the prebuilt download has no prebuilt.json" };
  try {
    const prebuilt = JSON.parse(fs.readFileSync(recordPath, "utf8")) as PrebuiltRecord;
    if (typeof prebuilt?.buildDirectoryName !== "string" || !BUILD_DIRECTORY_NAME.test(prebuilt.buildDirectoryName)) {
      throw new Error("invalid build directory name");
    }
    const bytes = fs.readFileSync(path.join(directory, "build", "manifest.json"));
    const build = JSON.parse(bytes.toString("utf8")) as BuildManifest;
    return { candidate: { directory, buildDirectoryName: prebuilt.buildDirectoryName, prebuilt, build, buildManifestSha256: sha256(bytes) } };
  } catch (error) {
    return { reason: `the prebuilt download is unreadable (${error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "unknown"})` };
  }
}

function outputClosureProblem(output: BuildManifest["compiledOutput"]) {
  if (output?.distDir !== DIST_DIRECTORY || !Array.isArray(output.inputs) || output.inputs.length === 0 ||
    output.digest !== sha256(JSON.stringify(output.inputs))) return "the build manifest has no consistent compiled output closure";
  return undefined;
}

/**
 * The reuse rule: the prebuilt build is served only when it is a complete, unchanged, successful build of this
 * checkout's sources, for this stack's origin and anon key, on this runtime. The first mismatch is the reason.
 */
export function decidePrebuiltReuse(input: {
  candidate: PrebuiltCandidate; source: SourceEvidence; backendOrigin: string; anonKey: string; runtime: RuntimeIdentity;
}): PrebuiltDecision {
  const { candidate: { prebuilt, build, buildManifestSha256 }, source, backendOrigin, anonKey, runtime } = input;
  const refuse = (reason: string): PrebuiltDecision => ({ reuse: false, reason });
  if (prebuilt.schemaVersion !== PREBUILT_SCHEMA) return refuse(`the prebuilt record has schema ${String(prebuilt.schemaVersion)}, not ${PREBUILT_SCHEMA}`);
  if (prebuilt.buildManifestSha256 !== buildManifestSha256) return refuse("the downloaded build manifest is not the one the build job recorded");
  if (build.schemaVersion !== "army-local-build-1") return refuse(`the build manifest has schema ${String(build.schemaVersion)}`);
  if (!Array.isArray(build.steps) || build.steps.some((step: { exitCode?: unknown }) => step?.exitCode !== 0) ||
    !isDeepStrictEqual(build.steps.map((step: { args?: unknown }) => step?.args), buildCommands)) {
    return refuse("the build steps are not the recorded build commands, all successful");
  }
  if (build.sourceChangedDuringBuild !== false || !isDeepStrictEqual(build.inputsAfter, build.inputs)) {
    return refuse("the build's sources changed during the build");
  }
  if (typeof build.buildId !== "string" || !build.buildId) return refuse("the build manifest has no build ID");
  const closure = outputClosureProblem(build.compiledOutput);
  if (closure) return refuse(closure);
  if (prebuilt.compiledOutputDigest !== build.compiledOutput?.digest) return refuse("the build job recorded another output digest than its build manifest");
  if (build.revision !== source.revision) return refuse(`the build is of revision ${String(build.revision)}, this checkout is ${source.revision}`);
  if (build.diffSha256 !== source.diffSha256) return refuse("the build's tracked diff differs from this checkout's");
  if (!isDeepStrictEqual(build.inputs, source.inputs)) return refuse("the build's application inputs differ from this checkout's");
  if (build.backend !== backendOrigin || prebuilt.backend !== backendOrigin) {
    return refuse(`the build is for backend origin ${String(build.backend)}, this stack's is ${backendOrigin}`);
  }
  if (prebuilt.anonKeySha256 !== sha256(anonKey)) return refuse("the build's anon key differs from this stack's");
  if (build.node !== runtime.node || build.platform !== runtime.platform || prebuilt.arch !== runtime.arch) {
    return refuse(`the build's runtime ${String(build.node)} ${String(build.platform)}-${String(prebuilt.arch)} differs from ${runtime.node} ${runtime.platform}-${runtime.arch}`);
  }
  return { reuse: true };
}

/**
 * The run annotation of a shard that was given a downloaded build and builds anyway: if every shard refuses (a CLI bump
 * that changes the anon key or the ports, say), the run costs more than before without turning red, and only this says
 * so. No download (the build job skipped, failed or published nothing) is visible in that job: it stays a log line.
 */
export function prebuiltRefusalWarning(directory: string | undefined, decision: PrebuiltDecision): string | undefined {
  if (decision.reuse || !directory) return undefined;
  try {
    if (fs.readdirSync(directory).length === 0) return undefined;
  } catch {
    return undefined;
  }
  // Workflow command data: %, CR and LF are escaped so the reason stays one annotation.
  const reason = decision.reason.replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
  return `::warning title=Army build not reused::${reason}`;
}

/** After installation: the files served are exactly the recorded output (buildOutputEvidence of the dist directory). */
export function verifyInstalledOutput(candidate: Pick<PrebuiltCandidate, "build">, output: unknown): PrebuiltDecision {
  return isDeepStrictEqual(output, candidate.build.compiledOutput) ? { reuse: true }
    : { reuse: false, reason: "the installed files do not match the recorded output digest" };
}

/** Empties the dist directory but its Next build cache (the fallback build still uses it). */
function clearDistDirectory(root: string) {
  const dist = path.join(root, DIST_DIRECTORY);
  if (!fs.existsSync(dist)) return;
  for (const entry of fs.readdirSync(dist)) if (entry !== "cache") fs.rmSync(path.join(dist, entry), { recursive: true, force: true });
}

/**
 * Puts the downloaded output where `next start` serves it, and its build manifest and log where evidence retention finds
 * them. Only the files the build manifest lists are copied: nothing else in the download lands beside them or over the
 * restored Next build cache. A listed path outside the dist directory, or missing from the download, throws.
 */
export async function installPrebuiltOutput(candidate: Pick<PrebuiltCandidate, "directory" | "buildDirectoryName" | "build">, root: string) {
  clearDistDirectory(root);
  const dist = path.join(root, DIST_DIRECTORY);
  fs.mkdirSync(dist, { recursive: true });
  const inputs = candidate.build.compiledOutput?.inputs;
  if (!Array.isArray(inputs)) throw new Error("The build manifest lists no output files.");
  for (const input of inputs as Array<{ path?: unknown }>) {
    const listed = typeof input?.path === "string" ? input.path : "";
    const relative = listed.startsWith(`${DIST_DIRECTORY}/`) ? listed.slice(DIST_DIRECTORY.length + 1) : "";
    const segments = relative.split("/");
    if (!relative || segments.some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`The build manifest lists a file outside ${DIST_DIRECTORY}.`);
    }
    const target = path.join(dist, ...segments);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(candidate.directory, "next", ...segments), target);
  }
  const builds = path.join(root, BUILDS_DIRECTORY, candidate.buildDirectoryName);
  fs.mkdirSync(builds, { recursive: true });
  for (const name of ["manifest.json", "build.log"]) {
    const file = path.join(candidate.directory, "build", name);
    if (!fs.existsSync(file)) continue;
    fs.copyFileSync(file, path.join(builds, name));
    // Evidence retention keeps the build manifests written since the run started (run-tester-army-ci.ts retainEvidence).
    const now = new Date();
    fs.utimesSync(path.join(builds, name), now, now);
  }
}

/** Undoes installPrebuiltOutput when the installed files were refused: the local build starts from a clean dist directory. */
export function removeInstalledOutput(root: string, buildDirectoryName: string) {
  clearDistDirectory(root);
  if (BUILD_DIRECTORY_NAME.test(buildDirectoryName)) fs.rmSync(path.join(root, BUILDS_DIRECTORY, buildDirectoryName), { recursive: true, force: true });
}

/**
 * The army-build job's artifact: the output closure (the dist directory without the entries buildOutputEvidence leaves
 * out, nor the route cache `next start` writes), the build manifest and log, and prebuilt.json.
 */
export function packagePrebuiltBuild(input: {
  root: string; out: string; buildManifestPath: string; anonKey: string; artifact: PrebuiltRecord["artifact"];
  /** Values that must never reach the published output (the stack's service key, the run's recovery secret). */
  forbidden: readonly string[];
}): PrebuiltRecord {
  const { root, out } = input;
  const manifestBytes = fs.readFileSync(input.buildManifestPath);
  const build = JSON.parse(manifestBytes.toString("utf8")) as BuildManifest;
  const closure = outputClosureProblem(build.compiledOutput);
  if (closure || build.sourceChangedDuringBuild !== false) throw new Error(closure ?? "The build's sources changed during the build.");
  const dist = path.join(root, DIST_DIRECTORY);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "build"), { recursive: true });
  const ignored = new Set<string>(IGNORED_OUTPUT_ENTRIES);
  fs.cpSync(dist, path.join(out, "next"), {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(dist, source).split(path.sep);
      return !(relative.length >= 1 && ignored.has(relative[0])) && !(relative[0] === "server" && relative[1] === "route-cache");
    },
  });
  const forbidden = input.forbidden.filter(Boolean);
  const scan = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("The production output must not contain symlinks.");
      if (entry.isDirectory()) scan(file);
      else {
        const bytes = fs.readFileSync(file);
        if (forbidden.some((value) => bytes.includes(value))) throw new Error("A server secret reached the production output; it is not published.");
      }
    }
  };
  scan(path.join(out, "next"));
  fs.writeFileSync(path.join(out, "build", "manifest.json"), manifestBytes);
  const log = path.join(path.dirname(input.buildManifestPath), "build.log");
  if (fs.existsSync(log)) fs.copyFileSync(log, path.join(out, "build", "build.log"));
  const record: PrebuiltRecord = {
    schemaVersion: PREBUILT_SCHEMA,
    buildDirectoryName: path.basename(path.dirname(input.buildManifestPath)),
    backend: String(build.backend),
    anonKeySha256: sha256(input.anonKey),
    arch: process.arch,
    buildManifestSha256: sha256(manifestBytes),
    compiledOutputDigest: String(build.compiledOutput?.digest),
    artifact: input.artifact,
  };
  fs.writeFileSync(path.join(out, "prebuilt.json"), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

/** Whether a calc-v3 selection runs a phase under `next start` ("all": the complete campaign). */
export function calcV3NeedsProductionBuild(phases: readonly string[]): boolean {
  return phases.some((phase) => phase === "all" ||
    (isCalcV3Phase(phase) && CALC_V3_PHASE_DEFINITIONS[phase].serverMode === "production"));
}

// The calc-v3 army-calc-v3-build job asks, before any install: `prebuilt-build.ts needs-production '<phases JSON>'`
// prints build=true or build=false for GITHUB_OUTPUT.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, phases, ...rest] = process.argv.slice(2);
  const selected: unknown = command === "needs-production" && rest.length === 0 && phases ? JSON.parse(phases) : undefined;
  if (!Array.isArray(selected) || selected.some((phase) => typeof phase !== "string")) {
    throw new Error("Usage: prebuilt-build.ts needs-production '<JSON array of calc-v3 phases>'");
  }
  process.stdout.write(`build=${calcV3NeedsProductionBuild(selected as string[])}\n`);
}
