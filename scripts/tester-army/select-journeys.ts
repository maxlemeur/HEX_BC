// Impact-based selection of the TesterArmy critical journeys for one change.
// Runs with plain Node (type stripping, no npm install): node builtins only and
// erasable TypeScript syntax. Contract and fail-safe rules:
// docs/testing/tester-army-ci.md, section "Sélection par impact des parcours critical".
//
// Decision, per changed path (git diff --name-only --no-renames base...head):
// 1. docs globs: nothing to run (pull request and push). On push, anything
//    else runs the full suite;
// 2. full globs, or a file the critical runner itself imports: full suite;
// 3. otherwise the reverse closure of the path (files that import it, and for
//    an API route the files whose code names its /api/... path) is walked:
//    - a member under a full glob (outside escalationExcluded): full suite;
//    - every rule a member matches adds its journeys, a journey adds itself;
//    - an entry point of the closure (nothing loads it) that no rule, full or
//      nonRuntime glob covers: full suite, since nothing maps its impact;
// 4. no rule hit and only nonRuntime entry points: nothing (pull request).
// Any git or map error, an empty diff or an unknown event also gives "full",
// and so does a map whose journeys differ from those the CI critical suite
// runs (e2e.config.ts): a journey the map omits would never be selected.
//
// Full-only journeys (map "fullOnly": the takeoff journeys, which only the
// e2e.config.ts full selection runs) are a second set, run by the army-takeoff
// job of e2e-army-critical.yml: on a pull request, those its paths reach; all
// of them whenever the critical decision is "full" (unsure, forced, other
// event), listed from the working tree so an unlisted one still runs; none on
// a push, whose post-merge check stays the critical suite (the nightly full
// suite runs them).
//
// Parallel jobs (army-shards.json, docs/testing/tester-army-ci.md, "Jobs
// parallèles"): the critical files, or the whole critical suite listed from
// e2e.config.ts, are split into disjoint shards, each with the login setup and
// an authenticated journey, by longest measured duration first; `--plan full`
// splits the nightly full selection the same way. A file is never cut. A list
// the runner would refuse or that cannot be established is one unsharded
// shard running the runner's own whole suite.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CRITICAL_JOURNEY_FILE, FULL_JOURNEY_FILE, FULL_ONLY_JOURNEY_FILE } from "./journey-files.mjs";

export type ImpactRule = { id: string; note?: string; paths: string[]; journeys: string[] };
export type ImpactMap = {
  schemaVersion: number;
  suite: { journeys: string[]; setup: string; anchor: string; anonymous: string[] };
  /** Journeys only the full selection of e2e.config.ts runs; globs taken verbatim from that list. */
  fullOnly: { note?: string; globs: string[]; journeys: string[] };
  docs: string[];
  nonRuntime: string[];
  full: string[];
  runnerEntries: string[];
  graph: {
    sourceRoots: string[];
    extraFiles: string[];
    apiRouteRoot: string;
    apiCallers: string[];
    apiCallersExcluded: string[];
    importersExcluded: string[];
    escalationExcluded: string[];
  };
  groups: Record<string, string[]>;
  rules: ImpactRule[];
};
export type PathClass = "docs" | "full" | "journeys" | "known-unexercised" | "non-runtime" | "unmapped";
export type PathDecision = { path: string; class: PathClass; reason: string; journeys?: string[]; rules?: string[] };
export type FullOnlySelection = {
  /** "all" and "files" both list their files explicitly, login setup included. */
  mode: "none" | "all" | "files";
  reason: string;
  files: string[];
};
export type ShardSuite = "critical" | "full";
/** scripts/tester-army/army-shards.json: measured seconds per journey file and each suite's limits. */
export type ShardDurations = {
  schemaVersion: number;
  note?: string;
  measured?: string[];
  defaultSeconds: number;
  suites: Record<ShardSuite, { maxShards: number; secondsPerShard: number; workers: number }>;
  seconds: Record<string, number>;
};
export type PlannedShard = { shard: number; total: number; files: string[]; seconds: number };
export type ShardPlan = {
  schemaVersion: "army-shard-plan-1";
  suite: ShardSuite;
  reason: string;
  /** Every file the shards run together, login setup included; empty: one shard runs the runner's own whole suite. */
  files: string[];
  /** E2E_ARMY_WORKERS of every shard; null when the durations file is unreadable. */
  workers: number | null;
  durationsSha256: string | null;
  shards: PlannedShard[];
  /** Full suite only: its development phase in its own job, on the single shard's stack, or not at all (--grep). */
  development?: "separate" | "in-shard" | "none";
};
export type Selection = {
  schemaVersion: "army-impact-selection-3";
  event: string;
  base: string | null;
  head: string | null;
  mapSha256: string | null;
  /** Critical journeys (army-critical shard jobs). */
  mode: "none" | "full" | "files";
  reason: string;
  files: string[];
  /** Full-only journeys (army-takeoff job). */
  fullOnly: FullOnlySelection;
  /** The critical journeys split into parallel jobs (empty for "none"). */
  shards: ShardPlan;
  changedPaths: PathDecision[];
};
export type SourceGraph = {
  files: Set<string>;
  importers: Map<string, Set<string>>;
  apiCallers: Map<string, Set<string>>;
  runnerClosure: Set<string>;
};

export const MAP_PATH = "scripts/tester-army/army-impact-map.json";
export const SHARDS_PATH = "scripts/tester-army/army-shards.json";
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".css"];
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css",
  "/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"];

/** Glob with literal brackets (Next route segments): ** for directories, * within a segment, {a,b}. */
export function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${globSource(glob)}$`);
}

function globSource(glob: string): string {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      const atSegmentStart = index === 0 || glob[index - 1] === "/";
      const next = glob[index + 2];
      if (!atSegmentStart || (next !== undefined && next !== "/")) throw new Error(`Unsupported "**" in glob ${glob}`);
      source += next === "/" ? "(?:[^/]*/)*" : ".*";
      index += next === "/" ? 2 : 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      const end = glob.indexOf("}", index);
      if (end === -1 || glob.slice(index + 1, end).includes("{")) throw new Error(`Unbalanced braces in glob ${glob}`);
      source += `(?:${glob.slice(index + 1, end).split(",").map(globSource).join("|")})`;
      index = end;
    } else {
      source += char.replace(/[\\^$.|+()[\]{}]/g, "\\$&");
    }
  }
  return source;
}

const globCache = new Map<string, RegExp>();
export function matchesAny(file: string, globs: readonly string[]): boolean {
  return globs.some((glob) => {
    let pattern = globCache.get(glob);
    if (!pattern) {
      pattern = globToRegExp(glob);
      globCache.set(glob, pattern);
    }
    return pattern.test(file);
  });
}

const MODULE_PATTERNS = [
  /\b(?:import|export)\s[^"'`;]*?\bfrom\s*["']([^"'\r\n]+)["']/g,
  /\bimport\s*["']([^"'\r\n]+)["']/g,
  /\bimport\s*\(\s*["'`]([^"'`$\r\n]+)["'`]\s*\)/g,
  /\brequire\s*\(\s*["']([^"'\r\n]+)["']\s*\)/g,
  /\bnew\s+URL\s*\(\s*["'`]([^"'`$\r\n]+)["'`]\s*,\s*import\.meta\.url/g,
  /@import\s+(?:url\(\s*)?["']([^"'\r\n]+)["']/g,
];

/** Module specifiers a file may load: static, side-effect, dynamic, require, worker URL and CSS @import. */
export function scanModuleSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of MODULE_PATTERNS) {
    for (const match of text.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

export type ApiReference = { segments: string[]; prefix: boolean };

/**
 * /api/... paths named in code: ${...}, {param}, [param] and :param are
 * one-segment wildcards. A trailing ${...} may hide a sub-path (a base URL
 * completed elsewhere), so it matches every route below, unless the literal
 * is a direct call argument that ends (or starts its query) right after it.
 */
export function scanApiReferences(text: string): ApiReference[] {
  const references: ApiReference[] = [];
  for (let index = text.indexOf("/api/"); index !== -1; index = text.indexOf("/api/", index + 5)) {
    // src/app/api/... or http://host/api/... is a file or an absolute URL, not a call path.
    if (index > 0 && /[A-Za-z0-9_$./-]/.test(text[index - 1])) continue;
    const quote = index > 0 && ["`", "\"", "'"].includes(text[index - 1]) ? text[index - 1] : "";
    let before = index - 2;
    while (before >= 0 && /\s/.test(text[before])) before -= 1;
    const callArgument = quote !== "" && before >= 0 && (text[before] === "(" || text[before] === ",");
    const segments: string[] = [];
    let current = "";
    let wildcard = false;
    let trailing: "interpolation" | "param" | "rest" = "interpolation";
    let cursor = index + 5;
    for (; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (char === "$" && text[cursor + 1] === "{") {
        let depth = 0;
        for (cursor += 1; cursor < text.length; cursor += 1) {
          if (text[cursor] === "{") depth += 1;
          else if (text[cursor] === "}" && --depth === 0) break;
        }
        wildcard = true;
        trailing = "interpolation";
      } else if (char === "/") {
        if (!current && !wildcard) break;
        segments.push(wildcard ? "*" : current);
        current = "";
        wildcard = false;
      } else if (/[A-Za-z0-9_.~-]/.test(char)) {
        current += char;
      } else if ((char === "[" || char === "{" || char === ":") && !current) {
        const close = char === "[" ? "]" : char === "{" ? "}" : "";
        const end = close ? text.indexOf(close, cursor) : cursor;
        if (close && (end === -1 || end - cursor > 64)) break;
        trailing = char === "[" && text.startsWith("...", cursor + 1) ? "rest" : "param";
        if (!close) {
          while (cursor + 1 < text.length && /[A-Za-z0-9_]/.test(text[cursor + 1])) cursor += 1;
        } else cursor = end;
        wildcard = true;
      } else break;
    }
    const trailingSlash = !current && !wildcard;
    if (current || wildcard) segments.push(wildcard ? "*" : current);
    // The API family is always literal in this repository; /api/${id}/... is a
    // third-party URL (the Sentry store endpoint), not one of our routes.
    if (segments.length === 0 || segments[0] === "*") continue;
    const closed = callArgument && (text[cursor] === quote || text[cursor] === "?");
    const oneSegment = wildcard && (trailing === "param" || (trailing === "interpolation" && closed));
    references.push({ segments, prefix: trailingSlash || (segments.at(-1) === "*" && !oneSegment) });
  }
  return references;
}

function routeSegments(file: string, apiRouteRoot: string): string[] | undefined {
  const match = new RegExp(`^${apiRouteRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(.+)/route\\.(?:ts|tsx|js|mjs)$`).exec(file);
  return match ? match[1].split("/") : undefined;
}

function referenceMatchesRoute(reference: ApiReference, route: string[], asPrefix: boolean): boolean {
  for (let index = 0; index < reference.segments.length; index += 1) {
    const segment = route[index];
    if (segment === undefined) return false;
    if (segment.startsWith("[...") || segment.startsWith("[[...")) return true;
    const wanted = reference.segments[index];
    if (wanted !== "*" && !segment.startsWith("[") && segment !== wanted) return false;
  }
  if (asPrefix || reference.prefix) return true;
  const rest = route.slice(reference.segments.length);
  return rest.length === 0 || (rest.length === 1 && rest[0].startsWith("[[..."));
}

function git(root: string, args: string[]) {
  return spawnSync("git", ["-c", "safe.directory=*", ...args], {
    cwd: root, encoding: "buffer", maxBuffer: 256 * 1024 * 1024, windowsHide: true,
  });
}

/** Tracked and untracked (not ignored) files of the working tree, POSIX paths. */
export function listRepositoryFiles(root: string): string[] {
  const result = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  if (result.status !== 0) throw new Error("git ls-files failed.");
  return result.stdout.toString("utf8").split("\0").filter((file) => file && fs.existsSync(path.join(root, file)));
}

function resolveSpecifier(from: string, specifier: string, files: Set<string>): string | undefined {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith("./") || specifier.startsWith("../")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  else return undefined;
  base = base.replace(/[?#].*$/, "");
  for (const suffix of RESOLVE_SUFFIXES) if (files.has(`${base}${suffix}`)) return `${base}${suffix}`;
  const typescript = base.replace(/\.(m|c)?js$/, ".$1ts");
  for (const candidate of [typescript, `${base.replace(/\.js$/, "")}.tsx`]) if (files.has(candidate)) return candidate;
  return undefined;
}

export function buildSourceGraph(root: string, map: ImpactMap, repositoryFiles = listRepositoryFiles(root)): SourceGraph {
  const files = new Set(repositoryFiles);
  const sources = repositoryFiles.filter((file) =>
    SOURCE_EXTENSIONS.includes(path.posix.extname(file)) &&
    (map.graph.extraFiles.includes(file) || map.graph.sourceRoots.some((sourceRoot) => file.startsWith(`${sourceRoot}/`))));
  const routes = repositoryFiles.flatMap((file) => {
    const segments = routeSegments(file, map.graph.apiRouteRoot);
    return segments ? [{ file, segments }] : [];
  });
  const imports = new Map<string, Set<string>>();
  const importers = new Map<string, Set<string>>();
  const apiCallers = new Map<string, Set<string>>();
  const link = (edges: Map<string, Set<string>>, key: string, value: string) => {
    let set = edges.get(key);
    if (!set) edges.set(key, set = new Set());
    set.add(value);
  };
  for (const file of sources) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const specifier of scanModuleSpecifiers(text)) {
      const target = resolveSpecifier(file, specifier, files);
      if (!target || target === file) continue;
      link(imports, file, target);
      if (!matchesAny(file, map.graph.importersExcluded)) link(importers, target, file);
    }
    if (path.posix.extname(file) === ".css" || !matchesAny(file, map.graph.apiCallers) ||
      matchesAny(file, map.graph.apiCallersExcluded)) continue;
    for (const reference of scanApiReferences(text)) {
      let matched = routes.filter((route) => referenceMatchesRoute(reference, route.segments, false));
      // A base constant ("/api/takeoff") followed by a computed suffix.
      if (matched.length === 0) matched = routes.filter((route) => referenceMatchesRoute(reference, route.segments, true));
      for (const route of matched) if (route.file !== file) link(apiCallers, route.file, file);
    }
  }
  const runnerClosure = new Set<string>();
  const pending = map.runnerEntries.filter((file) => files.has(file));
  while (pending.length) {
    const file = pending.pop()!;
    if (runnerClosure.has(file)) continue;
    runnerClosure.add(file);
    for (const target of imports.get(file) ?? []) pending.push(target);
  }
  return { files, importers, apiCallers, runnerClosure };
}

/** The file and every file that loads it or names its API route, transitively. */
export function reverseClosure(graph: SourceGraph, file: string): Set<string> {
  const closure = new Set<string>();
  const pending = [file];
  while (pending.length) {
    const current = pending.pop()!;
    if (closure.has(current)) continue;
    closure.add(current);
    for (const next of graph.importers.get(current) ?? []) pending.push(next);
    for (const next of graph.apiCallers.get(current) ?? []) pending.push(next);
  }
  return closure;
}

/** Group, anchor and wildcard references expanded to journey files; "*" is every critical and full-only journey. */
export function expandJourneys(map: ImpactMap, references: readonly string[], seen = new Set<string>()): string[] {
  const journeys = new Set<string>();
  for (const reference of references) {
    if (reference === "*") [...map.suite.journeys, ...map.fullOnly.journeys].forEach((journey) => journeys.add(journey));
    else if (reference === "@anchor") journeys.add(map.suite.anchor);
    else if (reference.startsWith("@")) {
      const name = reference.slice(1);
      const group = map.groups[name];
      if (!group) throw new Error(`Unknown journey group ${reference}.`);
      if (seen.has(name)) throw new Error(`Recursive journey group ${reference}.`);
      expandJourneys(map, group, new Set([...seen, name])).forEach((journey) => journeys.add(journey));
    } else journeys.add(reference);
  }
  return [...journeys];
}

/**
 * Journey files the CI critical suite runs: the localBusiness test list of
 * e2e.config.ts (the CI stack is loopback), matched against the working tree.
 */
export function criticalSuiteJourneys(config: string, repositoryFiles: readonly string[]): string[] {
  const branch = /critical \? localBusiness \? \[([^\]]*)\]/u.exec(config);
  if (!branch) throw new Error("The localBusiness critical test list of e2e.config.ts cannot be read.");
  const globs = [...branch[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  return repositoryFiles.filter((file) => globs.some((glob) => globToRegExp(glob).test(file))).sort();
}

/** Test globs of the e2e.config.ts full selection (nightly and dispatched full suite). */
export function fullSelectionGlobs(config: string): string[] {
  const branch = /: full \? \[([^\]]*)\]/u.exec(config);
  if (!branch) throw new Error("The full test list of e2e.config.ts cannot be read.");
  return [...branch[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
}

/**
 * Journey files the map's fullOnly globs select in the working tree. Each glob
 * must be in the full selection of e2e.config.ts, else its journeys may not run.
 */
export function fullOnlySuiteJourneys(config: string, globs: readonly string[], repositoryFiles: readonly string[]): string[] {
  const full = new Set(fullSelectionGlobs(config));
  for (const glob of globs) if (!full.has(glob)) throw new Error(`The full selection of e2e.config.ts does not run ${glob}.`);
  return repositoryFiles.filter((file) => globs.some((glob) => globToRegExp(glob).test(file))).sort();
}

/**
 * Problems that make the map unusable, including any difference between its
 * journeys and those the CI critical suite, or the full selection's fullOnly
 * globs, run; the guardrail test also runs this.
 */
export function validateImpactMap(map: ImpactMap, exists: (file: string) => boolean, suiteJourneys: readonly string[],
  fullOnlyJourneys: readonly string[]): string[] {
  const problems: string[] = [];
  const suite = new Set(map.suite.journeys);
  const fullOnly = new Set(map.fullOnly.journeys);
  const known = new Set([...suite, ...fullOnly]);
  if (map.schemaVersion !== 1) problems.push(`Unsupported map schemaVersion ${map.schemaVersion}.`);
  const run = new Set(suiteJourneys);
  for (const journey of suiteJourneys) if (!suite.has(journey)) problems.push(`The critical suite runs ${journey}, which the map does not list.`);
  for (const journey of map.suite.journeys) if (!run.has(journey)) problems.push(`The map lists ${journey}, which the critical suite does not run.`);
  const runFullOnly = new Set(fullOnlyJourneys);
  for (const journey of fullOnlyJourneys) if (!fullOnly.has(journey)) problems.push(`The full selection runs ${journey}, which the map does not list as full-only.`);
  for (const journey of map.fullOnly.journeys) {
    if (!runFullOnly.has(journey)) problems.push(`The map lists ${journey} as full-only, which the full selection does not run.`);
    if (suite.has(journey)) problems.push(`${journey} is both a critical and a full-only journey.`);
    // The army-takeoff job hands these paths to the runner's full --files.
    if (!FULL_ONLY_JOURNEY_FILE.test(journey)) problems.push(`The runner's full --files refuses the full-only journey ${journey}.`);
  }
  if (!FULL_ONLY_JOURNEY_FILE.test(map.suite.setup)) problems.push(`The runner's full --files refuses the login setup ${map.suite.setup}.`);
  for (const file of [...map.suite.journeys, ...map.fullOnly.journeys, map.suite.setup, map.suite.anchor, ...map.suite.anonymous, ...map.runnerEntries]) {
    if (!exists(file)) problems.push(`Map points to a missing file: ${file}.`);
  }
  for (const file of [map.suite.setup, map.suite.anchor, ...map.suite.anonymous]) {
    if (!suite.has(file)) problems.push(`${file} is not a suite journey.`);
  }
  if (map.suite.anonymous.includes(map.suite.anchor)) problems.push("The anchor journey must be authenticated.");
  const globs = [...map.docs, ...map.nonRuntime, ...map.full, ...map.fullOnly.globs, ...map.rules.flatMap((rule) => rule.paths),
    ...map.graph.apiCallers, ...map.graph.apiCallersExcluded, ...map.graph.importersExcluded, ...map.graph.escalationExcluded];
  for (const glob of globs) {
    try { globToRegExp(glob); } catch (error) { problems.push((error as Error).message); }
  }
  const ids = new Set<string>();
  for (const rule of map.rules) {
    if (ids.has(rule.id)) problems.push(`Duplicate rule id ${rule.id}.`);
    ids.add(rule.id);
    try {
      for (const journey of expandJourneys(map, rule.journeys)) {
        if (!known.has(journey)) problems.push(`Rule ${rule.id} points to ${journey}, which is not a suite journey.`);
      }
    } catch (error) { problems.push(`Rule ${rule.id}: ${(error as Error).message}`); }
  }
  for (const [name, members] of Object.entries(map.groups)) {
    try { expandJourneys(map, [`@${name}`]); } catch (error) { problems.push((error as Error).message); }
    for (const member of members) if (!member.startsWith("@") && !known.has(member)) problems.push(`Group ${name} lists ${member}, which is not a suite journey.`);
  }
  return problems;
}

type FileImpact = { rules: string[]; journeys: string[] };

/**
 * Rules a single file matches, and their journeys; a critical or full-only
 * journey file selects itself. A nonRuntime file (a colocated test under a
 * mapped route folder, for example) matches no rule: the app never loads it,
 * its importers still count.
 */
function fileImpact(map: ImpactMap, file: string, cache: Map<string, FileImpact>): FileImpact {
  let impact = cache.get(file);
  if (!impact) {
    const self = map.suite.journeys.includes(file) || map.fullOnly.journeys.includes(file);
    const rules = self || !matchesAny(file, map.nonRuntime) ? map.rules.filter((rule) => matchesAny(file, rule.paths)) : [];
    impact = {
      rules: [...(self ? ["journey-file"] : []), ...rules.map((rule) => rule.id)],
      journeys: [...(self ? [file] : []), ...expandJourneys(map, rules.flatMap((rule) => rule.journeys))],
    };
    cache.set(file, impact);
  }
  return impact;
}

/** An entry point of the graph: nothing (but tests) loads it and no code names its API route. */
export function isEntryPoint(graph: SourceGraph, file: string): boolean {
  return !graph.importers.get(file)?.size && !graph.apiCallers.get(file)?.size;
}

export function classifyPath(map: ImpactMap, graph: SourceGraph, file: string, event: string,
  cache = new Map<string, FileImpact>()): PathDecision {
  if (matchesAny(file, map.docs)) return { path: file, class: "docs", reason: "documentation" };
  if (event !== "pull_request") return { path: file, class: "full", reason: "push: only a documentation change skips the suite" };
  if (matchesAny(file, map.full)) return { path: file, class: "full", reason: "shared core (full glob)" };
  if (graph.runnerClosure.has(file)) return { path: file, class: "full", reason: "imported by the critical runner" };
  const closure = graph.files.has(file) ? reverseClosure(graph, file) : new Set([file]);
  const journeys = new Set<string>();
  const rules = new Set<string>();
  const unmappedEntries: string[] = [];
  for (const member of [...closure].sort()) {
    // A dependency of the shared core (root layout, proxy, auth, calculation
    // engine, journey fixtures) changes every journey. Build tools under
    // escalationExcluded run only their own step and are entry points below.
    if (member !== file && matchesAny(member, map.full) && !matchesAny(member, map.graph.escalationExcluded)) {
      return { path: file, class: "full", reason: `loaded by the shared core ${member}` };
    }
    const impact = fileImpact(map, member, cache);
    impact.rules.forEach((rule) => rules.add(rule));
    impact.journeys.forEach((journey) => journeys.add(journey));
    // Impact stops at entry points (routes, pages, journeys, scripts): each one
    // the change reaches must be known to the map, else nothing proves it.
    if (!impact.rules.length && isEntryPoint(graph, member) &&
      !matchesAny(member, map.nonRuntime) && !matchesAny(member, map.full)) unmappedEntries.push(member);
  }
  if (unmappedEntries.length) {
    return { path: file, class: "unmapped", reason: unmappedReason(unmappedEntries, file, graph) };
  }
  if (!rules.size) return { path: file, class: "non-runtime", reason: "only non-runtime entry points load it" };
  const sorted = [...journeys].sort();
  return sorted.length
    ? { path: file, class: "journeys", reason: `${closure.size} file(s) in its impact closure`, journeys: sorted, rules: [...rules].sort() }
    : { path: file, class: "known-unexercised", reason: "no critical or full-only journey reaches it", rules: [...rules].sort() };
}

function unmappedReason(unmappedEntries: string[], file: string, graph: SourceGraph): string {
  if (unmappedEntries[0] === file) return graph.files.has(file) ? "no map rule covers this entry point" : "deleted or unknown path without a map rule";
  return `reaches the unmapped entry point ${unmappedEntries[0]}${unmappedEntries.length > 1 ? ` (+${unmappedEntries.length - 1})` : ""}`;
}

const PUSH_FULL_ONLY: FullOnlySelection = {
  mode: "none", reason: "push: the post-merge check is the critical suite; the nightly full suite runs the full-only journeys", files: [],
};

/** Problems that make army-shards.json unusable; with the suites' journeys, also the files no suite runs. */
export function validateShardDurations(durations: ShardDurations, journeys?: readonly string[]): string[] {
  const problems: string[] = [];
  if (durations?.schemaVersion !== 1) return [`Unsupported army-shards.json schemaVersion ${durations?.schemaVersion}.`];
  const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
  const integer = (value: unknown, low: number, high: number) => Number.isInteger(value) && (value as number) >= low && (value as number) <= high;
  if (!positive(durations.defaultSeconds)) problems.push("army-shards.json defaultSeconds must be a positive number of seconds.");
  for (const suite of ["critical", "full"] as const) {
    const settings = durations.suites?.[suite];
    if (!integer(settings?.maxShards, 1, 8) || !positive(settings?.secondsPerShard) || !integer(settings?.workers, 1, 4)) {
      problems.push(`army-shards.json suite ${suite} needs maxShards from 1 to 8, secondsPerShard above 0 and workers from 1 to 4.`);
    }
  }
  const known = journeys ? new Set(journeys) : undefined;
  for (const [file, seconds] of Object.entries(durations.seconds ?? {})) {
    if (!positive(seconds)) problems.push(`army-shards.json times ${file} with ${seconds}, not a positive number of seconds.`);
    if (known && !known.has(file)) problems.push(`army-shards.json times ${file}, which no suite runs.`);
  }
  return problems;
}

export function loadShardDurations(root: string): { durations: ShardDurations; sha256: string } {
  const bytes = fs.readFileSync(path.join(root, SHARDS_PATH));
  return { durations: JSON.parse(bytes.toString("utf8")) as ShardDurations, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** The durations file when it is readable and valid; null otherwise (every plan is then one shard). */
function usableShardDurations(root: string): { durations: ShardDurations | null; sha256: string | null } {
  try {
    const loaded = loadShardDurations(root);
    return validateShardDurations(loaded.durations).length ? { durations: null, sha256: loaded.sha256 } : loaded;
  } catch {
    return { durations: null, sha256: null };
  }
}

/**
 * Splits a selection into disjoint shards, each with the login setup, longest
 * measured file first onto the least loaded shard: authenticated journeys
 * first, so that every shard holds one (the runner refuses a run of anonymous
 * journeys only), anonymous ones after. A file is never cut, so an SDK serial
 * group, which lives in one file, stays whole. One shard when the measured
 * journeys fit it; one shard of the runner's own whole suite (files empty)
 * when the list is the whole suite or cannot be used as runner --files.
 */
export function planShards(input: {
  suite: ShardSuite;
  /** The files to run, login setup included. */
  files: readonly string[];
  /** The files are the suite's whole listing: a single shard then runs the runner's own selection instead. */
  wholeSuite: boolean;
  setup: string;
  anonymous: readonly string[];
  /** The runner's --files pattern. */
  accepts: RegExp;
  durations: ShardDurations | null;
  durationsSha256?: string | null;
}): ShardPlan {
  const settings = input.durations?.suites?.[input.suite];
  const plan = (reason: string, shards: string[][], seconds: number[]): ShardPlan => ({
    schemaVersion: "army-shard-plan-1", suite: input.suite, reason, files: [...new Set(shards.flat())].sort(),
    workers: settings?.workers ?? null, durationsSha256: input.durationsSha256 ?? null,
    shards: shards.map((files, index) => ({ shard: index + 1, total: shards.length, files: [...files].sort(), seconds: seconds[index] })),
  });
  const whole = (why: string) => plan(`one shard, the runner's own whole suite: ${why}`, [[]], [0]);
  const files = [...new Set(input.files)].sort();
  if (files.length === 0) return whole("no list of its journeys");
  const refused = files.find((file) => !input.accepts.test(file));
  if (refused) return whole(`the runner's --files refuses ${refused}`);
  if (!files.includes(input.setup)) return whole(`the list lacks the login setup ${input.setup}`);
  const business = files.filter((file) => file !== input.setup);
  if (!settings || !input.durations) {
    const why = "no usable measured durations (army-shards.json)";
    return input.wholeSuite ? whole(why) : plan(`one shard: ${why}`, [files], [0]);
  }
  const { defaultSeconds, seconds } = input.durations;
  const weight = (file: string) => seconds[file] ?? defaultSeconds;
  const total = business.reduce((sum, file) => sum + weight(file), 0);
  const anonymous = new Set(input.anonymous);
  const authenticated = business.filter((file) => !anonymous.has(file));
  const count = Math.min(settings.maxShards, Math.max(1, authenticated.length), Math.max(1, Math.ceil(total / settings.secondsPerShard)));
  if (count === 1) {
    const why = `${total} s of measured journeys fit one shard of ${settings.secondsPerShard} s`;
    return input.wholeSuite ? whole(why) : plan(`one shard: ${why}`, [files], [total]);
  }
  const longestFirst = (list: string[]) => [...list].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  const bins = Array.from({ length: count }, () => ({ load: 0, files: [input.setup] }));
  for (const file of [...longestFirst(authenticated), ...longestFirst(business.filter((entry) => anonymous.has(entry)))]) {
    let target = 0;
    for (let index = 1; index < count; index += 1) if (bins[index].load < bins[target].load) target = index;
    bins[target].load += weight(file);
    bins[target].files.push(file);
  }
  return plan(`${count} shards: ${total} s of measured journeys, ${settings.secondsPerShard} s per shard, at most ${settings.maxShards}`,
    bins.map((bin) => bin.files), bins.map((bin) => bin.load));
}

/** One GitHub matrix entry per shard; the files comma-joined (the selector refuses a path with a comma). */
export function shardMatrix(plan: ShardPlan): Array<{ shard: number; total: number; files: string }> {
  return plan.shards.map(({ shard, total, files }) => ({ shard, total, files: files.join(",") }));
}

type ShardInput = { suiteJourneys: readonly string[] | null; durations: ShardDurations | null; durationsSha256: string | null };

function criticalShards(map: ImpactMap, mode: Selection["mode"], files: string[], input: ShardInput | undefined): ShardPlan {
  const base = { suite: "critical" as const, setup: map.suite.setup, anonymous: map.suite.anonymous, accepts: CRITICAL_JOURNEY_FILE,
    durations: input?.durations ?? null, durationsSha256: input?.durationsSha256 ?? null };
  if (mode === "none") {
    return { schemaVersion: "army-shard-plan-1", suite: "critical", reason: "no critical journey to run", files: [],
      workers: base.durations?.suites?.critical?.workers ?? null, durationsSha256: base.durationsSha256, shards: [] };
  }
  return mode === "files"
    ? planShards({ ...base, files, wholeSuite: false })
    : planShards({ ...base, files: input?.suiteJourneys ?? [], wholeSuite: true });
}

/**
 * The nightly full selection split into shards: listed from the e2e.config.ts
 * full globs and the working tree (an unregistered journey is listed too),
 * the development phase in its own job. Filtered (--grep), or a list that
 * cannot be established: one shard of the runner's own selection, which then
 * runs no development phase (--grep) or both phases on its stack.
 */
export function planFullSuite(root: string, options: { repositoryFiles?: string[]; config?: string; unsharded?: string } = {}): ShardPlan {
  const { durations, sha256 } = usableShardDurations(root);
  const unsharded = (reason: string, development: "in-shard" | "none"): ShardPlan => ({
    schemaVersion: "army-shard-plan-1", suite: "full", reason, files: [], workers: durations?.suites?.full?.workers ?? null,
    durationsSha256: sha256, development, shards: [{ shard: 1, total: 1, files: [], seconds: 0 }],
  });
  if (options.unsharded) return unsharded(`one shard, the runner's own selection: ${options.unsharded}`, "none");
  try {
    const { map } = loadImpactMap(root);
    const repositoryFiles = options.repositoryFiles ?? listRepositoryFiles(root);
    const globs = fullSelectionGlobs(options.config ?? fs.readFileSync(path.join(root, "e2e.config.ts"), "utf8"));
    const files = repositoryFiles.filter((file) => globs.some((glob) => globToRegExp(glob).test(file)));
    const plan = planShards({ suite: "full", files, wholeSuite: true, setup: map.suite.setup, anonymous: map.suite.anonymous,
      accepts: FULL_JOURNEY_FILE, durations, durationsSha256: sha256 });
    return { ...plan, development: plan.files.length ? "separate" : "in-shard" };
  } catch (error) {
    return unsharded(`fail-safe: ${(error as Error).message}`, "in-shard");
  }
}

export function selectJourneys(input: {
  map: ImpactMap;
  graph: SourceGraph;
  event: string;
  paths: string[];
  /** Why the full suite is forced (army-full label, unverifiable checkout); empty or absent: not forced. */
  forceFull?: string | null;
  base?: string | null;
  head?: string | null;
  mapSha256?: string | null;
  /** The critical suite listing and the measured durations; absent, every plan is one shard. */
  shards?: ShardInput;
}): Selection {
  const { map, graph, event } = input;
  // When the critical decision is unsure, every full-only journey runs too.
  const everyFullOnly = (why: string): FullOnlySelection => event === "push"
    ? PUSH_FULL_ONLY
    : { mode: "all", reason: `every full-only journey: ${why}`, files: [map.suite.setup, ...map.fullOnly.journeys].sort() };
  const selection = (mode: Selection["mode"], reason: string, files: string[], changedPaths: PathDecision[],
    fullOnly: FullOnlySelection = everyFullOnly(reason)): Selection => ({
    schemaVersion: "army-impact-selection-3", event, base: input.base ?? null, head: input.head ?? null,
    mapSha256: input.mapSha256 ?? null, mode, reason, files, fullOnly,
    shards: criticalShards(map, mode, files, input.shards), changedPaths,
  });
  if (input.forceFull) return selection("full", `full suite forced: ${input.forceFull}`, [], []);
  if (event !== "pull_request" && event !== "push") return selection("full", `event ${event || "unknown"} always runs the full suite`, [], []);
  const paths = [...new Set(input.paths)].sort();
  if (paths.length === 0) return selection("full", "no changed path could be determined", [], []);
  const cache = new Map<string, FileImpact>();
  const decisions = paths.map((file) => classifyPath(map, graph, file, event, cache));
  const blocking = decisions.filter((decision) => decision.class === "full" || decision.class === "unmapped");
  if (blocking.length) return selection("full", `${blocking.length} path(s) require the full suite, first: ${blocking[0].path} (${blocking[0].reason})`, [], decisions);
  const reached = new Set(decisions.flatMap((decision) => decision.journeys ?? []));
  const fullOnlyJourneys = new Set(map.fullOnly.journeys);
  const fullOnlyReached = [...reached].filter((journey) => fullOnlyJourneys.has(journey));
  const fullOnly: FullOnlySelection = event === "push"
    ? PUSH_FULL_ONLY
    : fullOnlyReached.length === 0
      ? { mode: "none", reason: "no full-only journey is affected", files: [] }
      : {
        mode: fullOnlyReached.length === fullOnlyJourneys.size ? "all" : "files",
        reason: `${fullOnlyReached.length} of ${fullOnlyJourneys.size} full-only journey files selected`,
        files: [map.suite.setup, ...fullOnlyReached].sort(),
      };
  const journeys = new Set([...reached].filter((journey) => !fullOnlyJourneys.has(journey)));
  if (journeys.size === 0) return selection("none", "no critical journey is affected", [], decisions, fullOnly);
  const anonymous = new Set(map.suite.anonymous);
  journeys.add(map.suite.setup);
  // The runner refuses a run without an authenticated business journey.
  if (![...journeys].some((journey) => journey !== map.suite.setup && !anonymous.has(journey))) journeys.add(map.suite.anchor);
  // A full critical selection runs every takeoff journey too, as any other full one.
  if (map.suite.journeys.every((journey) => journeys.has(journey))) return selection("full", "every critical journey is affected", [], decisions);
  return selection("files", `${journeys.size} of ${map.suite.journeys.length} journey files selected`, [...journeys].sort(), decisions, fullOnly);
}

/**
 * Fail-safe full-only selection: every journey the map's globs match in the
 * working tree, so one the map omits still runs. Nothing listable (unreadable
 * map), or a path the runner's full --files would refuse: empty "all", which
 * the army-takeoff job runs as the whole full selection.
 */
function fullOnlyFailSafe(event: string, map: ImpactMap | undefined, repositoryFiles: readonly string[] | undefined): FullOnlySelection {
  if (event === "push") return PUSH_FULL_ONLY;
  try {
    const journeys = repositoryFiles!.filter((file) => matchesAny(file, map!.fullOnly.globs));
    const setup = repositoryFiles!.includes(map!.suite.setup) ? [map!.suite.setup] : [];
    const listed = [...setup, ...journeys].sort();
    if (journeys.length && listed.every((file) => FULL_ONLY_JOURNEY_FILE.test(file))) {
      return { mode: "all", reason: "fail-safe: every full-only journey of the working tree", files: listed };
    }
  } catch { /* nothing listable */ }
  return { mode: "all", reason: "fail-safe: the full-only journeys cannot be listed for the runner; the whole full selection runs", files: [] };
}

export function loadImpactMap(root: string): { map: ImpactMap; sha256: string } {
  const bytes = fs.readFileSync(path.join(root, MAP_PATH));
  return { map: JSON.parse(bytes.toString("utf8")) as ImpactMap, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function changedPathsFromGit(root: string, base: string, head: string): string[] {
  for (const revision of [base, head]) {
    if (!revision || /^0+$/.test(revision) || git(root, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]).status !== 0) {
      throw new Error(`Revision ${revision || "(empty)"} is not available in this checkout.`);
    }
  }
  const result = git(root, ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`]);
  if (result.status !== 0) throw new Error(`git diff ${base}...${head} failed.`);
  return result.stdout.toString("utf8").split("\0").filter(Boolean);
}

export type SelectionRequest = {
  event: string;
  base?: string | null;
  head?: string;
  /** Changed paths; absent, read from pathsFile, else git diff base...head. */
  paths?: string[];
  pathsFile?: string;
  forceFull?: string | null;
  /** The working tree's files; absent, git ls-files lists them. */
  repositoryFiles?: string[];
};

/** The command line decision: map checked against the working tree, then selection; any error selects the full suite. */
export function selectFromRepository(root: string, request: SelectionRequest): Selection {
  const { event } = request;
  const base = request.base ?? null;
  const head = request.head ?? "HEAD";
  const givenPaths = request.paths !== undefined || request.pathsFile !== undefined;
  let loadedMap: ImpactMap | undefined;
  let repositoryFiles = request.repositoryFiles;
  try {
    const { map, sha256 } = loadImpactMap(root);
    loadedMap = map;
    repositoryFiles ??= listRepositoryFiles(root);
    const present = new Set(repositoryFiles);
    const config = fs.readFileSync(path.join(root, "e2e.config.ts"), "utf8");
    const suiteJourneys = criticalSuiteJourneys(config, repositoryFiles);
    const fullOnlyJourneys = fullOnlySuiteJourneys(config, map.fullOnly.globs, repositoryFiles);
    const problems = validateImpactMap(map, (file) => present.has(file), suiteJourneys, fullOnlyJourneys);
    if (problems.length) {
      throw new Error(`Invalid impact map: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}`);
    }
    const forceFull = request.forceFull ?? null;
    const paths = forceFull || (event !== "pull_request" && event !== "push")
      ? []
      : request.paths ?? (request.pathsFile
        ? fs.readFileSync(request.pathsFile, "utf8").split(/[\0\r\n]+/).map((file) => file.trim()).filter(Boolean)
        : changedPathsFromGit(root, base ?? "", head));
    const durations = usableShardDurations(root);
    return selectJourneys({ map, graph: buildSourceGraph(root, map, repositoryFiles), event, paths,
      forceFull, base, head: givenPaths ? null : head, mapSha256: sha256,
      shards: { suiteJourneys, durations: durations.durations, durationsSha256: durations.sha256 } });
  } catch (error) {
    const reason = `fail-safe: ${(error as Error).message}`;
    // Unsure of the map: one shard of the runner's own whole suite, as before shards existed.
    const shards: ShardPlan = { schemaVersion: "army-shard-plan-1", suite: "critical",
      reason: `one shard, the runner's own whole suite: ${reason}`, files: [], workers: usableShardDurations(root).durations?.suites.critical.workers ?? null,
      durationsSha256: null, shards: [{ shard: 1, total: 1, files: [], seconds: 0 }] };
    return { schemaVersion: "army-impact-selection-3", event, base, head, mapSha256: null, mode: "full",
      reason, files: [], fullOnly: fullOnlyFailSafe(event, loadedMap, repositoryFiles), shards, changedPaths: [] };
  }
}

function summary(selection: Selection): string {
  const title = selection.mode === "none"
    ? "Aucun parcours TesterArmy critical concerné : étape des parcours ignorée (succès explicite)."
    : selection.mode === "full"
      ? "Suite TesterArmy critical complète."
      : `Parcours TesterArmy critical sélectionnés par impact (exécution enregistrée « filtered-critical ») : ${selection.files.length} fichiers.`;
  const lines = [`### Sélection TesterArmy critical`, "", title, "", `Motif : ${selection.reason}.`, ""];
  if (selection.files.length) lines.push(...selection.files.map((file) => `- \`${file}\``), "");
  const fullOnly = selection.fullOnly;
  lines.push("#### Parcours du métré (job army-takeoff)", "", fullOnly.mode === "none"
    ? "Aucun parcours du métré concerné : job ignoré (succès explicite)."
    : fullOnly.files.length
      ? `Exécution enregistrée « filtered-full » : ${fullOnly.files.length} fichiers (${fullOnly.mode === "all" ? "tous" : "sélection par impact"}).`
      : "Liste indisponible : sélection full complète.", "", `Motif : ${fullOnly.reason}.`, "");
  if (fullOnly.files.length) lines.push(...fullOnly.files.map((file) => `- \`${file}\``), "");
  if (selection.mode !== "none") lines.push("#### Jobs parallèles (army-critical shard)", "", ...shardLines(selection.shards));
  if (selection.changedPaths.length) {
    lines.push("<details><summary>Chemins modifiés</summary>", "", "| Chemin | Classe | Parcours |", "| --- | --- | --- |");
    for (const decision of selection.changedPaths.slice(0, 300)) {
      lines.push(`| \`${decision.path}\` | ${decision.class} | ${decision.journeys?.length ?? 0} |`);
    }
    lines.push("", "</details>", "");
  }
  return `${lines.join("\n")}\n`;
}

function shardLines(plan: ShardPlan): string[] {
  const lines = [`${plan.shards.length} job(s) à ${plan.workers ?? "?"} worker(s). Motif : ${plan.reason}.`, ""];
  for (const shard of plan.shards) {
    lines.push(`- shard ${shard.shard}/${shard.total} : ${shard.files.length ? `${shard.files.length} fichiers, ${shard.seconds} s mesurées` : "suite entière du runner"}`);
  }
  return [...lines, ""];
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** Writes the JSON report, the GitHub outputs and the job summary; a path that could split or inject an output is refused. */
function publish(args: string[], result: unknown, files: string[], outputs: string, markdown: string) {
  if (files.some((file) => /[\r\n,]/u.test(file))) throw new Error("A selected journey path contains a comma or a line break.");
  const json = `${JSON.stringify(result, null, 2)}\n`;
  const report = option(args, "--report");
  if (report) {
    fs.mkdirSync(path.dirname(path.resolve(report)), { recursive: true });
    fs.writeFileSync(report, json);
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  process.stdout.write(json);
}

function main() {
  const args = process.argv.slice(2);
  const known = new Set(["--event", "--base", "--head", "--paths-file", "--report", "--force-full", "--plan", "--unsharded"]);
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    if (!known.has(args[index]) || seen.has(args[index])) throw new Error(`Unknown or repeated argument ${args[index]}.`);
    seen.add(args[index]);
    if (!args[index + 1] || known.has(args[index + 1])) throw new Error(`${args[index]} requires a value.`);
    index += 1;
  }
  const usage = "Usage: node scripts/tester-army/select-journeys.ts --event pull_request|push|<other> " +
    "[--base REV --head REV | --paths-file FILE] [--force-full REASON] [--report FILE]" +
    " | --plan full [--unsharded REASON] [--report FILE]";
  const planned = option(args, "--plan");
  if (planned !== undefined) {
    // The nightly full suite: no impact selection, only its shards.
    if (planned !== "full" || ["--event", "--base", "--head", "--paths-file", "--force-full"].some((name) => seen.has(name))) throw new Error(usage);
    const plan = planFullSuite(process.cwd(), { unsharded: option(args, "--unsharded") });
    publish(args, plan, plan.files, `shards=${JSON.stringify(shardMatrix(plan))}\ndevelopment=${plan.development}\n`,
      ["### Suite TesterArmy full : jobs parallèles", "", ...shardLines(plan),
        `Phase développement : ${plan.development === "separate" ? "job army-full-development" : plan.development === "in-shard" ? "sur la pile du shard unique" : "non lancée (exécution filtrée)"}.`, ""].join("\n"));
    return;
  }
  const event = option(args, "--event");
  if (!event || seen.has("--unsharded")) throw new Error(usage);
  const result = selectFromRepository(process.cwd(), {
    event,
    base: option(args, "--base") ?? null,
    head: option(args, "--head") ?? "HEAD",
    pathsFile: option(args, "--paths-file"),
    forceFull: option(args, "--force-full") ?? null,
  });
  publish(args, result, [...result.files, ...result.fullOnly.files, ...result.shards.files],
    `mode=${result.mode}\nfiles=${result.files.join(",")}\n` +
    `full_only_mode=${result.fullOnly.mode}\nfull_only_files=${result.fullOnly.files.join(",")}\n` +
    `critical_shards=${JSON.stringify(shardMatrix(result.shards))}\n`, summary(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
  }
}
