// Proposals only; admissions are defined before code in generated-ouvrage-components-e2e.md.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { validateComponentsPlan } from "./generated-components-plan.mjs";
import { assertCctpLaborSelection } from "./cctp-seed-plan.mjs";
import { verifyNativeRecipe } from "./local-native-proof.mjs";
import { ignoredFile, readProof, requireValue, sha256, relativePath, repositoryRoot as root, redactOutput } from "./local-recipe-common.mjs";

requireValue(["24", "26"].includes(process.versions.node.split(".")[0]) && process.argv.length === 4 && process.argv[3] === "--execute", "Supply exact component plan and --execute under Node 24 or 26.");
const file = await ignoredFile(process.argv[2]), bytes = await readFile(file), plan = validateComponentsPlan(JSON.parse(bytes));
requireValue(process.env.NEXT_PUBLIC_SUPABASE_URL === plan.apiUrl && process.env.E2E_ALLOWED_SUPABASE_HOST === new URL(plan.apiUrl).hostname &&
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD"].every((key) => process.env[key]?.trim()), "Explicit ordinary local environment required.");
const native = await verifyNativeRecipe(plan.nativeRecipePath, plan.nativeRecipeSha256);
requireValue(plan.nativeNodePath === native.config.data.nodePath, "Native Node differs from qualified config.");
const stack = await readProof(plan.stackReceiptPath, plan.stackReceiptSha256), owner = await readProof(plan.ownerFixturePath, plan.ownerFixtureSha256);
requireValue(stack.data.status === "ready" && stack.data.apiUrl === plan.apiUrl && stack.data.nativeRecipeSha256 === native.sha256 &&
  isDeepStrictEqual(stack.data.target, native.data.target) && owner.data.status === "ready" && owner.data.apiUrl === plan.apiUrl && isDeepStrictEqual(owner.data.owner, plan.owner), "Qualified exact native stack/owner required.");
const directory = path.dirname(file), receiptFile = path.join(directory, "seed-receipt.json");
const sources = ["scripts/tester-army/seed-generated-components.mjs", "scripts/tester-army/seed-generated-components.py", "scripts/tester-army/generated-components-plan.mjs", "scripts/tester-army/seed-generated-prerequisites.py"];
const sourceProof = await Promise.all(sources.map(async (p) => ({ path: p, sha256: sha256(await readFile(path.join(root, p))) })));
requireValue(sourceProof[1].sha256 === plan.nativeHelperSha256 && sourceProof[3].sha256 === plan.nativePrimitivesSha256, "Reviewed component seed sources changed.");
const receipt = { schemaVersion: "army-generated-components-seed-1", status: "requested", phase: "ordinary_admission", startedAt: new Date().toISOString(),
  command: { executable: process.execPath, args: process.argv.slice(1) }, planPath: relativePath(file), planSha256: sha256(bytes), sources: sourceProof,
  owner: plan.owner, apiUrl: plan.apiUrl, nativeRecipeSha256: native.sha256, noAuthAdmin: true, noServiceClient: true,
  limits: ["Prerequisites only, no human decision/application/snapshot/library/final line.", "No repair, migration, reset, model, email or automatic retry.", "Native conservation begins after ordinary login; Auth session metadata is excluded."] };
await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
const save = () => writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
const client = createClient(plan.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const select = async (table, column, value) => { const result = await client.from(table).select("*").eq(column, value).order("id"); requireValue(!result.error, "Ordinary prerequisite read failed."); return result.data; };
try {
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD });
  requireValue(!login.error && login.data.user?.id === plan.owner.userId, "Existing ordinary component owner differs; no provisioning.");
  const memberships = await select("tenant_memberships", "id", plan.owner.membershipId), tenants = await select("tenants", "id", plan.owner.tenantId);
  requireValue(memberships.length === 1 && memberships[0].user_id === plan.owner.userId && memberships[0].tenant_id === plan.owner.tenantId && memberships[0].role === "admin" && tenants.length === 1 && tenants[0].is_active, "Existing admin/active tenant differs; no repair.");
  const laborRoles = await select("labor_roles", "tenant_id", plan.owner.tenantId), selectedLaborRole = assertCctpLaborSelection(laborRoles, plan.owner);
  receipt.phase = "native_seed_requested"; await save();
  const helper = path.join(root, "scripts/tester-army/seed-generated-components.py"), normalized = helper.replaceAll("\\", "/"), linux = /^[A-Za-z]:\//.test(normalized) ? `/mnt/${normalized[0].toLowerCase()}${normalized.slice(2)}` : normalized;
  const args = [linux, "--plan", relativePath(file), "--plan-sha", sha256(bytes), "--execute"], executable = process.platform === "win32" ? "wsl.exe" : "python3";
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,60}$/.test(plan.nativeDistribution), "Explicit WSL distribution required.");
  receipt.nativeCommand = { executable, args: process.platform === "win32" ? ["-d", plan.nativeDistribution, "--", "python3", ...args] : args }; await save();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, receipt.nativeCommand.args, { cwd: root, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Native component seed expired; preserve ambiguous outcome, no retry.")); }, 240_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Native component seed could not start.")); });
    child.once("exit", (status) => { clearTimeout(timer); resolve(status); });
  });
  receipt.nativeExitCode = code; await save(); requireValue(code === 0, "Native component seed failed; retain exact receipt, no retry.");
  const nativeFile = path.join(directory, "native-seed/receipt.json"), nativeBytes = await readFile(nativeFile), seeded = JSON.parse(nativeBytes);
  requireValue(seeded.status === "verified" && seeded.phase === "commit_verified" && seeded.planSha256 === sha256(bytes) && seeded.stackReceiptSha256 === plan.stackReceiptSha256 &&
    ["businessDataPreserved", "exactPlannedAdditionsVerified", "catalogueAndPrivilegesPreserved", "independentReadbackVerified"].every((key) => seeded[key] === true), "Native component prerequisites unqualified.");
  const records = [];
  for (const expected of plan.records) {
    const r = expected.row;
    let query = client.from(expected.table).select("*");
    query = r.id ? query.eq("id", r.id) : query.eq("candidate_id", r.candidate_id).eq("source_fragment_id", r.source_fragment_id).eq("source_rank", r.source_rank);
    const result = await query;
    requireValue(!result.error && result.data.length === 1 && Object.entries(r).every(([key, value]) => isDeepStrictEqual(result.data[0][key], value)), "Ordinary component prerequisite differs from plan.");
    records.push({ table: expected.table, row: result.data[0] });
  }
  const empty = [];
  for (const s of [...plan.scenarios, plan.reuse]) for (const table of ["estimate_generated_ouvrage_applications", "estimate_generated_ouvrage_work_snapshots"]) {
    const rows = await select(table, "target_version_id", s.versionId); requireValue(rows.length === 0, "Final component result was preinserted."); empty.push({ table, versionId: s.versionId, rows });
  }
  const rolesAfter = await select("labor_roles", "tenant_id", plan.owner.tenantId);
  requireValue(isDeepStrictEqual(assertCctpLaborSelection(rolesAfter, plan.owner), selectedLaborRole), "Effective RMO changed during seed.");
  const readbackFile = path.join(directory, "readback.json"); await writeFile(readbackFile, JSON.stringify({ records, empty, laborRoles: rolesAfter, selectedLaborRole }, null, 2) + "\n", { flag: "wx" });
  receipt.nativePrerequisites = { file: relativePath(nativeFile), sha256: sha256(nativeBytes) };
  receipt.readback = { file: relativePath(readbackFile), sha256: sha256(await readFile(readbackFile)) };
  receipt.status = "ready"; receipt.phase = "ordinary_readback_verified"; receipt.finishedAt = new Date().toISOString(); await save();
  const fixture = { ...plan, schemaVersion: "estimate-generated-components-fixture-1", status: "ready", planPath: relativePath(file), planSha256: sha256(bytes),
    nativePrerequisites: receipt.nativePrerequisites, readback: receipt.readback, seedReceiptPath: relativePath(receiptFile), seedReceiptSha256: sha256(await readFile(receiptFile)) };
  const fixtureFile = path.join(directory, "fixture.json"); await writeFile(fixtureFile, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: "ready", fixture: { file: relativePath(fixtureFile), sha256: sha256(await readFile(fixtureFile)) } }));
} catch (error) { receipt.status = "failed-or-ambiguous-no-retry"; receipt.error = redactOutput(error.message); await save(); throw new Error(receipt.error); }
finally { const logout = await client.auth.signOut({ scope: "local" }); requireValue(!logout.error, "Ordinary observer local sign-out failed."); }
