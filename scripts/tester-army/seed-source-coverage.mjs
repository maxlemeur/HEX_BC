// Preparation only until the coordinator authorizes an exact local profile.
// No retry, cleanup, model, application/snapshot, reference or coverage writes.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PDFDocument } from "pdf-lib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const scenarios = ["nominal", "reference", "register", "l2_quantity", "l1_quantity", "l4_quantity", "l2_price", "recovery", "read_failure", "stale", "form_change"];
const args = process.argv.slice(2);
if (args[0] === "--existing-owner-plan") {
  if (args.length !== 3 || !["--execute", "--validate-only"].includes(args[2])) throw new Error("Explicit existing-owner plan and mode required.");
  const { seedExistingCctp } = await import("./seed-source-coverage-existing.mjs");
  try { await seedExistingCctp(args[1], { execute: args[2] === "--execute" }); }
  catch { console.error("Existing-owner CCTP seed failed or is ambiguous; inspect its exact receipt, no retry."); process.exitCode = 3; }
  process.exit(process.exitCode ?? 0);
}
if (args.length === 1 && args[0] === "--help") {
  console.log("Prepare fresh local prerequisites only after authorization: node --env-file=<local-backend.env> scripts/tester-army/seed-source-coverage.mjs --execute --profile <ignored-seed-profile.json>. See scripts/tester-army/README.md. No profile is inferred.");
  process.exit(0);
}
if (args.length !== 3 || args[0] !== "--execute" || args[1] !== "--profile") {
  throw new Error("Explicit --execute --profile required; preparation is not execution authorization.");
}
if (process.cwd() !== root || !/^v(?:24|26)\./.test(process.version)) throw new Error("Run from the repository root with Node 24 or 26.");

function contained(base, file) {
  const relative = path.relative(base, file);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}
async function ownedFile(relative, ignored = true) {
  if (typeof relative !== "string" || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) throw new Error("Evidence path must be relative to this checkout.");
  const actualRoot = await fs.realpath(root);
  const base = ignored ? await fs.realpath(path.join(root, ".e2e")) : actualRoot;
  if (ignored && !contained(actualRoot, base)) throw new Error("Ignored evidence directory escaped this checkout.");
  const file = await fs.realpath(path.resolve(root, relative));
  if (!contained(base, file) || !(await fs.stat(file)).isFile()) throw new Error("Evidence file escaped its owned directory.");
  return file;
}
async function proof(relative, expectedSha256, ignored = true) {
  if (!digest.test(expectedSha256 ?? "")) throw new Error("Explicit evidence SHA-256 required.");
  const file = await ownedFile(relative, ignored), bytes = await fs.readFile(file);
  if (sha(bytes) !== expectedSha256) throw new Error(`Evidence hash differs: ${relative}`);
  return { file, relative, sha256: expectedSha256, data: JSON.parse(bytes.toString("utf8")) };
}
function localOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || value !== url.origin) throw new Error("Explicit loopback HTTP origin with fixed port required.");
  return url;
}
const profileFile = await ownedFile(args[2]), profileBytes = await fs.readFile(profileFile);
const profile = JSON.parse(profileBytes.toString("utf8"));
const scenarioSet = profile.scenarioSet ?? "source-coverage";
if (!["source-coverage", "create-atomic"].includes(scenarioSet)) throw new Error("Unknown explicit fixture scenario set.");
const atomic = scenarioSet === "create-atomic";
if (profile.schemaVersion !== "army-source-coverage-seed-1" || profile.scope !== "source-coverage-prerequisites" ||
  !/^[a-z0-9][a-z0-9-]{0,47}$/.test(profile.campaign ?? "") || typeof profile.approvalReference !== "string" || !profile.approvalReference.trim()) throw new Error("Explicit authorized coverage seed profile required.");
if (/"(?:password|secret|token|serviceRoleKey|anonKey)"\s*:|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i.test(profileBytes.toString("utf8"))) throw new Error("Secrets must not be stored in the profile.");
const backend = localOrigin(profile.backendOrigin);
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== backend.origin || process.env.E2E_ALLOWED_SUPABASE_HOST !== backend.hostname) throw new Error("Explicit environment differs from the authorized local backend.");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey?.trim() || !serviceKey?.trim()) throw new Error("Explicit local anon and provisioning keys required; no .env.local fallback.");
const stack = await proof(profile.stackReceiptPath, profile.stackReceiptSha256);
if (stack.data.status !== "ready" || stack.data.runtime !== "native" || stack.data.apiUrl !== backend.origin) throw new Error("Verified native stack receipt required.");
const application = await proof(profile.nativeApplicationPath, profile.nativeApplicationSha256);
if (application.data.status !== "verified" || (application.data.backend ?? application.data.apiUrl) !== backend.origin ||
  application.data.stackDirectory !== stack.data.stackDirectory || !application.data.migration?.file?.endsWith("_estimate_source_coverage.sql")) throw new Error("Verified coverage migration application on this exact stack required.");
const migrationName = application.data.migration.file.replace(/^supabase\/migrations\//, "");
if (!/^\d{14}_estimate_source_coverage\.sql$/.test(migrationName)) throw new Error("Unexpected coverage migration path.");
const migrationPath = `supabase/migrations/${migrationName}`;
const migrationFile = await ownedFile(migrationPath, false);
if (sha(await fs.readFile(migrationFile)) !== application.data.migration.sha256) throw new Error("Installed coverage migration proof differs from the current source.");
let atomicApplication = null, atomicCorrection = null, atomicPgTap = null;
if (profile.atomicApplicationPath || profile.atomicApplicationSha256) {
  if (!atomic) throw new Error("Atomic application proof belongs only to its explicit scenario set.");
  atomicApplication = await proof(profile.atomicApplicationPath, profile.atomicApplicationSha256);
  const installed = atomicApplication.data;
  if (installed.status !== "verified" || installed.phase !== "commit_verified" || installed.apiUrl !== backend.origin ||
    installed.stackDirectory !== stack.data.stackDirectory ||
    installed.target?.dbPort !== stack.data.ports?.["54322"] || !/^\d{14}_atomic_create_estimate_item\.sql$/.test(installed.migration?.file ?? "")) throw new Error("Atomic application does not identify this verified local stack.");
  const file = await ownedFile(`supabase/migrations/${installed.migration.file}`, false);
  if (sha(await fs.readFile(file)) !== installed.migration.sha256) throw new Error("Installed atomic creation migration differs from its source.");
  if (profile.atomicCorrectionPath || profile.atomicCorrectionSha256) {
    atomicCorrection = await proof(profile.atomicCorrectionPath, profile.atomicCorrectionSha256);
    const correction = atomicCorrection.data;
    let finalTransportSha256 = correction.transportReceiptSha256;
    if (profile.atomicPgTapPath || profile.atomicPgTapSha256) {
      atomicPgTap = await proof(profile.atomicPgTapPath, profile.atomicPgTapSha256);
      const tested = atomicPgTap.data;
      if (tested.status !== "verified" || tested.exitCode !== 0 || tested.rollbackVerified !== true ||
        tested.stackReceiptSha256 !== correction.transportReceiptSha256 || tested.target?.systemIdentifier !== installed.target.systemIdentifier || tested.target?.dbPort !== installed.target.dbPort ||
        stack.data.pgTapPassed !== true || tested.files !== stack.data.pgTap?.files || tested.tests !== stack.data.pgTap?.tests) throw new Error("Atomic pgTAP receipt does not continue the corrected stack.");
      finalTransportSha256 = tested.transportReceiptSha256;
    }
    if (correction.status !== "verified" || correction.phase !== "commit_verified" || correction.historyVerified !== true ||
      correction.target?.systemIdentifier !== installed.target.systemIdentifier || correction.target?.dbPort !== installed.target.dbPort ||
      finalTransportSha256 !== stack.sha256 || correction.artifacts?.find((entry) => entry.name === "3-stack.json")?.sha256 !== installed.transportReceiptSha256 ||
      !/^\d{14}_guard_normalized_estimate_calculation_tenant\.sql$/.test(correction.migration?.file ?? "")) throw new Error("Atomic correction does not continue the exact installed stack receipt.");
    const correctionFile = await ownedFile(`supabase/migrations/${correction.migration.file}`, false);
    if (sha(await fs.readFile(correctionFile)) !== correction.migration.sha256 ||
      !stack.data.migrationInventory?.some((entry) => entry.name === correction.migration.file && entry.sha256 === correction.migration.sha256)) throw new Error("Atomic correction source or transport migration inventory differs.");
  } else if (installed.transportReceiptSha256 !== stack.sha256) throw new Error("Atomic stack transport changed without explicit correction evidence.");
}
const targetMode = profile.targetMode ?? "existing-stack";
if (!["existing-stack", "fresh-stack"].includes(targetMode)) throw new Error("Unknown explicit seed target mode.");
let sentinel = null, freshStack = null, excludedStack = null, freshClaimFile = null;
let freshMigrationNames = [];
const freshPublicTables = ["profiles", "tenant_memberships", "estimate_projects", "estimate_versions", "estimate_items", "estimate_generated_ouvrage_drafts", "estimate_generated_ouvrage_applications", "estimate_generated_ouvrage_work_snapshots", "affaire_register_entries", "affaire_intake_uploads", "affaire_intake_documents"];
function assertFreshAge(value) {
  const timestamp = Date.parse(value.verifiedAt);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp > 15 * 60_000 || timestamp > Date.now() + 5000) throw new Error("Fresh-stack proof is stale or future-dated; obtain a new read-only inventory.");
}
function noSecrets(value) {
  const serialized = JSON.stringify(value);
  if ([anonKey, serviceKey].some((key) => serialized.includes(key)) || /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.|postgres(?:ql)?:\/\/[^\s/@]+:[^\s@]+@/.test(serialized)) throw new Error("Fresh-stack metadata contains credentials.");
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    if (/password|secret|credential|authorization|access.?token|refresh.?token|anon.?key|service.?role.?key/i.test(key)) throw new Error("Fresh-stack metadata must not contain credential fields.");
    noSecrets(child);
  }
}
if (targetMode === "existing-stack") {
  sentinel = await proof(profile.sentinelFixturePath, profile.sentinelFixtureSha256);
  if (sentinel.data.status !== "ready" || sentinel.data.apiUrl !== backend.origin ||
    ![sentinel.data.ownerId, sentinel.data.tenantId, sentinel.data.projectId, sentinel.data.versionId].every((id) => uuid.test(id ?? ""))) throw new Error("Existing local actor/project/version identity receipt required.");
} else {
  if (profile.sentinelFixturePath || profile.sentinelFixtureSha256) throw new Error("Fresh-stack mode must not supply a fabricated historical sentinel.");
  freshStack = await proof(profile.freshStackProofPath, profile.freshStackProofSha256);
  excludedStack = await proof(profile.excludedStackReceiptPath, profile.excludedStackReceiptSha256);
  noSecrets(freshStack.data); noSecrets(profile);
  const value = freshStack.data;
  assertFreshAge(value);
  if (value.schemaVersion !== "source-coverage-fresh-stack-1" || value.status !== "verified" ||
    value.apiUrl !== backend.origin || value.stackDirectory !== stack.data.stackDirectory ||
    value.projectId !== stack.data.projectId || value.projectId !== profile.expectedFreshProjectId ||
    !/^[a-z0-9-]{1,100}$/.test(value.projectId ?? "") ||
    value.stackReceiptSha256 !== stack.sha256 || value.identity?.database !== "postgres" ||
    !/^\d{16,24}$/.test(value.identity?.systemIdentifier ?? "") ||
    value.identity.systemIdentifier !== profile.expectedFreshSystemIdentifier ||
    value.migration?.sha256 !== application.data.migration.sha256 ||
    value.migration?.file?.replace(/^supabase\/migrations\//, "") !== migrationName) throw new Error("Fresh-stack proof does not identify the pinned new stack and current coverage migration.");
  if (excludedStack.data.status !== "ready" || excludedStack.data.runtime !== "native") throw new Error("Explicit excluded stack identity required.");
  const newPorts = Object.values(stack.data.ports ?? {}), oldPorts = Object.values(excludedStack.data.ports ?? {});
  if (newPorts.length !== 8 || oldPorts.length !== 8 || new Set(newPorts).size !== 8 || newPorts.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535 || oldPorts.includes(port)) ||
    Object.keys(value.ports ?? {}).length !== 8 || Object.entries(stack.data.ports).some(([key, port]) => value.ports?.[key] !== port) || Number(backend.port) !== stack.data.ports["54321"] ||
    value.identity.dbPort !== stack.data.ports["54322"] ||
    value.apiUrl === excludedStack.data.apiUrl || value.projectId === excludedStack.data.projectId || value.stackDirectory === excludedStack.data.stackDirectory ||
    value.separateFrom?.stackDirectory !== excludedStack.data.stackDirectory || value.separateFrom?.apiUrl !== excludedStack.data.apiUrl || value.separateFrom?.dbPort !== excludedStack.data.ports["54322"] ||
    value.separateFrom?.projectId !== excludedStack.data.projectId) throw new Error("Fresh-stack identity or ports reuse the explicitly excluded stack.");
  const zeroCounts = ["authUsers", "profiles", "memberships", "projects", "versions", "items", "generatedDrafts", "applications", "snapshots", "registerEntries", "sourceReviews", "referenceCopies", "referenceEvents", "coverageDimensions", "coverageRequirements", "coverageCitations", "coverageLinks", "coverageEvents", "storageObjects", "intakeUploads", "intakeDocuments"];
  const initial = value.emptyBeforeFixtures;
  if (!initial || zeroCounts.some((key) => initial[key] !== 0) || initial.tenants !== 1 ||
    value.baselineTenants?.length !== 1 || !uuid.test(value.baselineTenants[0].id ?? "") || value.baselineTenants[0].slug !== "hydro-express" || value.baselineTenants[0].createdBy !== null) throw new Error("Fresh-stack native inventory contains business data or an unexpected baseline tenant.");
  const migrationNames = (await fs.readdir(path.join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort();
  const currentMigrations = await Promise.all(migrationNames.map(async (name) => ({ name, sha256: sha(await fs.readFile(path.join(root, "supabase/migrations", name))) })));
  const installedMigrations = value.migrationInventory;
  if (!Array.isArray(installedMigrations) || installedMigrations.length !== currentMigrations.length ||
    JSON.stringify(installedMigrations.map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name))) !== JSON.stringify([...currentMigrations].sort((a, b) => a.name.localeCompare(b.name))) ||
    value.migrationHistoryVerified !== true || value.pgTapPassed !== true) throw new Error("Fresh-stack migration inventory/history or pgTAP proof differs.");
  freshMigrationNames = migrationNames;
  freshClaimFile = path.join(root, ".e2e/army/coverage/fresh-stack-claims", `${value.projectId}-${value.identity.systemIdentifier}.json`);
  try { await fs.access(freshClaimFile); throw new Error("Fresh-stack seed proof was already consumed; no automatic retry."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
let runtime = null;
if (profile.runtimeReceiptPath) {
  runtime = await proof(profile.runtimeReceiptPath, profile.runtimeReceiptSha256);
  if (runtime.data.status !== "ready" || runtime.data.platform !== process.platform || runtime.data.node?.path !== process.execPath || runtime.data.node?.version !== process.version ||
    (runtime.data.distribution && runtime.data.distribution !== process.env.WSL_DISTRO_NAME)) throw new Error("Explicit seed runtime identity differs.");
  const binary = await ownedFile(path.relative(root, runtime.data.esbuild?.binary ?? ""));
  process.env.ESBUILD_BINARY_PATH = binary;
} else if (process.platform !== "win32") throw new Error("Non-Windows provisioning requires its verified local runtime receipt.");
const corpusRoot = path.join(root, "e2e/fixtures/source-coverage");
const corpusManifestFile = path.join(corpusRoot, "manifest.json"), corpusBytes = await fs.readFile(corpusManifestFile);
const manifest = JSON.parse(corpusBytes.toString("utf8"));
const corpus = new Map();
if (manifest.schemaVersion !== "source-reference-corpus-1" || manifest.documents.length !== 2) throw new Error("Expected the tracked two-document synthetic corpus.");
for (const entry of manifest.documents) {
  const file = await fs.realpath(path.resolve(corpusRoot, entry.path));
  if (!contained(await fs.realpath(corpusRoot), file) || !["A", "B"].includes(entry.revision)) throw new Error("Corpus path/revision mismatch.");
  const bytes = await fs.readFile(file), pdf = await PDFDocument.load(bytes);
  if (sha(bytes) !== entry.sha256 || bytes.length !== entry.byteSize || pdf.getPageCount() !== 3 || pdf.isEncrypted || entry.pageCount !== 3) throw new Error("Tracked corpus integrity mismatch.");
  corpus.set(entry.revision, { ...entry, bytes, file });
}
if (corpus.size !== 2 || corpus.get("A").sha256 === corpus.get("B").sha256) throw new Error("Distinct A/B documents required.");
const { tsImport } = await import("tsx/esm/api");
const intake = await tsImport(pathToFileURL(path.join(root, "src/lib/affaires/intake.ts")).href, import.meta.url);
const { AFFAIRE_INTAKE_BUCKET, buildAffaireIntakeStoragePath, createEmptyAffaireIntakeExtractedMetadata } = intake.default ?? intake;
if (AFFAIRE_INTAKE_BUCKET !== "affaire-intake" || typeof buildAffaireIntakeStoragePath !== "function" || typeof createEmptyAffaireIntakeExtractedMetadata !== "function") throw new Error("Canonical intake constructors unavailable.");

const index = process.env.GIT_INDEX_FILE;
if (!index || !contained(await fs.realpath(path.join(root, ".e2e")), await fs.realpath(index))) throw new Error("Explicit alternate read-only Git index required.");
const git = (...command) => execFileSync("git", command, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, windowsHide: true }).trim();
if (git("branch", "--show-current") !== "main") throw new Error("Seed preparation requires the existing main checkout.");
const sourcePaths = [...new Set(["scripts/tester-army/seed-source-coverage.mjs", "src/lib/affaires/intake.ts", "e2e/fixtures/source-coverage/manifest.json", "e2e/fixtures/source-coverage/make-cctp-fixtures.py", migrationPath, ...[atomicApplication, atomicCorrection].filter(Boolean).map((entry) => `supabase/migrations/${entry.data.migration.file}`), ...freshMigrationNames.map((name) => `supabase/migrations/${name}`)])];
const inputs = await Promise.all(sourcePaths.map(async (file) => ({ file, sha256: sha(await fs.readFile(path.join(root, file))) })));
const baseDirectory = path.join(root, ".e2e/army/coverage/fixtures");
await fs.mkdir(baseDirectory, { recursive: true });
if (!contained(await fs.realpath(root), await fs.realpath(baseDirectory))) throw new Error("Fixture output escaped the checkout.");
const directory = path.join(baseDirectory, profile.campaign);
await fs.mkdir(directory); // exclusive: never overwrite or resume implicitly
const ownerId = randomUUID(), laborRoleId = randomUUID();
const prefix = `${atomic ? "ARMY-CREATE-ATOMIC" : "ARMY-COVERAGE"}-${profile.campaign}-${ownerId.slice(0, 8)}`;
const plans = (atomic ? ["legacyV1", "legacySplitV1"] : scenarios).map((label) => ({
  label, projectId: randomUUID(), versionId: randomUUID(), sectionA: randomUUID(), sectionB: randomUUID(),
  draftId: randomUUID(), candidateId: randomUUID(), fragmentId: randomUUID(), subdetailId: randomUUID(),
  designation: "ARMY Réseau CH-A avec calorifuge", componentIds: [randomUUID(), randomUUID(), randomUUID()],
  sources: ["A", "B"].map((revision) => ({ revision, uploadId: randomUUID(), documentId: randomUUID() })),
}));
const email = `army-coverage-${profile.campaign}-${ownerId.slice(0, 8)}@example.invalid`;
const password = `Army-Coverage-${randomBytes(28).toString("base64url")}-A1!`;
const secrets = [anonKey, serviceKey, email, password];
const redact = (value) => {
  let result = String(value);
  for (const secret of secrets) result = result.replaceAll(secret, "[REDACTED]");
  return result.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-TOKEN]");
};
const receiptFile = path.join(directory, "provisioning.json");
const receipt = {
  schemaVersion: "source-coverage-provisioning-1", status: "planned", campaign: profile.campaign, prefix, scenarioSet,
  approvalReference: profile.approvalReference, apiUrl: backend.origin, targetMode, createdAt: new Date().toISOString(),
  command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
  source: { revision: git("rev-parse", "HEAD"), branch: "main", inputs, gitStatus: git("status", "--short", "--branch") },
  runtime: { platform: process.platform, node: process.version, executable: process.execPath, distribution: runtime?.data.distribution ?? null },
  evidence: [ { file: path.relative(root, profileFile), sha256: sha(profileBytes) }, ...[stack, application, atomicApplication, atomicCorrection, atomicPgTap, sentinel, freshStack, excludedStack, runtime].filter(Boolean).map(({ relative, sha256 }) => ({ file: relative, sha256 })) ],
  owner: { userId: ownerId, laborRoleId }, scenarios: plans, steps: [], pending: null,
  limits: ["Local prerequisite creation only, not a business or role-matrix qualification.", "No application, snapshot, final line, register, retained reference or coverage decision is preinserted.", "Public empty-state checks do not independently inspect private source-review/coverage tables; those require the subsequent ordinary UI and native observation.", "No automatic retry, cleanup, compensation, model or email delivery."],
};
const persist = () => fs.writeFile(receiptFile, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
await persist();
let tenantId = null, observerToken = null;
const storagePaths = new Set(), bootstrapRoleIds = new Set();
const tableIds = {
  estimate_projects: plans.map((s) => s.projectId), estimate_versions: plans.map((s) => s.versionId),
  estimate_items: plans.flatMap((s) => [s.sectionA, s.sectionB]),
  estimate_generated_ouvrage_drafts: plans.map((s) => s.draftId),
  estimate_generated_ouvrage_source_fragments: plans.map((s) => s.fragmentId),
  estimate_generated_ouvrage_candidates: plans.map((s) => s.candidateId),
  estimate_generated_ouvrage_subdetail_drafts: plans.map((s) => s.subdetailId),
  estimate_generated_ouvrage_subdetail_items: plans.flatMap((s) => s.componentIds),
  affaire_intake_uploads: plans.flatMap((s) => s.sources.map((d) => d.uploadId)),
  affaire_intake_documents: plans.flatMap((s) => s.sources.map((d) => d.documentId)),
  labor_roles: [laborRoleId],
};
if (atomic) for (const table of Object.keys(tableIds)) {
  if (!["estimate_projects", "estimate_versions", "labor_roles"].includes(table)) tableIds[table] = [];
}
function assertRequest(method, pathname, query, body, headers) {
  if (pathname === "/auth/v1/admin/users" && method === "POST" && body.id === ownerId && body.email === email && body.email_confirm === true) return;
  if (pathname === "/auth/v1/token" && method === "POST" && query.grant_type === "password" && body.email === email && body.password === password) return;
  if (pathname === "/storage/v1/bucket/affaire-intake" && method === "GET") return;
  const objectPath = pathname.startsWith("/storage/v1/object/affaire-intake/") ? decodeURIComponent(pathname.slice("/storage/v1/object/affaire-intake/".length)) : null;
  if (objectPath && storagePaths.has(objectPath) && ["GET", "POST"].includes(method) && (method !== "POST" || headers["x-upsert"] === "false")) return;
  const table = pathname.match(/^\/rest\/v1\/([a-z_]+)$/)?.[1];
  if (!table) throw new Error("Request outside planned local transport.");
  const ownedScope = tenantId && query.tenant_id === `eq.${tenantId}`;
  const plannedVersion = plans.some((s) => [query.version_id, query.target_version_id, query.id].includes(`eq.${s.versionId}`));
  if (method === "GET") {
    if (table === "tenant_memberships" && query.user_id === `eq.${ownerId}`) return;
    if (table === "tenants" && tenantId && query.id === `eq.${tenantId}`) return;
    if (sentinel && ["estimate_projects", "estimate_versions"].includes(table) && query.tenant_id === `eq.${sentinel.data.tenantId}` && query.id === `eq.${table === "estimate_projects" ? sentinel.data.projectId : sentinel.data.versionId}`) return;
    if (freshStack && tenantId === null && freshPublicTables.includes(table) && query.select === "id" && query.limit === "1") return;
    if (freshStack && tenantId === null && table === "tenants" && query.select === "id,slug,created_by" && query.limit === "2") return;
    if (ownedScope && (plannedVersion || query.user_id === `eq.${ownerId}` || plans.some((s) => query.project_id === `eq.${s.projectId}`))) return;
  }
  if (method === "POST" && tenantId) {
    if (atomic && !["estimate_projects", "estimate_versions", "labor_roles"].includes(table)) throw new Error("Atomic fixture provisions only empty legacy metadata and its new labor role.");
    const rows = Array.isArray(body) ? body : [body];
    if (rows.length && rows.every((row) => row.tenant_id === tenantId &&
      (tableIds[table]?.includes(row.id) || (table === "estimate_generated_ouvrage_candidate_sources" && plans.some((s) => row.draft_id === s.draftId && row.candidate_id === s.candidateId && row.source_fragment_id === s.fragmentId))) &&
      (!row.project_id || plans.some((s) => row.project_id === s.projectId)) && (!row.user_id || row.user_id === ownerId))) return;
  }
  if (method === "PATCH" && ownedScope) {
    if (table === "labor_roles" && query.user_id === `eq.${ownerId}` && bootstrapRoleIds.has(query.id?.slice(3)) && JSON.stringify(body) === '{"is_active":false}') return;
    if (table === "affaire_intake_documents" && tableIds.affaire_intake_documents.includes(query.id?.slice(3)) && query.upload_status === "eq.pending" && JSON.stringify(body) === '{"upload_status":"uploaded"}') return;
  }
  throw new Error("Request outside new fixture row scope.");
}
async function request(label, { method = "GET", pathname, query = {}, body, bytes, ordinary = false, binary = false, extraHeaders = {} }) {
  assertRequest(method, pathname, query, body, extraHeaders);
  const url = new URL(pathname, backend.origin);
  if (url.origin !== backend.origin || url.username || url.password || url.hash) throw new Error("Request escaped the exact loopback origin.");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const authRequest = pathname.startsWith("/auth/");
  receipt.pending = { label, method, pathname, mutation: method !== "GET", startedAt: new Date().toISOString() };
  await persist();
  const response = await fetch(url, {
    method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { apikey: ordinary ? anonKey : serviceKey, Authorization: `Bearer ${ordinary ? observerToken ?? anonKey : serviceKey}`, ...(body ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
    body: bytes ?? (body ? JSON.stringify(body) : undefined),
  });
  const raw = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}; no automatic retry.`);
  const value = binary ? raw : raw.length ? JSON.parse(raw.toString("utf8")) : null;
  receipt.steps.push({ label, method, pathname, status: response.status, finishedAt: new Date().toISOString(), ...(!authRequest ? { responseSha256: sha(raw) } : {}) });
  receipt.pending = null; await persist();
  return value;
}
const rest = (label, table, query, options = {}) => request(label, { pathname: `/rest/v1/${table}`, query, ...options });
const insert = (label, table, body) => rest(label, table, {}, { method: "POST", body, extraHeaders: { Prefer: "return=minimal" } });
async function readSentinel(label) {
  const p = sentinel.data;
  const projects = await rest(`${label}:project`, "estimate_projects", { select: "id,tenant_id,user_id,name,is_archived", id: `eq.${p.projectId}`, tenant_id: `eq.${p.tenantId}` });
  const versions = await rest(`${label}:version`, "estimate_versions", { select: "id,tenant_id,project_id,status,content_revision,updated_at,total_ht_cents,total_tax_cents,total_ttc_cents", id: `eq.${p.versionId}`, tenant_id: `eq.${p.tenantId}` });
  if (projects.length !== 1 || projects[0].user_id !== p.ownerId || versions.length !== 1 || versions[0].project_id !== p.projectId) throw new Error("Live backend does not match the pinned existing fixture identity.");
  return { projects, versions };
}
async function inspectFreshPublicState() {
  const observed = {};
  for (const table of freshPublicTables) {
    const rows = await rest(`fresh public empty:${table}`, table, { select: "id", limit: "1" });
    if (!Array.isArray(rows) || rows.length !== 0) throw new Error(`Fresh-stack public prerequisite ${table} is no longer empty.`);
    observed[table] = { observedRows: rows.length, limit: 1 };
  }
  const tenants = await rest("fresh baseline tenant", "tenants", { select: "id,slug,created_by", limit: "2" });
  const baseline = freshStack.data.baselineTenants[0];
  if (tenants.length !== 1 || tenants[0].id !== baseline.id || tenants[0].slug !== baseline.slug || tenants[0].created_by !== null) throw new Error("Fresh-stack baseline tenant differs from its native inventory.");
  return { observed, baselineTenants: tenants, privateTablesReadViaRest: false, authUsersReadViaRest: false, nativeBefore: { file: freshStack.relative, sha256: freshStack.sha256, verifiedAt: freshStack.data.verifiedAt } };
}
async function claimFreshStack() {
  assertFreshAge(freshStack.data);
  if (sha(await fs.readFile(freshStack.file)) !== freshStack.sha256) throw new Error("Fresh-stack proof changed before its first mutation.");
  const claimDirectory = path.dirname(freshClaimFile);
  await fs.mkdir(claimDirectory, { recursive: true });
  if (!contained(await fs.realpath(root), await fs.realpath(claimDirectory))) throw new Error("Fresh-stack claim escaped this checkout.");
  await fs.writeFile(freshClaimFile, JSON.stringify({
    schemaVersion: "source-coverage-fresh-stack-claim-1", claimedAt: new Date().toISOString(),
    projectId: freshStack.data.projectId, systemIdentifier: freshStack.data.identity.systemIdentifier,
    apiUrl: backend.origin, freshStackProofSha256: freshStack.sha256,
    campaign: profile.campaign, ownerId, receipt: path.relative(root, receiptFile),
    boundary: "Exclusive first fixture provisioning; never remove or retry automatically after ambiguity.",
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  receipt.freshStackClaim = { file: path.relative(root, freshClaimFile), sha256: sha(await fs.readFile(freshClaimFile)) };
  await persist();
}
async function addScenario(s) {
  if (atomic) {
    await insert(`${s.label}:project`, "estimate_projects", { id: s.projectId, tenant_id: tenantId, user_id: ownerId, name: `${prefix} ${s.label}` });
    await insert(`${s.label}:empty legacy version`, "estimate_versions", { id: s.versionId, tenant_id: tenantId, project_id: s.projectId, version_number: 1, title: s.label, status: "draft", currency: "EUR", calc_engine_version: 1, max_section_depth: 3, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [], global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, contractor_role: "principal", total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0 });
    return;
  }
  const common = { tenant_id: tenantId }, context = { ...common, project_id: s.projectId, target_version_id: s.versionId };
  const name = `${prefix} ${s.label}`;
  await insert(`${s.label}:project`, "estimate_projects", { ...common, id: s.projectId, user_id: ownerId, name });
  await insert(`${s.label}:empty version`, "estimate_versions", { ...common, id: s.versionId, project_id: s.projectId, version_number: 1, title: name, status: "draft", currency: "EUR", calc_engine_version: 2, max_section_depth: 1, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0 });
  await insert(`${s.label}:sections only`, "estimate_items", [{ id: s.sectionA, title: `${name} SA`, position: 1 }, { id: s.sectionB, title: `${name} SB`, position: 2 }].map((row) => ({ ...row, ...common, version_id: s.versionId, item_type: "section", parent_id: null })));
  await insert(`${s.label}:pending draft`, "estimate_generated_ouvrage_drafts", { ...context, id: s.draftId, created_by: ownerId, source_kind: "internal_note", preferred_lot_id: s.sectionA, status: "pending", summary: {}, generation_metadata: { fixture: "Synthetic prepared draft, no model invoked" } });
  await insert(`${s.label}:source fragment`, "estimate_generated_ouvrage_source_fragments", { ...common, project_id: s.projectId, draft_id: s.draftId, id: s.fragmentId, fragment_order: 0, source_kind: "internal_note", label: "ARMY oracle synthétique", excerpt: s.designation, normalized_excerpt: s.designation.toLowerCase() });
  await insert(`${s.label}:pending candidate`, "estimate_generated_ouvrage_candidates", { ...context, id: s.candidateId, draft_id: s.draftId, candidate_order: 0, suggested_lot_id: s.sectionA, lot_label: `${name} SA`, designation: s.designation, normalized_designation: s.designation.toLowerCase(), unit: "m", quantity: 10, confidence: 1, ai_status: "certain", resolution_status: "pending", reasoning: "Oracle synthétique, aucune génération" });
  await insert(`${s.label}:candidate source`, "estimate_generated_ouvrage_candidate_sources", { ...common, draft_id: s.draftId, candidate_id: s.candidateId, source_fragment_id: s.fragmentId, source_rank: 0 });
  await insert(`${s.label}:subdetail pending review`, "estimate_generated_ouvrage_subdetail_drafts", { ...context, id: s.subdetailId, draft_id: s.draftId, parent_work_id: s.candidateId, created_by: ownerId, status: "pending_review", summary: {}, generation_metadata: { fixture: "Human review is required in the application" } });
  const components = [
    { designation: "ARMY calorifuge 30 mm CH-A", cost_type: "material", quantity: 10, unit: "m", unit_cost_ht_cents: 800 },
    { designation: "ARMY canalisation CH-A", cost_type: "material", quantity: 10, unit: "m", unit_cost_ht_cents: 1200 },
    { designation: "ARMY pose réseau CH-A", cost_type: "labor", quantity: 5, unit: "h", unit_cost_ht_cents: 4000 },
  ].map((row, index) => ({ ...row, ...common, project_id: s.projectId, draft_id: s.draftId, subdetail_id: s.subdetailId, parent_work_id: s.candidateId, source_fragment_id: s.fragmentId, id: s.componentIds[index], component_order: index, status: "manual", loss_coeff_bp: 0, yield_value: null, yield_unit: null, confidence: 1, source_label: "ARMY oracle synthétique", facts: ["Valeur de recette synthétique"], hypotheses: [], inferences: [] }));
  await insert(`${s.label}:three proposed components`, "estimate_generated_ouvrage_subdetail_items", components);
  for (const source of s.sources) {
    const pdf = corpus.get(source.revision), timestamp = new Date().toISOString();
    const objectPath = buildAffaireIntakeStoragePath({ tenantId, projectId: s.projectId, uploadId: source.uploadId, documentId: source.documentId, fileName: pdf.fileName });
    if (objectPath !== `${tenantId}/${s.projectId}/${source.uploadId}/${source.documentId}/${pdf.fileName}`) throw new Error("Canonical intake object path changed.");
    source.storagePath = objectPath; storagePaths.add(objectPath); await persist();
    await insert(`${s.label}/${source.revision}:inert upload`, "affaire_intake_uploads", { ...common, id: source.uploadId, project_id: s.projectId, created_by: ownerId, status: "ready", attempt_count: 0, next_retry_at: null, last_error: null, completed_at: timestamp });
    await insert(`${s.label}/${source.revision}:intake document`, "affaire_intake_documents", { ...common, id: source.documentId, project_id: s.projectId, upload_id: source.uploadId, created_by: ownerId, storage_path: objectPath, file_name: pdf.fileName, mime_type: "application/pdf", size_bytes: pdf.byteSize, upload_status: "pending", rejection_reason: null, classification_status: "classified", document_kind: "cctp", document_priority: source.revision === "A" ? "primary" : "secondary", confidence: 1, issues: [], extracted_metadata: createEmptyAffaireIntakeExtractedMetadata(), classification_source: "manual", classified_by: ownerId, classified_at: timestamp, manually_overridden_at: timestamp });
    const pathname = `/storage/v1/object/affaire-intake/${objectPath}`;
    await request(`${s.label}/${source.revision}:source upload`, { method: "POST", pathname, bytes: pdf.bytes, extraHeaders: { "Content-Type": "application/pdf", "x-upsert": "false" } });
    // The canonical Storage read policy requires upload_status=uploaded. First
    // verify provisioned bytes as the seeder, then mark only this owned row,
    // then independently prove the ordinary account can read the same bytes.
    const stored = await request(`${s.label}/${source.revision}:provisioning source readback`, { pathname, binary: true });
    const parsed = await PDFDocument.load(stored);
    if (!stored.equals(pdf.bytes) || sha(stored) !== pdf.sha256 || parsed.getPageCount() !== 3 || parsed.isEncrypted) throw new Error("Stored source bytes differ from the tracked corpus.");
    source.actual = { sha256: sha(stored), bytes: stored.length, pageCount: parsed.getPageCount(), encrypted: parsed.isEncrypted };
    const updated = await rest(`${s.label}/${source.revision}:verified source uploaded`, "affaire_intake_documents", { id: `eq.${source.documentId}`, tenant_id: `eq.${tenantId}`, upload_status: "eq.pending", select: "id" }, { method: "PATCH", body: { upload_status: "uploaded" }, extraHeaders: { Prefer: "return=representation" } });
    if (updated.length !== 1 || updated[0].id !== source.documentId) throw new Error("Owned source status was not changed exactly once.");
    const ordinaryBytes = await request(`${s.label}/${source.revision}:ordinary source readback`, { pathname, ordinary: true, binary: true });
    if (!ordinaryBytes.equals(pdf.bytes)) throw new Error("Ordinary source readback differs from the tracked corpus.");
  }
}
async function verifyScenario(s) {
  const versionScope = { tenant_id: `eq.${tenantId}`, target_version_id: `eq.${s.versionId}` };
  const read = (label, table, query) => rest(`${s.label}:${label}`, table, query, { ordinary: true });
  const versions = await read("read version", "estimate_versions", { select: "*", tenant_id: `eq.${tenantId}`, id: `eq.${s.versionId}` });
  const items = await read("read items", "estimate_items", { select: "*", tenant_id: `eq.${tenantId}`, version_id: `eq.${s.versionId}`, order: "position.asc,id.asc" });
  if (atomic) {
    if (versions.length !== 1 || versions[0].status !== "draft" || versions[0].project_id !== s.projectId || versions[0].calc_engine_version !== 1 || items.length ||
      [versions[0].total_ht_cents, versions[0].total_tax_cents, versions[0].total_ttc_cents].some((value) => value !== 0)) throw new Error("Legacy atomic witness is not empty.");
    const file = path.join(directory, `initial-${s.label}.json`);
    await fs.writeFile(file, JSON.stringify({ versions, items }, null, 2) + "\n", { flag: "wx" });
    return { file: path.relative(root, file), sha256: sha(await fs.readFile(file)), lines: 0, sections: 0, calcEngineVersion: 1 };
  }
  const drafts = await read("read draft", "estimate_generated_ouvrage_drafts", { select: "id,status,created_by,preferred_lot_id", ...versionScope });
  const candidates = await read("read candidate", "estimate_generated_ouvrage_candidates", { select: "id,resolution_status,unit,quantity", ...versionScope });
  const subdetails = await read("read pending subdetail", "estimate_generated_ouvrage_subdetail_drafts", { select: "id,status,parent_work_id", ...versionScope });
  const components = await read("read proposed components", "estimate_generated_ouvrage_subdetail_items", { select: "id,status,quantity,unit,unit_cost_ht_cents,cost_type,loss_coeff_bp,yield_value,yield_unit", tenant_id: `eq.${tenantId}`, project_id: `eq.${s.projectId}`, order: "component_order.asc" });
  const applications = await read("no application", "estimate_generated_ouvrage_applications", { select: "id", ...versionScope });
  const snapshots = await read("no snapshot", "estimate_generated_ouvrage_work_snapshots", { select: "id", ...versionScope });
  const register = await read("no register", "affaire_register_entries", { select: "id", tenant_id: `eq.${tenantId}`, project_id: `eq.${s.projectId}` });
  const documents = await read("read documents", "affaire_intake_documents", { select: "id,upload_status,document_kind,document_priority,storage_path,size_bytes", tenant_id: `eq.${tenantId}`, project_id: `eq.${s.projectId}` });
  const uploads = await read("read inert uploads", "affaire_intake_uploads", { select: "id,status,attempt_count,processing_lease_token", tenant_id: `eq.${tenantId}`, project_id: `eq.${s.projectId}` });
  if (versions.length !== 1 || versions[0].status !== "draft" || versions[0].project_id !== s.projectId || [versions[0].total_ht_cents, versions[0].total_tax_cents, versions[0].total_ttc_cents].some((n) => n !== 0) ||
    items.length !== 2 || items.some((row) => row.item_type !== "section") || items[0].id !== s.sectionA || items[1].id !== s.sectionB || applications.length || snapshots.length || register.length) throw new Error("Non-pristine estimate prerequisites.");
  if (drafts.length !== 1 || drafts[0].id !== s.draftId || drafts[0].status !== "pending" || drafts[0].created_by !== ownerId || drafts[0].preferred_lot_id !== s.sectionA ||
    candidates.length !== 1 || candidates[0].id !== s.candidateId || candidates[0].resolution_status !== "pending" || candidates[0].unit !== "m" || candidates[0].quantity !== 10 ||
    subdetails.length !== 1 || subdetails[0].id !== s.subdetailId || subdetails[0].parent_work_id !== s.candidateId || subdetails[0].status !== "pending_review") throw new Error("Pending human review prerequisites differ.");
  if (components.length !== 3 || components.some((c, i) => c.id !== s.componentIds[i] || c.status !== "manual" || c.quantity !== [10, 10, 5][i] || c.unit !== ["m", "m", "h"][i] || c.cost_type !== ["material", "material", "labor"][i] || c.unit_cost_ht_cents !== [800, 1200, 4000][i] || c.loss_coeff_bp !== 0 || c.yield_value !== null || c.yield_unit !== null)) throw new Error("Component cost/hour oracle differs.");
  if (documents.length !== 2 || uploads.length !== 2 || s.sources.some((source) => {
    const d = documents.find((row) => row.id === source.documentId), u = uploads.find((row) => row.id === source.uploadId);
    return !d || d.upload_status !== "uploaded" || d.document_kind !== "cctp" || d.document_priority !== (source.revision === "A" ? "primary" : "secondary") || d.storage_path !== source.storagePath || d.size_bytes !== source.actual.bytes || !u || u.status !== "ready" || u.attempt_count !== 0 || u.processing_lease_token !== null;
  })) throw new Error("Uploaded inert CCTP prerequisites differ.");
  const value = { versions, items, drafts, candidates, subdetails, components, applications, snapshots, register, documents, uploads };
  const file = path.join(directory, `initial-${s.label}.json`);
  await fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  return { file: path.relative(root, file), sha256: sha(await fs.readFile(file)), lines: 0, applications: 0, snapshots: 0, register: 0, humanReviewStillRequired: true };
}
async function main() {
  const historicalBefore = sentinel ? await readSentinel("sentinel-before") : null;
  if (freshStack) { receipt.freshStackBefore = await inspectFreshPublicState(); await persist(); }
  if (!atomic) {
    const bucket = await request("existing intake bucket", { pathname: "/storage/v1/bucket/affaire-intake" });
    if (bucket.id !== AFFAIRE_INTAKE_BUCKET || bucket.public !== false || !bucket.allowed_mime_types?.includes("application/pdf")) throw new Error("Existing intake bucket is incompatible; no repair attempted.");
  }
  const env = { NEXT_PUBLIC_SUPABASE_URL: backend.origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey, E2E_LOGIN_EMAIL: email, E2E_LOGIN_PASSWORD: password, E2E_ALLOWED_SUPABASE_HOST: backend.hostname, RESEND_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "", GEMINI_API_KEY: "" };
  await fs.writeFile(path.join(directory, "local.env"), Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  if (freshStack) await claimFreshStack();
  receipt.status = "creating"; await persist();
  const created = await request("create new actor without email", { method: "POST", pathname: "/auth/v1/admin/users", body: { id: ownerId, email, password, email_confirm: true, user_metadata: { full_name: prefix }, app_metadata: { army_test_account: true } } });
  receipt.authReturnedUserId = typeof created.id === "string" ? created.id : null;
  await persist();
  if (created.id !== ownerId) throw new Error("Auth returned a different actor identity.");
  const memberships = await rest("new bootstrap membership", "tenant_memberships", { select: "id,tenant_id,user_id,role,is_default", user_id: `eq.${ownerId}` });
  receipt.bootstrapMemberships = memberships; await persist();
  if (memberships.length !== 1 || memberships[0].role !== "admin" || memberships[0].is_default !== true || !uuid.test(memberships[0].tenant_id)) throw new Error("Unexpected new-account bootstrap; no repair attempted.");
  tenantId = memberships[0].tenant_id;
  const tenants = await rest("new owned active tenant", "tenants", { select: "id,created_by,is_active", id: `eq.${tenantId}` });
  if (tenants.length !== 1 || tenants[0].created_by !== ownerId || tenants[0].is_active !== true) throw new Error("New account tenant ownership differs.");
  receipt.owner = { userId: ownerId, tenantId, membershipId: memberships[0].id, laborRoleId }; await persist();
  const roles = await rest("new account bootstrap roles", "labor_roles", { select: "id", user_id: `eq.${ownerId}`, tenant_id: `eq.${tenantId}` });
  receipt.bootstrapRoleIds = roles.map((role) => role.id); await persist();
  for (const role of roles) {
    bootstrapRoleIds.add(role.id);
    await rest("deactivate only new-account bootstrap role", "labor_roles", { id: `eq.${role.id}`, user_id: `eq.${ownerId}`, tenant_id: `eq.${tenantId}` }, { method: "PATCH", body: { is_active: false } });
  }
  await insert("new active RMO4000", "labor_roles", { id: laborRoleId, tenant_id: tenantId, user_id: ownerId, name: "ARMY pose", hourly_rate_cents: 4000, is_active: true, position: 0 });
  const login = await request("ordinary observer login", { method: "POST", pathname: "/auth/v1/token", query: { grant_type: "password" }, ordinary: true, body: { email, password } });
  if (login.user?.id !== ownerId || typeof login.access_token !== "string") throw new Error("Ordinary observer identity mismatch.");
  observerToken = login.access_token; secrets.push(observerToken);
  const activeRoles = await rest("ordinary unique RMO verification", "labor_roles", { select: "id,hourly_rate_cents", tenant_id: `eq.${tenantId}`, user_id: `eq.${ownerId}`, is_active: "eq.true" }, { ordinary: true });
  if (activeRoles.length !== 1 || activeRoles[0].id !== laborRoleId || activeRoles[0].hourly_rate_cents !== 4000) throw new Error("Unique labor rate oracle differs.");
  for (const scenario of plans) await addScenario(scenario);
  receipt.before = {};
  for (const scenario of plans) receipt.before[scenario.label] = await verifyScenario(scenario);
  if (sentinel) {
    const historicalAfter = await readSentinel("sentinel-after");
    if (JSON.stringify(historicalBefore) !== JSON.stringify(historicalAfter)) throw new Error("Existing fixture sentinel changed during provisioning.");
  }
  if (freshStack && JSON.stringify((await fs.readdir(path.join(root, "supabase/migrations"))).filter((name) => name.endsWith(".sql")).sort()) !== JSON.stringify(freshMigrationNames)) throw new Error("Migration file inventory changed during fresh-stack provisioning.");
  for (const input of inputs) if (sha(await fs.readFile(path.join(root, input.file))) !== input.sha256) throw new Error("Seed source changed during provisioning.");
  for (const input of receipt.evidence) if (sha(await fs.readFile(path.join(root, input.file))) !== input.sha256) throw new Error("Pinned input proof changed during provisioning.");
  const fixture = atomic ? {
    schemaVersion: "estimate-create-atomic-fixture-1", status: "ready", prefix, apiUrl: backend.origin,
    owner: receipt.owner, ...Object.fromEntries(plans.map((s) => [s.label, { projectId: s.projectId, versionId: s.versionId }])),
    createdAt: receipt.createdAt, approvalReference: profile.approvalReference, targetMode,
  } : {
    schemaVersion: "source-coverage-fixture-1", status: "ready", prefix, apiUrl: backend.origin,
    owner: receipt.owner, scenarios: Object.fromEntries(plans.map((s) => [s.label, { projectId: s.projectId, versionId: s.versionId, sectionA: s.sectionA, sectionB: s.sectionB, draftId: s.draftId, candidateId: s.candidateId, designation: s.designation, documents: Object.fromEntries(s.sources.map((source) => [source.revision, source.documentId])) }])),
    corpus: Object.fromEntries([...corpus].map(([revision, pdf]) => [revision, { sha256: pdf.sha256, bytes: pdf.bytes.length, pageCount: 3 }])),
    createdAt: receipt.createdAt, approvalReference: profile.approvalReference, targetMode,
    ...(freshStack ? { freshStackProof: { path: freshStack.relative, sha256: freshStack.sha256, projectId: freshStack.data.projectId, systemIdentifier: freshStack.data.identity.systemIdentifier } } : {}),
  };
  const fixtureFile = path.join(directory, "fixture.json");
  const fixtureBytes = JSON.stringify(fixture, null, 2) + "\n";
  receipt.status = "ready"; receipt.finishedAt = new Date().toISOString(); receipt.fixtureSha256 = sha(fixtureBytes);
  receipt.verification = { sentinelUnchanged: sentinel ? true : null, historicalDataInspected: Boolean(sentinel), freshStackNativeBeforeVerified: Boolean(freshStack), sourceBytesVerified: !atomic, ordinaryRlsReadback: true, scenarios: plans.length, emptyFinalLinesApplicationsSnapshotsRegister: atomic ? null : true, emptyLegacyItems: atomic ? true : null, uiLoginNotYetExecuted: true, privateCoverageNotInspected: true };
  await persist();
  await fs.writeFile(`${receiptFile}.sha256`, `${sha(await fs.readFile(receiptFile))}\n`, { flag: "wx" });
  await fs.writeFile(fixtureFile, fixtureBytes, { flag: "wx" });
  console.log(JSON.stringify({ status: "ready", fixture: path.relative(root, fixtureFile), fixtureSha256: receipt.fixtureSha256, provisioning: path.relative(root, receiptFile), scenarios: plans.length, noBusinessQualification: true }));
}
try { await main(); } catch (error) {
  receipt.status = receipt.pending?.mutation ? "ambiguous-mutation" : "failed";
  receipt.error = redact(error instanceof Error ? error.message : String(error)); receipt.finishedAt = new Date().toISOString();
  await persist();
  console.error(JSON.stringify({ status: receipt.status, receipt: path.relative(root, receiptFile), error: receipt.error, retryAllowed: false }));
  process.exitCode = 1;
}
