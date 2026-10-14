import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readProof, requireValue, sha256, repositoryRoot as root } from "./local-recipe-common.mjs";
import { validateComponentsPlan } from "./generated-components-plan.mjs";
import { assertCctpLaborSelection } from "./cctp-seed-plan.mjs";

export async function verifyComponentsSeed(fixture, owner, profile) {
  requireValue(fixture.schemaVersion === "estimate-generated-components-fixture-1" && fixture.status === "ready" &&
    fixture.apiUrl === profile.backendOrigin && fixture.selection === profile.componentSelection && isDeepStrictEqual(fixture.owner, owner.owner) &&
    fixture.ownerFixtureSha256 === profile.fixtureSha256 && fixture.stackReceiptSha256 === profile.stackReceiptSha256 && fixture.nativeRecipeSha256 === profile.nativeRecipeSha256, "Component fixture chain differs.");
  const plan = await readProof(fixture.planPath, fixture.planSha256); validateComponentsPlan(plan.data);
  for (const key of ["scenarios", "reuse", "records", "owner", "selection", "apiUrl", "prefix"]) requireValue(isDeepStrictEqual(fixture[key], plan.data[key]), "Component fixture differs from exact plan.");
  const native = await readProof(fixture.nativePrerequisites.file, fixture.nativePrerequisites.sha256), value = native.data;
  requireValue(value.status === "verified" && value.phase === "commit_verified" && value.planSha256 === plan.sha256 && value.stackReceiptSha256 === profile.stackReceiptSha256 &&
    value.apiUrl === profile.backendOrigin && value.plannedRows === plan.data.records.length &&
    ["businessDataPreserved", "exactPlannedAdditionsVerified", "catalogueAndPrivilegesPreserved", "independentReadbackVerified"].every((k) => value[k] === true), "Native component seed is incomplete.");
  const directory = path.dirname(native.file), artifacts = [];
  for (const a of value.artifacts) {
    requireValue(path.basename(a.name) === a.name && !(await lstat(path.join(directory, a.name))).isSymbolicLink(), "Component seed artifact escaped.");
    const file = path.join(directory, a.name), bytes = await readFile(file);
    requireValue(sha256(bytes) === a.sha256, "Component seed artifact SHA differs."); artifacts.push({ name: `components-seed-${a.name}`, file, sha256: a.sha256 });
  }
  requireValue(isDeepStrictEqual((await readdir(directory)).sort(), ["receipt.json", ...value.artifacts.map((a) => a.name)].sort()), "Complete component seed inventory required.");
  const json = async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8"));
  const before = await json("before.json"), after = await json("after-before-commit.json"), independent = await json("after-independent.json"), records = await json("prerequisites.json"), audits = await json("derived-audits.json");
  requireValue(isDeepStrictEqual(after, independent) && isDeepStrictEqual(before.guards, after.guards), "Component commit/independent conservation differs.");
  const counterBefore = await json("counter-before.json"), counterAfter = await json("counter-after.json");
  requireValue(isDeepStrictEqual(counterAfter.row, { ...counterBefore.row, last_value: counterBefore.row.last_value + 5 }) &&
    value.referenceCounterException.delta === 5 && value.referenceCounterException.tenantId === fixture.owner.tenantId && records.length === 91, "Component reference counter/precondition count differs.");
  for (const expected of plan.data.records) {
    const actual = records.filter((r) => r.table === expected.table && (expected.row.id ? r.row.id === expected.row.id : r.row.candidate_id === expected.row.candidate_id && r.row.source_fragment_id === expected.row.source_fragment_id && r.row.source_rank === expected.row.source_rank));
    requireValue(actual.length === 1 && Object.entries(expected.row).every(([k, v]) => isDeepStrictEqual(actual[0].row[k], v)), "Native exact component record differs.");
  }
  const allowed = new Map();
  for (const r of [...records.map((r) => ({ schema: "public", name: r.table, hash: r.hash })), ...audits.map((r) => ({ schema: "public", name: "audit_logs", hash: r.hash }))]) {
    const key = `${r.schema}.${r.name}`, values = allowed.get(key) ?? {}; values[r.hash] = (values[r.hash] ?? 0) + 1; allowed.set(key, values);
  }
  requireValue(before.data.length === after.data.length && value.derivedAuditCount === audits.length, "Component data inventory differs.");
  for (const old of before.data) {
    const matches = after.data.filter((r) => r.schema === old.schema && r.name === old.name); requireValue(matches.length === 1, "Component data table missing/duplicated.");
    const next = matches[0], expected = { ...old.hashes }, key = `${old.schema}.${old.name}`;
    if (key === "private.estimate_reference_counters") {
      requireValue(expected[counterBefore.hash] === 1, "Existing component reference counter must be unique."); delete expected[counterBefore.hash]; expected[counterAfter.hash] = 1;
    }
    for (const [hash, count] of Object.entries(allowed.get(key) ?? {})) expected[hash] = (expected[hash] ?? 0) + count;
    requireValue(isDeepStrictEqual(next.hashes, expected) && next.rows === Object.values(expected).reduce((a, b) => a + b, 0), "Component seed escaped exact additions/conservation.");
  }
  const seed = await readProof(fixture.seedReceiptPath, fixture.seedReceiptSha256), readback = await readProof(fixture.readback.file, fixture.readback.sha256);
  requireValue(seed.data.schemaVersion === "army-generated-components-seed-1" && seed.data.status === "ready" && seed.data.phase === "ordinary_readback_verified" &&
    seed.data.nativeExitCode === 0 && seed.data.planSha256 === plan.sha256 && seed.data.apiUrl === fixture.apiUrl && isDeepStrictEqual(seed.data.owner, fixture.owner) &&
    seed.data.noAuthAdmin === true && seed.data.noServiceClient === true && isDeepStrictEqual(seed.data.nativePrerequisites, fixture.nativePrerequisites) &&
    isDeepStrictEqual(seed.data.readback, fixture.readback), "Ordinary component seed is incomplete.");
  for (const s of seed.data.sources) requireValue(typeof s.path === "string" && s.path.startsWith("scripts/tester-army/") && !s.path.includes("..") && sha256(await readFile(path.join(root, s.path))) === s.sha256, "Current component seed source differs.");
  requireValue(readback.data.records.length === records.length && readback.data.empty.length === 10 && readback.data.empty.every((r) => r.rows.length === 0), "Ordinary component readback incomplete.");
  for (const expected of plan.data.records) {
    const actual = readback.data.records.filter((r) => r.table === expected.table && (expected.row.id ? r.row.id === expected.row.id : r.row.candidate_id === expected.row.candidate_id && r.row.source_fragment_id === expected.row.source_fragment_id && r.row.source_rank === expected.row.source_rank));
    requireValue(actual.length === 1 && Object.entries(expected.row).every(([k, v]) => isDeepStrictEqual(actual[0].row[k], v)), "Ordinary exact component record differs.");
  }
  requireValue(isDeepStrictEqual(assertCctpLaborSelection(readback.data.laborRoles, fixture.owner), readback.data.selectedLaborRole), "Ordinary effective component RMO differs.");
  return [{ name: "components-plan.json", file: plan.file, sha256: plan.sha256 }, { name: "components-native-seed.json", file: native.file, sha256: native.sha256 }, ...artifacts,
    { name: "components-seed.json", file: seed.file, sha256: seed.sha256 }, { name: "components-readback.json", file: readback.file, sha256: readback.sha256 }];
}
