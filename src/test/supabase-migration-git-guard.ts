import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  inspectSupabaseMigrations,
  MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS,
  parseUtcMigrationTimestamp,
} from "@/test/supabase-migrations";

const SHA1_PATTERN = /^[0-9a-f]{40}$/i;
const ZERO_SHA = "0".repeat(40);
const MIGRATIONS_DIRECTORY = "supabase/migrations";
const MANIFEST_PATH = "supabase/migrations.manifest.json";

export type MigrationDiffMode = "local" | "pull_request" | "push";

export interface GitChangeRecord {
  status: string;
  path: string;
  previousPath?: string;
}

interface GitCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface MigrationGitGuardDependencies {
  environment?: Record<string, string | undefined>;
  executeGit?: (args: string[]) => GitCommandResult;
  rootDirectory?: string;
}

interface MigrationGitGuardOptions {
  base?: string;
  mode?: MigrationDiffMode;
}

function normalizeGitPath(filePath: string) {
  return filePath.replace(/\\/g, "/");
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

function assertCommitSha(value: string, label: string) {
  const sha = value.trim();
  if (!SHA1_PATTERN.test(sha) || sha === ZERO_SHA) {
    throw new Error(`${label} must be a non-zero 40-character Git commit SHA`);
  }
  return sha.toLowerCase();
}

function parseOptions(argv: string[]): MigrationGitGuardOptions {
  const options: MigrationGitGuardOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--base requires a commit SHA");
      }
      options.base = value;
      index += 1;
    } else if (argument === "--mode") {
      const value = argv[index + 1];
      if (!value || !["local", "pull_request", "push"].includes(value)) {
        throw new Error("--mode must be local, pull_request or push");
      }
      options.mode = value as MigrationDiffMode;
      index += 1;
    } else {
      throw new Error(`Unknown migration Git guard option: ${argument}`);
    }
  }
  return options;
}

export function parseGitNameStatus(output: string): GitChangeRecord[] {
  if (!output) {
    return [];
  }
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") {
    tokens.pop();
  }

  const records: GitChangeRecord[] = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++];
    if (!/^(?:[ACDMRTUXB]|[RC]\d{1,3})$/.test(status)) {
      throw new Error(`Unrecognized Git name-status record: ${status || "<empty>"}`);
    }

    if (/^[RC]\d{1,3}$/.test(status)) {
      const previousPath = tokens[index++];
      const filePath = tokens[index++];
      if (!previousPath || !filePath) {
        throw new Error(`Incomplete Git rename/copy record: ${status}`);
      }
      records.push({
        status,
        previousPath: normalizeGitPath(previousPath),
        path: normalizeGitPath(filePath),
      });
      continue;
    }

    const filePath = tokens[index++];
    if (!filePath) {
      throw new Error(`Incomplete Git name-status record: ${status}`);
    }
    records.push({ status, path: normalizeGitPath(filePath) });
  }
  return records;
}

function maximumBaseTimestamp(baseMigrationPaths: string[]) {
  return baseMigrationPaths
    .map(normalizeGitPath)
    .filter((filePath) => filePath.startsWith(`${MIGRATIONS_DIRECTORY}/`))
    .map((filePath) => path.posix.basename(filePath).match(/^(\d{14})_/)?.[1])
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .at(-1);
}

export function validateSupabaseMigrationGitChanges(input: {
  baseMigrationPaths: string[];
  now?: Date;
  records: GitChangeRecord[];
  rootDirectory?: string;
}) {
  const rootDirectory = input.rootDirectory ?? process.cwd();
  const errors: string[] = [];
  const baseMaximumTimestamp = maximumBaseTimestamp(input.baseMigrationPaths);
  const maximumAllowedTimestamp =
    (input.now ?? new Date()).getTime() +
    MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS;

  for (const record of input.records) {
    const filePath = normalizeGitPath(record.path);
    const statusCode = record.status[0];

    if (filePath === MANIFEST_PATH) {
      if (!new Set(["A", "M"]).has(statusCode)) {
        errors.push(`migration manifest may only be added or modified: ${record.status}`);
      }
      continue;
    }

    if (!filePath.startsWith(`${MIGRATIONS_DIRECTORY}/`)) {
      errors.push(`unexpected migration guard path: ${filePath}`);
      continue;
    }
    if (statusCode !== "A") {
      errors.push(`deployed migration is immutable (${record.status}): ${filePath}`);
      continue;
    }

    const relativePath = filePath.slice(`${MIGRATIONS_DIRECTORY}/`.length);
    if (!relativePath || relativePath.includes("/") || relativePath.includes("\\")) {
      errors.push(`new migration must be a direct file: ${filePath}`);
      continue;
    }
    const match = relativePath.match(/^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/);
    const migrationDate = match ? parseUtcMigrationTimestamp(match[1]) : null;
    if (!match || !migrationDate) {
      errors.push(`new migration name is not a valid UTC timestamp: ${filePath}`);
      continue;
    }
    if (migrationDate.getTime() > maximumAllowedTimestamp) {
      errors.push(`new migration timestamp is too far in the future: ${filePath}`);
    }
    if (baseMaximumTimestamp && match[1] <= baseMaximumTimestamp) {
      errors.push(
        `new migration timestamp ${match[1]} must be newer than base ${baseMaximumTimestamp}`
      );
    }

    const absolutePath = path.join(rootDirectory, ...filePath.split("/"));
    if (!fs.existsSync(absolutePath)) {
      errors.push(`added migration is missing from the working tree: ${filePath}`);
      continue;
    }
    const metadata = fs.lstatSync(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      errors.push(`new migration must be a regular file, not a link: ${filePath}`);
    }
  }

  return errors;
}

function resolveBaseSha(
  options: MigrationGitGuardOptions,
  environment: Record<string, string | undefined>,
  executeGit: (args: string[]) => GitCommandResult
) {
  const configured = options.base ?? environment.MIGRATION_BASE_SHA;
  if (configured) {
    return assertCommitSha(configured, "Migration base");
  }

  for (const reference of ["@{upstream}", "origin/main"]) {
    const result = executeGit(["rev-parse", "--verify", `${reference}^{commit}`]);
    if (result.status === 0 && result.stdout.trim()) {
      return assertCommitSha(result.stdout, `Resolved ${reference}`);
    }
  }
  throw new Error(
    "Cannot resolve a migration base; pass --base or set MIGRATION_BASE_SHA"
  );
}

export function runSupabaseMigrationGitGuard(
  argv = process.argv.slice(2),
  dependencies: MigrationGitGuardDependencies = {}
) {
  const rootDirectory = dependencies.rootDirectory ?? process.cwd();
  const environment = dependencies.environment ?? process.env;
  const executeGit =
    dependencies.executeGit ?? ((args: string[]) => runGit(rootDirectory, args));
  const options = parseOptions(argv);
  const modeValue = options.mode ?? environment.MIGRATION_DIFF_MODE ?? "local";
  if (!["local", "pull_request", "push"].includes(modeValue)) {
    throw new Error(`Unsupported migration diff mode: ${modeValue}`);
  }
  const mode = modeValue as MigrationDiffMode;
  const targetBase = resolveBaseSha(options, environment, executeGit);

  requireGitSuccess(
    executeGit(["cat-file", "-e", `${targetBase}^{commit}`]),
    `Migration base commit is unavailable (${targetBase})`
  );

  const diffBase =
    mode === "push"
      ? targetBase
      : assertCommitSha(
          requireGitSuccess(
            executeGit(["merge-base", targetBase, "HEAD"]),
            `Cannot compute migration merge-base from ${targetBase}`
          ),
          "Migration diff base"
        );

  const diffOutput = requireGitSuccess(
    executeGit([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      "--find-renames",
      diffBase,
      "--",
      MIGRATIONS_DIRECTORY,
      MANIFEST_PATH,
    ]),
    "Cannot inspect migration changes"
  );
  const records = parseGitNameStatus(diffOutput);

  const untrackedOutput = requireGitSuccess(
    executeGit([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      MIGRATIONS_DIRECTORY,
      MANIFEST_PATH,
    ]),
    "Cannot inspect untracked migrations"
  );
  const knownPaths = new Set(records.map((record) => record.path));
  for (const untrackedPath of untrackedOutput.split("\0").filter(Boolean)) {
    const normalizedPath = normalizeGitPath(untrackedPath);
    if (!knownPaths.has(normalizedPath)) {
      records.push({ status: "A", path: normalizedPath });
      knownPaths.add(normalizedPath);
    }
  }

  const baseMigrationPaths = requireGitSuccess(
    executeGit([
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      targetBase,
      "--",
      MIGRATIONS_DIRECTORY,
    ]),
    `Cannot inspect base migrations at ${targetBase}`
  )
    .split("\0")
    .filter(Boolean);

  const errors = validateSupabaseMigrationGitChanges({
    baseMigrationPaths,
    records,
    rootDirectory,
  });
  if (errors.length > 0) {
    throw new Error(`Supabase migration Git guard failed:\n- ${errors.join("\n- ")}`);
  }

  const migrationErrors = inspectSupabaseMigrations(rootDirectory).errors;
  if (migrationErrors.length > 0) {
    throw new Error(
      `Supabase migration validation failed:\n- ${migrationErrors.join("\n- ")}`
    );
  }

  return {
    base: targetBase,
    changedPaths: records.length,
    diffBase,
    mode,
  };
}
