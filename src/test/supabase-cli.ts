import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

export const PINNED_SUPABASE_CLI_VERSION = "2.109.1";
export type SupabaseEnvironment = Readonly<
  Record<string, string | undefined>
>;

export class SupabaseCliCommandError extends Error {
  readonly capturedOutput: string;

  constructor(command: string, status: number | null, capturedOutput: string) {
    super(
      `Supabase CLI command failed with exit code ${status ?? "unknown"}: ${command}`
    );
    this.capturedOutput = capturedOutput;
  }
}

export const SUPABASE_ROUTING_ENVIRONMENT_NAMES = [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_ANON_KEY",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_DB_URL",
  "SUPABASE_PROJECT_ID",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
] as const;

const DATABASE_ROUTING_ENVIRONMENT_NAMES = new Set([
  "DATABASE_URL",
  "PGDATABASE",
  "PGHOST",
  "PGPASSWORD",
  "PGPORT",
  "PGUSER",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
]);

const LOCAL_CI_ENVIRONMENT_NAMES = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "SUPABASE_TELEMETRY_DISABLED",
  "USERPROFILE",
  "WINDIR",
]);

function isForbiddenSupabaseEnvironmentName(name: string) {
  const normalizedName = name.toUpperCase();
  return (
    (normalizedName.startsWith("SUPABASE_") &&
      normalizedName !== "SUPABASE_TELEMETRY_DISABLED") ||
    normalizedName.startsWith("NEXT_PUBLIC_SUPABASE_") ||
    DATABASE_ROUTING_ENVIRONMENT_NAMES.has(normalizedName)
  );
}

const LOCAL_START_EXCLUSIONS =
  "edge-runtime,imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector";
const LOCAL_STATUS_OVERRIDES = [
  "api.url=NEXT_PUBLIC_SUPABASE_URL",
  "auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY",
];

function hasNonEmptyValue(args: string[], index: number) {
  return Boolean(args[index]?.trim() && !args[index].startsWith("--"));
}

function hasIsolatedWorkdir(args: string[], index: number) {
  if (!hasNonEmptyValue(args, index)) {
    return false;
  }
  return path
    .basename(path.resolve(args[index]))
    .startsWith("miaouffrage-supabase-ci-");
}

function isPathInsideWorkdir(filePath: string, workdir: string) {
  const relativePath = path.relative(path.resolve(workdir), path.resolve(filePath));
  return Boolean(
    relativePath &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath)
  );
}

export function assertLocalOnlySupabaseArgs(args: string[]) {
  if (args.length === 1 && args[0] === "--version") {
    return;
  }

  if (
    args.length === 5 &&
    args[0] === "start" &&
    args[1] === "--exclude" &&
    args[2] === LOCAL_START_EXCLUSIONS &&
    args[3] === "--workdir" &&
    hasIsolatedWorkdir(args, 4)
  ) {
    return;
  }

  if (
    [5, 6].includes(args.length) &&
    args[0] === "db" &&
    args[1] === "reset" &&
    args[2] === "--local" &&
    (args.length === 5 || args[3] === "--no-seed") &&
    args.at(-2) === "--workdir" &&
    hasIsolatedWorkdir(args, args.length - 1)
  ) {
    return;
  }

  if (
    [5, 7].includes(args.length) &&
    args[0] === "migration" &&
    args[1] === "list" &&
    args[2] === "--local" &&
    args[3] === "--output-format" &&
    args[4] === "json" &&
    (args.length === 5 ||
      (args[5] === "--workdir" && hasNonEmptyValue(args, 6)))
  ) {
    return;
  }

  if (
    args.length === 6 &&
    args[0] === "test" &&
    args[1] === "db" &&
    args[2] === "--local" &&
    hasNonEmptyValue(args, 3) &&
    args[4] === "--workdir" &&
    hasIsolatedWorkdir(args, 5) &&
    isPathInsideWorkdir(args[3], args[5])
  ) {
    return;
  }

  if (
    args.length === 11 &&
    args[0] === "status" &&
    args[1] === "-o" &&
    args[2] === "env" &&
    args[3] === "--override-name" &&
    args[5] === "--override-name" &&
    args[7] === "--override-name" &&
    args[9] === "--workdir" &&
    hasIsolatedWorkdir(args, 10) &&
    JSON.stringify([args[4], args[6], args[8]]) ===
      JSON.stringify(LOCAL_STATUS_OVERRIDES)
  ) {
    return;
  }

  if (
    args.length === 4 &&
    args[0] === "stop" &&
    args[1] === "--project-id" &&
    /^miaouffrage-ci-\d+-[0-9a-f]{8}$/.test(args[2] ?? "") &&
    args[3] === "--no-backup"
  ) {
    return;
  }

  throw new Error(
    `Supabase command is not allowlisted for local CI: ${args.slice(0, 2).join(" ")}`
  );
}

export function assertNoRemoteSupabaseEnvironment(
  environment: SupabaseEnvironment = process.env
) {
  const configured = Object.entries(environment)
    .filter(([, value]) => value?.trim())
    .map(([name]) => name)
    .filter(isForbiddenSupabaseEnvironmentName)
    .sort();
  if (configured.length > 0) {
    throw new Error(
      `Local Supabase CI refuses preconfigured Supabase environment variables: ${configured.join(", ")}`
    );
  }
}

export function createLocalCiEnvironment(
  environment: SupabaseEnvironment
) {
  assertNoRemoteSupabaseEnvironment(environment);
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) =>
      LOCAL_CI_ENVIRONMENT_NAMES.has(name.toUpperCase())
    )
  ) as NodeJS.ProcessEnv;
}

export function resolveSupabaseCli(rootDirectory = process.cwd()) {
  const manifestPath = path.join(
    rootDirectory,
    "node_modules",
    "supabase",
    "package.json"
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    version?: string;
    bin?: { supabase?: string };
  };

  if (manifest.version !== PINNED_SUPABASE_CLI_VERSION) {
    throw new Error(
      `Supabase CLI must be exactly ${PINNED_SUPABASE_CLI_VERSION}; received ${manifest.version ?? "unknown"}`
    );
  }
  if (!manifest.bin?.supabase) {
    throw new Error("Installed Supabase package does not expose its CLI binary");
  }

  const platformCandidates: Record<string, Record<string, string[]>> = {
    darwin: { arm64: ["darwin-arm64"], x64: ["darwin-x64"] },
    linux: {
      arm64: ["linux-arm64", "linux-arm64-musl"],
      x64: ["linux-x64", "linux-x64-musl"],
    },
    win32: { arm64: ["windows-arm64"], x64: ["windows-x64"] },
  };
  const candidates = platformCandidates[process.platform]?.[process.arch];
  if (!candidates) {
    throw new Error(
      `Supabase CLI does not support ${process.platform}-${process.arch}`
    );
  }

  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  const isMusl =
    process.platform === "linux" && !report?.header?.glibcVersionRuntime;
  const orderedCandidates = isMusl
    ? [...candidates].sort((left) => (left.endsWith("-musl") ? -1 : 1))
    : candidates;
  const requireFromRoot = createRequire(path.join(rootDirectory, "package.json"));
  const executableName = process.platform === "win32" ? "supabase.exe" : "supabase";

  for (const suffix of orderedCandidates) {
    try {
      const binaryManifestPath = requireFromRoot.resolve(
        `@supabase/cli-${suffix}/package.json`
      );
      const binaryManifest = JSON.parse(
        fs.readFileSync(binaryManifestPath, "utf8")
      ) as { version?: string };
      if (binaryManifest.version !== PINNED_SUPABASE_CLI_VERSION) {
        throw new Error(
          `Supabase CLI binary must be exactly ${PINNED_SUPABASE_CLI_VERSION}; received ${binaryManifest.version ?? "unknown"}`
        );
      }
      const binaryPath = path.join(
        path.dirname(binaryManifestPath),
        "bin",
        executableName
      );
      if (fs.existsSync(binaryPath)) {
        return binaryPath;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Supabase CLI binary must be exactly")
      ) {
        throw error;
      }
    }
  }

  throw new Error(
    `Installed Supabase CLI binary is missing for ${process.platform}-${process.arch}`
  );
}

export function runSupabaseCli(
  args: string[],
  options: {
    capture?: boolean;
    environment?: SupabaseEnvironment;
    rootDirectory?: string;
  } = {}
) {
  const rootDirectory = options.rootDirectory ?? process.cwd();
  const environment = options.environment ?? process.env;
  const combinedEnvironment = { ...process.env, ...environment };
  assertNoRemoteSupabaseEnvironment(combinedEnvironment);
  assertLocalOnlySupabaseArgs(args);

  const binaryPath = resolveSupabaseCli(rootDirectory);
  const commandOptions = {
    cwd: rootDirectory,
    encoding: "utf8" as const,
    env: {
      ...createLocalCiEnvironment(combinedEnvironment),
      DO_NOT_TRACK: "1",
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
    maxBuffer: 64 * 1024 * 1024,
  };

  if (!options.capture) {
    return execFileSync(binaryPath, args, {
      ...commandOptions,
      stdio: ["ignore", "inherit", "inherit"],
    });
  }

  const result = spawnSync(binaryPath, args, {
    ...commandOptions,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new SupabaseCliCommandError(
      args.slice(0, 2).join(" "),
      result.status,
      [result.stdout, result.stderr].filter(Boolean).join("\n")
    );
  }

  return [result.stdout, result.stderr].filter(Boolean).join("\n");
}
