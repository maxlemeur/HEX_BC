// Fail-closed checks of a TesterArmy journey selection, run before any stack
// starts (scripts/run-tester-army-ci.ts) and by the journey wrapper
// (scripts/run-tester-army.mjs). Failure modes: src/test/army-journey-preflight.test.ts.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Files whose double-quoted e2e/army/local journey paths and globs are the
 * standing selections: every phase of e2e.config.ts, the calc-v3 phases and
 * the offer-emission and resend-portal profiles. Read as text, as
 * select-journeys.ts reads e2e.config.ts.
 */
export const LOCAL_JOURNEY_COLLECTORS = [
  "e2e.config.ts",
  "scripts/tester-army/calc-v3-phases.ts",
  "scripts/tester-army/coverage-phases.ts",
  "e2e/army/local/offer-emission.config.ts",
  "e2e/army/local/resend-portal.config.ts",
];

/**
 * No business journey is excluded from standing selections. Kept as an empty
 * compatibility hook for diagnostic tests; adding a journey requires a runner
 * selection and owned prerequisites.
 */
export const LOCAL_JOURNEYS_OUTSIDE_SELECTIONS = {};

const LOCAL_DIRECTORY = "e2e/army/local";

/** A config glob as the e2e CLI reads it: `*` within a segment, `**` across segments. */
function globPattern(glob) {
  const source = glob.split(/(\*\*\/|\*)/u).map((part) => part === "**/" ? "(?:[^/]+/)*" : part === "*" ? "[^/]*"
    : part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&")).join("");
  return new RegExp(`^${source}$`, "u");
}

/**
 * Problems that let a local journey file go unrun silently: a file no
 * collector names and no exclusion lists, or an exclusion that is collected,
 * missing or without its run document. Empty when every journey is accounted for.
 * @param {string} root
 * @param {{ collectors?: readonly string[], outsideSelections?: Readonly<Record<string, string>> }} [options]
 * @returns {string[]}
 */
export function localJourneyCoverageProblems(root, options = {}) {
  const collectors = options.collectors ?? LOCAL_JOURNEY_COLLECTORS;
  const outside = options.outsideSelections ?? LOCAL_JOURNEYS_OUTSIDE_SELECTIONS;
  const globs = collectors.flatMap((file) => [...fs.readFileSync(path.join(root, file), "utf8")
    .matchAll(/"(e2e\/army\/local\/[^"\s]*\.e2e\.ts)"/gu)].map((match) => globPattern(match[1])));
  const directory = path.join(root, LOCAL_DIRECTORY);
  const journeys = fs.existsSync(directory)
    ? fs.readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".e2e.ts"))
      .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/")).sort()
    : [];
  const collected = (file) => globs.some((glob) => glob.test(file));
  const problems = [];
  for (const file of journeys) {
    if (!collected(file) && !(file in outside)) {
      problems.push(`${file} is collected by no TesterArmy selection (${collectors.join(", ")}) and is not listed in ` +
        "LOCAL_JOURNEYS_OUTSIDE_SELECTIONS (scripts/tester-army/journey-preflight.mjs): add it to a selection, or list it with the document of the run that executes it.");
    }
  }
  for (const [file, document] of Object.entries(outside)) {
    if (!journeys.includes(file)) problems.push(`${file} is listed as run outside the selections but does not exist.`);
    else if (collected(file)) problems.push(`${file} is listed as run outside the selections but a selection collects it: remove its entry.`);
    else if (!fs.existsSync(path.join(root, document))) problems.push(`${file} names ${document}, which does not exist.`);
  }
  return problems;
}

/** A --grep value as the e2e CLI parses it: a bare pattern, or /pattern/flags. */
function parseGrep(value) {
  const slashed = /^\/(.*)\/([a-z]*)$/su.exec(value);
  return slashed === null ? { source: value, flags: "" } : { source: slashed[1], flags: slashed[2] };
}

/** Index after the character class opening at `start` (JavaScript: a `]` right after `[` or `[^` closes it). */
function classEnd(source, start) {
  let index = start + 1;
  if (source[index] === "^") index += 1;
  for (; index < source.length; index += 1) {
    if (source[index] === "\\") index += 1;
    else if (source[index] === "]") return index + 1;
  }
  return source.length;
}

/** Index of the parenthesis closing the group opening at `start`, or -1. */
function groupEnd(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === "[") index = classEnd(source, index) - 1;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index;
  }
  return -1;
}

/** The pattern split at its bars outside any group or class. */
function topLevelAlternatives(source) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === "[") index = classEnd(source, index) - 1;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "|" && depth === 0) { parts.push(source.slice(from, index)); from = index + 1; }
  }
  return [...parts, source.slice(from)];
}

/** Where the body of a group starts: plain, non-capturing and named groups only, never a lookaround or modifier group. */
function groupBodyStart(source, start) {
  if (source[start + 1] !== "?") return start + 1;
  if (source[start + 2] === ":") return start + 3;
  if (source[start + 2] === "<" && source[start + 3] !== "=" && source[start + 3] !== "!") {
    const close = source.indexOf(">", start);
    return close === -1 ? -1 : close + 1;
  }
  return -1;
}

const MAX_ALTERNATIVES = 64;
class TooManyAlternatives extends Error {}

/** At most MAX_ALTERNATIVES sources, else TooManyAlternatives: a bound on the enumeration itself. */
function bounded(sources) {
  if (sources.length > MAX_ALTERNATIVES) throw new TooManyAlternatives();
  return sources;
}

/** Sources whose union is exactly `source`; [source] when it has no alternative this split can isolate. */
function expand(source) {
  const parts = topLevelAlternatives(source);
  if (parts.length > 1) return bounded(parts.flatMap(expand));
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") { index += 1; continue; }
    if (char === "[") { index = classEnd(source, index) - 1; continue; }
    if (char !== "(") continue;
    const end = groupEnd(source, index);
    if (end === -1) return [source];
    const body = groupBodyStart(source, index);
    // A quantified group repeats its alternation: (A|B)+ is not A+ or B+.
    if (body !== -1 && !/^[*+?{]/u.test(source.slice(end + 1))) {
      const inner = expand(source.slice(body, end));
      if (inner.length > 1) {
        return bounded(inner.flatMap((alternative) => expand(`${source.slice(0, index)}(?:${alternative})${source.slice(end + 1)}`)));
      }
    }
    index = end;
  }
  return [source];
}

/**
 * The alternatives of a --grep pattern, each matching a subset of what the
 * pattern matches and together all of it: its top-level bars, and those of
 * groups that are neither quantified nor lookarounds. A backreference, a v
 * flag or more than 64 alternatives keep the pattern whole.
 * @param {string} value
 * @returns {RegExp[]}
 */
export function grepAlternatives(value) {
  const { source, flags } = parseGrep(value);
  const whole = [new RegExp(source, flags)];
  if (flags.includes("v") || /\\(?:[1-9]|k<)/u.test(source)) return whole;
  try {
    return expand(source).map((alternative) => new RegExp(alternative, flags));
  } catch {
    // TooManyAlternatives, or an alternative that does not compile alone.
    return whole;
  }
}

/** The text --grep matches, as the e2e CLI builds it: the title path joined by one space. */
const grepText = (test) => test.titlePath.join(" ");

/**
 * Alternatives of `grep` that match none of `tests` (tests that run, not setups).
 * @param {string} grep
 * @param {ReadonlyArray<{ titlePath: readonly string[] }>} tests
 * @returns {string[]}
 */
export function grepAlternativeProblems(grep, tests) {
  return grepAlternatives(grep)
    .filter((alternative) => !tests.some((test) => { alternative.lastIndex = 0; return alternative.test(grepText(test)); }))
    .map((alternative) => `--grep alternative /${alternative.source}/${alternative.flags ? alternative.flags : ""} selects no runnable test.`);
}

/**
 * Problems of a filtered selection listed by `e2e list`: an authenticated
 * business test must run, and so must a test of each --grep alternative and
 * of each requested file.
 * @param {{ pairs: ReadonlyArray<{ file: string, titlePath: readonly string[], kind: string, tags: readonly string[], disposition: string }>, grep?: string, files?: readonly string[] }} selection
 * @returns {string[]}
 */
export function selectionPreflightProblems({ pairs, grep, files = [] }) {
  const runnable = pairs.filter((entry) => entry.disposition === "run" && entry.kind === "test");
  const problems = [];
  if (!runnable.some((entry) => entry.tags.includes("critical") && !entry.tags.includes("anonymous"))) {
    problems.push("The selection runs no authenticated business test (critical, not anonymous).");
  }
  if (grep !== undefined) problems.push(...grepAlternativeProblems(grep, runnable));
  // A shard or takeoff job names the login setup among its files: it runs as the setup of the others.
  for (const file of files) {
    if (!pairs.some((entry) => entry.file === file && entry.disposition === "run")) problems.push(`--files ${file} selects no runnable test.`);
  }
  return problems;
}

/**
 * The critical or full selection `e2e list` collects on the owned loopback
 * stack, before that stack exists: no app, engine or worker starts. The flags
 * are those scripts/run-tester-army.mjs passes for a critical run; the
 * loopback Supabase URL only selects the e2e.config.ts localBusiness list, as
 * every owned stack is loopback.
 * @param {{ root: string, suite: "critical" | "full", grep?: string, files?: readonly string[], env: NodeJS.ProcessEnv }} options
 * @returns {Promise<Array<{ file: string, titlePath: string[], kind: string, tags: string[], disposition: string }>>}
 */
export async function listArmySelection({ root, suite, grep, files = [], env }) {
  const args = [path.join(root, "node_modules/e2e/dist/cli/bin.js"), "list", "--config", "e2e.config.ts",
    "--tag", "critical", "--exclude-tag", "agent", "--target", "chromium-desktop", "--reporter", "json",
    ...(grep === undefined ? [] : ["--grep", grep]), ...files];
  const environment = {
    ...env, CI: "1", E2E_ARMY_SUITE: "critical", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    E2E_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1", NEXT_TELEMETRY_DISABLED: "1",
  };
  if (suite === "full") environment.E2E_ARMY_CRITICAL_SELECTION = "full";
  else delete environment.E2E_ARMY_CRITICAL_SELECTION;
  delete environment.E2E_ARMY_WORKERS;
  const { code, stdout, stderr } = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", reject);
    child.once("close", (exit) => resolve({ code: exit, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8") }));
  });
  if (code !== 0) throw new Error(`e2e list refused the ${suite} selection (exit ${code}): ${stderr.trim().split(/\r?\n/u).slice(-3).join(" ")}`);
  return JSON.parse(stdout).pairs;
}
