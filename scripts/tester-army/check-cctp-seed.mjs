// Failure contract written before the native CCTP seed and its reader.
// These vectors test refusal/parsing only, never a database qualification.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { repositoryRoot as root, sha256, relativePath } from "./local-recipe-common.mjs";

const directory = path.join(root, ".e2e/retro-runtime/cctp-seed-checks", randomUUID());
await mkdir(directory, { recursive: true });
const results = [];
let proof;
async function check(name, action) {
  try {
    if (name !== "reader capability available") assert.ok(proof, "Reader capability unavailable; refusal vectors were not executed");
    await action(); results.push({ name, passed: true });
  }
  catch (error) { results.push({ name, passed: false, error: error.name === "AssertionError" ? error.message : "Offline capability unavailable or refused" }); }
}
await check("reader capability available", async () => { proof = await import("./cctp-seed-proof.mjs"); });
const table = (hashes) => ({ schema: "public", name: "example", rows: Object.values(hashes).reduce((a, b) => a + b, 0), hashes });
await check("new rows conserve duplicate old row fingerprints", async () => {
  proof.validateCctpDelta([table({ old: 2 })], [table({ old: 2, new: 1 })], { "public.example": { new: 1 } });
  assert.throws(() => proof.validateCctpDelta([table({ old: 2 })], [table({ old: 1, new: 2 })], { "public.example": { new: 1 } }));
});
await check("deletion and unplanned addition cannot hide in equal row counts", async () => {
  assert.throws(() => proof.validateCctpDelta([table({ old: 1 })], [table({ other: 1 })], {}));
  assert.throws(() => proof.validateCctpDelta([table({ old: 1 })], [table({ old: 1, extra: 1 })], {}));
});
await check("inventory duplication removal and allowance outside inventory refused", async () => {
  const before = [table({ old: 1 })];
  for (const after of [[], [table({ old: 1 }), table({ old: 1 })], [{ ...table({ old: 1 }), name: "other" }]]) {
    assert.throws(() => proof.validateCctpDelta(before, after, {}));
  }
  assert.throws(() => proof.validateCctpDelta(before, before, { "private.other": { extra: 1 } }));
});
await check("row counts and multiset frequencies must describe actual inventory", async () => {
  for (const wrong of [{ ...table({ old: 1 }), rows: 2 }, table({ old: -1 }), table({ old: 0 }), table({ old: 1.5 })]) {
    assert.throws(() => proof.validateCctpDelta([table({ old: 1 })], [wrong], {}));
  }
});
const userId = randomUUID(), tenantId = randomUUID();
const uploadPlan = { owner: { userId, tenantId }, records: [{ table: "affaire_intake_documents", row: {
  id: randomUUID(), storage_path: `${tenantId}/new-project/new-upload/new-doc/fixture.pdf`, size_bytes: 4352,
} }] };
const object = { row: { id: randomUUID(), bucket_id: "affaire-intake", name: uploadPlan.records[0].row.storage_path,
  owner: userId, owner_id: userId, metadata: { mimetype: "application/pdf", size: 4352 } }, hash: "new-object" };
await check("only new owned Storage objects with exact PDF metadata accepted", async () => {
  proof.validateCctpUploads([object], uploadPlan);
  for (const patch of [{ bucket_id: "public" }, { owner_id: randomUUID() }, { owner: randomUUID() },
    { name: "outside/fixture.pdf" }, { metadata: { mimetype: "text/html", size: 4352 } },
    { metadata: { mimetype: "application/pdf", size: 4353 } }]) {
    assert.throws(() => proof.validateCctpUploads([{ ...object, row: { ...object.row, ...patch } }], uploadPlan));
  }
});
await check("missing duplicate and additional Storage rows refused", async () => {
  for (const wrong of [[], [object, object], [object, { ...object, row: { ...object.row, id: randomUUID(), name: "other" } }]]) {
    assert.throws(() => proof.validateCctpUploads(wrong, uploadPlan));
  }
});
const prepared = [{ table: "affaire_intake_documents", hash: "pending-hash", row: { id: randomUUID(), upload_status: "pending", updated_at: "before", file_name: "fixture.pdf" } }];
const finalized = [{ ...prepared[0], hash: "uploaded-hash", row: { ...prepared[0].row, upload_status: "uploaded", updated_at: "after" } }];
await check("only document upload status and its updated timestamp may change", async () => {
  proof.validateCctpTransitions(prepared, finalized);
  for (const wrong of [{ ...finalized[0], row: { ...finalized[0].row, file_name: "other.pdf" } },
    { ...finalized[0], row: { ...finalized[0].row, upload_status: "rejected" } },
    { ...finalized[0], row: { ...finalized[0].row, id: randomUUID() } }]) {
    assert.throws(() => proof.validateCctpTransitions(prepared, [wrong]));
  }
});
await check("missing duplicated or non-document transition refused", async () => {
  for (const wrong of [[], [finalized[0], finalized[0]], [{ ...finalized[0], table: "estimate_items" }]]) {
    assert.throws(() => proof.validateCctpTransitions(prepared, wrong));
  }
});
await check("claimed verified receipt without exact evidence cannot qualify", async () => {
  const file = path.join(directory, "unqualified-receipt.json"), bytes = JSON.stringify({
    schemaVersion: "army-local-cctp-seed-1", status: "verified", phase: "prepare", transactionState: "commit_verified",
    businessDataPreserved: true, exactPlannedAdditionsVerified: true, catalogueAndPrivilegesPreserved: true,
    independentReadbackVerified: true,
  });
  await writeFile(file, bytes, { flag: "wx" });
  await assert.rejects(proof.verifyCctpSeedPhase({ receiptPath: relativePath(file), receiptSha256: sha256(bytes), phase: "prepare" }));
});
const receipt = { schemaVersion: "cctp-seed-offline-check-1", createdAt: new Date().toISOString(), databaseAccess: false,
  browserExecution: false, sources: [{ path: relativePath(fileURLToPath(import.meta.url)),
    sha256: sha256(await readFile(new URL(import.meta.url))) }], results,
  limits: ["Parser/conservation vectors only; no native, SQL, Storage, Auth, HTTP or browser qualification."] };
const file = path.join(directory, "receipt.json"); await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ passed: results.filter((r) => r.passed).length, total: results.length, receipt: relativePath(file), sha256: sha256(await readFile(file)) }));
if (results.some((r) => !r.passed)) process.exitCode = 3;
