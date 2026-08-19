import fs from "node:fs";
import path from "node:path";

export const PGTAP_RPC_BASELINE_PATH = "src/test/pgtap-rpc-baseline.json";
export const PGTAP_DATABASE_TESTS_DIRECTORY = "supabase/tests/database";
export const SUPABASE_MIGRATIONS_DIRECTORY = "supabase/migrations";

const CREATE_FUNCTION_PATTERN_SOURCE =
  String.raw`\bcreate\s+(?:or\s+replace\s+)?function\s+(?:((?:"[^"]+"|[A-Za-z_][\w]*))\.)?((?:"[^"]+"|[A-Za-z_][\w]*))`;

export interface PgtapRpcBaseline {
  uncoveredFunctionNames: string[];
}

export interface PgtapRpcCoverageReport {
  migrationFunctionNames: string[];
  mentionedFunctionNames: string[];
  baselineFunctionNames: string[];
  unguardedFunctionNames: string[];
  staleBaselineFunctionNames: string[];
}

export interface PgtapRpcCoverageOptions {
  rootDirectory?: string;
}

function normalizeIdentifier(value: string) {
  return value.replaceAll('"', "").toLowerCase();
}

export function stripSqlComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function extractCreatedFunctionNames(source: string) {
  const names = new Set<string>();
  const uncommented = stripSqlComments(source);
  const pattern = new RegExp(CREATE_FUNCTION_PATTERN_SOURCE, "gi");
  for (const match of uncommented.matchAll(pattern)) {
    names.add(normalizeIdentifier(match[2]));
  }
  return [...names].sort();
}

export function extractMentionedFunctionNames(
  source: string,
  functionNames: readonly string[]
) {
  return functionNames.filter((functionName) =>
    new RegExp(`(?<![A-Za-z0-9_])${functionName}(?![A-Za-z0-9_])`, "i").test(
      source
    )
  );
}

function listSqlFiles(directory: string) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
    .map((fileName) => path.join(directory, fileName));
}

function readSqlDirectory(directory: string) {
  return listSqlFiles(directory)
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");
}

export function parsePgtapRpcBaseline(value: unknown): PgtapRpcBaseline {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pgTAP RPC baseline must be an object");
  }

  const uncoveredFunctionNames = (value as { uncoveredFunctionNames?: unknown })
    .uncoveredFunctionNames;
  if (
    !Array.isArray(uncoveredFunctionNames) ||
    uncoveredFunctionNames.some((name) => typeof name !== "string")
  ) {
    throw new Error("pgTAP RPC baseline must list uncoveredFunctionNames");
  }

  return {
    uncoveredFunctionNames: [...new Set(uncoveredFunctionNames)].sort((left, right) =>
      left.localeCompare(right)
    ),
  };
}

export function inspectPgtapRpcCoverage(
  options: PgtapRpcCoverageOptions = {}
): PgtapRpcCoverageReport {
  const rootDirectory = options.rootDirectory ?? process.cwd();
  const migrationFunctionNames = extractCreatedFunctionNames(
    readSqlDirectory(path.join(rootDirectory, SUPABASE_MIGRATIONS_DIRECTORY))
  );
  const mentionedFunctionNames = extractMentionedFunctionNames(
    readSqlDirectory(path.join(rootDirectory, PGTAP_DATABASE_TESTS_DIRECTORY)),
    migrationFunctionNames
  );
  const mentioned = new Set(mentionedFunctionNames);
  const baseline = parsePgtapRpcBaseline(
    JSON.parse(
      fs.readFileSync(path.join(rootDirectory, PGTAP_RPC_BASELINE_PATH), "utf8")
    ) as unknown
  );
  const baselineNames = new Set(baseline.uncoveredFunctionNames);

  return {
    migrationFunctionNames,
    mentionedFunctionNames,
    baselineFunctionNames: baseline.uncoveredFunctionNames,
    unguardedFunctionNames: migrationFunctionNames.filter(
      (functionName) => !mentioned.has(functionName) && !baselineNames.has(functionName)
    ),
    staleBaselineFunctionNames: baseline.uncoveredFunctionNames.filter(
      (functionName) => !migrationFunctionNames.includes(functionName)
    ),
  };
}
