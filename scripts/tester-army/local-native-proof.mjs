// Verify executed native results, rather than accepting a status flag.
import { readFile, readdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { readProof, requireValue, sha256, sqlInventory, repositoryRoot } from "./local-recipe-common.mjs";
import { cctpDefinitions, verifyCctpFunctions, verifyCctpRegression } from "./cctp-native-contract.mjs";
import { generatedDefinitions, verifyGeneratedFunctions, verifyComponentRegression } from "./generated-native-contract.mjs";

export async function verifyNativeRecipe(receiptPath, receiptSha256, { scenarioSet = "generated-recovery" } = {}) {
  const proof = await readProof(receiptPath, receiptSha256), value = proof.data;
  requireValue(["generated-recovery", "source-coverage"].includes(scenarioSet), "Unknown native recipe scenario.");
  requireValue(scenarioSet !== "source-coverage" || value.sourceCoverage?.bodiesAndAclVerified === true, "CCTP installed attestation is required separately from generated qualification.");
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  requireValue(value.schemaVersion === "army-local-native-qualification-1" && value.status === "verified" &&
    value.host?.platform === "linux" && Number.isInteger(value.host.uid) && value.host.uid > 0 &&
    value.cliVersion === packageJson.devDependencies.supabase && /^v26\.\d+\.\d+$/.test(value.nativeNodeVersion ?? "") &&
    ["rollbackVerified", "migrationHistoryVerified", "bodiesAndAclVerified"].every((key) => value[key] === true) &&
    ["reset", "migrationApplied", "seed"].every((key) => value[key] === false), "Executed native recipe qualification is required.");
  const directory = await realpath(path.dirname(proof.file));
  requireValue(Array.isArray(value.artifacts) && value.artifacts.length > 0 &&
    new Set(value.artifacts.map((entry) => entry.name)).size === value.artifacts.length, "Native recipe artifacts must be unique.");
  const artifacts = [];
  for (const entry of value.artifacts) {
    requireValue(typeof entry.name === "string" && path.basename(entry.name) === entry.name && !/[\\:]/.test(entry.name), "Native recipe artifact must be a flat owned file.");
    const file = await realpath(path.join(directory, entry.name));
    requireValue(!(await lstat(path.join(directory, entry.name))).isSymbolicLink() && path.dirname(file) === directory && sha256(await readFile(file)) === entry.sha256, "Native recipe artifact escaped or changed.");
    artifacts.push({ name: `native-recipe-${entry.name}`, file, sha256: entry.sha256 });
  }
  const actualNames = (await readdir(directory)).sort();
  requireValue(isDeepStrictEqual(actualNames, ["receipt.json", ...value.artifacts.map((entry) => entry.name)].sort()), "Native recipe archive inventory differs.");
  const bytesFor = async (name) => {
    requireValue(value.artifacts.some((entry) => entry.name === name), `Native artifact ${name} is missing.`);
    return readFile(path.join(directory, name), "utf8");
  };
  requireValue(isDeepStrictEqual(JSON.parse(await bytesFor("before.json")), JSON.parse(await bytesFor("after-independent.json"))), "Native rollback conservation differs.");
  const config = await readProof(value.configPath, value.configSha256);
  requireValue(config.data.schemaVersion === "army-local-native-config-1" && value.target.apiUrl === config.data.apiUrl &&
    value.target.stackDirectory === config.data.stackDirectory && value.target.projectId === config.data.projectId &&
    value.target.ports["54322"] === config.data.dbPort && value.target.identity.systemIdentifier === config.data.systemIdentifier &&
    value.target.identity.serverVersionNum === config.data.serverVersionNum && value.target.identity.user === "postgres" &&
    value.target.identity.database === "postgres", "Native recipe target differs from its explicit configuration.");
  requireValue(isDeepStrictEqual(await sqlInventory(path.join(repositoryRoot, "supabase/migrations")), value.migrationInventory) &&
    isDeepStrictEqual(await sqlInventory(path.join(repositoryRoot, "supabase/tests")), value.testInventory), "Current native migration/test sources differ.");
  const currentSources = ["scripts/tester-army/local-native.py", "scripts/tester-army/local-native-catalog.sql", "scripts/tester-army/local-native-privileges.sql", "scripts/tester-army/generated-native-contract.mjs", "scripts/tester-army/sql-function-declarations.mjs", "src/test/fixtures/estimate-generated-components-regression.sql", "src/test/fixtures/estimate-generated-atomic-regression.sql",
    ...(value.sourceCoverage ? ["scripts/tester-army/cctp-native-contract.mjs", "src/test/fixtures/source-coverage-regression.sql"] : []),
    ...value.migrationInventory.map((entry) => `supabase/migrations/${entry.name}`), ...value.testInventory.map((entry) => `supabase/tests/${entry.name}`)];
  for (const source of currentSources) {
    const matches = value.artifacts.filter((entry) => /^source-\d+-/.test(entry.name) && entry.name.replace(/^source-\d+-/, "") === path.basename(source));
    requireValue(matches.length === 1 && sha256(await readFile(path.join(repositoryRoot, source))) === matches[0].sha256, `Current native source ${source} differs.`);
  }
  const functions = JSON.parse(await bytesFor("generated-functions.json"));
  const generated = await generatedDefinitions();
  verifyGeneratedFunctions(functions, generated);
  requireValue(value.componentRegression?.rollbackVerified === true &&
    isDeepStrictEqual(JSON.parse(await bytesFor("before.json")), JSON.parse(await bytesFor("after-component-regression.json"))), "Component rollback conservation is required.");
  verifyComponentRegression(await bytesFor("component-regression-output.txt"), value.componentRegression.regression, value.componentRegression.exitCode, generated);
  const regression = await bytesFor("regression-output.txt");
  const matches = [...regression.matchAll(/ESTIMATE_GENERATED_ATOMIC_PROOF:(\{[^\n]+\})/g)];
  const source = await readFile(path.join(repositoryRoot, "src/test/fixtures/estimate-generated-atomic-regression.sql"), "utf8");
  const array = source.match(/foreach case_name in array array\[([\s\S]*?)\] loop/i);
  requireValue(array && matches.length === 1 && /ERROR:\s+P9001:/.test(regression), "Native sequential regression result or mandatory abort is missing.");
  const expectedCases = [...array[1].matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
  const parsed = JSON.parse(matches[0][1]);
  requireValue(isDeepStrictEqual(parsed, value.regression) && parsed.allPassed === true && parsed.fixturePrefix === "cfc20000" &&
    parsed.concurrencyExecuted === false && isDeepStrictEqual(parsed.cases.map((entry) => entry.case), expectedCases) &&
    new Set(expectedCases).size === expectedCases.length && parsed.cases.every((entry) => entry.passed === true && entry.error === null), "Native exact sequential cases did not all pass.");
  const output = await bytesFor("pgtap-output.txt"), summaries = [...output.matchAll(/^Files=(\d+), Tests=(\d+),.*$/gm)];
  const executed = [...output.matchAll(/^(.+\.sql)\s+\.{2,}\s+ok\s*$/gm)].map((match) => match[1].trim()).sort();
  const expected = value.testInventory.map((entry) => `${value.target.stackDirectory}/supabase/tests/${entry.name}`).sort();
  requireValue(value.pgTap?.complete === true && value.pgTap.cliExitCode === 0 && value.pgTap.rawTapStored === false &&
    isDeepStrictEqual(value.pgTap.command, [config.data.cliPath, "--workdir", value.target.stackDirectory, "test", "db", "--local", `${value.target.stackDirectory}/supabase/tests/database`]) &&
    summaries.length === 1 && Number(summaries[0][1]) === expected.length && Number(summaries[0][2]) === value.pgTap.tests &&
    value.pgTap.files === expected.length && value.pgTap.tests > 0 && new Set(executed).size === executed.length && isDeepStrictEqual(executed, expected) &&
    [...output.matchAll(/^Result: PASS\s*$/gm)].length === 1 && output.includes("All tests successful.") &&
    !/^(?:not ok\b|Bail out!|Dubious\b|Failed\b)|\b(?:ERROR|FATAL|PANIC):|#\s*(?:SKIP|TODO)\b/im.test(output), "Native pgTAP executed file set or plan is incomplete.");
  for (const entry of value.testInventory) requireValue(!/\b(?:skip|skip_all|todo|todo_start|todo_end|bail_out)\s*\(/i.test(await readFile(path.join(repositoryRoot, "supabase/tests", entry.name), "utf8")), "Native test sources include skipped/TODO assertions.");
  if (value.sourceCoverage) {
    requireValue(value.sourceCoverage.rollbackVerified === true, "CCTP rollback conservation is required.");
    const definitions = await cctpDefinitions();
    verifyCctpFunctions(JSON.parse(await bytesFor("cctp-functions.json")), definitions);
    verifyCctpRegression(await bytesFor("cctp-regression-output.txt"), value.sourceCoverage.regression, value.sourceCoverage.exitCode, definitions);
  }
  return { ...proof, artifacts, config };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue([5, 6].includes(process.argv.length) && process.argv[2] === "--verify", "Use --verify <exact-receipt-path> <sha256> [scenario]; no database access.");
    const proof = await verifyNativeRecipe(process.argv[3], process.argv[4], { scenarioSet: process.argv[5] ?? "generated-recovery" });
    console.log(JSON.stringify({ status: "verified-offline", sha256: proof.sha256, databaseAccess: false }));
  } catch (error) { console.error(error.message); process.exitCode = 3; }
}
