// Read actual committed evidence; flags alone never establish conservation.
import { readFile, readdir, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { repositoryRoot as root, readProof, requireValue, sha256, digestPattern } from "./local-recipe-common.mjs";
import { verifyNativeRecipe } from "./local-native-proof.mjs";
import { validateCctpPlan, assertCctpLaborSelection } from "./cctp-seed-plan.mjs";

const same = (a, b, message) => requireValue(isDeepStrictEqual(a, b), message);
const omit = (row, names) => Object.fromEntries(Object.entries(row).filter(([key]) => !names.includes(key)));

function inventory(value) {
  requireValue(Array.isArray(value), "CCTP table inventory required.");
  const result = new Map();
  for (const row of value) {
    requireValue(row && ["public", "private", "auth", "storage"].includes(row.schema) && /^[a-zA-Z0-9_]+$/.test(row.name ?? "") &&
      Number.isInteger(row.rows) && row.rows >= 0 && row.rows <= 50000 && row.hashes && typeof row.hashes === "object" && !Array.isArray(row.hashes), "Invalid CCTP table row inventory.");
    const key = `${row.schema}.${row.name}`;
    requireValue(!result.has(key) && Object.entries(row.hashes).every(([hash, count]) => hash && Number.isInteger(count) && count > 0) &&
      Object.values(row.hashes).reduce((a, b) => a + b, 0) === row.rows, "CCTP duplicate table or row-count mismatch.");
    result.set(key, row);
  }
  return result;
}

export function validateCctpDelta(before, after, allowed = {}) {
  const previous = inventory(before), current = inventory(after);
  same([...previous.keys()].sort(), [...current.keys()].sort(), "CCTP data table inventory changed.");
  requireValue(allowed && typeof allowed === "object" && !Array.isArray(allowed) && Object.keys(allowed).every((key) => previous.has(key)), "CCTP allowance escaped table inventory.");
  for (const [key, row] of previous) {
    const additions = allowed[key] ?? {};
    requireValue(additions && typeof additions === "object" && !Array.isArray(additions) &&
      Object.entries(additions).every(([hash, count]) => hash && Number.isInteger(count) && count > 0), "Invalid CCTP addition multiset.");
    const expected = { ...row.hashes };
    for (const [hash, count] of Object.entries(additions)) expected[hash] = (expected[hash] ?? 0) + count;
    same(current.get(key).hashes, expected, `CCTP old rows changed or additions escaped ${key}.`);
  }
}

export function validateCctpUploads(objects, plan) {
  const docs = plan.records.filter((r) => r.table === "affaire_intake_documents").map((r) => r.row);
  requireValue(docs.length > 0 && Array.isArray(objects) && objects.length === docs.length, "CCTP uploaded object count differs.");
  const expected = new Map(docs.map((d) => [d.storage_path, d]));
  requireValue(expected.size === docs.length && new Set(objects.map((r) => r.row?.name)).size === docs.length &&
    new Set(objects.map((r) => r.row?.id)).size === docs.length, "CCTP uploaded object identities duplicated.");
  for (const entry of objects) {
    const row = entry.row, doc = expected.get(row?.name), metadata = row?.metadata;
    requireValue(doc && row.bucket_id === "affaire-intake" && row.owner_id === plan.owner.userId &&
      [null, undefined, plan.owner.userId].includes(row.owner) && metadata?.mimetype === "application/pdf" &&
      Number.isInteger(metadata.size) && metadata.size === doc.size_bytes && typeof entry.hash === "string" && entry.hash,
    "CCTP uploaded object path/owner/PDF metadata differs.");
  }
}

export function validateCctpTransitions(before, after) {
  requireValue(Array.isArray(before) && before.length > 0 && Array.isArray(after) && after.length === before.length &&
    before.every((r) => r.table === "affaire_intake_documents" && r.row?.upload_status === "pending") &&
    new Set(before.map((r) => r.row.id)).size === before.length && new Set(after.map((r) => r.row?.id)).size === before.length,
  "Exact new pending CCTP documents required.");
  const expected = new Map(before.map((r) => [r.row.id, r]));
  for (const entry of after) {
    const previous = expected.get(entry.row?.id);
    requireValue(previous && entry.table === previous.table && entry.row.upload_status === "uploaded" &&
      typeof entry.hash === "string" && entry.hash && entry.hash !== previous.hash,
    "CCTP document transition escaped new pending identities.");
    same(omit(entry.row, ["upload_status", "updated_at"]), omit(previous.row, ["upload_status", "updated_at"]), "CCTP document changed beyond upload status/timestamp.");
    requireValue(typeof entry.row.updated_at === "string" && typeof previous.row.updated_at === "string", "CCTP document timestamp missing.");
  }
}

function removeHashes(snapshot, table, records) {
  const result = structuredClone(snapshot), matches = result.filter((r) => `${r.schema}.${r.name}` === table);
  requireValue(matches.length === 1, "CCTP removable table absent or duplicated.");
  for (const entry of records) {
    requireValue(matches[0].hashes[entry.hash] === 1, "CCTP exception fingerprint is not unique.");
    delete matches[0].hashes[entry.hash]; matches[0].rows -= 1;
  }
  return result;
}

function allowance(records) {
  const result = {};
  for (const entry of records) {
    requireValue(digestPattern.test(entry.hash ?? ""), "CCTP persisted row fingerprint invalid.");
    const key = `public.${entry.table}`;
    result[key] ??= {}; result[key][entry.hash] = (result[key][entry.hash] ?? 0) + 1;
  }
  return result;
}

function validateRecords(records, plan) {
  requireValue(Array.isArray(records) && records.length === 176, "CCTP exact persisted prerequisites required.");
  for (const [index, expected] of plan.records.entries()) {
    const actual = records[index];
    requireValue(actual.table === expected.table && actual.row && digestPattern.test(actual.hash ?? ""), "CCTP persisted record identity differs.");
    for (const [key, value] of Object.entries(expected.row)) {
      if (["completed_at", "classified_at", "manually_overridden_at"].includes(key) && value !== null) {
        requireValue(Number.isFinite(Date.parse(actual.row[key])) && Date.parse(actual.row[key]) === Date.parse(value), "CCTP persisted prerequisite timestamp differs.");
      } else same(actual.row[key], value, "CCTP persisted prerequisite differs from exact plan.");
    }
  }
}

function validateAudits(audits, records, owner) {
  const audited = new Map(records.filter((r) => !["affaire_intake_uploads", "affaire_intake_documents", "estimate_generated_ouvrage_subdetail_drafts", "estimate_generated_ouvrage_subdetail_items"].includes(r.table)).map((r) => [r.row.id, r]));
  requireValue(audited.size === 88 && Array.isArray(audits) && audits.length === 110 && new Set(audits.map((r) => r.row?.id)).size === 110, "CCTP exact derived audit inventory required.");
  const inserts = new Map(), revisions = new Map();
  for (const entry of audits) {
    const row = entry.row, source = audited.get(row?.record_id);
    requireValue(source && digestPattern.test(entry.hash ?? ""), "CCTP audit escaped new prerequisites.");
    const user = ["estimate_projects", "estimate_versions", "estimate_items", "estimate_generated_ouvrage_drafts"].includes(source.table) ? owner.userId : null;
    const version = source.table === "estimate_versions" ? source.row.id : source.table === "estimate_items" ? source.row.version_id : null;
    requireValue(row.table_name === source.table && row.tenant_id === owner.tenantId && row.user_id === user && row.estimate_version_id === version && row.after_data && typeof row.after_data === "object", "CCTP audit actor/tenant/version differs.");
    const excluded = source.table === "estimate_versions" ? ["updated_at", "content_revision"] : [];
    same(omit(row.after_data, excluded), omit(source.row, excluded), "CCTP audit after image differs from prerequisite.");
    if (row.action === "INSERT") {
      requireValue(row.before_data === null, "CCTP INSERT audit has a before image.");
      inserts.set(row.record_id, (inserts.get(row.record_id) ?? 0) + 1);
    } else {
      requireValue(row.action === "UPDATE" && source.table === "estimate_versions" && row.before_data &&
        Number.isInteger(row.before_data.content_revision) && row.after_data.content_revision === row.before_data.content_revision + 1,
      "CCTP audit is not an exact section revision update.");
      same(omit(row.before_data, excluded), omit(row.after_data, excluded), "CCTP audit update changed more than version revision.");
      const values = revisions.get(source.row.id) ?? [];
      values.push([row.before_data.content_revision, row.after_data.content_revision]); revisions.set(source.row.id, values);
    }
  }
  same([...inserts.entries()].sort(), [...audited.keys()].map((id) => [id, 1]).sort(), "CCTP INSERT audit set differs.");
  for (const source of records.filter((r) => r.table === "estimate_versions")) {
    const final = source.row.content_revision;
    requireValue(Number.isInteger(final), "CCTP section revision missing.");
    same((revisions.get(source.row.id) ?? []).sort((a, b) => a[0] - b[0]), [[final - 2, final - 1], [final - 1, final]], "CCTP section revision audit history differs.");
  }
}

async function archive(proof) {
  const value = proof.data, directory = await realpath(path.dirname(proof.file));
  requireValue(path.basename(proof.file) === "seed-receipt.json" && Array.isArray(value.artifacts) && value.artifacts.length > 0 &&
    new Set(value.artifacts.map((e) => e.name)).size === value.artifacts.length, "CCTP seed artifact inventory missing or duplicated.");
  const artifacts = [], names = new Set();
  for (const entry of value.artifacts) {
    requireValue(typeof entry.name === "string" && entry.name !== "." && entry.name !== ".." && path.basename(entry.name) === entry.name &&
      !/[\\:]/.test(entry.name) && digestPattern.test(entry.sha256 ?? ""), "CCTP seed artifact must be a flat hashed file.");
    const requested = path.join(directory, entry.name), info = await lstat(requested), file = await realpath(requested);
    requireValue(!info.isSymbolicLink() && info.isFile() && path.dirname(file) === directory && sha256(await readFile(file)) === entry.sha256, "CCTP seed artifact escaped or changed.");
    names.add(entry.name); artifacts.push({ name: `cctp-native-${value.phase}-${entry.name}`, file, sha256: entry.sha256 });
  }
  same((await readdir(directory)).sort(), ["seed-receipt.json", ...names].sort(), "CCTP seed archive inventory differs.");
  const json = async (name) => {
    requireValue(names.has(name), `CCTP seed artifact ${name} missing.`);
    return JSON.parse(await readFile(path.join(directory, name), "utf8"));
  };
  return { directory, names, artifacts, json };
}

async function chain(planPath, planSha256) {
  const plan = await readProof(planPath, planSha256); await validateCctpPlan(plan.data);
  const value = plan.data, native = await verifyNativeRecipe(value.nativeRecipePath, value.nativeRecipeSha256, { scenarioSet: "source-coverage" });
  const stack = await readProof(value.stackReceiptPath, value.stackReceiptSha256), owner = await readProof(value.ownerFixturePath, value.ownerFixtureSha256);
  requireValue(stack.data.schemaVersion === "army-local-native-stack-1" && stack.data.status === "ready" && stack.data.runtime === "native" && stack.data.pgTapPassed === true &&
    stack.data.apiUrl === value.apiUrl && stack.data.nativeRecipePath === value.nativeRecipePath && stack.data.nativeRecipeSha256 === value.nativeRecipeSha256, "CCTP stack chain differs.");
  same(stack.data.target, native.data.target, "CCTP native target differs from stack.");
  requireValue(owner.data.schemaVersion === "army-local-owner-fixture-1" && owner.data.status === "ready" && owner.data.apiUrl === value.apiUrl &&
    owner.data.nativeRecipeSha256 === value.nativeRecipeSha256 && owner.data.ordinaryLoginVerified === true && owner.data.adminMembershipVerified === true && owner.data.laborRateCents === 4000,
  "CCTP existing ordinary owner chain differs.");
  same(owner.data.owner, value.owner, "CCTP owner identity changed.");
  for (const [file, hash] of [["seed-source-coverage-native.py", value.nativeHelperSha256], ["local-native.py", value.nativeSupportSha256], ["seed-generated-prerequisites.py", value.nativePrimitivesSha256]]) {
    requireValue(digestPattern.test(hash ?? "") && sha256(await readFile(path.join(root, "scripts/tester-army", file))) === hash, "CCTP reviewed executable SHA differs.");
  }
  return { plan, native, stack, owner };
}

async function phaseProof(options, bound) {
  const { receiptPath, receiptSha256, phase } = options, proof = await readProof(receiptPath, receiptSha256), value = proof.data, plan = bound.plan.data;
  requireValue(["prepare", "finalize"].includes(phase) && value.schemaVersion === "army-local-cctp-seed-1" && value.status === "verified" &&
    value.phase === phase && value.transactionState === "commit_verified" && value.planPath === options.planPath && value.planSha256 === options.planSha256 &&
    value.apiUrl === plan.apiUrl && value.approvalReference === plan.approvalReference && value.plannedRows === 176 &&
    ["businessDataPreserved", "exactPlannedAdditionsVerified", "catalogueAndPrivilegesPreserved", "independentReadbackVerified"].every((k) => value[k] === true), "Executed CCTP seed phase required.");
  same(value.owner, plan.owner, "CCTP phase owner differs."); same(value.target, bound.native.data.target.identity, "CCTP phase DB identity differs.");
  const evidence = await archive(proof);
  const before = await evidence.json("before.json"), committed = await evidence.json("after-before-commit.json"), independent = await evidence.json("after-independent.json");
  same(committed, independent, "CCTP independent committed readback differs."); same(before.guards, committed.guards, "CCTP catalogue/history/rights changed.");
  const nativeInstalled = JSON.parse(await readFile(path.join(path.dirname(bound.native.file), "after-independent.json"), "utf8"));
  same(before.guards, nativeInstalled.guards, "CCTP guards differ from qualified native stack.");
  inventory(before.data); inventory(committed.data);
  const bucket = await evidence.json("bucket.json");
  const labor = await evidence.json("labor-role.json");
  same(assertCctpLaborSelection(labor.roles, plan.owner), labor.selected, "CCTP native effective labor selection differs.");
  requireValue(bucket.id === "affaire-intake" && bucket.public === false &&
    (bucket.allowed_mime_types === null || bucket.allowed_mime_types?.includes("application/pdf")) &&
    (bucket.file_size_limit === null || Number.isInteger(bucket.file_size_limit) && bucket.file_size_limit >= 4370), "CCTP existing private PDF bucket differs.");
  const requiredSources = ["scripts/tester-army/seed-source-coverage-native.py", "scripts/tester-army/local-native.py", "scripts/tester-army/seed-generated-prerequisites.py",
    "scripts/tester-army/cctp-seed-plan.mjs", "scripts/tester-army/cctp-seed-proof.mjs", "scripts/tester-army/local-recipe-common.mjs", options.planPath,
    plan.ownerFixturePath, plan.stackReceiptPath, plan.nativeRecipePath, `${path.posix.dirname(plan.nativeRecipePath)}/after-independent.json`,
    "scripts/tester-army/local-native-catalog.sql", "scripts/tester-army/local-native-privileges.sql", "e2e/fixtures/source-coverage/manifest.json",
    "e2e/fixtures/source-coverage/A/ARMY-CCTP-calorifuge.pdf", "e2e/fixtures/source-coverage/B/ARMY-CCTP-calorifuge.pdf"];
  if (phase === "finalize") requiredSources.push(value.preparePath, `${path.posix.dirname(value.preparePath)}/after-independent.json`, `${path.posix.dirname(value.preparePath)}/prerequisites.json`);
  requireValue(Array.isArray(value.sources) && value.sources.length === requiredSources.length && new Set(value.sources.map((s) => s.path)).size === requiredSources.length,
  "CCTP exact source inventory required.");
  same(value.sources.map((s) => s.path).sort(), requiredSources.sort(), "CCTP seed source inventory differs.");
  for (const source of value.sources) {
    requireValue(evidence.names.has(source.copy) && digestPattern.test(source.sha256 ?? ""), "CCTP copied source missing.");
    const actual = path.resolve(root, source.path), physical = await realpath(actual);
    requireValue(physical === actual && !(await lstat(actual)).isSymbolicLink() && sha256(await readFile(actual)) === source.sha256 &&
      sha256(await readFile(path.join(evidence.directory, source.copy))) === source.sha256, "CCTP seed source bytes changed.");
  }
  if (phase === "prepare") {
    const records = await evidence.json("prerequisites.json"), audits = await evidence.json("derived-audits.json"), counterBefore = await evidence.json("counter-before.json"), counterAfter = await evidence.json("counter-after.json");
    validateRecords(records, plan); validateAudits(audits, records, plan.owner);
    requireValue(value.derivedAuditCount === 110 && counterBefore.row?.tenant_id === plan.owner.tenantId &&
      Object.keys(counterBefore.row).sort().join() === "last_value,reference_year,tenant_id" && Number.isInteger(counterBefore.row.last_value) && counterBefore.row.last_value >= 0 &&
      Number.isInteger(counterBefore.row.reference_year) && digestPattern.test(counterBefore.hash ?? "") && digestPattern.test(counterAfter.hash ?? ""), "CCTP exact existing counter required.");
    same(counterAfter.row, { ...counterBefore.row, last_value: counterBefore.row.last_value + 11 }, "CCTP reference counter changed beyond eleven projects.");
    const projects = records.filter((r) => r.table === "estimate_projects").map((r) => r.row);
    projects.forEach((project, index) => requireValue(new RegExp(`^HEX_D${String(counterBefore.row.reference_year % 100).padStart(2, "0")}${String(counterBefore.row.last_value + index + 1).padStart(3, "0")}[A-Z]{2}$`).test(project.estimate_reference), "CCTP project reference escaped exact sequence."));
    same(value.referenceCounterException, { tenantId: plan.owner.tenantId, year: counterBefore.row.reference_year, before: counterBefore.row.last_value,
      after: counterBefore.row.last_value + 11, delta: 11, assignedReferences: projects.map((r) => r.estimate_reference) }, "CCTP counter exception receipt differs.");
    const allowed = allowance(records); allowed["public.audit_logs"] = allowance(audits.map((r) => ({ ...r, table: "audit_logs" })))["public.audit_logs"];
    validateCctpDelta(removeHashes(before.data, "private.estimate_reference_counters", [counterBefore]), removeHashes(committed.data, "private.estimate_reference_counters", [counterAfter]), allowed);
    return { ...proof, ...evidence, before, after: committed, records, audits, bound };
  }
  requireValue(value.uploadedObjectCount === 22 && value.documentTransitionCount === 22 && value.ordinaryUploadOwnerVerified === true &&
    value.preparePath === options.preparePath && value.prepareSha256 === options.prepareSha256, "CCTP finalize preparation chain differs.");
  const prepared = await phaseProof({ ...options, receiptPath: value.preparePath, receiptSha256: value.prepareSha256, phase: "prepare" }, bound);
  const uploads = await evidence.json("storage-objects.json"), docsBefore = await evidence.json("documents-before.json"), docsAfter = await evidence.json("documents-after.json");
  same(prepared.after.guards, before.guards, "CCTP guards changed between prepare and uploads.");
  validateCctpUploads(uploads, plan);
  requireValue(uploads.every((r) => digestPattern.test(r.hash ?? "")), "CCTP Storage fingerprint differs.");
  validateCctpDelta(prepared.after.data, before.data, { "storage.objects": Object.fromEntries(uploads.map((r) => [r.hash, 1])) });
  same(docsBefore, prepared.records.filter((r) => r.table === "affaire_intake_documents"), "CCTP finalization documents differ from prepared records.");
  validateCctpTransitions(docsBefore, docsAfter);
  validateCctpDelta(removeHashes(before.data, "public.affaire_intake_documents", docsBefore), removeHashes(committed.data, "public.affaire_intake_documents", docsAfter), {});
  return { ...proof, ...evidence, before, after: committed, uploads, docsBefore, docsAfter, prepared, bound };
}

export async function verifyCctpSeedPhase(options) {
  const bound = await chain(options.planPath, options.planSha256);
  return phaseProof(options, bound);
}

export async function verifyCctpSeed({ planPath, planSha256, preparePath, prepareSha256, finalizePath, finalizeSha256 }) {
  const bound = await chain(planPath, planSha256);
  const finalize = await phaseProof({ planPath, planSha256, preparePath, prepareSha256, receiptPath: finalizePath, receiptSha256: finalizeSha256, phase: "finalize" }, bound);
  const evidence = [{ name: "cctp-native-prepare-seed-receipt.json", file: finalize.prepared.file, sha256: prepareSha256 },
    { name: "cctp-native-finalize-seed-receipt.json", file: finalize.file, sha256: finalizeSha256 }, ...finalize.prepared.artifacts, ...finalize.artifacts];
  return { plan: bound.plan, native: bound.native, stack: bound.stack, owner: bound.owner, prepare: finalize.prepared, finalize,
    evidence, artifacts: evidence };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), values = {};
    requireValue(args.shift() === "--verify-phase", "Use --verify-phase with explicit plan/receipt SHA and phase; no database access.");
    for (let i = 0; i < args.length; i += 2) {
      requireValue(["--plan", "--plan-sha", "--receipt", "--receipt-sha", "--phase", "--prepare-proof", "--prepare-sha"].includes(args[i]) && args[i + 1] && !Object.hasOwn(values, args[i]), "Explicit unique reader arguments required.");
      values[args[i]] = args[i + 1];
    }
    const proof = await verifyCctpSeedPhase({ planPath: values["--plan"], planSha256: values["--plan-sha"], receiptPath: values["--receipt"], receiptSha256: values["--receipt-sha"],
      phase: values["--phase"], preparePath: values["--prepare-proof"], prepareSha256: values["--prepare-sha"] });
    console.log(JSON.stringify({ status: "verified-offline", databaseAccess: false, phase: proof.data.phase, sha256: proof.sha256 }));
  } catch { console.error("CCTP seed evidence refused; no database access."); process.exitCode = 3; }
}
