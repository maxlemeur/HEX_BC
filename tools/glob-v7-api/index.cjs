"use strict";
// glob 7 call surface of rimraf 2.7.1 (exceljs > unzipper > fstream > rimraf):
// glob(pattern, options, callback), glob.sync(pattern, options) and glob.hasMagic(pattern).
// Globbing is done by glob 14.0.3, whose bundled copy of minimatch (11.0.1 or later, patched for
// GHSA-g3hv-75wg-m249) does the matching: a later minimatch fix needs a new glob release.
//
// rimraf only expands a path that has glob characters and does not exist; fstream passes the
// resolved path of an entry it has just found on disk. Patterns are limited to literals, *, ?,
// braces without an empty alternative or a preceding "${" and, without braces, one ** before a
// portion holding * or ?, where glob 7.2.3 and 14.0.3 return the same files (differential testing
// of both releases on macOS). glob 7 finds a literal portion after ** by stat, which follows the
// case rules of the file system; glob 14 compares names. Other patterns and options throw a
// TypeError, passed to the callback of glob() instead of being thrown.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS entry, required by rimraf
const glob14 = require("glob-14");

const NAME = "@mergeone/glob-v7-api";
const OPTIONS = new Set(["nosort", "silent"]);
// glob 7 never folds case, glob 14 does by default on macOS and Windows. glob 7 reads
// backslashes as separators on Windows.
const settings = { nocase: false, ...(process.platform === "win32" ? { windowsPathsNoEscape: true } : {}) };

function readOptions(options) {
  if (options === undefined || options === null) return {};
  if (typeof options !== "object") throw new TypeError(`${NAME}: options must be an object`);
  for (const [key, value] of Object.entries(options)) {
    if (!OPTIONS.has(key)) throw new TypeError(`${NAME}: unsupported option ${JSON.stringify(key)}`);
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError(`${NAME}: option ${JSON.stringify(key)} must be a boolean`);
    }
  }
  return options;
}

function readPattern(pattern) {
  if (typeof pattern !== "string" || pattern === "") throw new TypeError(`${NAME}: the pattern must be a non-empty string`);
  const slashed = settings.windowsPathsNoEscape ? pattern.split("\\").join("/") : pattern;
  const portions = slashed.split("/");
  const globstar = portions.indexOf("**");
  const braces = /[{}]/.test(slashed);
  // ? is refused too: glob 14 reads one code point where glob 7 reads one UTF-16 unit (astral names).
  if (/[[\]()|\\?]/.test(slashed) || /^[!#]/.test(slashed) || /\{,|,\}|,,|\$\{/.test(slashed) ||
    portions.some((portion, index) => (portion === "" && index > 0) || portion === "." || portion === "..") ||
    portions.filter((portion) => portion === "**").length > 1 || portions.at(-1) === "**" ||
    (globstar !== -1 && !/[*?]/.test(portions[globstar + 1])) ||
    // Braces could hide a ** or the portion after it: none with **, no * on each side of a brace boundary.
    (braces && (slashed.includes("**") || (/\*[{,}]/.test(slashed) && /[{,}]\*/.test(slashed))))) {
    throw new TypeError(`${NAME}: ${JSON.stringify(pattern)} is not a pattern on which glob 7.2.3 and 14.0.3 agree`);
  }
  return slashed;
}

// glob 7 sorts its results unless nosort is set; rimraf sets it.
const ordered = (results, options) => options.nosort ? results : results.sort((a, b) => a.localeCompare(b, "en"));

function glob(pattern, options, callback) {
  if (typeof options === "function") [options, callback] = [undefined, options];
  if (typeof callback !== "function") throw new TypeError(`${NAME}: a callback is required`);
  let request;
  try {
    request = { pattern: readPattern(pattern), options: readOptions(options) };
  } catch (error) {
    process.nextTick(callback, error);
    return;
  }
  // The callback runs outside the promise, so an exception it throws stays uncaught as with glob 7.
  glob14.glob(request.pattern, settings).then(
    (results) => process.nextTick(callback, null, ordered(results, request.options)),
    (error) => process.nextTick(callback, error),
  );
}

glob.sync = function sync(pattern, options) {
  const read = readOptions(options);
  return ordered(glob14.globSync(readPattern(pattern), settings), read);
};

// glob 7 counts braces that expand to several patterns as glob characters. glob 14 also counts
// those after "${", which glob 7 leaves literal: rimraf then removes the existing literal path,
// or reaches readPattern, which refuses the pattern.
glob.hasMagic = function hasMagic(pattern, options) {
  readOptions(options);
  // Report magic wherever glob 7 may see some ([1], {a}, a{,}b, a\\*b, a(b), a[, a]): rimraf then stats
  // first, removes an existing path literally as glob 7 does, and sends a missing one to readPattern,
  // which refuses it instead of treating it silently as a literal.
  return glob14.hasMagic(pattern, { ...settings, magicalBraces: true }) || /[[\]{}()|*?+@!]|^\s*#|(?:^|\/)\.\.(?:\/|$)/.test(pattern);
};

module.exports = glob;
