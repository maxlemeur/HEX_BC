// Reuse an explicit ordinary local owner. No AuthAdmin, service client or repair.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { repositoryRoot as root, assertRecipeHost, ignoredFile, readProof, requireValue, relativePath, sha256, redactOutput } from "./local-recipe-common.mjs";
import { verifyNativeRecipe } from "./local-native-proof.mjs";
import { validateCctpPlan, cctpCorpus, assertCctpLaborSelection } from "./cctp-seed-plan.mjs";

const bytes = (value) => JSON.stringify(value, null, 2) + "\n";
const proofOf = async (file) => ({ path: relativePath(file), sha256: sha256(await readFile(file)) });
const equalField = (actual, expected, key) => /^(?:completed_at|classified_at|manually_overridden_at)$/.test(key)
  ? Date.parse(actual) === Date.parse(expected) : isDeepStrictEqual(actual, expected);

export async function seedExistingCctp(planPath, { execute = false } = {}) {
  assertRecipeHost();
  const ownedPlan = await ignoredFile(planPath), planFile = await readProof(planPath, sha256(await readFile(ownedPlan))), plan = planFile.data;
  await validateCctpPlan(plan);
  const native = await verifyNativeRecipe(plan.nativeRecipePath, plan.nativeRecipeSha256, { scenarioSet: "source-coverage" });
  const owner = await readProof(plan.ownerFixturePath, plan.ownerFixtureSha256), stack = await readProof(plan.stackReceiptPath, plan.stackReceiptSha256);
  requireValue(owner.data.status === "ready" && owner.data.ordinaryLoginVerified === true && owner.data.adminMembershipVerified === true && owner.data.laborRateCents === 4000 &&
    owner.data.apiUrl === plan.apiUrl && isDeepStrictEqual(owner.data.owner, plan.owner) && owner.data.nativeRecipeSha256 === native.sha256 &&
    stack.data.schemaVersion === "army-local-native-stack-1" && stack.data.status === "ready" && stack.data.apiUrl === plan.apiUrl &&
    isDeepStrictEqual(stack.data.target, native.data.target) && stack.data.nativeRecipeSha256 === native.sha256, "Existing ordinary CCTP owner/stack differs.");
  for (const [file, expected] of [["seed-source-coverage-native.py", plan.nativeHelperSha256], ["local-native.py", plan.nativeSupportSha256], ["seed-generated-prerequisites.py", plan.nativePrimitivesSha256]]) {
    requireValue(sha256(await readFile(path.join(root, "scripts/tester-army", file))) === expected, "Reviewed native seed sources changed.");
  }
  if (!execute) { console.log(JSON.stringify({ status: "validated-offline", databaseAccess: false, plannedRows: plan.records.length })); return; }
  const url = new URL(plan.apiUrl);
  requireValue(process.env.NEXT_PUBLIC_SUPABASE_URL === url.origin && process.env.E2E_ALLOWED_SUPABASE_HOST === url.hostname &&
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD"].every((key) => process.env[key]?.trim()), "Explicit ordinary local environment required.");
  const directory = path.dirname(planFile.file), receiptFile = path.join(directory, "seed-receipt.json");
  const receipt = { schemaVersion: "army-local-cctp-seed-1", status: "requested", startedAt: new Date().toISOString(),
    command: { executable: process.execPath, args: process.argv.slice(1) }, plan: await proofOf(planFile.file), apiUrl: plan.apiUrl, owner: plan.owner,
    nativeRecipeSha256: native.sha256, uploads: [], pending: null, noAuthAdmin: true, noServiceClient: true,
    limits: ["New prerequisites and source PDFs only; no final business decision or retained reference is inserted.", "No retry, upsert, cleanup, compensation or repair; partial successful uploads remain owned witnesses.", "Native data conservation begins after ordinary login; other Auth session metadata is outside that claim."] };
  await writeFile(receiptFile, bytes(receipt), { flag: "wx" });
  const persist = () => writeFile(receiptFile, bytes(receipt));
  const sourceFiles = ["seed-source-coverage.mjs", "seed-source-coverage-existing.mjs", "cctp-seed-plan.mjs", "cctp-seed-proof.mjs", "seed-source-coverage-native.py", "seed-generated-prerequisites.py", "local-native.py"];
  const sourceSnapshot = await Promise.all(sourceFiles.map(async (name) => ({ name, data: await readFile(path.join(root, "scripts/tester-army", name)) })));
  const assertUnchanged = async () => {
    requireValue(sha256(await readFile(planFile.file)) === planFile.sha256 && (await cctpCorpus()).sha256 === plan.corpusSha256, "CCTP plan/corpus changed during seed.");
    for (const source of sourceSnapshot) requireValue(source.data.equals(await readFile(path.join(root, "scripts/tester-army", source.name))), "CCTP seed source changed during execution.");
  };
  const ordinary = createClient(plan.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let loggedIn = false;
  async function nativePhase(phase, prepared) {
    await assertUnchanged();
    const helper = path.join(root, "scripts/tester-army/seed-source-coverage-native.py").replaceAll("\\", "/");
    const linux = /^[A-Za-z]:\//.test(helper) ? `/mnt/${helper[0].toLowerCase()}${helper.slice(2)}` : helper;
    requireValue(process.platform !== "win32" || /^[a-zA-Z0-9][a-zA-Z0-9.-]{1,60}$/.test(plan.nativeDistribution ?? ""), "Explicit native distribution required.");
    const args = [linux, "--plan", relativePath(planFile.file), "--plan-sha", planFile.sha256, "--phase", phase, "--execute",
      ...(prepared ? ["--prepare-proof", prepared.path, "--prepare-sha", prepared.sha256] : [])];
    const executable = process.platform === "win32" ? "wsl.exe" : "python3";
    const argv = process.platform === "win32" ? ["-d", plan.nativeDistribution, "--", "python3", ...args] : args;
    let output = "";
    const env = { ...process.env }; delete env.SUPABASE_SERVICE_ROLE_KEY;
    const status = await new Promise((resolve, reject) => {
      const child = spawn(executable, argv, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (chunk) => output += chunk.toString()); child.stderr.on("data", (chunk) => output += chunk.toString());
      child.once("error", () => reject(new Error("Native seed process failed before observation."))); child.once("exit", resolve);
    });
    await writeFile(path.join(directory, `native-seed-${phase}.log`), redactOutput(output), { flag: "wx" });
    requireValue(status === 0, "Native seed failed or commit is ambiguous; preserve its terminal receipt.");
    const proof = await proofOf(path.join(directory, `native-seed-${phase}/seed-receipt.json`));
    const { verifyCctpSeedPhase } = await import("./cctp-seed-proof.mjs");
    await verifyCctpSeedPhase({ planPath: relativePath(planFile.file), planSha256: planFile.sha256, receiptPath: proof.path, receiptSha256: proof.sha256, phase,
      ...(prepared ? { preparePath: prepared.path, prepareSha256: prepared.sha256 } : {}) });
    return proof;
  }
  try {
    const login = await ordinary.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD });
    requireValue(!login.error && login.data.user?.id === plan.owner.userId && login.data.session?.access_token, "Existing ordinary owner login differs.");
    loggedIn = true;
    receipt.nativePrepare = await nativePhase("prepare"); await persist();
    const { corpus } = await cctpCorpus();
    for (const scenario of plan.scenarios) for (const source of scenario.sources) {
      await assertUnchanged();
      const pdf = corpus.get(source.revision), pathname = `/storage/v1/object/affaire-intake/${source.storagePath}`;
      receipt.pending = { scenario: scenario.label, revision: source.revision, documentId: source.documentId, storagePath: source.storagePath, phase: "upload-requested" }; await persist();
      const response = await fetch(new URL(pathname, plan.apiUrl), { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${login.data.session.access_token}`, "Content-Type": "application/pdf", "x-upsert": "false" }, body: pdf.bytes });
      requireValue(response.ok, `Owned source upload failed with HTTP ${response.status}; no retry.`);
      // Do not retain credential-bearing headers or response bodies.
      await response.arrayBuffer();
      receipt.uploads.push({ ...receipt.pending, status: response.status, sha256: pdf.sha256, bytes: pdf.bytes.length, pageCount: 3, upsert: false });
      receipt.pending = null; await persist();
    }
    receipt.nativeFinalize = await nativePhase("finalize", receipt.nativePrepare); await persist();
    const roles = await ordinary.from("labor_roles").select("*").eq("tenant_id", plan.owner.tenantId).eq("user_id", plan.owner.userId).eq("is_active", true)
      .order("position", { ascending: true }).order("id", { ascending: true });
    requireValue(!roles.error, "Ordinary effective labor-role readback failed.");
    const readback = { records: [], pdfs: [], emptyBusiness: [], laborRoles: roles.data, selectedLaborRole: assertCctpLaborSelection(roles.data, plan.owner) };
    for (const expected of plan.records) {
      let request = ordinary.from(expected.table).select("*");
      for (const key of expected.row.id ? ["id"] : ["tenant_id", "draft_id", "candidate_id", "source_fragment_id"]) request = request.eq(key, expected.row[key]);
      const result = await request.limit(2);
      const wanted = expected.table === "affaire_intake_documents" ? { ...expected.row, upload_status: "uploaded" } : expected.row;
      requireValue(!result.error && result.data.length === 1 && Object.entries(wanted).every(([key, value]) => equalField(result.data[0][key], value, key)), "Ordinary CCTP prerequisite readback differs.");
      readback.records.push({ table: expected.table, row: result.data[0] });
    }
    for (const scenario of plan.scenarios) {
      const groups = [];
      for (const [table, column, id] of [["estimate_generated_ouvrage_applications", "target_version_id", scenario.versionId], ["estimate_generated_ouvrage_work_snapshots", "target_version_id", scenario.versionId], ["affaire_register_entries", "project_id", scenario.projectId]]) {
        const result = await ordinary.from(table).select("id").eq("tenant_id", plan.owner.tenantId).eq(column, id);
        requireValue(!result.error && result.data.length === 0, "Ordinary CCTP final business prerequisites must be empty."); groups.push({ table, rows: result.data });
      }
      readback.emptyBusiness.push({ label: scenario.label, groups });
      for (const source of scenario.sources) {
        const downloaded = await ordinary.storage.from("affaire-intake").download(source.storagePath);
        requireValue(!downloaded.error && downloaded.data, "Ordinary source PDF readback failed.");
        const data = Buffer.from(await downloaded.data.arrayBuffer()), expected = corpus.get(source.revision), pdf = await PDFDocument.load(data);
        requireValue(data.equals(expected.bytes) && sha256(data) === expected.sha256 && pdf.getPageCount() === 3 && !pdf.isEncrypted, "Ordinary source bytes/pages differ.");
        const file = path.join(directory, `source-${scenario.label}-${source.revision}.pdf`); await writeFile(file, data, { flag: "wx" });
        readback.pdfs.push({ label: scenario.label, revision: source.revision, documentId: source.documentId, storagePath: source.storagePath,
          ...await proofOf(file), bytes: data.length, pageCount: 3, ordinary: true });
      }
    }
    await assertUnchanged();
    const readbackFile = path.join(directory, "readback.json"); await writeFile(readbackFile, bytes(readback), { flag: "wx" });
    receipt.readback = await proofOf(readbackFile);
    receipt.sources = sourceSnapshot.map((source) => ({ path: `scripts/tester-army/${source.name}`, sha256: sha256(source.data) }));
    receipt.status = "ready"; receipt.finishedAt = new Date().toISOString(); await persist();
    const fixture = { schemaVersion: "source-coverage-fixture-1", status: "ready", prefix: plan.prefix, apiUrl: plan.apiUrl, owner: plan.owner,
      scenarios: Object.fromEntries(plan.scenarios.map((s) => [s.label, { projectId: s.projectId, versionId: s.versionId, sectionA: s.sectionA, sectionB: s.sectionB, draftId: s.draftId, candidateId: s.candidateId, designation: s.designation, documents: Object.fromEntries(s.sources.map((source) => [source.revision, source.documentId])) }])),
      corpus: Object.fromEntries([...corpus].map(([revision, pdf]) => [revision, { sha256: pdf.sha256, bytes: pdf.bytes.length, pageCount: 3 }])),
      ordinaryLoginVerified: true, adminMembershipVerified: true, laborRateCents: 4000, nativeRecipeSha256: native.sha256,
      planPath: relativePath(planFile.file), planSha256: planFile.sha256, nativePrepare: receipt.nativePrepare, nativeFinalize: receipt.nativeFinalize,
      readback: receipt.readback, seedReceiptPath: relativePath(receiptFile), seedReceiptSha256: sha256(await readFile(receiptFile)), approvalReference: plan.approvalReference };
    await writeFile(path.join(directory, "fixture.json"), bytes(fixture), { flag: "wx" });
    console.log(JSON.stringify({ status: "ready", fixture: await proofOf(path.join(directory, "fixture.json")), seedReceipt: await proofOf(receiptFile) }));
  } catch (error) {
    receipt.status = "failed-or-ambiguous-no-retry"; receipt.finishedAt = new Date().toISOString(); receipt.error = redactOutput(error.message); await persist(); throw error;
  } finally {
    if (loggedIn) { const logout = await ordinary.auth.signOut({ scope: "local" }); requireValue(!logout.error, "Ordinary local sign-out failed after seed; inspect retained result."); }
  }
}
