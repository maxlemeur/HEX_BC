"use strict";
// minimatch 3 call surface of eslint-plugin-import 2.32, eslint-plugin-jsx-a11y 6.10 and
// eslint-plugin-react 7.37, which require("minimatch") as a function, through Babel interop
// (.default), for makeRe or for the Minimatch class. Every match is made by minimatch 11.0.3,
// the release that fixes GHSA-g3hv-75wg-m249: this file holds no matcher of its own.
//
// Supported: minimatch(path, pattern, options), new Minimatch(pattern, options).match(path) and
// makeRe(pattern, options).test(path), with the options nocomment, nonegate, noglobstar,
// nobrace, noext, dot, nocase, matchBase and flipNegate. Any other option or argument throws a
// TypeError, and so does a construct whose meaning differs between minimatch 3.1.5 and 11.0.3
// (found by differential testing of the two releases) instead of returning the 11.0.3 answer.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS entry, required by the plugins
const patched = require("minimatch-11");

const NAME = "@mergeone/minimatch-v3-api";
const OPTIONS = new Set(["nocomment", "nonegate", "noglobstar", "nobrace", "noext", "dot", "nocase", "matchBase",
  "flipNegate"]);
const MAX_PATTERN_LENGTH = 64 * 1024;
// minimatch 11.0.3 parses nested extglobs recursively and overflows the stack near 2,000 levels.
const MAX_EXTGLOB_DEPTH = 64;
// minimatch 11 decides the platform (it honours __MINIMATCH_TESTING_PLATFORM__); follow it.
const windows = patched.sep === "\\";
const SIMPLE_CLASS = /^[!^]?(?:[a-z]-[a-z]|[A-Z]-[A-Z]|[0-9]-[0-9]|[A-Za-z0-9_.@])+$/;
const WILDCARD = /[*?[]|[+@!*?]\(/;
const DRIVE = /^[A-Za-z]:/;
// The characters minimatch 3 holds until the next one, to see whether they open an extglob.
const STATE = "*?+@!";
// minimatch 3 folds case with toLowerCase and the i flag, 11.0.3 with Unicode case folding;
// minimatch 3 reads one UTF-16 unit for ? and a class, 11.0.3 one code point.
const NON_ASCII = /[^\0-\x7f]/;
const SURROGATE = /[\ud800-\udfff]/;
// minimatch 3 unescapes with /\\(.)/g, whose . skips line terminators; 11.0.3 drops the \.
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;

const differs = (what, pattern) => new TypeError(
  `${NAME}: ${what} in ${JSON.stringify(pattern)} does not match the same paths in minimatch 3.1.5 and 11.0.3`);
const differsFor = (pattern, path) => new TypeError(
  `${NAME}: ${JSON.stringify(pattern)} does not match ${JSON.stringify(path)} the same way in minimatch 3.1.5 and 11.0.3`);

function readOptions(options) {
  if (options === undefined || options === null) return {};
  if (typeof options !== "object") throw new TypeError(`${NAME}: options must be an object`);
  const settings = {};
  for (const [key, value] of Object.entries(options)) {
    if (!OPTIONS.has(key)) throw new TypeError(`${NAME}: unsupported option ${JSON.stringify(key)}`);
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError(`${NAME}: option ${JSON.stringify(key)} must be a boolean`);
    }
    if (value) settings[key] = true;
  }
  return settings;
}

function readPattern(pattern) {
  if (typeof pattern !== "string") throw new TypeError("invalid pattern");
  if (pattern.length > MAX_PATTERN_LENGTH) throw new TypeError("pattern is too long");
  // minimatch 3 trims patterns and, on Windows, reads every backslash as a separator.
  const trimmed = pattern.trim();
  return windows ? trimmed.split("\\").join("/") : trimmed;
}

// The patterns minimatch 3 matches after its comment, negation and brace handling.
function variants(pattern, settings) {
  if (!settings.nocomment && pattern.startsWith("#")) return [];
  // brace-expansion 1 (minimatch 3) leaves every brace after "${" unexpanded, 5 (11.0.3) does not.
  if (!settings.nobrace && pattern.includes("${")) throw differs("a ${", pattern);
  // They also expand a {} next to an empty alternative differently ({,{}}{},}).
  if (!settings.nobrace && pattern.includes("{}")) throw differs("a {}", pattern);
  return patched.braceExpand(settings.nonegate ? pattern : pattern.replace(/^!+/, ""), settings);
}

function rejectDifferentConstructs(variant, settings, pattern) {
  // Both releases split the pattern on "/" before parsing each portion, so an extglob, a
  // parenthesis or an escape never spans portions. depth counts every parenthesis; extglobs lists
  // the open extglob types, which 3.1.5 and 11.0.3 both close at the next ")" whatever literal "("
  // it follows.
  for (const portion of variant.split("/")) {
    let depth = 0;
    const extglobs = [];
    let escaped = -1;
    for (let index = 0; index < portion.length; index++) {
      const character = portion[index];
      const next = portion[index + 1];
      if (character === "\\") {
        if (next === "@") throw differs("an escaped @", pattern);
        if (next !== undefined && LINE_TERMINATOR.test(next)) throw differs("a \\ before a line terminator", pattern);
        escaped = ++index;
        continue;
      }
      if (character === "[") {
        const end = portion.indexOf("]", index + (next === "!" || next === "^" ? 2 : 1));
        const body = end === -1 ? "" : portion.slice(index + 1, end);
        // 11.0.3 reads [.] as a literal dot, which a leading wildcard guard no longer excludes.
        if (!SIMPLE_CLASS.test(body) || body === "." ||
          [...body.matchAll(/(\w)-(\w)/g)].some(([, low, high]) => low > high)) {
          throw differs("this bracket expression", pattern);
        }
        index = end;
        continue;
      }
      // minimatch 3 emits a held *, ?, +, @ or ! after a following ], or after a ) or | outside
      // extglobs: \[*] or (*) as in Next.js [id] and (group) segments, *], (a*|b).
      if (!settings.noext && STATE.includes(character) && next !== undefined && "])|".includes(next) &&
        (next === "]" || extglobs.length === 0)) {
        throw differs(`a ${character} before ${next}`, pattern);
      }
      if (!settings.noext && STATE.includes(character) && next === "(" && portion[index - 1] === "*") {
        throw differs("a * before an extglob", pattern);
      }
      if (character === "(") {
        depth++;
        if (!settings.noext && index > 0 && escaped !== index - 1 && STATE.includes(portion[index - 1])) {
          extglobs.push(portion[index - 1]);
          if (extglobs.length > MAX_EXTGLOB_DEPTH) {
            throw new TypeError(`${NAME}: more than ${MAX_EXTGLOB_DEPTH} nested extglobs in ${JSON.stringify(pattern)}`);
          }
          // 3.1.5 compiles @() and the like to an expression that matches nothing, 11.0.3 to literals.
          if (next === ")") throw differs("an empty extglob", pattern);
        }
      } else if (character === ")") {
        if (depth === 0) throw differs("an unmatched )", pattern);
        depth--;
        if (extglobs.pop() === "!" && next !== undefined) {
          throw differs("a !(...) followed by more of its portion", pattern);
        }
      } else if (character === "|" && depth === 0) {
        throw differs("a | outside parentheses", pattern);
      }
    }
    if (extglobs.length > 0) throw differs("an unclosed extglob", pattern);
  }
  if (!settings.noglobstar) {
    const portions = variant.split("/").filter(Boolean);
    if (portions.some((portion, index) => portion === "**" && portions[index - 1] === "**")) {
      throw differs("adjacent ** portions", pattern);
    }
    if (portions.filter((portion) => portion === "**").length > 2) throw differs("more than two ** portions", pattern);
  }
}

// Constructs that only differ for paths with ".", ".." or dot-led portions.
function dotRules(list, settings) {
  const rules = { wildcardAfterDot: false, dotSensitive: false, drives: [] };
  for (const variant of list) {
    const portions = variant.split("/").map((portion) => portion.replace(/^\\(?=\.)/, ""));
    if (portions.some((portion) => portion.startsWith(".") && portion !== "." && portion !== ".." &&
      WILDCARD.test(portion))) rules.wildcardAfterDot = true;
    if (!settings.noext && portions.some((portion) => /^[!?+*@]\(/.test(portion) && portion.includes("."))) {
      rules.dotSensitive = true;
    }
    if (!settings.noglobstar && portions.filter((portion) => portion === "**").length === 2 &&
      portions.some((portion) => portion.startsWith("."))) rules.dotSensitive = true;
    if (windows) rules.drives.push(...portions.filter((portion) => DRIVE.test(portion)).map((portion) => portion[0]));
  }
  return rules;
}

class Minimatch {
  #matcher;
  #nocase;
  #pattern;
  #rules;

  constructor(pattern, options) {
    const settings = readOptions(options);
    const normalized = readPattern(pattern);
    if (settings.nocase && NON_ASCII.test(normalized)) throw differs("a non-ASCII character with nocase", pattern);
    const list = variants(normalized, settings);
    for (const variant of list) rejectDifferentConstructs(variant, settings, pattern);
    if (windows && list.some((variant) => variant.startsWith("//"))) throw differs("a UNC root", pattern);
    if (windows && list.some((variant) => variant.split("/").some((portion) => DRIVE.test(portion) && portion.length > 2))) {
      throw differs("a drive letter followed by more of its portion", pattern);
    }
    this.#pattern = pattern;
    this.#nocase = settings.nocase === true;
    this.#rules = dotRules(list, settings);
    this.#matcher = new patched.Minimatch(normalized, { ...settings, optimizationLevel: 0, windowsPathsNoEscape: windows });
  }

  match(path, partial) {
    if (partial !== undefined) throw new TypeError(`${NAME}: partial matching is not supported`);
    if (typeof path !== "string") throw new TypeError(`${NAME}: the path must be a string`);
    const slashed = windows ? path.split("\\").join("/") : path;
    const portions = slashed.split("/");
    if (SURROGATE.test(path) || (this.#nocase && NON_ASCII.test(path)) ||
      (this.#rules.wildcardAfterDot && portions.some((portion) => portion === "." || portion === "..")) ||
      (this.#rules.dotSensitive && portions.some((portion) => portion.startsWith("."))) ||
      (windows && slashed.startsWith("//")) ||
      portions.some((portion) => DRIVE.test(portion) && this.#rules.drives.some((drive) =>
        drive !== portion[0] && drive.toLowerCase() === portion[0].toLowerCase()))) {
      throw differsFor(this.#pattern, path);
    }
    return this.#matcher.match(path);
  }
}

function minimatch(path, pattern, options) {
  return new Minimatch(pattern, options).match(path);
}

// minimatch 3 builds a regular expression; 11.0.3 has none. The test is delegated to glob
// matching only where the two agree: no matchBase or flipNegate (which makeRe ignored), a
// literal first portion, no bracket expression, !(...) or **, and paths without empty, "."
// or ".." portions other than a leading "/" and without line terminators, which the .* of a
// negated 3.x expression does not cross.
function makeRe(pattern, options) {
  const settings = readOptions(options);
  const normalized = readPattern(pattern);
  if (normalized === "" || (!settings.nocomment && normalized.startsWith("#"))) return false;
  if (settings.matchBase || settings.flipNegate) {
    throw new TypeError(`${NAME}: makeRe does not support matchBase or flipNegate`);
  }
  const list = variants(normalized, settings);
  // minimatch 3 has no regular expression when every brace alternative is empty ({,}).
  if (list.length === 0) return false;
  for (const variant of list) {
    const portions = variant.split("/");
    if (variant === "" || /[*?[(\\]/.test(portions[0]) || variant.includes("[") ||
      (!settings.noext && variant.includes("!(")) || (!settings.noglobstar && portions.includes("**"))) {
      throw differs("the regular expression", pattern);
    }
  }
  const matcher = new Minimatch(pattern, options);
  return Object.freeze({
    test(path) {
      if (typeof path !== "string") throw new TypeError(`${NAME}: the path must be a string`);
      if (LINE_TERMINATOR.test(path) || (path !== "" && path !== "/" && ((windows && path.includes("\\")) ||
        path.split("/").some((portion, index) => (portion === "" && index > 0) || portion === "." || portion === "..")))) {
        throw new TypeError(`${NAME}: makeRe(...).test() only reads normalized paths, not ${JSON.stringify(path)}`);
      }
      return matcher.match(path);
    },
  });
}

minimatch.Minimatch = Minimatch;
minimatch.makeRe = makeRe;
module.exports = minimatch;
