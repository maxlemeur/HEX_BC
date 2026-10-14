// Current generated-ouvrage declarations and rollback oracles. No IO on import.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { repositoryRoot as root, requireValue, sqlInventory } from "./local-recipe-common.mjs";
import { foldFunctionDeclarations } from "./sql-function-declarations.mjs";

export async function generatedDefinitions() {
  const inventory = await sqlInventory(path.join(root, "supabase/migrations"));
  const baseline = inventory.filter((row) => row.name.endsWith("_atomic_generated_ouvrages.sql"));
  requireValue(baseline.length === 1, "Generated declaration baseline must be unique.");
  const candidates = inventory.filter((row) => row.name >= baseline[0].name);
  const sources = await Promise.all(candidates.map(async (row) => ({ ...row, sql: await readFile(path.join(root, "supabase/migrations", row.name), "utf8") })));
  const folded = foldFunctionDeclarations(sources, { select: ({ name }) => name.includes("generated_ouvrage") });
  const componentFixturePath = "src/test/fixtures/estimate-generated-components-regression.sql";
  const fixture = await readFile(path.join(root, componentFixturePath), "utf8");
  const array = fixture.match(/foreach case_name in array array\[([\s\S]*?)\]\s+loop/i);
  requireValue(array && fixture.trimEnd().endsWith("$generated_components_probe$;") && !/\b(?:commit|rollback)\s*;/i.test(fixture), "Component mandatory abort source differs.");
  const componentCases = [...array[1].matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
  requireValue(componentCases.length > 0 && new Set(componentCases).size === componentCases.length, "Component case inventory is empty or duplicated.");
  return { sources: inventory.filter((row) => folded.sources.includes(row.name)), functions: folded.functions, componentFixturePath, componentCases };
}

export function verifyGeneratedFunctions(actual, expected) {
  requireValue(actual?.functions?.length === expected.functions.length && new Set(actual.functions.map((row) => row.signature)).size === expected.functions.length &&
    actual.functions.every((row) => Number.isInteger(row.oid) && row.oid > 0) && new Set(actual.functions.map((row) => row.oid)).size === expected.functions.length, "Generated function set or resolved OIDs are missing or duplicated.");
  for (const definition of expected.functions) {
    const row = actual.functions.find((entry) => entry.signature === definition.signature);
    requireValue(row && row.schema === definition.schema && row.name === definition.name && row.body.trim() === definition.body && row.owner === "postgres" &&
      row.definer === definition.definer && row.language === definition.language && row.volatility === definition.volatility && isDeepStrictEqual(row.config, definition.config) &&
      row.authenticated === definition.authenticated && row.service === definition.service && row.publicExecute === false && row.anon === false, "Generated latest body/signature/security/ACL differs.");
  }
  requireValue(actual.ledger?.length === 3 && isDeepStrictEqual(actual.ledger.map((row) => row.role).sort(), ["anon", "authenticated", "service_role"]) &&
    actual.ledger.every((row) => row.usagePrivate === false && row.ledgerAny === false), "Native private receipt access differs.");
}

export function verifyComponentRegression(output, result, exitCode, expected) {
  const matches = [...output.matchAll(/ESTIMATE_GENERATED_COMPONENTS_PROOF:(\{[^\n]+\})/g)];
  requireValue(exitCode === 3 && /ERROR:\s+P9001:/.test(output) && matches.length === 1, "Component mandatory rollback result is missing.");
  const parsed = JSON.parse(matches[0][1]);
  requireValue(isDeepStrictEqual(parsed, result) && parsed.allPassed === true && parsed.fixturePrefix === "cfc70000" && parsed.concurrencyExecuted === false &&
    isDeepStrictEqual(parsed.cases.map((row) => row.case), expected.componentCases) && parsed.cases.every((row) => row.passed === true && row.error === null), "Component exact cases did not pass.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 3 && process.argv[2] === "--describe", "Use --describe; no database access.");
    console.log(JSON.stringify(await generatedDefinitions()));
  } catch { console.error("Generated current declarations refused."); process.exitCode = 3; }
}
