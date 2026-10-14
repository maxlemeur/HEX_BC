// Current CCTP declarations and rollback oracle. No database access on import.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { repositoryRoot as root, requireValue, sqlInventory } from "./local-recipe-common.mjs";
import { foldFunctionDeclarations, parseFunctionDeclarations } from "./sql-function-declarations.mjs";

export async function cctpDefinitions() {
  const inventory = await sqlInventory(path.join(root, "supabase/migrations"));
  const baseline = ["_estimate_source_reference_review.sql", "_estimate_source_coverage.sql"].map((suffix) => {
    const matches = inventory.filter((row) => row.name.endsWith(suffix));
    requireValue(matches.length === 1, "CCTP declaration baseline must be unique."); return matches[0];
  });
  const ownedNames = new Set(), tables = [];
  for (const source of baseline) {
    const sql = await readFile(path.join(root, "supabase/migrations", source.name), "utf8");
    for (const row of parseFunctionDeclarations({ name: source.name, sql })) ownedNames.add(`${row.schema}.${row.name}`);
    tables.push(...[...sql.matchAll(/create table (private\.[a-z_]+)\s*\(/gi)].map((entry) => entry[1]));
  }
  const candidates = inventory.filter((row) => row.name >= baseline[0].name);
  const declarationSources = await Promise.all(candidates.map(async (row) => ({ ...row, sql: await readFile(path.join(root, "supabase/migrations", row.name), "utf8") })));
  const folded = foldFunctionDeclarations(declarationSources, { select: ({ schema, name }) => ownedNames.has(`${schema}.${name}`) ||
    schema === "private" && /^source_(review|coverage|reference)_/.test(name) });
  const { functions } = folded;
  const sources = inventory.filter((row) => folded.sources.includes(row.name) || baseline.some((base) => base.name === row.name));
  const fixturePath = "src/test/fixtures/source-coverage-regression.sql", fixture = await readFile(path.join(root, fixturePath), "utf8");
  const array = fixture.match(/foreach case_name in array array\[([\s\S]*?)\] loop/i);
  requireValue(array && fixture.trimEnd().endsWith("$coverage_probe$;") && !/\b(?:commit|rollback)\s*;/i.test(fixture), "CCTP mandatory abort source differs.");
  const cases = [...array[1].matchAll(/'([A-Za-z0-9-]+)'/g)].map((entry) => entry[1]);
  requireValue(cases.length === 34 && new Set(cases).size === 34, "CCTP exact 34-case inventory differs.");
  return { sources, functions, tables, cases, fixturePath };
}

export function verifyCctpFunctions(actual, expected) {
  requireValue(actual?.functions?.length === expected.functions.length && new Set(actual.functions.map((row) => row.signature)).size === expected.functions.length &&
    actual.functions.every((row) => Number.isInteger(row.oid) && row.oid > 0) && new Set(actual.functions.map((row) => row.oid)).size === expected.functions.length, "CCTP function set or resolved OIDs are missing or duplicated.");
  for (const definition of expected.functions) {
    const row = actual.functions.find((entry) => entry.signature === definition.signature);
    requireValue(row && row.schema === definition.schema && row.name === definition.name && row.body.trim() === definition.body && row.owner === "postgres" &&
      row.definer === definition.definer && row.language === definition.language && row.volatility === definition.volatility && isDeepStrictEqual(row.config, definition.config) &&
      row.authenticated === definition.authenticated && row.service === definition.service && row.publicExecute === false && row.anon === false, "CCTP body/signature/security/ACL differs.");
  }
  const identities = expected.tables.flatMap((table) => ["anon", "authenticated", "service_role"].map((role) => `${table}:${role}`)).sort();
  requireValue(actual.tables?.length === identities.length && isDeepStrictEqual(actual.tables.map((row) => `${row.table}:${row.role}`).sort(), identities) &&
    actual.tables.every((row) => row.rls === true && row.owner === "postgres" && row.usagePrivate === false && row.tableAny === false), "CCTP private table security/ACL differs.");
}

export function verifyCctpRegression(output, result, exitCode, expected) {
  const matches = [...output.matchAll(/SOURCE_COVERAGE_PROOF:(\{[^\n]+\})/g)];
  requireValue(exitCode === 3 && /ERROR:\s+P9001:/.test(output) && matches.length === 1, "CCTP mandatory rollback result is missing.");
  const parsed = JSON.parse(matches[0][1]);
  requireValue(isDeepStrictEqual(parsed, result) && parsed.allPassed === true && parsed.fixturePrefix === "dc510000" && parsed.physicalStorageProof === false && parsed.concurrencyExecuted === false &&
    isDeepStrictEqual(parsed.cases.map((row) => row.case), expected.cases) && parsed.cases.every((row) => row.passed === true && row.error === null), "CCTP exact 34 cases did not pass.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 3 && process.argv[2] === "--describe", "Use --describe; no database access.");
    console.log(JSON.stringify(await cctpDefinitions()));
  } catch { console.error("CCTP current declaration refused."); process.exitCode = 3; }
}
