// A local recipe has explicit stages. Failed/ambiguous stages are retained,
// never selected as latest, repaired, retried, reset or silently skipped.
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { assertRecipeHost, ignoredFile, loopbackOrigin, newEvidenceDirectory, nonSecretMetadata, readProof, redactOutput, relativePath, repositoryRoot as root, requireValue, sha256, sqlInventory } from "./local-recipe-common.mjs";
import { verifyNativeRecipe } from "./local-native-proof.mjs";
import { loadCoverageProfile } from "./coverage-profile.mjs";
import { newCctpPlan, assertCctpLaborSelection } from "./cctp-seed-plan.mjs";
import { newComponentsPlan } from "./generated-components-plan.mjs";
import { componentSelections, isNumericSelection } from "./generated-numeric-plan.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jsonBytes = (value) => JSON.stringify(value, null, 2) + "\n";
const saveNew = (file, value) => writeFile(file, jsonBytes(value), { flag: "wx" });
const fileProof = async (file) => ({ path: relativePath(file), sha256: sha256(await readFile(file)) });
const linuxPath = (file) => /^[A-Za-z]:[\\/]/.test(file) ? `/mnt/${file[0].toLowerCase()}${file.slice(2).replaceAll("\\", "/")}` : file;

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    requireValue(["--config", "--build", "--build-sha", "--run", "--execute"].includes(key) && !(key in result), "Unknown or duplicate recipe option.");
    result[key] = key === "--execute" ? true : args[++i];
    requireValue(result[key], "Recipe option requires its explicit value.");
  }
  return result;
}

async function configuration(args) {
  const opts = options(args);
  requireValue(opts["--config"], "Explicit --config under .e2e is required.");
  const file = await ignoredFile(opts["--config"]), bytes = await readFile(file), value = JSON.parse(bytes);
  nonSecretMetadata(value);
  requireValue(value.schemaVersion === "army-local-recipe-1" && /^[a-z0-9][a-z0-9-]{2,70}$/.test(value.campaign ?? "") && value.approvalReference?.trim(), "Explicit local campaign and authorization reference are required.");
  const scenarioSet = value.scenarioSet ?? "generated-recovery";
  requireValue(["generated-recovery", "source-coverage", "generated-components"].includes(scenarioSet), "Unknown local recipe scenarioSet.");
  requireValue(scenarioSet !== "generated-components" || componentSelections.includes(value.componentSelection), "Explicit component selection required.");
  const backend = loopbackOrigin(value.backendOrigin), app = loopbackOrigin(value.appOrigin);
  requireValue(app.hostname === "localhost", "App origin must use localhost for Next hydration.");
  requireValue(/^[a-zA-Z0-9][a-zA-Z0-9.-]{1,60}$/.test(value.native?.distribution ?? "") || process.platform !== "win32", "Explicit native WSL distribution required.");
  const native = await readProof(value.native?.configPath, value.native?.configSha256);
  nonSecretMetadata(native.data);
  requireValue(native.data.schemaVersion === "army-local-native-config-1" && native.data.apiUrl === backend.origin && native.data.nodePath === value.native.nodePath, "Native configuration and backend/Node path differ.");
  requireValue(Object.keys(value.owner ?? {}).sort().join() === "laborRoleId,membershipId,tenantId,userId" && Object.values(value.owner).every((id) => uuid.test(id)), "Explicit existing owner/admin/4000 labor-role UUIDs required.");
  return { opts, file, bytes, value, scenarioSet, native, backend, app, directory: path.join(root, ".e2e/army/recipes/campaigns", value.campaign) };
}

async function child(executable, args, env = process.env, timeout = 1_800_000) {
  let output = "";
  const code = await new Promise((resolve, reject) => {
    const processChild = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    processChild.stdout.on("data", (bytes) => { output += bytes.toString(); });
    processChild.stderr.on("data", (bytes) => { output += bytes.toString(); });
    const timer = setTimeout(() => { processChild.kill(); reject(new Error("Stage observation expired; preserve exact receipt and inspect process before any retry.")); }, timeout);
    processChild.once("error", () => { clearTimeout(timer); reject(new Error("Recipe child could not start; inspect requested receipt.")); });
    processChild.once("exit", (status) => { clearTimeout(timer); resolve(status); });
  });
  return { exitCode: code, output: redactOutput(output, env) };
}

async function stage(c, name, command, action) {
  const file = path.join(c.directory, `${name}-stage-receipt.json`);
  const receipt = { schemaVersion: "army-local-recipe-stage-1", status: "requested", stage: name, startedAt: new Date().toISOString(),
    configSha256: sha256(c.bytes), approvalReference: c.value.approvalReference, command,
    limits: ["This stage alone does not qualify another stage or the application.", "No automatic retry after an interrupted or ambiguous stage."] };
  await saveNew(file, receipt);
  try { await action(receipt); receipt.status = "completed"; }
  catch (error) { receipt.status = "failed-or-ambiguous-no-retry"; receipt.error = redactOutput(error.message); throw error; }
  finally { receipt.finishedAt = new Date().toISOString(); await writeFile(file, jsonBytes(receipt)); }
  console.log(JSON.stringify({ status: receipt.status, stage: name, receipt: await fileProof(file), ...receipt.result }));
}

async function assertPlan(c) {
  const plan = JSON.parse(await readFile(await ignoredFile(relativePath(path.join(c.directory, "recipe-plan.json"))), "utf8"));
  requireValue(plan.configSha256 === sha256(c.bytes) && plan.nativeConfigSha256 === c.native.sha256 && (plan.scenarioSet ?? "generated-recovery") === c.scenarioSet, "Recipe configuration changed after its plan.");
}

async function qualified(c) {
  const file = path.join(c.directory, "native/receipt.json"), proof = await fileProof(file);
  return verifyNativeRecipe(proof.path, proof.sha256, { scenarioSet: c.scenarioSet === "generated-components" ? "generated-recovery" : c.scenarioSet });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.join() === "--help") {
    console.log("Local recipe stages: plan, native, seed, profile, collect, run, read. Every stage requires --config .e2e/<explicit-config.json>; native/seed/run additionally --execute. Build separately: build-local.mjs --execute. profile additionally --build <exact-manifest> --build-sha <sha>; read --run <exact-terminal-run>. No reset, migration, provisioning or automatic retry.");
    return;
  }
  assertRecipeHost();
  const name = args.shift();
  requireValue(["plan", "native", "seed", "profile", "collect", "run", "read"].includes(name), "Unknown local recipe stage.");
  const c = await configuration(args), command = { executable: process.execPath, args: process.argv.slice(1) };
  const allowed = name === "profile" ? ["--config", "--build", "--build-sha"] : name === "read" ? ["--config", "--run"] : ["native", "seed", "run"].includes(name) ? ["--config", "--execute"] : ["--config"];
  requireValue(Object.keys(c.opts).every((key) => allowed.includes(key)), "Recipe options do not belong to this explicit stage.");
  requireValue(!["native", "seed", "run"].includes(name) || c.opts["--execute"] === true, "Mutating or executing stage requires explicit --execute.");
  if (name === "plan") {
    requireValue(Object.keys(c.opts).join() === "--config", "Plan accepts only --config; it performs no backend action.");
    const directory = await newEvidenceDirectory("army/recipes/campaigns", c.value.campaign);
    await saveNew(path.join(directory, "recipe-plan.json"), { schemaVersion: "army-local-recipe-plan-1", status: "prepared-no-mutation", command,
      configPath: relativePath(c.file), configSha256: sha256(c.bytes), nativeConfigPath: relativePath(c.native.file), nativeConfigSha256: c.native.sha256,
      owner: c.value.owner, scenarioSet: c.scenarioSet, approvalReference: c.value.approvalReference, backendOrigin: c.backend.origin, appOrigin: c.app.origin,
      migrationInventory: await sqlInventory(path.join(root, "supabase/migrations")), testInventory: await sqlInventory(path.join(root, "supabase/tests")),
      preconditions: ["Local native stack is already started, unlinked and has the current repository SQL migrations/tests installed.", "Existing ordinary test owner is active admin with explicit 4000 labor role and reference counter.", "Coordinate an exclusive SQL/browser window; no seed/runtime/schema mutation in parallel."] });
    console.log(JSON.stringify({ status: "planned-no-mutation", plan: await fileProof(path.join(directory, "recipe-plan.json")) }));
    return;
  }
  await assertPlan(c);
  if (name === "native") {
    const helper = linuxPath(path.join(root, "scripts/tester-army/local-native.py"));
    const args = [helper, "--config", relativePath(c.native.file), "--config-sha", c.native.sha256, "--output", relativePath(path.join(c.directory, "native")), "--approval-reference", c.value.approvalReference, "--scenario-set", c.scenarioSet === "generated-components" ? "generated-recovery" : c.scenarioSet, "--execute"];
    const executable = process.platform === "win32" ? "wsl.exe" : "python3";
    const nativeArgs = process.platform === "win32" ? ["-d", c.value.native.distribution, "--", "python3", ...args] : args;
    await stage(c, name, { executable, args: nativeArgs }, async (receipt) => {
      const result = await child(executable, nativeArgs, process.env, 900_000);
      receipt.exitCode = result.exitCode;
      await writeFile(path.join(c.directory, "native-stage.log"), result.output, { flag: "wx" });
      requireValue(result.exitCode === 0, "Native qualification failed; inspect exact native receipt, no retry.");
      const proof = await qualified(c);
      const stack = { schemaVersion: "army-local-native-stack-1", status: "ready", runtime: "native", apiUrl: c.backend.origin,
        target: proof.data.target, pgTapPassed: true, nativeRecipePath: relativePath(proof.file), nativeRecipeSha256: proof.sha256 };
      const stackFile = path.join(c.directory, "stack.json");
      await saveNew(stackFile, stack); receipt.result = { native: await fileProof(proof.file), stack: await fileProof(stackFile) };
    });
    return;
  }
  if (name === "seed") {
    const proof = await qualified(c), stack = await fileProof(path.join(c.directory, "stack.json"));
    requireValue(process.env.NEXT_PUBLIC_SUPABASE_URL === c.backend.origin && process.env.E2E_ALLOWED_SUPABASE_HOST === c.backend.hostname &&
      ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD"].every((key) => process.env[key]?.trim()), "Explicit ordinary local env is required; no env-file fallback.");
    await stage(c, name, command, async (receipt) => {
      const ordinary = createClient(c.backend.origin, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      try {
        const login = await ordinary.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL, password: process.env.E2E_LOGIN_PASSWORD });
        requireValue(!login.error && login.data.user?.id === c.value.owner.userId, "Existing ordinary owner login differs; no provisioning.");
        const memberships = await ordinary.from("tenant_memberships").select("id,user_id,tenant_id,role").eq("id", c.value.owner.membershipId);
        const coverage = c.scenarioSet === "source-coverage";
        const components = c.scenarioSet === "generated-components";
        const selectedLabor = coverage || components;
        const role = selectedLabor ? await ordinary.from("labor_roles").select("id,tenant_id,user_id,hourly_rate_cents,is_active,position").eq("tenant_id", c.value.owner.tenantId).eq("user_id", c.value.owner.userId).eq("is_active", true).order("position", { ascending: true }).order("id", { ascending: true })
          : await ordinary.from("labor_roles").select("id,tenant_id,hourly_rate_cents").eq("id", c.value.owner.laborRoleId);
        const tenant = await ordinary.from("tenants").select("id,is_active").eq("id", c.value.owner.tenantId);
        requireValue(!memberships.error && memberships.data.length === 1 && memberships.data[0].user_id === c.value.owner.userId &&
          memberships.data[0].tenant_id === c.value.owner.tenantId && memberships.data[0].role === "admin" && !role.error && (selectedLabor ? role.data.length > 0 : role.data.length === 1) &&
          role.data[0].tenant_id === c.value.owner.tenantId && role.data[0].hourly_rate_cents === 4000 && !tenant.error && tenant.data.length === 1 && tenant.data[0].is_active,
        "Existing ordinary admin/active tenant/4000 labor role is missing; no repair.");
        if (selectedLabor) assertCctpLaborSelection(role.data, c.value.owner);
        const prefix = `${coverage ? "ARMY-COVERAGE" : components ? "ARMY-GENERATED-COMPONENTS" : "ARMY-GENERATED-ATOMIC"}-${c.value.campaign.toUpperCase()}`;
        const ownerFile = path.join(c.directory, "owner-fixture.json");
        await saveNew(ownerFile, { schemaVersion: "army-local-owner-fixture-1", status: "ready", prefix, apiUrl: c.backend.origin, owner: c.value.owner,
          ordinaryLoginVerified: true, adminMembershipVerified: true, laborRateCents: 4000, nativeRecipeSha256: proof.sha256, observedAt: new Date().toISOString() });
        const chain = {
          ownerFixturePath: relativePath(ownerFile), ownerFixtureSha256: sha256(await readFile(ownerFile)),
          stackReceiptPath: stack.path, stackReceiptSha256: stack.sha256, nativeRecipePath: relativePath(proof.file), nativeRecipeSha256: proof.sha256,
          nativeDistribution: c.value.native.distribution, nativeSupportSha256: sha256(await readFile(path.join(root, "scripts/tester-army/local-native.py"))) };
        const plan = coverage ? await newCctpPlan({ campaign: c.value.campaign, prefix, apiUrl: c.backend.origin, owner: c.value.owner, approvalReference: c.value.approvalReference, ...chain,
          nativeHelperSha256: sha256(await readFile(path.join(root, "scripts/tester-army/seed-source-coverage-native.py"))),
          nativePrimitivesSha256: sha256(await readFile(path.join(root, "scripts/tester-army/seed-generated-prerequisites.py"))) }) : components ? newComponentsPlan({
          campaign: c.value.campaign, prefix, apiUrl: c.backend.origin, owner: c.value.owner, approvalReference: c.value.approvalReference, ...chain,
          selection: c.value.componentSelection, nativeNodePath: c.value.native.nodePath,
          nativeHelperSha256: sha256(await readFile(path.join(root, "scripts/tester-army/seed-generated-components.py"))),
          nativePrimitivesSha256: sha256(await readFile(path.join(root, "scripts/tester-army/seed-generated-prerequisites.py"))) }) : { schemaVersion: "estimate-generated-recovery-plan-1", status: "prepared-no-mutation", approvalReference: c.value.approvalReference,
          prefix, apiUrl: c.backend.origin, ownerFixturePath: relativePath(ownerFile), ownerFixtureSha256: sha256(await readFile(ownerFile)), owner: c.value.owner,
          stackReceiptPath: stack.path, stackReceiptSha256: stack.sha256, nativeRecipePath: relativePath(proof.file), nativeRecipeSha256: proof.sha256,
          nativeDistribution: c.value.native.distribution, nativeHelperSha256: sha256(await readFile(path.join(root, "scripts/tester-army/seed-generated-prerequisites.py"))),
          nativeSupportSha256: sha256(await readFile(path.join(root, "scripts/tester-army/local-native.py"))),
          scenarios: ["lost", "malformed", "stale", "partial", "abandon"].map((label) => ({ label, projectId: randomUUID(), versionId: randomUUID(), sectionId: randomUUID(), draftId: randomUUID(),
            candidates: Array.from({ length: label === "partial" ? 2 : 1 }, (_, index) => ({ candidateId: randomUUID(), fragmentId: randomUUID(), subdetailId: randomUUID(), componentId: randomUUID(),
              designation: `${prefix} ${label} ouvrage ${index + 1}`, componentDesignation: `${prefix} ${label} fourniture ${index + 1}`, unitCostHtCents: index === 0 ? 1000 : 2000 })) })),
          generation: { projectId: randomUUID(), versionId: randomUUID(), sectionA: randomUUID(), sectionB: randomUUID() } };
        const planFile = path.join(c.directory, "plan.json");
        await saveNew(planFile, plan);
        const result = await child(process.execPath, coverage ? ["scripts/tester-army/seed-source-coverage.mjs", "--existing-owner-plan", relativePath(planFile), "--execute"] : [components ? "scripts/tester-army/seed-generated-components.mjs" : "scripts/tester-army/seed-generated-atomic.mjs", relativePath(planFile), "--execute"], process.env, coverage ? 900_000 : 360_000);
        receipt.exitCode = result.exitCode;
        await writeFile(path.join(c.directory, "seed-stage.log"), result.output, { flag: "wx" });
        requireValue(result.exitCode === 0, "Seed failed or is ambiguous; inspect native-seed/receipt.json and seed-receipt.json, no retry.");
        receipt.result = { fixture: await fileProof(path.join(c.directory, "fixture.json")), owner: await fileProof(ownerFile) };
      } finally { const logout = await ordinary.auth.signOut({ scope: "local" }); requireValue(!logout.error, "Observer local sign-out failed."); }
    });
    return;
  }
  if (name === "profile") {
    requireValue(c.opts["--build"] && c.opts["--build-sha"], "Profile requires explicit --build and --build-sha.");
    const native = await qualified(c), build = await readProof(c.opts["--build"], c.opts["--build-sha"]);
    const owner = await fileProof(path.join(c.directory, "owner-fixture.json")), fixture = await fileProof(path.join(c.directory, "fixture.json")), stack = await fileProof(path.join(c.directory, "stack.json"));
    await stage(c, name, command, async (receipt) => {
      const coverage = c.scenarioSet === "source-coverage";
      const profile = { schemaVersion: "army-source-coverage-profile-1", scope: "source-coverage", scenarioSet: c.scenarioSet, approvalReference: c.value.approvalReference,
        ...(c.scenarioSet === "generated-components" ? { componentSelection: c.value.componentSelection } : {}),
        serverMode: "production", backendOrigin: c.backend.origin, appOrigin: c.app.origin, fixturePath: coverage ? fixture.path : owner.path, fixtureSha256: coverage ? fixture.sha256 : owner.sha256,
        buildProofPath: c.opts["--build"], buildProofSha256: build.sha256, buildOriginPlatform: build.data.platform,
        stackReceiptPath: stack.path, stackReceiptSha256: stack.sha256, nativeRecipePath: relativePath(native.file), nativeRecipeSha256: native.sha256,
        ...(coverage ? { ownerFixturePath: owner.path, ownerFixtureSha256: owner.sha256 } : { generatedFixturePath: fixture.path, generatedFixtureSha256: fixture.sha256 }) };
      const file = path.join(c.directory, "profile.json");
      await saveNew(file, profile);
      const verified = await loadCoverageProfile(root, { configuredPath: relativePath(file) });
      receipt.result = { profile: await fileProof(file), proofCount: verified.evidence.length };
    });
    return;
  }
  const profile = path.join(c.directory, "profile.json");
  await stat(profile);
  if (name === "collect" || name === "run") {
    await stage(c, name, command, async (receipt) => {
      const env = { ...process.env, E2E_COVERAGE_PROFILE_PATH: relativePath(profile) };
      const result = await child(process.execPath, ["scripts/run-tester-army.mjs", name === "collect" ? "coverage-list" : "coverage"], env);
      receipt.exitCode = result.exitCode;
      const file = path.join(c.directory, `${name}-stage.log`); await writeFile(file, result.output, { flag: "wx" });
      receipt.result = { output: await fileProof(file) };
      requireValue(result.exitCode === 0, `${name} failed; retain the exact TesterArmy run and inspect it. No automatic rerun.`);
    });
    return;
  }
  requireValue(c.opts["--run"], "Read requires an explicit --run; no latest run selection.");
  const runManifest = JSON.parse(await readFile(await ignoredFile(`${c.opts["--run"]}/manifest.json`), "utf8"));
  const archivedProfiles = runManifest.coverage?.evidence?.filter((entry) => path.basename(entry.path) === "profile.json") ?? [];
  requireValue(archivedProfiles.length === 1 && archivedProfiles[0].sha256 === sha256(await readFile(profile)), "Named run belongs to another campaign profile.");
  const archivedProfile = await ignoredFile(archivedProfiles[0].path);
  requireValue(sha256(await readFile(archivedProfile)) === archivedProfiles[0].sha256, "Named run campaign profile archive changed.");
  await stage(c, name, command, async (receipt) => {
    const reader = c.scenarioSet === "source-coverage" ? "qualify-source-coverage.mjs" : c.scenarioSet === "generated-components" ? isNumericSelection(c.value.componentSelection) ? "qualify-generated-numeric.mjs" : "qualify-generated-components.mjs" : "qualify-generated-recovery.mjs";
    const result = await child(process.execPath, [`scripts/tester-army/${reader}`, c.opts["--run"]], { ...process.env, E2E_COVERAGE_PROFILE_PATH: relativePath(profile) });
    receipt.exitCode = result.exitCode; const file = path.join(c.directory, "read-stage.log"); await writeFile(file, result.output, { flag: "wx" });
    receipt.result = { output: await fileProof(file) }; requireValue(result.exitCode === 0, "Exact scenario reader refused the run; preserve its qualification receipt.");
  });
}

main().catch((error) => { console.error(redactOutput(error.message)); process.exitCode = 3; });
