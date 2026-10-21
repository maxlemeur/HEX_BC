// Generated-work prerequisites only. No final estimate line, application or snapshot.
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { verifyNativeRecipe } from "./local-native-proof.mjs";

const root = process.cwd();
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function owned(value) {
  const file = await realpath(path.resolve(root, value));
  if (!file.startsWith(await realpath(path.join(root, ".e2e")) + path.sep)) throw new Error("Owned ignored evidence path required.");
  return file;
}
async function proof(value, expected) {
  const file = await owned(value), bytes = await readFile(file);
  if (!/^[0-9a-f]{64}$/.test(expected ?? "") || sha(bytes) !== expected) throw new Error("Explicit prerequisite SHA differs.");
  return JSON.parse(bytes.toString());
}
if (!["24", "26"].includes(process.versions.node.split(".")[0]) || process.argv.length !== 4 || process.argv[3] !== "--execute") throw new Error("Supply an explicit reviewed plan and --execute under Node 24 or 26.");
const planFile = await owned(process.argv[2]), bytes = await readFile(planFile), plan = JSON.parse(bytes.toString());
const recovery = plan.schemaVersion === "estimate-generated-recovery-plan-1";
const url = new URL(plan.apiUrl);
if ((!recovery && plan.schemaVersion !== "estimate-generated-atomic-plan-1") || plan.status !== "prepared-no-mutation" || !plan.approvalReference ||
  url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port || url.origin !== plan.apiUrl ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== url.origin || process.env.E2E_ALLOWED_SUPABASE_HOST !== url.hostname ||
  !plan.prefix?.startsWith("ARMY-GENERATED-ATOMIC-")) throw new Error("Explicit owned loopback plan required.");
const stack = await proof(plan.stackReceiptPath, plan.stackReceiptSha256);
const owner = await proof(plan.ownerFixturePath, plan.ownerFixtureSha256);
if (stack.status !== "ready" || stack.runtime !== "native" || stack.apiUrl !== plan.apiUrl || stack.pgTapPassed !== true ||
  owner.status !== "ready" || owner.apiUrl !== plan.apiUrl || JSON.stringify(owner.owner) !== JSON.stringify(plan.owner) ||
  !["userId", "tenantId", "laborRoleId"].every((key) => uuid.test(plan.owner?.[key] ?? ""))) throw new Error("Ready native stack and existing fixture owner required.");
const expectedLabels = recovery ? "lost,malformed,stale,partial,abandon" : "existing,fallback";
if (!Array.isArray(plan.scenarios) || plan.scenarios.map((s) => s.label).join() !== expectedLabels) throw new Error("Exact reviewed generated-work witnesses required.");
const candidatesFor = (s) => recovery ? s.candidates : [s];
if (recovery && plan.scenarios.some((s) => !Array.isArray(s.candidates) || s.candidates.length !== (s.label === "partial" ? 2 : 1) ||
  s.candidates.some((c, index) => c.unitCostHtCents !== (index === 0 ? 1000 : 2000) || !c.designation || !c.componentDesignation))) throw new Error("Recovery prerequisites differ from the pre-code oracle.");
const ids = plan.scenarios.flatMap((s) => [s.projectId, s.versionId, s.sectionId, s.draftId,
  ...candidatesFor(s).flatMap((c) => ["candidateId", "fragmentId", "subdetailId", "componentId"].map((key) => c[key]))]);
if (recovery) ids.push(...["projectId", "versionId", "sectionA", "sectionB"].map((key) => plan.generation?.[key]));
if (!ids.every((id) => uuid.test(id)) || new Set(ids).size !== ids.length) throw new Error("New independent UUIDs required.");
for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD"]) if (!process.env[key]) throw new Error(`Missing explicitly loaded ${key}.`);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const ordinary = createClient(plan.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
const nativeHelper = path.join(root, "scripts/tester-army/seed-generated-prerequisites.py");
if (sha(await readFile(nativeHelper)) !== plan.nativeHelperSha256) throw new Error("Reviewed native seed helper changed.");
if (!(plan.nativeRecipePath && plan.nativeRecipeSha256) && (!plan.generatedApplicationPath || !plan.generatedPgTapPath)) throw new Error("Current generated installation and pgTAP receipts are required.");
if (plan.nativeRecipePath || plan.nativeRecipeSha256) await verifyNativeRecipe(plan.nativeRecipePath, plan.nativeRecipeSha256);
const directory = path.dirname(planFile), receiptFile = path.join(directory, "seed-receipt.json");
const receipt = { status: "requested", startedAt: new Date().toISOString(), plan: path.relative(root, planFile), planSha256: sha(bytes),
  command: { executable: process.execPath, args: process.argv.slice(1) }, scriptSha256: sha(await readFile(new URL(import.meta.url))),
  apiUrl: plan.apiUrl, owner: plan.owner, stackReceiptSha256: plan.stackReceiptSha256, operations: [],
  limits: ["Prerequisites only; no final application, snapshot, assembly or estimate line is inserted.", "Existing fixture owner reused; no membership, role, configuration or historical project changed.", "No automatic retry, cleanup, model or email.", "Native conservation precedes ordinary login; Auth session metadata is outside the subsequent readback invariance claim."] };
await writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
const persist = () => writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n");
async function select(table, column, value, client = ordinary) {
  const result = await client.from(table).select("*").eq(column, value).order("id");
  if (result.error) throw new Error(`Read failed for ${table}: ${result.error.code}`);
  return result.data;
}
async function seedNative() {
  const normalized = nativeHelper.replaceAll("\\", "/");
  const wsl = /^[A-Za-z]:\//.test(normalized) ? `/mnt/${normalized[0].toLowerCase()}${normalized.slice(2)}` : normalized;
  const args = [wsl, "--plan", path.relative(root, planFile).replaceAll("\\", "/"), "--plan-sha", sha(bytes), "--execute"];
  const executable = process.platform === "win32" ? "wsl.exe" : "python3";
  const distribution = plan.nativeDistribution ?? "Ubuntu-24.04";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,60}$/.test(distribution)) throw new Error("Explicit native distribution is invalid.");
  const command = process.platform === "win32" ? ["-d", distribution, "--", "python3", ...args] : args;
  receipt.nativeCommand = { executable, args: command };
  await persist();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, command, { cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Native seed timed out; preserve its receipt, no retry.")); }, 240_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Native prerequisite process could not start.")); });
    child.once("exit", (code) => { clearTimeout(timer); resolve(code); });
  });
  receipt.nativeExitCode = code;
  await persist();
  if (code !== 0) throw new Error("Native prerequisite preparation failed or is ambiguous; inspect its owned receipt, no retry.");
  const nativeFile = await owned(path.join(directory, "native-seed/receipt.json"));
  const nativeBytes = await readFile(nativeFile), native = JSON.parse(nativeBytes.toString());
  if (native.status !== "verified" || native.phase !== "commit_verified" || native.planSha256 !== sha(bytes) ||
    native.stackReceiptSha256 !== plan.stackReceiptSha256 || native.apiUrl !== plan.apiUrl ||
    !["businessDataPreserved", "exactPlannedAdditionsVerified", "catalogueAndPrivilegesPreserved", "independentReadbackVerified"].every((key) => native[key] === true)) throw new Error("Native prerequisite evidence is incomplete.");
  receipt.nativePrerequisites = { file: path.relative(root, nativeFile), sha256: sha(nativeBytes) };
  await persist();
}
try {
  await seedNative();
  const login = await ordinary.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD });
  if (login.error || login.data.user?.id !== plan.owner.userId) throw new Error("Ordinary fixture identity differs.");
  const memberships = await select("tenant_memberships", "user_id", plan.owner.userId);
  if (!memberships.some((row) => row.tenant_id === plan.owner.tenantId && row.role === "admin")) throw new Error("Existing fixture membership differs.");
  const readback = [];
  if (recovery) {
    const g = plan.generation;
    const version = await select("estimate_versions", "id", g.versionId), items = await select("estimate_items", "version_id", g.versionId);
    const drafts = await select("estimate_generated_ouvrage_drafts", "target_version_id", g.versionId);
    const candidates = await select("estimate_generated_ouvrage_candidates", "target_version_id", g.versionId);
    const fragments = await select("estimate_generated_ouvrage_source_fragments", "project_id", g.projectId);
    const subdetails = await select("estimate_generated_ouvrage_subdetail_drafts", "target_version_id", g.versionId);
    const applications = await select("estimate_generated_ouvrage_applications", "target_version_id", g.versionId), snapshots = await select("estimate_generated_ouvrage_work_snapshots", "target_version_id", g.versionId);
    if (version.length !== 1 || version[0].total_ht_cents !== 0 || items.length !== 2 ||
      items.some((item) => ![g.sectionA, g.sectionB].includes(item.id) || item.item_type !== "section") ||
      drafts.length || candidates.length || fragments.length || subdetails.length || applications.length || snapshots.length) throw new Error("Generation witness is not empty.");
    readback.push({ label: "generation", version, items, drafts, candidates, fragments, subdetails, applications, snapshots });
  }
  for (const s of plan.scenarios) {
    const version = await select("estimate_versions", "id", s.versionId), items = await select("estimate_items", "version_id", s.versionId);
    const drafts = await select("estimate_generated_ouvrage_drafts", "id", s.draftId), candidates = await select("estimate_generated_ouvrage_candidates", "draft_id", s.draftId);
    const subdetails = await select("estimate_generated_ouvrage_subdetail_drafts", "draft_id", s.draftId), components = await select("estimate_generated_ouvrage_subdetail_items", "draft_id", s.draftId);
    const applications = await select("estimate_generated_ouvrage_applications", "target_version_id", s.versionId), snapshots = await select("estimate_generated_ouvrage_work_snapshots", "target_version_id", s.versionId);
    if (version.length !== 1 || version[0].discount_bp !== (recovery ? 0 : 1667) || version[0].total_ht_cents !== 0 || items.length !== 1 || items[0].id !== s.sectionId ||
      drafts[0]?.status !== "pending" || candidates.length !== candidatesFor(s).length || subdetails.length !== candidatesFor(s).length || components.length !== candidatesFor(s).length ||
      candidatesFor(s).some((c) => candidates.find((row) => row.id === c.candidateId)?.resolution_status !== "pending" ||
        subdetails.find((row) => row.id === c.subdetailId)?.status !== "pending_review" ||
        components.find((row) => row.id === c.componentId)?.unit_cost_ht_cents !== (recovery ? c.unitCostHtCents : 3)) ||
      applications.length || snapshots.length) throw new Error("Ordinary prerequisite readback differs.");
    readback.push({ label: s.label, version, items, drafts, candidates, subdetails, components, applications, snapshots });
  }
  const readbackFile = path.join(directory, "readback.json");
  await writeFile(readbackFile, JSON.stringify(readback, null, 2) + "\n", { flag: "wx" });
  const fixture = { ...plan, schemaVersion: recovery ? "estimate-generated-recovery-fixture-1" : "estimate-generated-atomic-fixture-1", status: "ready", planPath: path.relative(root, planFile), planSha256: sha(bytes), preparedAt: new Date().toISOString(), nativePrerequisites: receipt.nativePrerequisites, readback: { file: path.relative(root, readbackFile), sha256: sha(await readFile(readbackFile)) } };
  const fixtureFile = path.join(directory, "fixture.json");
  await writeFile(fixtureFile, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
  Object.assign(receipt, { status: "ready", finishedAt: new Date().toISOString(), fixture: { file: path.relative(root, fixtureFile), sha256: sha(await readFile(fixtureFile)) } });
  await persist();
  console.log(JSON.stringify({ status: receipt.status, fixture: receipt.fixture }));
} catch (error) {
  receipt.status = "failed-or-ambiguous-no-retry"; receipt.error = error instanceof Error ? error.message : "Prerequisite preparation failed"; await persist(); throw error;
} finally {
  const logout = await ordinary.auth.signOut({ scope: "local" });
  if (logout.error) throw new Error("Ordinary observer local sign-out failed; no global sign-out attempted.");
}
