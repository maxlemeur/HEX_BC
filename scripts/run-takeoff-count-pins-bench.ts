import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { FICTION_SEED } from "@/lib/takeoff/bench/count-pins/fiction";
import { REPLAY_SCHEMA_VERSION, TILE_OVERLAP, WIDE_PAGE } from "@/lib/takeoff/bench/count-pins/replay";
import { METHODS, runCountBench, type Method } from "@/lib/takeoff/bench/count-pins/run";
import { MATCH_RADIUS, NEGATIVE_ZONE_TOLERANCE } from "@/lib/takeoff/bench/count-pins/score";
import { version as pdfjs } from "pdfjs-dist/package.json";

async function main() {
  const { values } = parseArgs({ options: {
    methods: { type: "string" },
    seed: { type: "string", default: String(FICTION_SEED) },
    help: { type: "boolean" },
    "allow-dirty": { type: "boolean" },
  } });
  if (values.help) {
    console.log("Usage: node --conditions=react-server --import tsx scripts/run-takeoff-count-pins-bench.ts [--methods name,name] [--seed uint32] [--allow-dirty]");
    console.log("Methods: " + METHODS.join(", "));
    return;
  }
  const methods = values.methods?.split(",") ?? METHODS;
  if (new Set(methods).size !== methods.length || methods.some((name) => !METHODS.includes(name as Method))) {
    throw new Error("Use distinct method names listed by --help.");
  }
  const seed = Number(values.seed);
  if (!/^\d+$/.test(values.seed) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("The seed must be an unsigned 32-bit integer.");
  }
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const gitEnv = { ...process.env };
  for (const name of Object.keys(gitEnv)) {
    if (name.startsWith("GIT_")) delete gitEnv[name];
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", env: gitEnv }).trim();
  const revision = git("rev-parse", "HEAD");
  const isDirty = () => Boolean(git("status", "--porcelain", "--untracked-files=all"));
  const checkDirty = (dirty: boolean) => {
    if (dirty && !values["allow-dirty"]) {
      throw new Error("A reproducible receipt requires a clean checkout. Use --allow-dirty for a non-reproducible run.");
    }
  };
  const startedDirty = isDirty();
  checkDirty(startedDirty);
  process.chdir(repository);
  const report = await runCountBench(methods as Method[], seed);
  if (git("rev-parse", "HEAD") !== revision) throw new Error("HEAD changed during the benchmark.");
  const dirty = isDirty() || startedDirty;
  checkDirty(dirty);
  const configuration = {
    revision,
    dirty,
    reproducible: !dirty,
    node: process.version,
    pdfjs,
    methods,
    seed,
    replay: { schemaVersion: REPLAY_SCHEMA_VERSION, source: "synthetic", prompt: null, model: null, effort: null, tileOverlap: TILE_OVERLAP, widePage: WIDE_PAGE },
    matching: {
      algorithm: "maximum-cardinality-minimum-total-distance",
      radius: MATCH_RADIUS,
      typedCredit: "pairs-forced-in-all-optimal-matchings",
      negativeZoneTolerancePoints: NEGATIVE_ZONE_TOLERANCE,
    },
    fusion: { algorithm: "same-poste-one-to-one", radius: MATCH_RADIUS },
  };
  console.log(JSON.stringify({ configuration, ...report }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
