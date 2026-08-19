/**
 * Re-timestamp local Supabase migrations that are not yet on origin/main
 * so their UTC 14-digit prefix is strictly after the latest origin/main
 * migration.
 *
 * Conservative: dry-run by default. Pass --apply to rename files and
 * rewrite supabase/migrations.manifest.json keys (content hashes stay
 * the same). Never rewrites a migration already present on the base ref.
 *
 * Usage:
 *   npm run supabase:migrations:restamp
 *   npm run supabase:migrations:restamp -- --apply
 *   npm run supabase:migrations:restamp -- --base origin/main --apply
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS,
  parseUtcMigrationTimestamp,
} from "../src/test/supabase-migrations";

const MIGRATIONS_DIRECTORY = "supabase/migrations";
const MANIFEST_PATH = "supabase/migrations.manifest.json";
const CANONICAL_MIGRATION_NAME = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/;
const DEFAULT_BASE_REFS = ["origin/main"] as const;

interface GitCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RestampUnpushedMigrationsDependencies {
  environment?: Record<string, string | undefined>;
  executeGit?: (args: string[]) => GitCommandResult;
  now?: Date;
  rootDirectory?: string;
  writeFile?: (filePath: string, contents: string) => void;
  renameFile?: (fromPath: string, toPath: string) => void;
}

export interface RestampPlanEntry {
  fromName: string;
  toName: string;
}

export interface RestampUnpushedMigrationsResult {
  applied: boolean;
  base: string;
  baseMaximumTimestamp: string | null;
  planned: RestampPlanEntry[];
  skipped: string[];
}

interface ParsedOptions {
  apply: boolean;
  base?: string;
}

interface MigrationManifest {
  algorithm: "sha256";
  migrations: Record<string, string>;
}

function runGit(rootDirectory: string, args: string[]): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd: rootDirectory,
    encoding: "utf8",
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

function parseOptions(argv: string[]): ParsedOptions {
  const options: ParsedOptions = { apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--base") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--base requires a Git ref");
      }
      options.base = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      throw new Error("usage");
    } else {
      throw new Error(`Unknown restamp option: ${argument}`);
    }
  }
  return options;
}

function formatUtcMigrationTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    String(date.getUTCFullYear()),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function addUtcSeconds(timestamp: string, seconds: number) {
  const date = parseUtcMigrationTimestamp(timestamp);
  if (!date) {
    throw new Error(`Cannot increment invalid UTC timestamp: ${timestamp}`);
  }
  return formatUtcMigrationTimestamp(new Date(date.getTime() + seconds * 1000));
}

function resolveBaseRef(
  options: ParsedOptions,
  environment: Record<string, string | undefined>,
  executeGit: (args: string[]) => GitCommandResult
) {
  const configured = options.base ?? environment.MIGRATION_BASE_REF;
  const candidates = configured ? [configured] : [...DEFAULT_BASE_REFS];
  for (const reference of candidates) {
    const result = executeGit(["rev-parse", "--verify", `${reference}^{commit}`]);
    if (result.status === 0 && result.stdout.trim()) {
      return { ref: reference, sha: result.stdout.trim() };
    }
  }
  throw new Error(
    "Cannot resolve a restamp base; pass --base or set MIGRATION_BASE_REF"
  );
}

function listBaseMigrationNames(
  executeGit: (args: string[]) => GitCommandResult,
  baseSha: string
) {
  return requireGitSuccess(
    executeGit([
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      baseSha,
      "--",
      MIGRATIONS_DIRECTORY,
    ]),
    `Cannot inspect base migrations at ${baseSha}`
  )
    .split("\0")
    .filter(Boolean)
    .map((filePath) => path.posix.basename(filePath.replace(/\\/g, "/")));
}

function maximumTimestamp(fileNames: string[]) {
  return fileNames
    .map((fileName) => fileName.match(/^(\d{14})_/)?.[1])
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .at(-1) ?? null;
}

function readManifest(rootDirectory: string): MigrationManifest {
  const manifestPath = path.join(rootDirectory, MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) {
    return { algorithm: "sha256", migrations: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    algorithm?: string;
    migrations?: Record<string, string>;
  };
  if (parsed.algorithm !== "sha256" || !parsed.migrations) {
    throw new Error("Existing migration manifest is invalid");
  }
  return { algorithm: "sha256", migrations: parsed.migrations };
}

function allocateNextTimestamp(input: {
  reserved: Set<string>;
  startTimestamp: string;
}) {
  let candidate = input.startTimestamp;
  while (input.reserved.has(candidate)) {
    candidate = addUtcSeconds(candidate, 1);
  }
  input.reserved.add(candidate);
  return candidate;
}

export function planRestampUnpushedMigrations(input: {
  baseMaximumTimestamp: string | null;
  localFileNames: string[];
  now?: Date;
  unpushedFileNames: string[];
}) {
  const now = input.now ?? new Date();
  const planned: RestampPlanEntry[] = [];
  const skipped: string[] = [];
  const reserved = new Set(
    input.localFileNames
      .map((fileName) => fileName.match(CANONICAL_MIGRATION_NAME)?.[1])
      .filter((timestamp): timestamp is string => Boolean(timestamp))
  );

  if (!input.baseMaximumTimestamp) {
    return { planned, skipped };
  }

  const minNextDate = parseUtcMigrationTimestamp(
    addUtcSeconds(input.baseMaximumTimestamp, 1)
  );
  if (!minNextDate) {
    throw new Error(
      `Cannot restamp after invalid base timestamp ${input.baseMaximumTimestamp}`
    );
  }
  if (
    minNextDate.getTime() >
    now.getTime() + MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS
  ) {
    throw new Error(
      `Refusing to restamp: base timestamp ${input.baseMaximumTimestamp} is already too far in the future`
    );
  }

  const nowTimestamp = formatUtcMigrationTimestamp(now);
  const startTimestamp =
    nowTimestamp > addUtcSeconds(input.baseMaximumTimestamp, 1)
      ? nowTimestamp
      : addUtcSeconds(input.baseMaximumTimestamp, 1);

  const candidates = [...input.unpushedFileNames].sort();
  for (const fileName of candidates) {
    const match = fileName.match(CANONICAL_MIGRATION_NAME);
    if (!match) {
      skipped.push(fileName);
      continue;
    }
    if (match[1] > input.baseMaximumTimestamp) {
      skipped.push(fileName);
      continue;
    }

    reserved.delete(match[1]);
    const nextTimestamp = allocateNextTimestamp({
      reserved,
      startTimestamp,
    });
    const nextDate = parseUtcMigrationTimestamp(nextTimestamp);
    if (
      nextDate &&
      nextDate.getTime() > now.getTime() + MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS
    ) {
      throw new Error(
        `Refusing to restamp ${fileName}: next timestamp ${nextTimestamp} is too far in the future`
      );
    }
    planned.push({
      fromName: fileName,
      toName: `${nextTimestamp}_${match[2]}.sql`,
    });
  }

  return { planned, skipped };
}

export function runRestampUnpushedMigrations(
  argv = process.argv.slice(2),
  dependencies: RestampUnpushedMigrationsDependencies = {}
): RestampUnpushedMigrationsResult {
  const rootDirectory = dependencies.rootDirectory ?? process.cwd();
  const environment = dependencies.environment ?? process.env;
  const executeGit =
    dependencies.executeGit ?? ((args: string[]) => runGit(rootDirectory, args));
  const options = parseOptions(argv);
  const { ref, sha } = resolveBaseRef(options, environment, executeGit);
  requireGitSuccess(
    executeGit(["cat-file", "-e", `${sha}^{commit}`]),
    `Restamp base commit is unavailable (${sha})`
  );

  const baseNames = listBaseMigrationNames(executeGit, sha);
  const baseNameSet = new Set(baseNames);
  const migrationsDirectory = path.join(rootDirectory, MIGRATIONS_DIRECTORY);
  const localFileNames = fs
    .readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const unpushedFileNames = localFileNames.filter(
    (fileName) => !baseNameSet.has(fileName)
  );
  const { planned, skipped } = planRestampUnpushedMigrations({
    baseMaximumTimestamp: maximumTimestamp(baseNames),
    localFileNames,
    now: dependencies.now,
    unpushedFileNames,
  });

  if (options.apply && planned.length > 0) {
    const renameFile =
      dependencies.renameFile ??
      ((fromPath, toPath) => fs.renameSync(fromPath, toPath));
    const writeFile =
      dependencies.writeFile ??
      ((filePath, contents) => fs.writeFileSync(filePath, contents, "utf8"));
    const manifest = readManifest(rootDirectory);

    // Plan, then commit: every collision or manifest gap is detected before the
    // first rename so a failure cannot leave files renamed and the manifest stale.
    const plannedDestinations = new Set<string>();
    for (const entry of planned) {
      const destination = path.join(migrationsDirectory, entry.toName);
      if (fs.existsSync(destination) || plannedDestinations.has(entry.toName)) {
        throw new Error(`Restamp destination already exists: ${entry.toName}`);
      }
      plannedDestinations.add(entry.toName);
      if (!manifest.migrations[entry.fromName]) {
        throw new Error(
          `Migration ${entry.fromName} is missing from ${MANIFEST_PATH}; ` +
            "run npm run supabase:manifest:add before restamping."
        );
      }
    }

    for (const entry of planned) {
      renameFile(
        path.join(migrationsDirectory, entry.fromName),
        path.join(migrationsDirectory, entry.toName)
      );
      manifest.migrations[entry.toName] = manifest.migrations[entry.fromName];
      delete manifest.migrations[entry.fromName];
    }

    const migrations = Object.fromEntries(
      Object.entries(manifest.migrations).sort(([left], [right]) =>
        left.localeCompare(right)
      )
    );
    writeFile(
      path.join(rootDirectory, MANIFEST_PATH),
      `${JSON.stringify({ algorithm: "sha256", migrations }, null, 2)}\n`
    );
  }

  return {
    applied: options.apply,
    base: `${ref} (${sha})`,
    baseMaximumTimestamp: maximumTimestamp(baseNames),
    planned,
    skipped,
  };
}

function printUsage() {
  console.log(`Re-timestamp unpushed Supabase migrations after origin/main.

Usage:
  npm run supabase:migrations:restamp
  npm run supabase:migrations:restamp -- --apply
  npm run supabase:migrations:restamp -- --base origin/main --apply

WARNING: only restamp migrations that have never been applied to a shared or
remote Supabase project. "Unpushed" means absent from the Git base ref; a
migration already pushed with \`supabase db push\` from a branch is recorded
under its old version in supabase_migrations.schema_migrations and would be
re-applied under its new name. Check the remote history first.

Dry-run by default. --apply renames files and updates
supabase/migrations.manifest.json keys without rewriting hashes.`);
}

const executedAsCli =
  typeof process.argv[1] === "string" &&
  /restamp-unpushed-migrations\.(cjs|js|mjs|ts)$/.test(
    path.basename(process.argv[1])
  );

if (executedAsCli) {
  try {
    const result = runRestampUnpushedMigrations();
    if (result.planned.length === 0) {
      console.log(
        `No unpushed migrations need restamping (base ${result.baseMaximumTimestamp ?? "none"}).`
      );
    } else {
      const verb = result.applied ? "Restamped" : "Would restamp";
      console.log(`${verb} ${result.planned.length} migration(s) after ${result.baseMaximumTimestamp}:`);
      for (const entry of result.planned) {
        console.log(`  ${entry.fromName} -> ${entry.toName}`);
      }
      if (!result.applied) {
        console.log("Dry-run only. Re-run with --apply to rename files and update the manifest.");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "usage") {
      printUsage();
      process.exitCode = 0;
    } else {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
