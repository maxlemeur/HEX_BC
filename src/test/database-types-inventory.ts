import fs from "node:fs";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/)|(?:^|\/)test\/|\.(?:test|spec|test-utils)\.(?:[cm]?[jt]sx?)$/;
const RPC_LITERAL_PATTERN =
  /\.rpc\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
const RPC_CONST_PATTERN = /\.rpc\(\s*([A-Z][A-Z0-9_]*)\b/g;
const CONST_RPC_NAME_PATTERN =
  /(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
const TAKEOFF_TABLE_FROM_PATTERN =
  /\.from\(\s*["']((?:takeoff_|plan_)[A-Za-z0-9_]+)["']/g;
const DATABASE_SECTION_KEY_PATTERN = /^      ([A-Za-z_][A-Za-z0-9_]*): \{/;

export const REQUIRED_RPCS = [
  "transition_estimate_version_status",
  "decide_estimate_approval",
  "recover_stale_takeoff_jobs",
  "list_due_durable_workflows",
  "claim_portal_estimate_decision",
  "acquire_takeoff_batch_reconcile_lease",
  "claim_affaire_intake_upload",
  "list_approval_queue",
  "apply_takeoff_job_guarded_atomic",
  "set_active_tenant_membership_default",
  "renew_takeoff_processing_lease",
  "renew_takeoff_batch_reconcile_lease",
  "persist_takeoff_provider_batch_snapshot",
  "persist_takeoff_provider_batch_snapshot_fenced",
] as const;

export const REQUIRED_TABLES = [
  "takeoff_jobs",
  "takeoff_items",
  "plan_files",
  "plan_sets",
  "takeoff_price_suggestions",
] as const;

export type DatabaseTypesInventory = {
  functionNames: string[];
  missingRpcs: string[];
  missingTables: string[];
  tableNames: string[];
  usedRpcs: string[];
  usedTables: string[];
};

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

function isDeclarationFile(filePath: string) {
  return (
    filePath.endsWith(".d.ts") ||
    filePath.endsWith(".d.cts") ||
    filePath.endsWith(".d.mts")
  );
}

export function isInventorySourceFile(relativePath: string) {
  const normalized = normalizePath(relativePath);
  if (normalized === "src/test" || normalized.startsWith("src/test/")) {
    return false;
  }
  if (TEST_FILE_PATTERN.test(normalized) || isDeclarationFile(normalized)) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.posix.extname(normalized));
}

export function extractDatabaseSectionKeys(
  source: string,
  section: "Tables" | "Functions"
) {
  const marker = `    ${section}: {`;
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === marker);
  if (start < 0) {
    throw new Error(`database.ts is missing the ${section} section`);
  }

  const keys: string[] = [];
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === start) {
      depth = 1;
      continue;
    }
    if (depth === 1) {
      const match = line.match(DATABASE_SECTION_KEY_PATTERN);
      if (match) {
        keys.push(match[1]);
      }
    }
    depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    if (depth <= 0) {
      break;
    }
  }
  return keys;
}

export function collectRpcNamesFromSource(source: string) {
  const names = new Set<string>();
  const constants = new Map<string, string>();
  for (const match of source.matchAll(CONST_RPC_NAME_PATTERN)) {
    constants.set(match[1], match[2]);
  }
  for (const match of source.matchAll(RPC_LITERAL_PATTERN)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(RPC_CONST_PATTERN)) {
    const resolved = constants.get(match[1]);
    if (resolved) {
      names.add(resolved);
    }
  }
  return [...names].sort();
}

export function collectTakeoffTableNamesFromSource(source: string) {
  const names = new Set<string>();
  for (const match of source.matchAll(TAKEOFF_TABLE_FROM_PATTERN)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function walkSourceFiles(rootDirectory: string, relativeDirectory: string) {
  const files: string[] = [];
  const absoluteDirectory = path.join(rootDirectory, ...relativeDirectory.split("/"));
  if (!fs.existsSync(absoluteDirectory)) {
    return files;
  }

  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = normalizePath(path.relative(rootDirectory, absolutePath));
      if (isInventorySourceFile(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  visit(absoluteDirectory);
  return files.sort();
}

export function inspectDatabaseTypesInventory(
  rootDirectory = process.cwd()
): DatabaseTypesInventory {
  const databaseSource = fs.readFileSync(
    path.join(rootDirectory, "src", "types", "database.ts"),
    "utf8"
  );
  const functionNames = extractDatabaseSectionKeys(databaseSource, "Functions");
  const tableNames = extractDatabaseSectionKeys(databaseSource, "Tables");
  const functionNameSet = new Set(functionNames);
  const tableNameSet = new Set(tableNames);

  const usedRpcs = new Set<string>(REQUIRED_RPCS);
  for (const relativePath of [
    ...walkSourceFiles(rootDirectory, "src/lib"),
    ...walkSourceFiles(rootDirectory, "src/app"),
  ]) {
    const source = fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
    for (const name of collectRpcNamesFromSource(source)) {
      usedRpcs.add(name);
    }
  }

  const usedTables = new Set<string>(REQUIRED_TABLES);
  for (const relativePath of walkSourceFiles(rootDirectory, "src/lib/takeoff")) {
    const source = fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
    for (const name of collectTakeoffTableNamesFromSource(source)) {
      usedTables.add(name);
    }
  }

  return {
    functionNames: [...functionNames].sort(),
    missingRpcs: [...usedRpcs].filter((name) => !functionNameSet.has(name)).sort(),
    missingTables: [...usedTables]
      .filter((name) => !tableNameSet.has(name))
      .sort(),
    tableNames: [...tableNames].sort(),
    usedRpcs: [...usedRpcs].sort(),
    usedTables: [...usedTables].sort(),
  };
}
