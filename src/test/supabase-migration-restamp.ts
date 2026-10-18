import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { runSupabaseMigrationGitGuard } from "@/test/supabase-migration-git-guard";
import {
  computeSupabaseMigrationHashes,
  hashSupabaseMigrationContents,
  inspectSupabaseMigrations,
  MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS,
  parseUtcMigrationTimestamp,
} from "@/test/supabase-migrations";

const MIGRATIONS_DIRECTORY = "supabase/migrations";
const MANIFEST_PATH = "supabase/migrations.manifest.json";
const SHARED_SUPABASE_REPORT_PREFIX = "docs/testing/shared-supabase-";
const CANONICAL_MIGRATION_NAME = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/;
const DEFAULT_BASE_REF = "origin/main";

export const MIGRATION_RESTAMP_USAGE = `Give migrations added by this branch their final timestamp, just before merge.

Usage:
  npm run supabase:migrations:restamp -- <supabase/migrations/file.sql>... [--base <ref>] [--at <YYYYMMDDHHMMSS>] [--dry-run]

  --base     Git ref holding the deployed history (default ${DEFAULT_BASE_REF}; fetch it first).
  --at       First new UTC timestamp (default: now, or just after the base newest).
  --dry-run  Print the renames and the references without writing anything.

Each file must be added by this branch, tracked and recorded in the manifest. It
is renamed with git mv after the newest base migration, in its original order;
its manifest key and every textual reference to its old name or timestamp in
tracked files are updated, then the Git guard (pull_request against the base)
and the manifest validation run. Only restamp a migration that no shared or
remote Supabase project has applied.`;

export interface MigrationRestampEntry {
  from: string;
  to: string;
}

export interface MigrationRestampDependencies {
  now?: Date;
  rootDirectory?: string;
}

export interface MigrationRestampResult {
  base: { ref: string; sha: string; newest: string | null };
  checks: { guard: string[]; manifest: string[] } | null;
  dryRun: boolean;
  ok: boolean;
  references: string[];
  rehashed: Array<{ name: string; previous: string; next: string }>;
  renames: MigrationRestampEntry[];
}

interface GitCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

interface RestampOptions {
  at?: string;
  base: string;
  dryRun: boolean;
  files: string[];
}

function runGit(rootDirectory: string, args: string[]): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd: rootDirectory,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function requireGitSuccess(result: GitCommandResult, description: string) {
  if (result.status !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || "unknown Git error";
    throw new Error(`${description}: ${details}`);
  }
  return result.stdout;
}

function parseOptions(argv: string[]): RestampOptions {
  const options: RestampOptions = { base: DEFAULT_BASE_REF, dryRun: false, files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base" || argument === "--at") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${argument} requires a value`);
      }
      if (argument === "--base") {
        options.base = value;
      } else {
        options.at = value;
      }
      index += 1;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`Unknown restamp option: ${argument}`);
    } else {
      options.files.push(argument);
    }
  }
  return options;
}

function formatUtcMigrationTimestamp(date: Date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "").replace(/\D/g, "");
}

function shiftTimestamp(timestamp: string, seconds: number) {
  const date = parseUtcMigrationTimestamp(timestamp);
  if (!date) {
    throw new Error(`Invalid UTC migration timestamp: ${timestamp}`);
  }
  return formatUtcMigrationTimestamp(new Date(date.getTime() + seconds * 1000));
}

function parseCanonicalName(name: string) {
  const match = name.match(CANONICAL_MIGRATION_NAME);
  if (!match) {
    throw new Error(
      `${name} is not a canonical migration name (<YYYYMMDDHHMMSS>_<snake_case>.sql)`
    );
  }
  return { name, slug: match[2], timestamp: match[1] };
}

export function planMigrationRestampTimestamps(input: {
  at?: string;
  baseNewest: string | null;
  named: string[];
  now: Date;
  otherBranchMigrations: string[];
}): MigrationRestampEntry[] {
  const latestAllowed = input.now.getTime() + MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS;
  let start: string;
  if (input.at !== undefined) {
    if (!parseUtcMigrationTimestamp(input.at)) {
      throw new Error(`--at ${input.at} is not a valid UTC timestamp (YYYYMMDDHHMMSS)`);
    }
    if (input.baseNewest && input.at <= input.baseNewest) {
      throw new Error(`--at ${input.at} must be newer than the base newest ${input.baseNewest}`);
    }
    start = input.at;
  } else {
    const current = formatUtcMigrationTimestamp(input.now);
    start =
      input.baseNewest && current <= input.baseNewest
        ? shiftTimestamp(input.baseNewest, 1)
        : current;
  }

  // Consecutive seconds in the original order keep dependent migrations ordered.
  const entries = input.named
    .map(parseCanonicalName)
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map((migration, index) => {
      const timestamp = shiftTimestamp(start, index);
      if ((parseUtcMigrationTimestamp(timestamp)?.getTime() ?? Infinity) > latestAllowed) {
        throw new Error(
          `New timestamp ${timestamp} for ${migration.name} is too far in the future: ` +
            `the Git guard accepts at most ${MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS / 60000} minutes ` +
            `after now (${formatUtcMigrationTimestamp(input.now)})`
        );
      }
      return {
        from: migration.name,
        newTimestamp: timestamp,
        oldTimestamp: migration.timestamp,
        to: `${timestamp}_${migration.slug}.sql`,
      };
    });

  for (const other of input.otherBranchMigrations) {
    const otherTimestamp = other.match(/^(\d{14})_/)?.[1];
    if (!otherTimestamp) {
      continue;
    }
    for (const entry of entries) {
      if (
        otherTimestamp === entry.newTimestamp ||
        (entry.oldTimestamp < otherTimestamp) !== (entry.newTimestamp < otherTimestamp)
      ) {
        throw new Error(
          `Restamping ${entry.from} to ${entry.to} would reorder or collide with ${other}, ` +
            "which this branch also adds; name both to keep their order"
        );
      }
    }
  }
  return entries.map(({ from, to }) => ({ from, to }));
}

function listMigrationNames(
  executeGit: (args: string[]) => GitCommandResult,
  treeish: string
) {
  return new Set(
    requireGitSuccess(
      executeGit(["ls-tree", "-r", "--name-only", "-z", treeish, "--", MIGRATIONS_DIRECTORY]),
      `Cannot inspect migrations at ${treeish}`
    )
      .split("\0")
      .filter(Boolean)
      .map((filePath) => migrationNameOf(filePath))
      .filter((name): name is string => Boolean(name))
  );
}

function migrationNameOf(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/");
  const prefix = `${MIGRATIONS_DIRECTORY}/`;
  if (!normalized.startsWith(prefix)) {
    return null;
  }
  const name = normalized.slice(prefix.length);
  return name && !name.includes("/") ? name : null;
}

function resolveMigrationArgument(rootDirectory: string, argument: string) {
  const normalized = argument.replace(/\\/g, "/");
  const migrationsDirectory = path.join(rootDirectory, MIGRATIONS_DIRECTORY);
  const absolute = normalized.includes("/")
    ? path.resolve(rootDirectory, normalized)
    : path.join(migrationsDirectory, normalized);
  const relative = path.relative(migrationsDirectory, absolute);
  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep) ||
    relative.includes("/")
  ) {
    throw new Error(`${normalized} is not a file directly under ${MIGRATIONS_DIRECTORY}`);
  }
  return relative;
}

function readManifest(rootDirectory: string) {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(rootDirectory, MANIFEST_PATH), "utf8")
  ) as { algorithm?: string; migrations?: Record<string, string> };
  if (parsed.algorithm !== "sha256" || !parsed.migrations) {
    throw new Error(`${MANIFEST_PATH} is invalid`);
  }
  return parsed.migrations;
}

function assertManifestEntry(
  name: string,
  manifest: Record<string, string>,
  currentHashes: Record<string, string>
) {
  if (!manifest[name]) {
    throw new Error(
      `${name} is missing from ${MANIFEST_PATH}; run npm run supabase:manifest:add first`
    );
  }
  if (manifest[name] !== currentHashes[name]) {
    throw new Error(
      `${name} does not match its ${MANIFEST_PATH} hash; record its current content first`
    );
  }
}

function listErrors(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const items = message
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
  return items.length > 0 ? items : [message];
}

export function runSupabaseMigrationRestamp(
  argv: string[],
  dependencies: MigrationRestampDependencies = {}
): MigrationRestampResult {
  const rootDirectory = dependencies.rootDirectory ?? process.cwd();
  const now = dependencies.now ?? new Date();
  const executeGit = (args: string[]) => runGit(rootDirectory, args);
  const options = parseOptions(argv);

  const baseSha = requireGitSuccess(
    executeGit(["rev-parse", "--verify", `${options.base}^{commit}`]),
    `Cannot resolve the restamp base ${options.base}`
  ).trim();
  const mergeBase = requireGitSuccess(
    executeGit(["merge-base", baseSha, "HEAD"]),
    `Cannot compute the merge-base of ${options.base} and HEAD`
  ).trim();
  const baseNames = listMigrationNames(executeGit, baseSha);
  const mergeBaseNames = listMigrationNames(executeGit, mergeBase);
  const trackedPaths = requireGitSuccess(
    executeGit(["ls-files", "-z"]),
    "Cannot list tracked files"
  )
    .split("\0")
    .filter(Boolean);
  const trackedNames = new Set(
    trackedPaths.map(migrationNameOf).filter((name): name is string => Boolean(name))
  );
  const migrationsDirectory = path.join(rootDirectory, MIGRATIONS_DIRECTORY);
  const localNames = fs
    .readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const baseNewest =
    [...baseNames]
      .map((name) => name.match(/^(\d{14})_/)?.[1])
      .filter((timestamp): timestamp is string => Boolean(timestamp))
      .sort()
      .at(-1) ?? null;

  if (options.files.length === 0) {
    const candidates = localNames.filter(
      (name) =>
        trackedNames.has(name) &&
        !baseNames.has(name) &&
        !mergeBaseNames.has(name) &&
        CANONICAL_MIGRATION_NAME.test(name) &&
        (!baseNewest || name.slice(0, 14) <= baseNewest)
    );
    throw new Error(
      "Name the migration file(s) to restamp" +
        (candidates.length > 0
          ? `; added by this branch and not newer than ${baseNewest}: ${candidates.join(", ")}`
          : "")
    );
  }

  const manifest = readManifest(rootDirectory);
  const currentHashes = computeSupabaseMigrationHashes(rootDirectory);
  const sharedReports = trackedPaths.filter((filePath) =>
    filePath.startsWith(SHARED_SUPABASE_REPORT_PREFIX)
  );
  const named: string[] = [];
  for (const argument of options.files) {
    const name = resolveMigrationArgument(rootDirectory, argument);
    if (named.includes(name)) {
      throw new Error(`${name} is named twice`);
    }
    parseCanonicalName(name);
    if (baseNames.has(name)) {
      throw new Error(
        `${name} is a deployed migration on ${options.base} (${baseSha}); deployed migrations are immutable`
      );
    }
    if (mergeBaseNames.has(name)) {
      throw new Error(`${name} is not added by this branch: the merge-base ${mergeBase} has it`);
    }
    const absolutePath = path.join(migrationsDirectory, name);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`${name} does not exist in ${MIGRATIONS_DIRECTORY}`);
    }
    const metadata = fs.lstatSync(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`${name} must be a regular file, not a link`);
    }
    if (!trackedNames.has(name)) {
      throw new Error(`${name} is not tracked by Git; stage it with git add first`);
    }
    assertManifestEntry(name, manifest, currentHashes);
    // A shared-Supabase report names the file it applied: renaming that file
    // would orphan the record, and the migration is no longer unapplied.
    for (const report of sharedReports) {
      const reportPath = path.join(rootDirectory, report);
      if (fs.existsSync(reportPath) && fs.readFileSync(reportPath, "latin1").includes(name)) {
        throw new Error(
          `${name} is recorded by name in ${report}; a migration applied to shared Supabase keeps its name`
        );
      }
    }
    named.push(name);
  }

  const namedSet = new Set(named);
  const renames = planMigrationRestampTimestamps({
    at: options.at,
    baseNewest,
    named,
    now,
    otherBranchMigrations: localNames.filter(
      (name) => !baseNames.has(name) && !namedSet.has(name)
    ),
  }).filter((entry) => entry.from !== entry.to);
  for (const entry of renames) {
    if (localNames.includes(entry.to) || trackedNames.has(entry.to)) {
      throw new Error(`Restamp destination already exists: ${entry.to}`);
    }
  }
  const renamedTo = new Map(renames.map((entry) => [entry.from, entry.to]));

  // Rewrite references byte for byte (latin1 maps each byte to one code unit),
  // only where the old timestamp is not part of a longer digit run.
  const timestamps = new Map(renames.map((entry) => [entry.from.slice(0, 14), entry.to.slice(0, 14)]));
  const rewrites: Array<{ contents: Buffer; path: string }> = [];
  const rehashed: MigrationRestampResult["rehashed"] = [];
  if (timestamps.size > 0) {
    const grep = executeGit([
      "grep",
      "-I",
      "-l",
      "-z",
      "-F",
      "--no-color",
      ...[...timestamps.keys()].flatMap((timestamp) => ["-e", timestamp]),
    ]);
    if (grep.status > 1) {
      requireGitSuccess(grep, "Cannot search references");
    }
    const pattern = new RegExp(`(?<![0-9])(?:${[...timestamps.keys()].join("|")})(?![0-9])`, "g");
    for (const filePath of grep.stdout.split("\0").filter(Boolean).sort()) {
      if (filePath === MANIFEST_PATH) {
        continue;
      }
      const absolutePath = path.join(rootDirectory, ...filePath.split("/"));
      const metadata = fs.lstatSync(absolutePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        continue;
      }
      const original = fs.readFileSync(absolutePath).toString("latin1");
      const mentioned = [...new Set(original.match(pattern) ?? [])];
      if (mentioned.length === 0) {
        continue;
      }
      const migrationName = migrationNameOf(filePath);
      if (migrationName && !namedSet.has(migrationName)) {
        if (baseNames.has(migrationName) || mergeBaseNames.has(migrationName)) {
          throw new Error(
            `deployed migration ${migrationName} mentions ${mentioned.join(", ")}; ` +
              "deployed migrations are immutable"
          );
        }
        assertManifestEntry(migrationName, manifest, currentHashes);
      }
      const contents = Buffer.from(
        original.replace(pattern, (timestamp) => timestamps.get(timestamp) ?? timestamp),
        "latin1"
      );
      const finalName = migrationName ? (renamedTo.get(migrationName) ?? migrationName) : null;
      rewrites.push({
        contents,
        path: finalName ? `${MIGRATIONS_DIRECTORY}/${finalName}` : filePath,
      });
      if (migrationName && finalName && manifest[migrationName]) {
        rehashed.push({
          name: finalName,
          next: hashSupabaseMigrationContents(contents.toString("utf8")),
          previous: manifest[migrationName],
        });
      }
    }
  }

  const result: MigrationRestampResult = {
    base: { newest: baseNewest, ref: options.base, sha: baseSha },
    checks: null,
    dryRun: options.dryRun,
    ok: true,
    references: rewrites.map((rewrite) => rewrite.path).sort(),
    rehashed,
    renames,
  };
  if (options.dryRun) {
    return result;
  }

  for (const entry of renames) {
    requireGitSuccess(
      executeGit([
        "mv",
        "--",
        `${MIGRATIONS_DIRECTORY}/${entry.from}`,
        `${MIGRATIONS_DIRECTORY}/${entry.to}`,
      ]),
      `Cannot rename ${entry.from}`
    );
  }
  for (const rewrite of rewrites) {
    fs.writeFileSync(path.join(rootDirectory, ...rewrite.path.split("/")), rewrite.contents);
  }
  // Same entries and serialization as `npm run supabase:manifest:add`.
  const hashes = computeSupabaseMigrationHashes(rootDirectory);
  for (const entry of renames) {
    delete manifest[entry.from];
    manifest[entry.to] = hashes[entry.to];
  }
  for (const entry of rehashed) {
    manifest[entry.name] = hashes[entry.name];
  }
  const migrations = Object.fromEntries(
    Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right))
  );
  fs.writeFileSync(
    path.join(rootDirectory, MANIFEST_PATH),
    `${JSON.stringify({ algorithm: "sha256", migrations }, null, 2)}\n`,
    "utf8"
  );

  const guard: string[] = [];
  try {
    runSupabaseMigrationGitGuard(["--base", baseSha, "--mode", "pull_request"], {
      environment: {},
      rootDirectory,
    });
  } catch (error) {
    guard.push(...listErrors(error));
  }
  const manifestErrors = inspectSupabaseMigrations(rootDirectory).errors;
  result.checks = { guard, manifest: manifestErrors };
  result.ok = guard.length === 0 && manifestErrors.length === 0;
  return result;
}

function printCheck(log: (line: string) => void, label: string, errors: string[]) {
  log(errors.length === 0 ? `${label}: passed` : `${label}: FAILED`);
  for (const error of errors) {
    log(`  - ${error}`);
  }
}

export function runSupabaseMigrationRestampCli(
  argv: string[],
  dependencies: MigrationRestampDependencies & {
    error?: (line: string) => void;
    log?: (line: string) => void;
  } = {}
): number {
  const log = dependencies.log ?? ((line: string) => console.log(line));
  const error = dependencies.error ?? ((line: string) => console.error(line));
  if (argv.includes("--help") || argv.includes("-h")) {
    log(MIGRATION_RESTAMP_USAGE);
    return 0;
  }

  let result: MigrationRestampResult;
  try {
    result = runSupabaseMigrationRestamp(argv, dependencies);
  } catch (caught) {
    error(`Restamp refused, nothing changed: ${caught instanceof Error ? caught.message : caught}`);
    return 1;
  }

  log(`Base ${result.base.ref} (${result.base.sha}), newest migration ${result.base.newest ?? "none"}.`);
  log(result.dryRun ? "Dry run, nothing written. Would rename:" : "Renamed with git mv:");
  for (const entry of result.renames) {
    log(`  ${entry.from} -> ${entry.to}`);
  }
  log(
    result.rehashed.length === 0
      ? "Manifest keys renamed, sha256 unchanged."
      : "Manifest keys renamed; these migrations mention a restamped timestamp, so their content and sha256 change:"
  );
  for (const entry of result.rehashed) {
    log(`  ${entry.name}: ${entry.previous} -> ${entry.next}`);
  }
  log(`${result.dryRun ? "References to update" : "References updated"} (${result.references.length}):`);
  for (const reference of result.references) {
    log(`  ${reference}`);
  }
  if (result.checks) {
    printCheck(log, `Git guard (pull_request against ${result.base.sha})`, result.checks.guard);
    printCheck(log, "Manifest validation", result.checks.manifest);
    log(
      result.ok
        ? "Review the diff (prose may now be stale), then commit the rename with its references."
        : "Restamp written, but a final check failed: fix it before merging."
    );
  }
  return result.ok ? 0 : 1;
}
