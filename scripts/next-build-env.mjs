// Heap floor shared by every production `next build`: scripts/next-build.mjs
// (npm run build: local, Vercel, verify:production / Quality Gate) and the
// TesterArmy recipe scripts/tester-army/build-local.mjs. No side effects:
// importing this module never starts a build.
//
// Next 16.4 type-checks with the TypeScript CLI (experimental.useTypeScriptCli,
// on by default): runTypeScriptCli spawns `process.execPath tsc` with
// process.env but without the parent's node arguments, so only NODE_OPTIONS
// gives tsc a heap limit. Next's own workers already receive a node argument,
// and its static-generation workers deliberately drop any limit
// (isolatedMemory). Without a limit V8 sizes the heap from the host's RAM:
// 2240 MiB in a 12 GB WSL VM, where tsc died near 2035 MB on 16/10/2026; with
// 4096 in NODE_OPTIONS it peaked at 3.0 GB RSS and the build passed.
import os from "node:os";

/** Minimum V8 old-space limit (MiB) for Next and the children that inherit NODE_OPTIONS, tsc included. */
export const NEXT_BUILD_HEAP_MB = 4096;

// NODE_OPTIONS words as Node splits them: on spaces, double quotes grouping.
const NODE_OPTION_WORD = /(?:[^ "]+|"(?:\\.|[^"\\])*")+/gu;
// --max-old-space-size=N or --max-old-space-size-percentage=P, any V8 spelling.
const OLD_SPACE_OPTION = /^--max[-_]old[-_]space[-_]size(?<percentage>[-_]percentage)?=(?<value>.*)$/u;

function nodeOptionWords(nodeOptions) {
  return (nodeOptions.match(NODE_OPTION_WORD) ?? []).map((word) => ({
    word,
    oldSpace: OLD_SPACE_OPTION.exec(word.replaceAll('"', ""))?.groups,
  }));
}

/**
 * Old-space limit (MiB) that V8 derives from these NODE_OPTIONS on this host,
 * or undefined when they set none. Measured on Node 24: a percentage of
 * physical memory overrides any absolute size whatever their order; otherwise
 * the last absolute size wins.
 */
export function oldSpaceLimitMib(nodeOptions = "") {
  const limits = nodeOptionWords(nodeOptions).flatMap(({ oldSpace }) => (oldSpace ? [oldSpace] : []));
  const percentage = limits.findLast((limit) => limit.percentage);
  if (percentage) return (os.totalmem() * Number(percentage.value)) / 100 / 2 ** 20;
  return limits.length > 0 ? Number(limits.at(-1).value) : undefined;
}

/**
 * Copy of `env` whose NODE_OPTIONS keeps every caller option and gives V8 at
 * least NEXT_BUILD_HEAP_MB of old space: a caller limit at least that large is
 * kept unchanged; a lower one, absolute or percentage, is replaced by
 * --max-old-space-size=NEXT_BUILD_HEAP_MB, since it would bring the crash back.
 */
export function withNextBuildHeap(env = process.env) {
  const result = { ...env };
  // Windows names are case-insensitive but a copied object is not: keep the
  // value spawn() would use (first in sort order) under a single NODE_OPTIONS.
  const names = Object.keys(result)
    .filter((name) => name === "NODE_OPTIONS" || (process.platform === "win32" && name.toUpperCase() === "NODE_OPTIONS"))
    .sort();
  const current = names.length > 0 ? (result[names[0]] ?? "") : "";
  for (const name of names) delete result[name];
  const limit = oldSpaceLimitMib(current);
  const floor = `--max-old-space-size=${NEXT_BUILD_HEAP_MB}`;
  if (limit === undefined) {
    result.NODE_OPTIONS = [current.trim(), floor].filter(Boolean).join(" ");
  } else if (limit >= NEXT_BUILD_HEAP_MB) {
    result.NODE_OPTIONS = current;
  } else {
    const kept = nodeOptionWords(current).flatMap(({ word, oldSpace }) => (oldSpace ? [] : [word]));
    result.NODE_OPTIONS = [...kept, floor].join(" ");
  }
  return result;
}

/**
 * True when a launcher build should take one of the user's native places
 * (src/test/native-stack-guard.ts): a local build only. CI (`CI` set, other
 * than `false`/`0`), Vercel (`VERCEL` set) and `--help` never touch the lock.
 */
export function isLocalProductionBuild(env = process.env, args = []) {
  if (args.includes("--help") || args.includes("-h")) return false;
  const ci = env.CI?.trim().toLowerCase();
  if (ci && ci !== "false" && ci !== "0") return false;
  return !env.VERCEL?.trim();
}
