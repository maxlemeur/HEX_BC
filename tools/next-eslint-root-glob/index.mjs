import fs from "node:fs";
import path from "node:path";
import { expand } from "brace-expansion";
import { globSync as findDirectories } from "tinyglobby";

function expandRootPattern(pattern) {
  // Reject oversized inputs and expansions instead of silently selecting only
  // some roots. Bound the parser's depth before entering brace-expansion.
  if (pattern.length > 4096) throw new Error("Next ESLint root glob exceeds the input limit");
  let depth = 0;
  for (const character of pattern) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (Math.abs(depth) > 64) throw new Error("Next ESLint root glob exceeds the nesting limit");
  }
  const patterns = expand(pattern, { max: 1001, maxLength: Infinity });
  if (patterns.length > 1000) throw new Error("Next ESLint root glob exceeds the expansion limit");
  return [...new Set(patterns)];
}

function hasDynamicPattern(pattern) {
  // Fast-glob treats ordinary parentheses as literal unless another glob
  // symbol is present. Tinyglobby's scan instead treats them as regex groups.
  return /[*?]|^!/.test(pattern) || /\[[^[]*]/.test(pattern) ||
    /(?:^|[^!*+?@])\([^(]*\|[^|]*\)/.test(pattern) || /[!*+?@]\([^(]*\)/.test(pattern);
}

function normalizeDirectory(directory, pattern) {
  const root = path.parse(directory).root;
  const normalized = directory === root ? directory : directory.replace(/[/\\]+$/, "");
  return pattern.startsWith("./") && !path.isAbsolute(normalized)
    ? "./" + normalized.replace(/^\.\//, "")
    : normalized;
}

// Next 16.4's getRootDirs is the only consumer of this scoped override. It
// requests one directory pattern at a time, including array settings. Keep
// that contract explicit rather than advertising the entire fast-glob API.
export function globSync(pattern, options) {
  if (typeof pattern !== "string" || options?.onlyDirectories !== true) {
    throw new TypeError("Next ESLint root globs require a string and onlyDirectories: true");
  }

  return [...new Set(expandRootPattern(pattern).flatMap((expanded) => globDirectory(expanded, options)))];
}

function globDirectory(pattern, options) {
  if (!hasDynamicPattern(pattern)) {
    try {
      // Avoid expanding literal directories, preserve their spelling, and
      // follow directory symlinks just as the original default did.
      return fs.statSync(pattern).isDirectory() ? [pattern] : [];
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    }
  }

  const directories = findDirectories(pattern, {
    onlyDirectories: true,
    expandDirectories: false,
    followSymbolicLinks: true,
    braceExpansion: false,
    absolute: path.isAbsolute(pattern),
  }).map((directory) => normalizeDirectory(directory, pattern));

  // tinyglobby includes the base of a terminal globstar; fast-glob does not.
  if (pattern === "**" || pattern.endsWith("/**")) {
    const prefix = pattern.replace(/(?:^|\/)(?:\*\*\/)*\*\*$/, "") ||
      (path.isAbsolute(pattern) ? "/" : ".");
    const bases = new Set(globDirectory(prefix, options).map((directory) => normalizeDirectory(directory, pattern)));
    return directories.filter((directory) => !bases.has(directory));
  }

  return directories;
}
