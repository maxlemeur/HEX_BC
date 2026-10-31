import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { verifyNativeRecipe } from "./local-native-proof.mjs";
import { buildCommands, buildSourceEvidence } from "./local-recipe-common.mjs";
import { cctpScenarios, cctpCorpus, validateCctpPlan, assertCctpLaborSelection } from "./cctp-seed-plan.mjs";
import { verifyCctpSeed } from "./cctp-seed-proof.mjs";
import { verifyComponentsSeed } from "./generated-components-proof.mjs";
import { componentSelections, isNumericSelection, numericCases, numericJourneys, numericDownloads } from "./generated-numeric-plan.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;

function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    !url.port || url.port === "0" || value !== url.origin) {
    throw new Error("Coverage requires an explicit loopback HTTP origin and fixed port.");
  }
  return url;
}

async function ownedPath(root, value, ignored = true) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    throw new Error("Coverage evidence paths must be relative to this checkout.");
  }
  const actualRoot = await realpath(root);
  const base = await realpath(ignored ? path.join(root, ".e2e") : root);
  const ownedBase = path.relative(actualRoot, base);
  if (ignored && (!ownedBase || ownedBase.startsWith("..") || path.isAbsolute(ownedBase))) {
    throw new Error("Coverage ignored evidence directory escaped this checkout.");
  }
  const file = await realpath(path.resolve(root, value));
  const relative = path.relative(base, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Coverage evidence escaped its owned directory.");
  }
  return file;
}

async function evidence(root, value, expectedSha256) {
  if (!digest.test(expectedSha256 ?? "")) throw new Error("Coverage evidence requires its explicit SHA-256.");
  const file = await ownedPath(root, value);
  const bytes = await readFile(file);
  if (hash(bytes) !== expectedSha256) throw new Error("Coverage evidence SHA-256 differs from its profile.");
  return { file, bytes, data: JSON.parse(bytes.toString()), path: value, sha256: expectedSha256 };
}

// Native receipts use WSL paths. Accept only the exact owned Windows path or
// its mechanical /mnt/<drive> equivalent, never an arbitrary suffix match.
function sameReceiptPath(reported, file) {
  const normalized = file.replaceAll("\\", "/");
  const wsl = /^[A-Za-z]:\//.test(normalized)
    ? `/mnt/${normalized[0].toLowerCase()}${normalized.slice(2)}` : normalized;
  return reported === normalized || reported === file || reported === wsl;
}

function safeMetadata(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/password|secret|token|cookie|authorization|service.?role|anon.?key/i.test(key)) {
      throw new Error("Coverage profile and fixture must not contain credentials.");
    }
    if (typeof child === "string" && /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(child)) {
      throw new Error("Coverage metadata must not contain session values.");
    }
    safeMetadata(child);
  }
}

async function installationArtifacts(root, application, prefix, { nested = false } = {}) {
  const entries = application.data.artifacts;
  if (!Array.isArray(entries) || !entries.length || new Set(entries.map((entry) => entry.name)).size !== entries.length) {
    throw new Error("Generated installation verification artifacts are missing or duplicated.");
  }
  const result = [];
  const directory = await realpath(path.dirname(application.file));
  for (const [index, entry] of entries.entries()) {
    if (typeof entry.name !== "string" || !entry.name || /[\\:]/.test(entry.name) || path.posix.isAbsolute(entry.name) ||
      entry.name.split("/").some((part) => !part || part === "." || part === "..") ||
      (!nested && path.basename(entry.name) !== entry.name) || !digest.test(entry.sha256 ?? "")) {
      throw new Error("Generated installation artifact is not an owned file.");
    }
    const file = await ownedPath(root, path.relative(root, path.join(path.dirname(application.file), entry.name)));
    const confined = path.relative(directory, file);
    if (!confined || confined.startsWith("..") || path.isAbsolute(confined)) throw new Error("Generated installation artifact escaped its receipt directory.");
    if (hash(await readFile(file)) !== entry.sha256) throw new Error("Generated installation artifact changed.");
    result.push({ name: nested ? `${prefix}-${index}-${path.basename(entry.name)}` : `${prefix}-${entry.name}`,
      file, sha256: entry.sha256, originalArtifactName: entry.name });
  }
  return result;
}

// This reads an explicitly supplied local profile; it never provisions fixtures,
// loads .env.local, installs a runtime or contacts the backend.
export async function loadCoverageProfile(root, { discoveryOnly = false, configuredPath = undefined } = {}) {
  if (!["26"].includes(process.versions.node.split(".")[0])) throw new Error("Coverage requires Node.js 26.");
  const configured = configuredPath ?? process.env.E2E_COVERAGE_PROFILE_PATH;
  if (!configured) throw new Error("E2E_COVERAGE_PROFILE_PATH is required; no default profile is allowed.");
  const profileFile = await ownedPath(root, configured);
  const bytes = await readFile(profileFile);
  const profile = JSON.parse(bytes.toString());
  safeMetadata(profile);
  const scenarioSet = profile.scenarioSet ?? "source-coverage";
  if (!["source-coverage", "create-atomic", "batch-atomic", "generated-atomic", "generated-recovery", "navigation-lease", "generated-components"].includes(scenarioSet)) throw new Error("Unknown explicit coverage scenario set.");
  const components = scenarioSet === "generated-components";
  if (components && !componentSelections.includes(profile.componentSelection)) throw new Error("Explicit component selection required.");
  const numeric = components && isNumericSelection(profile.componentSelection);
  const assemblyTotals = components && profile.componentSelection === "assembly-totals";
  const navigation = scenarioSet === "navigation-lease";
  const recovery = scenarioSet === "generated-recovery";
  const localRecipe = Boolean(profile.nativeRecipePath || profile.nativeRecipeSha256);
  const cctpRecipe = localRecipe && scenarioSet === "source-coverage";
  if (components && !localRecipe) throw new Error("Components require the autonomous native chain.");
  if (localRecipe && ((!recovery && !cctpRecipe && !components) || Object.keys(profile).some((key) => /^(?:(?:atomic|batch|generated)(?:Application|Correction|PgTap|PredecessorStack|InstalledStack|Fault)|nativeApplication|freshStack|sentinel)/.test(key)) ||
    (cctpRecipe && (profile.generatedFixturePath || profile.generatedFixtureSha256)))) throw new Error("Autonomous native recipe requires its exact separate scenario chain.");
  const generated = scenarioSet === "generated-atomic" || recovery;
  const generatedInstallation = Boolean(profile.generatedApplicationPath || profile.generatedApplicationSha256 ||
    profile.generatedPredecessorStackPath || profile.generatedPredecessorStackSha256 || profile.generatedPgTapPath || profile.generatedPgTapSha256 ||
    profile.generatedInstalledStackPath || profile.generatedInstalledStackSha256);
  const atomic = scenarioSet === "create-atomic" || scenarioSet === "batch-atomic" || generated || navigation;
  if (profile.schemaVersion !== "army-source-coverage-profile-1" ||
    profile.scope !== "source-coverage" || typeof profile.approvalReference !== "string" ||
    !profile.approvalReference.trim() || profile.serverMode !== "production") {
    throw new Error("An explicitly approved source-coverage production profile is required.");
  }
  const backend = localOrigin(profile.backendOrigin);
  const app = localOrigin(profile.appOrigin);
  if (app.hostname !== "localhost") throw new Error("Coverage app origin must use localhost for Next hydration.");
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== backend.origin ||
    process.env.E2E_ALLOWED_SUPABASE_HOST !== backend.hostname ||
    (process.env.E2E_ARMY_BASE_URL && process.env.E2E_ARMY_BASE_URL !== app.origin)) {
    throw new Error("Explicit environment, profile and authorized origins must match exactly.");
  }
  if (discoveryOnly) {
    return {
      env: { E2E_ARMY_BASE_URL: app.origin, E2E_ARMY_SERVER_MODE: "production", E2E_COVERAGE_BACKEND_ORIGIN: backend.origin, E2E_COVERAGE_SCENARIO_SET: scenarioSet,
        ...(components ? { E2E_GENERATED_COMPONENTS_SELECTION: profile.componentSelection } : {}) },
      evidence: [{ name: "profile.json", file: profileFile, sha256: hash(bytes) }],
      metadata: { profile: configured, approvalReference: profile.approvalReference, backendOrigin: backend.origin, appOrigin: app.origin,
        fixture: null, scenarioSet, fixtureStage: "not-verified-discovery-only", buildProof: null, buildOriginPlatform: null,
        executionPlatform: process.platform, expected: "Static collection only; no authentication, server, browser or database execution.", limits: ["No fixture readiness or build qualification inferred from discovery."] },
    };
  }
  for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", ...(!cctpRecipe ? ["SUPABASE_SERVICE_ROLE_KEY"] : []), "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD"]) {
    if (!process.env[key]?.trim()) throw new Error(`Coverage requires an explicitly loaded ${key}.`);
  }
  // Reject a tampered build receipt before reading any fixture identities.
  const build = await evidence(root, profile.buildProofPath, profile.buildProofSha256);
  const fixture = await evidence(root, profile.fixturePath, profile.fixtureSha256);
  safeMetadata(fixture.data);
  if (fixture.data.schemaVersion !== (localRecipe && !cctpRecipe ? "army-local-owner-fixture-1" : atomic ? "estimate-create-atomic-fixture-1" : "source-coverage-fixture-1") || fixture.data.status !== "ready" ||
    fixture.data.apiUrl !== backend.origin || !fixture.data.prefix?.startsWith(localRecipe && !cctpRecipe ? components ? "ARMY-GENERATED-COMPONENTS-" : "ARMY-GENERATED-ATOMIC-" : atomic ? "ARMY-CREATE-ATOMIC-" : "ARMY-COVERAGE-") ||
    !["userId", "tenantId", "laborRoleId"].every((key) => uuid.test(fixture.data.owner?.[key] ?? ""))) {
    throw new Error("Coverage requires its own ready ARMY fixture and ordinary owner.");
  }
  if (atomic && !localRecipe && ["legacyV1", "legacySplitV1"].some((key) => !["projectId", "versionId"].every((field) => uuid.test(fixture.data[key]?.[field] ?? "")))) throw new Error("Atomic creation requires two distinct legacy witnesses.");
  if (atomic && !localRecipe && (fixture.data.legacyV1.versionId === fixture.data.legacySplitV1.versionId || fixture.data.legacyV1.projectId === fixture.data.legacySplitV1.projectId)) throw new Error("Atomic legacy witnesses must be independent.");
  const nativeEvidence = [];
  const batch = scenarioSet === "batch-atomic" || generated || navigation;
  if (localRecipe) {
    const native = await verifyNativeRecipe(profile.nativeRecipePath, profile.nativeRecipeSha256, { scenarioSet: components ? "generated-recovery" : scenarioSet });
    const stack = await evidence(root, profile.stackReceiptPath, profile.stackReceiptSha256);
    if (stack.data.schemaVersion !== "army-local-native-stack-1" || stack.data.status !== "ready" || stack.data.runtime !== "native" ||
      stack.data.pgTapPassed !== true || stack.data.apiUrl !== backend.origin || !isDeepStrictEqual(stack.data.target, native.data.target) ||
      stack.data.nativeRecipeSha256 !== native.sha256 || (await ownedPath(root, stack.data.nativeRecipePath)) !== native.file ||
      fixture.data.ordinaryLoginVerified !== true || fixture.data.adminMembershipVerified !== true || fixture.data.laborRateCents !== 4000 ||
      fixture.data.nativeRecipeSha256 !== native.sha256) throw new Error("Autonomous native stack/ordinary owner differs from its executed qualification.");
    nativeEvidence.push({ name: "native-recipe.json", file: native.file, sha256: native.sha256 }, ...native.artifacts,
      { name: "native-config.json", file: native.config.file, sha256: native.config.sha256 }, { name: "stack.json", file: stack.file, sha256: stack.sha256 });
    if (cctpRecipe) {
      const owner = await evidence(root, profile.ownerFixturePath, profile.ownerFixtureSha256), value = fixture.data;
      if (owner.data.schemaVersion !== "army-local-owner-fixture-1" || owner.data.status !== "ready" || owner.data.apiUrl !== backend.origin ||
        !isDeepStrictEqual(owner.data.owner, value.owner) || owner.data.ordinaryLoginVerified !== true || owner.data.adminMembershipVerified !== true ||
        owner.data.laborRateCents !== 4000 || owner.data.nativeRecipeSha256 !== native.sha256 || owner.data.prefix !== value.prefix ||
        !isDeepStrictEqual(Object.keys(value.scenarios).sort(), [...cctpScenarios].sort())) throw new Error("CCTP exact existing owner and eleven scenarios are required.");
      const plan = await evidence(root, value.planPath, value.planSha256); await validateCctpPlan(plan.data);
      if (plan.data.ownerFixtureSha256 !== owner.sha256 || plan.data.nativeRecipeSha256 !== native.sha256 || plan.data.stackReceiptSha256 !== stack.sha256 ||
        plan.data.prefix !== value.prefix || !isDeepStrictEqual(plan.data.owner, value.owner) || plan.data.apiUrl !== backend.origin) throw new Error("CCTP plan belongs to another qualified owner/campaign.");
      const expectedScenarios = Object.fromEntries(plan.data.scenarios.map((s) => [s.label, { projectId: s.projectId, versionId: s.versionId, sectionA: s.sectionA, sectionB: s.sectionB,
        draftId: s.draftId, candidateId: s.candidateId, designation: s.designation, documents: Object.fromEntries(s.sources.map((source) => [source.revision, source.documentId])) }]));
      if (!isDeepStrictEqual(value.scenarios, expectedScenarios)) throw new Error("CCTP fixture prerequisite identities differ from its exact plan.");
      const seed = await verifyCctpSeed({ planPath: value.planPath, planSha256: value.planSha256, preparePath: value.nativePrepare.path, prepareSha256: value.nativePrepare.sha256,
        finalizePath: value.nativeFinalize.path, finalizeSha256: value.nativeFinalize.sha256 });
      const receipt = await evidence(root, value.seedReceiptPath, value.seedReceiptSha256), readback = await evidence(root, value.readback.path, value.readback.sha256);
      if (!isDeepStrictEqual(assertCctpLaborSelection(readback.data.laborRoles, value.owner), readback.data.selectedLaborRole)) throw new Error("CCTP ordinary effective labor-role readback differs.");
      if (receipt.data.schemaVersion !== "army-local-cctp-seed-1" || receipt.data.status !== "ready" || receipt.data.nativeRecipeSha256 !== native.sha256 ||
        receipt.data.plan.sha256 !== plan.sha256 || !isDeepStrictEqual(receipt.data.owner, value.owner) || receipt.data.apiUrl !== backend.origin || receipt.data.pending !== null ||
        receipt.data.noAuthAdmin !== true || receipt.data.noServiceClient !== true || !isDeepStrictEqual(receipt.data.nativePrepare, value.nativePrepare) ||
        !isDeepStrictEqual(receipt.data.nativeFinalize, value.nativeFinalize) || !isDeepStrictEqual(receipt.data.readback, value.readback)) throw new Error("CCTP ordinary seed receipt is incomplete or mixed.");
      for (const source of receipt.data.sources) {
        if (hash(await readFile(await ownedPath(root, source.path, false))) !== source.sha256) throw new Error("CCTP seed sources changed.");
      }
      const corpus = await cctpCorpus();
      if (!isDeepStrictEqual(value.corpus, Object.fromEntries([...corpus.corpus].map(([revision, pdf]) => [revision, { sha256: pdf.sha256, bytes: pdf.bytes.length, pageCount: 3 }]))) ||
        readback.data.records.length !== plan.data.records.length || readback.data.pdfs.length !== 22 || receipt.data.uploads.length !== 22 || readback.data.emptyBusiness.length !== 11) throw new Error("CCTP source corpus/readback is incomplete.");
      const pdfEvidence = [];
      for (const s of plan.data.scenarios) for (const source of s.sources) {
        const matches = readback.data.pdfs.filter((entry) => entry.label === s.label && entry.revision === source.revision), uploads = receipt.data.uploads.filter((entry) => entry.scenario === s.label && entry.revision === source.revision);
        const pdf = corpus.corpus.get(source.revision);
        if (matches.length !== 1 || uploads.length !== 1 || matches[0].documentId !== source.documentId || matches[0].storagePath !== source.storagePath || matches[0].sha256 !== pdf.sha256 ||
          matches[0].bytes !== pdf.bytes.length || matches[0].pageCount !== 3 || matches[0].ordinary !== true || uploads[0].storagePath !== source.storagePath || uploads[0].documentId !== source.documentId ||
          uploads[0].sha256 !== pdf.sha256 || uploads[0].bytes !== pdf.bytes.length || uploads[0].upsert !== false || uploads[0].status < 200 || uploads[0].status >= 300) throw new Error("CCTP exact ordinary source upload/readback differs.");
        const file = await ownedPath(root, matches[0].path);
        if (!pdf.bytes.equals(await readFile(file))) throw new Error("CCTP ordinary retained PDF bytes differ.");
        pdfEvidence.push({ name: `cctp-source-${s.label}-${source.revision}.pdf`, file, sha256: pdf.sha256 });
      }
      for (const expected of plan.data.records) {
        const matches = readback.data.records.filter((entry) => entry.table === expected.table && (expected.row.id ? entry.row.id === expected.row.id : entry.row.candidate_id === expected.row.candidate_id));
        if (matches.length !== 1 || Object.entries(expected.row).some(([key, wanted]) => {
          const actual = matches[0].row[key];
          return expected.table === "affaire_intake_documents" && key === "upload_status" ? actual !== "uploaded" : /^(?:completed_at|classified_at|manually_overridden_at)$/.test(key)
            ? Date.parse(actual) !== Date.parse(wanted) : !isDeepStrictEqual(actual, wanted);
        })) throw new Error("CCTP ordinary prerequisite records differ.");
      }
      if (!isDeepStrictEqual(readback.data.emptyBusiness.map((s) => s.label), cctpScenarios) || readback.data.emptyBusiness.some((s) =>
        !isDeepStrictEqual(s.groups.map((g) => g.table), ["estimate_generated_ouvrage_applications", "estimate_generated_ouvrage_work_snapshots", "affaire_register_entries"]) || s.groups.some((g) => g.rows.length))) throw new Error("CCTP business results must not be preinserted.");
      nativeEvidence.push({ name: "cctp-owner.json", file: owner.file, sha256: owner.sha256 }, { name: "cctp-plan.json", file: plan.file, sha256: plan.sha256 },
        { name: "cctp-seed.json", file: receipt.file, sha256: receipt.sha256 }, { name: "cctp-readback.json", file: readback.file, sha256: readback.sha256 }, ...seed.evidence, ...pdfEvidence);
    }
  } else {
  if (recovery && !generatedInstallation) throw new Error("Generated recovery requires its explicit installed product chain.");
  if (generatedInstallation && (!batch || !profile.generatedApplicationPath || !profile.generatedApplicationSha256 ||
    !profile.generatedPredecessorStackPath || !profile.generatedPredecessorStackSha256 || !profile.batchPgTapPath)) {
    throw new Error("Generated execution requires the exact qualified batch predecessor and installation pair.");
  }
  if (batch && (!profile.atomicApplicationPath || !profile.atomicCorrectionPath || !profile.atomicPgTapPath ||
    !profile.atomicPredecessorStackPath || !profile.batchApplicationPath)) {
    throw new Error("Batch execution requires the explicit predecessor and installed batch evidence chain.");
  }
  if (!atomic && (profile.stackReceiptPath || profile.stackReceiptSha256)) {
    const stack = await evidence(root, profile.stackReceiptPath, profile.stackReceiptSha256);
    if (stack.data.status !== "ready" || stack.data.runtime !== "native" || stack.data.apiUrl !== backend.origin) throw new Error("Coverage transport does not match the current ready local stack.");
    nativeEvidence.push({ name: "stack.json", file: stack.file, sha256: stack.sha256 });
  }
  if (profile.atomicApplicationPath || profile.atomicApplicationSha256) {
    if (!atomic) throw new Error("Atomic application evidence requires its scenario set.");
    const installed = await evidence(root, profile.atomicApplicationPath, profile.atomicApplicationSha256);
    const stack = await evidence(root, batch ? profile.atomicPredecessorStackPath : profile.stackReceiptPath,
      batch ? profile.atomicPredecessorStackSha256 : profile.stackReceiptSha256);
    if (installed.data.status !== "verified" || installed.data.phase !== "commit_verified" || installed.data.apiUrl !== backend.origin ||
      stack.data.status !== "ready" || stack.data.apiUrl !== backend.origin || installed.data.stackDirectory !== stack.data.stackDirectory ||
      installed.data.target?.dbPort !== stack.data.ports?.["54322"] ||
      !/^\d{14}_atomic_create_estimate_item\.sql$/.test(installed.data.migration?.file ?? "")) throw new Error("Atomic application and transport evidence differ from the profile.");
    const migration = await ownedPath(root, `supabase/migrations/${installed.data.migration.file}`, false);
    if (hash(await readFile(migration)) !== installed.data.migration.sha256) throw new Error("Atomic migration source differs from its installed evidence.");
    nativeEvidence.push({ name: "atomic-application.json", file: installed.file, sha256: installed.sha256 },
      { name: batch ? "atomic-predecessor-stack.json" : "stack.json", file: stack.file, sha256: stack.sha256 });
    if (profile.atomicCorrectionPath || profile.atomicCorrectionSha256) {
      const correction = await evidence(root, profile.atomicCorrectionPath, profile.atomicCorrectionSha256);
      const value = correction.data;
      let finalTransportSha256 = value.transportReceiptSha256;
      if (profile.atomicPgTapPath || profile.atomicPgTapSha256) {
        const tested = await evidence(root, profile.atomicPgTapPath, profile.atomicPgTapSha256);
        const result = tested.data;
        if (result.status !== "verified" || result.exitCode !== 0 || result.rollbackVerified !== true || result.stackReceiptSha256 !== value.transportReceiptSha256 ||
          result.target?.systemIdentifier !== installed.data.target.systemIdentifier || result.target?.dbPort !== installed.data.target.dbPort ||
          stack.data.pgTapPassed !== true || result.files !== stack.data.pgTap?.files || result.tests !== stack.data.pgTap?.tests) throw new Error("Atomic pgTAP receipt does not continue this corrected stack.");
        finalTransportSha256 = result.transportReceiptSha256;
        nativeEvidence.push({ name: "atomic-pgtap.json", file: tested.file, sha256: tested.sha256 });
      }
      if (value.status !== "verified" || value.phase !== "commit_verified" || value.historyVerified !== true ||
        value.target?.systemIdentifier !== installed.data.target.systemIdentifier || value.target?.dbPort !== installed.data.target.dbPort ||
        finalTransportSha256 !== stack.sha256 || value.artifacts?.find((entry) => entry.name === "3-stack.json")?.sha256 !== installed.data.transportReceiptSha256 ||
        !/^\d{14}_guard_normalized_estimate_calculation_tenant\.sql$/.test(value.migration?.file ?? "")) throw new Error("Atomic correction does not continue its exact installation.");
      const file = await ownedPath(root, `supabase/migrations/${value.migration.file}`, false);
      if (hash(await readFile(file)) !== value.migration.sha256 || !stack.data.migrationInventory?.some((entry) => entry.name === value.migration.file && entry.sha256 === value.migration.sha256)) throw new Error("Atomic correction source or inventory differs.");
      nativeEvidence.push({ name: "atomic-correction.json", file: correction.file, sha256: correction.sha256 });
    } else if (installed.data.transportReceiptSha256 !== stack.sha256) throw new Error("Atomic transport changed without correction evidence.");
    if (batch) {
      const application = await evidence(root, profile.batchApplicationPath, profile.batchApplicationSha256);
      const current = await evidence(root, profile.batchPgTapPath ? profile.batchInstalledStackPath : profile.stackReceiptPath,
        profile.batchPgTapPath ? profile.batchInstalledStackSha256 : profile.stackReceiptSha256);
      const value = application.data, next = current.data;
      const flags = ["businessDataPreserved", "unrelatedCataloguePreserved", "expectedFunctionChangeVerified",
        "existingPrivilegesPreserved", "historyVerified", "bodiesAndAclVerified", "ledgerEmptyVerified", "schemaCacheReloadRequested"];
      if (value.status !== "verified" || value.phase !== "commit_verified" || !flags.every((key) => value[key] === true) ||
        !isDeepStrictEqual(value.expectedChangedFunctions, ["private.guard_estimate_calculation_context_write"]) ||
        value.previousStackReceiptSha256 !== stack.sha256 || value.predecessor?.stackReceiptSha256 !== stack.sha256 ||
        !sameReceiptPath(value.predecessor?.stackReceiptPath, stack.file) ||
        !isDeepStrictEqual(value.target, stack.data.identity) || value.apiUrl !== backend.origin || value.stackDirectory !== stack.data.stackDirectory ||
        value.transportReceiptSha256 !== current.sha256 || !sameReceiptPath(value.transportReceiptPath, current.file) ||
        !/^\d{14}_atomic_estimate_batch\.sql$/.test(value.migration?.file ?? "")) {
        throw new Error("Batch installation does not continue the exact verified CORE-08 predecessor.");
      }
      if (next.status !== "ready" || next.runtime !== "native" || next.apiUrl !== backend.origin || next.stackDirectory !== stack.data.stackDirectory ||
        next.projectId !== stack.data.projectId || next.configSha256 !== stack.data.configSha256 ||
        !isDeepStrictEqual(next.ports, stack.data.ports) || !isDeepStrictEqual(next.identity, stack.data.identity) ||
        next.predecessorStackReceipt?.sha256 !== stack.sha256 || !sameReceiptPath(next.predecessorStackReceipt?.path, stack.file) ||
        next.batchInstallation?.migrationSha256 !== value.migration.sha256 || !sameReceiptPath(next.batchInstallation?.receipt, application.file) ||
        next.migrationHistoryVerified !== true || next.pgTapPassed !== false || next.pgTap !== null ||
        next.priorPgTap?.passed !== true || !isDeepStrictEqual(next.priorPgTap?.result, stack.data.pgTap)) {
        throw new Error("Batch transport identity or explicit unqualified pgTAP state differs.");
      }
      const migration = await ownedPath(root, `supabase/migrations/${value.migration.file}`, false);
      if (hash(await readFile(migration)) !== value.migration.sha256 ||
        !Array.isArray(stack.data.migrationInventory) || !Array.isArray(next.migrationInventory) ||
        stack.data.migrationInventory.some((entry) => entry.name === value.migration.file) ||
        !isDeepStrictEqual([...next.migrationInventory].sort((a, b) => a.name.localeCompare(b.name)),
          [...stack.data.migrationInventory, { name: value.migration.file, sha256: value.migration.sha256 }].sort((a, b) => a.name.localeCompare(b.name)))) {
        throw new Error("Batch migration bytes or append-only inventory differs.");
      }
      if (!Array.isArray(value.artifacts) || !value.artifacts.length || new Set(value.artifacts.map((entry) => entry.name)).size !== value.artifacts.length) {
        throw new Error("Batch installation verification artifacts are missing or duplicated.");
      }
      for (const entry of value.artifacts) {
        if (typeof entry.name !== "string" || path.basename(entry.name) !== entry.name || /[\\/]/.test(entry.name) || !digest.test(entry.sha256 ?? "")) {
          throw new Error("Batch installation artifact is not an owned file.");
        }
        const file = await ownedPath(root, path.relative(root, path.join(path.dirname(application.file), entry.name)));
        if (hash(await readFile(file)) !== entry.sha256) throw new Error("Batch installation artifact changed.");
        nativeEvidence.push({ name: `batch-install-${entry.name}`, file, sha256: entry.sha256 });
      }
      nativeEvidence.push({ name: "batch-application.json", file: application.file, sha256: application.sha256 },
        { name: profile.batchPgTapPath ? "batch-installed-stack.json" : "stack.json", file: current.file, sha256: current.sha256 });
      if (profile.batchPgTapPath) {
        const tested = await evidence(root, profile.batchPgTapPath, profile.batchPgTapSha256);
        const qualified = await evidence(root, generatedInstallation ? profile.generatedPredecessorStackPath : profile.stackReceiptPath,
          generatedInstallation ? profile.generatedPredecessorStackSha256 : profile.stackReceiptSha256);
        const result = tested.data, final = qualified.data;
        const omit = (value) => Object.fromEntries(Object.entries(value).filter(([key]) =>
          !["verifiedAt", "pgTapPassed", "pgTap", "predecessorStackReceipt", "batchPgTapReceipt", "batchPgTapRunReceipt"].includes(key)));
        if (result.status !== "verified" || result.exitCode !== 0 || result.rollbackVerified !== true || result.qualification?.complete !== true ||
          result.stackReceiptSha256 !== current.sha256 || !sameReceiptPath(result.stackReceiptPath, current.file) ||
          !isDeepStrictEqual(result.target, next.identity) || result.transportReceiptSha256 !== qualified.sha256 || !sameReceiptPath(result.transportReceiptPath, qualified.file) ||
          !isDeepStrictEqual(omit(final), omit(next)) || final.pgTapPassed !== true || result.files !== final.pgTap?.files || result.tests !== final.pgTap?.tests ||
          final.predecessorStackReceipt?.sha256 !== current.sha256 || !sameReceiptPath(final.predecessorStackReceipt?.path, current.file) ||
          !sameReceiptPath(final.batchPgTapReceipt, tested.file)) throw new Error("Batch qualification does not continue the exact installed transport.");
        nativeEvidence.push({ name: "batch-pgtap.json", file: tested.file, sha256: tested.sha256 },
          { name: generatedInstallation ? "generated-predecessor-stack.json" : "stack.json", file: qualified.file, sha256: qualified.sha256 });
      }
    }
  }
  if (generatedInstallation) {
    const predecessor = await evidence(root, profile.generatedPredecessorStackPath, profile.generatedPredecessorStackSha256);
    const application = await evidence(root, profile.generatedApplicationPath, profile.generatedApplicationSha256);
    const installed = await evidence(root, profile.generatedPgTapPath ? profile.generatedInstalledStackPath : profile.stackReceiptPath,
      profile.generatedPgTapPath ? profile.generatedInstalledStackSha256 : profile.stackReceiptSha256);
    const old = predecessor.data, value = application.data, next = installed.data;
    const flags = ["businessDataPreserved", "existingPrivilegesPreserved", "catalogueChangesVerified", "functionBodiesVerified", "migrationHistoryVerified"];
    if (value.status !== "verified" || value.phase !== "commit_verified" || !flags.every((key) => value[key] === true) ||
      value.previousStackReceiptSha256 !== predecessor.sha256 || value.predecessor?.stackReceiptSha256 !== predecessor.sha256 ||
      !sameReceiptPath(value.predecessor?.stackReceiptPath, predecessor.file) || !isDeepStrictEqual(value.target, old.identity) ||
      value.apiUrl !== backend.origin || value.stackDirectory !== old.stackDirectory ||
      value.transportReceiptSha256 !== installed.sha256 || !sameReceiptPath(value.transportReceiptPath, installed.file) ||
      !/^\d{14}_atomic_generated_ouvrages\.sql$/.test(value.migration?.file ?? "")) {
      throw new Error("Generated installation does not continue its exact qualified batch predecessor.");
    }
    const omitInstalled = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) =>
      !["verifiedAt", "migrationInventory", "predecessorStackReceipt", "generatedInstallation", "priorPgTap", "pgTapPassed", "pgTap"].includes(key)));
    if (old.pgTapPassed !== true || next.status !== "ready" || next.runtime !== "native" || next.apiUrl !== backend.origin ||
      !isDeepStrictEqual(omitInstalled(next), omitInstalled(old)) || next.predecessorStackReceipt?.sha256 !== predecessor.sha256 ||
      !sameReceiptPath(next.predecessorStackReceipt?.path, predecessor.file) ||
      next.generatedInstallation?.migrationSha256 !== value.migration.sha256 || !sameReceiptPath(next.generatedInstallation?.receipt, application.file) ||
      next.migrationHistoryVerified !== true || next.pgTapPassed !== false || next.pgTap !== null ||
      next.priorPgTap?.passed !== true || !isDeepStrictEqual(next.priorPgTap?.result, old.pgTap)) {
      throw new Error("Generated transport identity or explicit historical pgTAP state differs.");
    }
    const migration = await ownedPath(root, `supabase/migrations/${value.migration.file}`, false);
    if (hash(await readFile(migration)) !== value.migration.sha256 || !Array.isArray(old.migrationInventory) || !Array.isArray(next.migrationInventory) ||
      old.migrationInventory.some((entry) => entry.name === value.migration.file) ||
      !isDeepStrictEqual([...next.migrationInventory].sort((a, b) => a.name.localeCompare(b.name)),
        [...old.migrationInventory, { name: value.migration.file, sha256: value.migration.sha256 }].sort((a, b) => a.name.localeCompare(b.name)))) {
      throw new Error("Generated migration bytes or append-only inventory differs.");
    }
    nativeEvidence.push(...await installationArtifacts(root, application, "generated-install"),
      { name: "generated-application.json", file: application.file, sha256: application.sha256 },
      { name: profile.generatedPgTapPath ? "generated-installed-stack.json" : "stack.json", file: installed.file, sha256: installed.sha256 });
    if (profile.generatedPgTapPath || profile.generatedPgTapSha256) {
      const tested = await evidence(root, profile.generatedPgTapPath, profile.generatedPgTapSha256);
      const qualified = await evidence(root, profile.stackReceiptPath, profile.stackReceiptSha256);
      const result = tested.data, final = qualified.data, qualification = result.qualification;
      const omitQualified = (entry) => Object.fromEntries(Object.entries(entry).filter(([key]) =>
        !["verifiedAt", "pgTapPassed", "pgTap", "predecessorStackReceipt", "generatedPgTapReceipt"].includes(key)));
      if (result.status !== "verified" || result.cliExitCode !== 0 || result.rollbackVerified !== true || qualification?.complete !== true ||
        !Array.isArray(qualification.files) || !qualification.files.length || qualification.files.some((file) => typeof file !== "string" || !file.trim()) ||
        new Set(qualification.files).size !== qualification.files.length || qualification.observedFileCount !== qualification.files.length ||
        !Number.isSafeInteger(qualification.observedAssertionCount) || qualification.observedAssertionCount < 1 ||
        result.stackReceiptSha256 !== installed.sha256 || !sameReceiptPath(result.stackReceiptPath, installed.file) ||
        result.generatedInstallationSha256 !== application.sha256 || !sameReceiptPath(result.generatedInstallationPath, application.file) ||
        !isDeepStrictEqual(result.target, next.identity) || result.transportReceiptSha256 !== qualified.sha256 || !sameReceiptPath(result.transportReceiptPath, qualified.file) ||
        !isDeepStrictEqual(omitQualified(final), omitQualified(next)) || final.pgTapPassed !== true ||
        final.pgTap?.files !== qualification.observedFileCount || final.pgTap?.tests !== qualification.observedAssertionCount ||
        final.predecessorStackReceipt?.sha256 !== installed.sha256 || !sameReceiptPath(final.predecessorStackReceipt?.path, installed.file) ||
        !sameReceiptPath(final.generatedPgTapReceipt, tested.file)) {
        throw new Error("Generated pgTAP qualification does not continue the exact installed transport.");
      }
      nativeEvidence.push(...await installationArtifacts(root, tested, "generated-pgtap-artifact", { nested: true }),
        { name: "generated-pgtap.json", file: tested.file, sha256: tested.sha256 },
        { name: "stack.json", file: qualified.file, sha256: qualified.sha256 });
    }
  }
  }
  let generatedFixture = null;
  if (components) {
    generatedFixture = await evidence(root, profile.generatedFixturePath, profile.generatedFixtureSha256);
    nativeEvidence.push({ name: "components-fixture.json", file: generatedFixture.file, sha256: generatedFixture.sha256 },
      ...await verifyComponentsSeed(generatedFixture.data, fixture.data, profile));
  }
  if (generated) {
    if (!localRecipe && !profile.batchPgTapPath) throw new Error("WFC02 requires the explicit qualified batch continuation.");
    generatedFixture = await evidence(root, profile.generatedFixturePath, profile.generatedFixtureSha256);
    const value = generatedFixture.data;
    safeMetadata(value);
    if (value.schemaVersion !== (recovery ? "estimate-generated-recovery-fixture-1" : "estimate-generated-atomic-fixture-1") || value.status !== "ready" || value.apiUrl !== backend.origin ||
      !value.prefix?.startsWith("ARMY-GENERATED-ATOMIC-") || !isDeepStrictEqual(value.owner, fixture.data.owner) ||
      value.ownerFixtureSha256 !== fixture.sha256 || value.stackReceiptSha256 !== profile.stackReceiptSha256 ||
      value.scenarios?.map((entry) => entry.label).join() !== (recovery ? "lost,malformed,stale,partial,abandon" : "existing,fallback")) throw new Error("Generated prerequisites differ from the exact profile.");
    if (recovery) {
      if (profile.generatedFaultPath || profile.generatedFaultSha256 || value.scenarios.some((entry) =>
        !Array.isArray(entry.candidates) || entry.candidates.length !== (entry.label === "partial" ? 2 : 1))) {
        throw new Error("Recovery requires its exact fresh candidates without a DDL fault profile.");
      }
      const ids = value.scenarios.flatMap((entry) => [entry.projectId, entry.versionId, entry.sectionId, entry.draftId,
        ...entry.candidates.flatMap((candidate) => [candidate.candidateId, candidate.fragmentId, candidate.subdetailId, candidate.componentId])]);
      ids.push(...["projectId", "versionId", "sectionA", "sectionB"].map((key) => value.generation?.[key]));
      if (!ids.every((id) => uuid.test(id ?? "")) || new Set(ids).size !== ids.length) throw new Error("Recovery fixture identities must be valid and independent.");
      if (localRecipe) {
        if (value.nativeRecipeSha256 !== profile.nativeRecipeSha256) throw new Error("Generated prerequisite qualification differs.");
        const seed = await evidence(root, value.nativePrerequisites?.file?.replaceAll("\\", "/"), value.nativePrerequisites?.sha256);
        if (seed.data.status !== "verified" || seed.data.phase !== "commit_verified" || seed.data.planSha256 !== value.planSha256 ||
          seed.data.stackReceiptSha256 !== profile.stackReceiptSha256 || !["businessDataPreserved", "exactPlannedAdditionsVerified", "catalogueAndPrivilegesPreserved", "independentReadbackVerified"].every((key) => seed.data[key] === true)) throw new Error("Generated native prerequisite receipt is incomplete.");
        const seedArtifacts = await installationArtifacts(root, seed, "generated-seed");
        const beforeCommit = seedArtifacts.find((entry) => entry.name === "generated-seed-after-before-commit.json");
        const independent = seedArtifacts.find((entry) => entry.name === "generated-seed-after-independent.json");
        if (!beforeCommit || !independent || !isDeepStrictEqual(JSON.parse(await readFile(beforeCommit.file)), JSON.parse(await readFile(independent.file)))) throw new Error("Generated seed independent conservation differs.");
        const readback = await evidence(root, value.readback?.file?.replaceAll("\\", "/"), value.readback?.sha256);
        const plan = await evidence(root, value.planPath?.replaceAll("\\", "/"), value.planSha256);
        if (plan.sha256 !== seed.data.planSha256 || plan.data.nativeRecipeSha256 !== profile.nativeRecipeSha256 ||
          !isDeepStrictEqual(plan.data.owner, value.owner) || !isDeepStrictEqual(plan.data.scenarios, value.scenarios)) throw new Error("Generated seed plan differs from its fixture.");
        nativeEvidence.push({ name: "generated-seed.json", file: seed.file, sha256: seed.sha256 }, ...seedArtifacts,
          { name: "generated-readback.json", file: readback.file, sha256: readback.sha256 }, { name: "generated-plan.json", file: plan.file, sha256: plan.sha256 });
      }
      nativeEvidence.push({ name: "generated-fixture.json", file: generatedFixture.file, sha256: generatedFixture.sha256 });
    } else {
    const fault = await evidence(root, profile.generatedFaultPath, profile.generatedFaultSha256);
    const activeStack = await evidence(root, profile.stackReceiptPath, profile.stackReceiptSha256);
    if (fault.data.status !== "verified" || fault.data.mode !== "install" || fault.data.phase !== "commit_verified" ||
      fault.data.dataPreserved !== true || fault.data.existingPrivilegesPreserved !== true ||
      fault.data.fixtureSha256 !== generatedFixture.sha256 || fault.data.planSha256 !== value.planSha256 ||
      fault.data.stackReceiptSha256 !== activeStack.sha256 || !isDeepStrictEqual(fault.data.target, activeStack.data.identity)) {
      throw new Error("WFC02 requires its exact verified scoped native fault installation.");
    }
    nativeEvidence.push({ name: "generated-fixture.json", file: generatedFixture.file, sha256: generatedFixture.sha256 },
      { name: "generated-native-fault.json", file: fault.file, sha256: fault.sha256 });
    }
  }
  if (build.data.backend !== backend.origin || build.data.sourceChangedDuringBuild !== false ||
    !Array.isArray(build.data.steps) || !build.data.steps.length ||
    build.data.steps.some((step) => step.exitCode !== 0) ||
    !["win32", "linux", "darwin"].includes(profile.buildOriginPlatform)) {
    throw new Error("Coverage requires an unchanged successful build for its exact backend.");
  }
  if (!Array.isArray(build.data.inputs) || !build.data.inputs.length) throw new Error("Build source evidence is missing.");
  if (localRecipe) {
    const current = await buildSourceEvidence();
    if (build.data.schemaVersion !== "army-local-build-1" || !isDeepStrictEqual(build.data.steps.map((step) => step.args), buildCommands) ||
      !isDeepStrictEqual(build.data.inputs, current.inputs) || !isDeepStrictEqual(build.data.inputsAfter, current.inputs) ||
      build.data.revision !== current.revision || build.data.diffSha256 !== current.diffSha256 || build.data.platform !== profile.buildOriginPlatform ||
      build.data.node !== process.version) throw new Error("Autonomous recipe requires exact commands, complete current inputs and revision from its real build.");
  }
  for (const input of build.data.inputs) {
    const file = await ownedPath(root, input.path.replaceAll("\\", "/"), false);
    if (hash(await readFile(file)) !== input.sha256) throw new Error("Coverage build sources have changed.");
  }
  if (hash(await readFile(path.join(path.dirname(build.file), "build.log"))) !== build.data.logSha256 ||
    (await readFile(path.join(root, ".e2e/army/next/BUILD_ID"), "utf8")).trim() !== build.data.buildId) {
    throw new Error("Coverage build log or installed build identity differs.");
  }
  const env = {
    E2E_ARMY_BASE_URL: app.origin,
    E2E_ARMY_SERVER_MODE: "production",
    E2E_COVERAGE_FIXTURE_PATH: fixture.file,
    E2E_COVERAGE_BACKEND_ORIGIN: backend.origin,
    E2E_COVERAGE_SCENARIO_SET: scenarioSet,
    ...(components ? { E2E_GENERATED_COMPONENTS_FIXTURE_PATH: generatedFixture.file, E2E_GENERATED_COMPONENTS_SELECTION: profile.componentSelection } : {}),
    ...(atomic ? { E2E_CREATE_ATOMIC_FIXTURE_PATH: fixture.file } : {}),
    ...(generatedFixture && !components ? recovery ? { E2E_GENERATED_RECOVERY_FIXTURE_PATH: generatedFixture.file } : { E2E_GENERATED_ATOMIC_FIXTURE_PATH: generatedFixture.file } : {}),
  };
  let runtime = null;
  if (profile.runtimeReceiptPath) {
    runtime = await evidence(root, profile.runtimeReceiptPath, profile.runtimeReceiptSha256);
    if (runtime.data.status !== "ready" || runtime.data.platform !== process.platform ||
      runtime.data.node?.path !== process.execPath || runtime.data.node?.version !== process.version ||
      (runtime.data.distribution && runtime.data.distribution !== process.env.WSL_DISTRO_NAME)) {
      throw new Error("Coverage runtime does not match its explicit receipt.");
    }
    for (const candidate of [runtime.data.esbuild?.binary, runtime.data.browserDirectory, runtime.data.browserPath]) {
      const relative = path.relative(root, candidate ?? "");
      await ownedPath(root, relative);
      await stat(candidate);
    }
    env.ESBUILD_BINARY_PATH = runtime.data.esbuild.binary;
    env.PLAYWRIGHT_BROWSERS_PATH = runtime.data.browserDirectory;
    env.E2E_COVERAGE_STRIP_TYPES = "1";
  } else if (profile.buildOriginPlatform !== process.platform) {
    throw new Error("Cross-platform build execution requires an explicit verified runtime receipt.");
  }
  return {
    env,
    evidence: [
      { name: "profile.json", file: profileFile, sha256: hash(bytes) },
      { name: "fixture.json", file: fixture.file, sha256: fixture.sha256 },
      { name: "build-proof.json", file: build.file, sha256: build.sha256 },
      ...nativeEvidence,
      ...(runtime ? [{ name: "runtime.json", file: runtime.file, sha256: runtime.sha256 }] : []),
    ],
    metadata: {
      profile: configured, approvalReference: profile.approvalReference,
      backendOrigin: backend.origin, appOrigin: app.origin,
      fixture: fixture.data, scenarioSet, buildProof: profile.buildProofPath,
      ...(generatedFixture ? { generatedFixture: generatedFixture.data } : {}),
      ...(numeric ? { numericSelection: profile.componentSelection, numericCases: numericCases(profile.componentSelection), numericJourneys: numericJourneys(profile.componentSelection), numericDownloads: numericDownloads(profile.componentSelection) } : {}),
      buildOriginPlatform: profile.buildOriginPlatform, executionPlatform: process.platform,
      ...(assemblyTotals ? { assemblyTotalsSelection: "assembly-totals", assemblyTotalsResults: 3, assemblyTotalsDownloads: 8 } : {}),
      expected: assemblyTotals ? "Authentication plus AT01/AT02; three exact results and eight real XLSX exports. Immediate nonempty fixed/V2-discount footer and ordinary RLS; V1/races/recovery are not qualified." : numeric ? `Authentication plus ${numericJourneys(profile.componentSelection).join(",")}; ${numericJourneys(profile.componentSelection).length + 1} exact results and ${numericDownloads(profile.componentSelection)} real GREEN exports. Explicit selection, no grep/skip/model/trace; non-reached RED phases remain missing proof.` : components ? `Authentication plus ${profile.componentSelection === "entry" ? "GC01; two" : "GC01-GC04; five"} exact results; selection is explicit, no grep/skip/model/trace. Entry alone does not qualify the complete component contract.` : navigation ? "Authentication and implemented navigation-lease probes, without filtering or skips; the planned order-controlled matrix remains open and these probes alone do not qualify CORE-06." : recovery ? "Authentication plus GO01-GO06; seven exact results, no filtering/skips; recovery, stale review, partial selection, durable closure and real local fallback generation." : generated ? "Authentication plus WFC02 existing and fallback; three exact results; real reviewed application under scoped native fault, immediate state before repair." : scenarioSet === "batch-atomic" ? "Authentication plus WFC01 and BC01-BC04; six exact results, no filtering/skips; ordinary failed batch, real UI save/recovery/undo and partial paste." : atomic ? "Authentication plus CA01/CA02/CA03; four exact results, no filtering/skips; immediate API coherence before editor or save." : "Exact pre-code DOS-CAL-01 assertions; no filtered, skipped or stale-source full qualification.",
      limits: [
        ...(profile.buildOriginPlatform !== process.platform ? ["Existing build executed on a different platform; no native production or performance qualification."] : []),
        ...(localRecipe ? ["Current native sequential regression and pgTAP are linked to their actual output; no migration application or concurrent-transaction proof is inferred."] : batch ? [profile.batchPgTapPath ? "Batch pgTAP continuation is explicit; WFC02 fault-hit and restoration receipts remain separate native observations, no workflow success inferred." : "Batch installation is verified; predecessor pgTAP remains historical, with new transport pgTapPassed:false. No new pgTAP or concurrency qualification is inferred."] : []),
        ...(generatedInstallation ? [profile.generatedPgTapPath ? "Generated-work pgTAP has its separate current receipt; native races and scoped QA fault hits remain separate evidence." : "Generated-work installation is verified but current pgTAP is explicitly absent; batch pgTAP is only a historical predecessor."] : []),
      ],
    },
  };
}
