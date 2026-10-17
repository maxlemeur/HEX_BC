import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Cell, Row, Workbook, Worksheet } from "exceljs";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { COMPANY_INFO } from "@/lib/company-info";
import { normalizeDocumentIssuerDisplay } from "@/lib/documents/issuer-display";
import { computeStoredDiscountCents } from "@/lib/estimate-calculations";
import { resolveCalcEngineVersion, shouldPreserveStoredEstimateV2Snapshot } from "@/lib/estimates/calc-engine-version";
import { buildCanonicalEstimateSealPayload, computeEstimateSealHash } from "@/lib/estimates/estimate-seal";
import { streamEstimateVersionXlsx } from "@/lib/estimates/export-stream";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import { computeOfferSealHash } from "@/lib/estimates/offer-contract";
import { captureOfferClientContract } from "@/lib/estimates/offer-contract-capture";
import { loadVerifiedOfferDocument } from "@/lib/estimates/offer-document";
import { generateEstimatePdfNow, markEstimatePdfProcessing } from "@/lib/estimates/pdf-generator";
import {
  applyEstimateTermsPolicy,
  DEFAULT_ESTIMATE_PDF_LAYOUT,
  ESTIMATE_PDF_PRESETS,
  normalizeEstimatePdfLayoutOptions,
} from "@/lib/estimates/pdf-layout";
import { toEstimatePdfTermsConfiguration } from "@/lib/estimates/pdf-terms";
import { readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { formatEstimateReference } from "@/lib/estimates/reference";
import { loadEstimateSealSource, patchEstimateStatus, verifyEstimateSeal } from "@/lib/estimates/server";
import { freezeEstimateV2Snapshot } from "@/lib/estimates/v2-snapshot-server";
import { normalizeEstimateCurrency } from "@/lib/money";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

// The stored-document mirror calls the real preparer directly: this relative
// specifier is not the alias the resolve hook redirects to the spy.
import {
  buildLegacyDocumentBreakdown,
  prepareEstimateDocumentData,
} from "../../src/components/estimate-document/prepare-estimate-document-data";
import {
  corpusDigest,
  FAMILIES,
  familyVersionId,
  LOCK_SESSION_ID,
  OWNER,
  PROJECT,
  renderCorpusSeedSql,
  TENANT,
  type FamilySpec,
} from "./document-fingerprints-corpus";
import {
  canonicalize,
  canonicalText,
  sha256Hex,
  type CanonicalJson,
  type FingerprintSet,
  type StageFingerprint,
} from "./document-fingerprints-format";
import { closeFingerprintRequest, openFingerprintRequest } from "./document-fingerprints-request";
import { observePreparedDocuments, type PreparedDocumentObservation } from "./document-fingerprints-spy";

/**
 * Document fingerprint worker (design §10.3). Spawned only by
 * scripts/engine-v3/document-fingerprints.ts from the `runApplication` hook of
 * runLocalSupabaseCi, with `--import tsx --import document-fingerprints-hooks.mjs`
 * and an explicit environment for the owned loopback stack. It seeds the fixed
 * corpus, signs its owner in, drives the real server functions (PDF route
 * sequence, manual emission and acceptance, v2 freeze, seal verification,
 * XLSX export) and records canonical payloads plus their SHA-256.
 */

type VersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type ItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type SealSource = Awaited<ReturnType<typeof loadEstimateSealSource>>;
type Stage = {
  components: Record<string, unknown>;
  amounts: Record<string, CanonicalJson>;
  checks: Record<string, CanonicalJson>;
};
type ExcelJsModule = { Workbook: new () => Workbook };

const ZERO_DOCUMENT_HASH = "0".repeat(64);
const moduleRequire = createRequire(import.meta.url);

function required(name: string) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required by the fingerprint worker.`);
  return value;
}

function isLoopback(hostname: string) {
  return ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
}

function workerEnvironment() {
  const root = process.cwd();
  const apiUrl = required("NEXT_PUBLIC_SUPABASE_URL");
  const api = new URL(apiUrl);
  const database = new URL(required("ENGINE_FP_DB_URL"));
  const psql = required("ENGINE_FP_PSQL");
  const evidence = path.resolve(required("ENGINE_FP_EVIDENCE"));
  const evidenceRoot = path.join(root, ".e2e", "engine-v3", "document-fingerprints");
  if (api.protocol !== "http:" || !isLoopback(api.hostname) || api.username || api.password ||
    api.pathname !== "/" || api.search || api.hash) {
    throw new Error("The fingerprint worker accepts only the owned bare loopback API origin.");
  }
  if (!["postgres:", "postgresql:"].includes(database.protocol) || database.hostname !== api.hostname ||
    !database.port || database.port === api.port || decodeURIComponent(database.username) !== "postgres" ||
    !database.password || database.pathname !== "/postgres" || database.search || database.hash) {
    throw new Error("The fingerprint worker accepts only the owned loopback PostgreSQL of the same stack.");
  }
  if (!path.isAbsolute(psql) || !/^psql$/.test(path.basename(psql))) {
    throw new Error("The fingerprint worker requires the absolute native psql resolved by the harness.");
  }
  if (!evidence.startsWith(`${evidenceRoot}${path.sep}`)) {
    throw new Error("Fingerprint evidence must stay under .e2e/engine-v3/document-fingerprints/.");
  }
  if (process.env.NODE_ENV !== "production") {
    throw new Error("The fingerprint worker runs the server modules in production mode only.");
  }
  return {
    apiUrl,
    anonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    ownerPassword: required("ENGINE_FP_OWNER_PASSWORD"),
    database,
    psql,
    evidence,
  };
}

type WorkerEnvironment = ReturnType<typeof workerEnvironment>;

function log(message: string) {
  console.log(`ENGINE_FP ${message}`);
}

/** Owned stack only: the connection is passed through PG* variables, never argv. */
function runSql(environment: WorkerEnvironment, sql: string, marker: string) {
  const db = environment.database;
  const child = spawn(environment.psql, ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    env: {
      NODE_ENV: "production",
      PATH: process.env.PATH,
      LANG: "C.UTF-8",
      PGHOST: db.hostname === "[::1]" ? "::1" : db.hostname,
      PGPORT: db.port,
      PGUSER: "postgres",
      PGDATABASE: "postgres",
      PGPASSWORD: decodeURIComponent(db.password),
      PGCONNECT_TIMEOUT: "5",
      PGSSLMODE: "disable",
      PGCLIENTENCODING: "UTF8",
      PGAPPNAME: "engine-document-fingerprints",
      PGOPTIONS: "-c statement_timeout=120000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=120000",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  return new Promise<string[]>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, 180_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout = (stdout + chunk).slice(-4 * 1024 * 1024); });
    child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-65_536); });
    child.stdin.on("error", () => { /* The close handler reports a refused session. */ });
    child.once("error", () => { clearTimeout(timer); reject(new Error("The native psql client could not start.")); });
    child.once("close", (code) => {
      clearTimeout(timer);
      const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
      if (timedOut || code !== 0 || lines.at(-1) !== marker) {
        // The error line alone does not name the failing statement: keep
        // psql's DETAIL, HINT and CONTEXT lines (no connection data appears there).
        const errorLines = stderr.split(/\r?\n/);
        const first = errorLines.findIndex((line) => /ERROR|FATAL/.test(line));
        const detail = first < 0 ? "no SQL error line" : errorLines.slice(first)
          .filter((line, index) => index === 0 || /^(DETAIL|HINT|CONTEXT|LINE \d+|PL\/pgSQL|SQL statement)/.test(line.trim()))
          .map((line) => line.trim()).join(" | ");
        reject(new Error(`SQL step ${marker} failed (exit ${code}, timeout ${timedOut}): ${detail.slice(0, 1500)}`));
        return;
      }
      resolve(lines.slice(0, -1));
    });
    child.stdin.end(sql);
  });
}

function sqlUuid(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("Fingerprint SQL accepts only literal UUIDs.");
  }
  return `'${value}'::uuid`;
}

const VERSION_COLUMNS = [
  "id", "version_number", "status", "calc_engine_version", "title", "exclusions", "date_devis", "validite_jours",
  "currency", "margin_mode", "margin_multiplier", "discount_bp", "discount_amount_cents", "discount_mode",
  "discount_steps", "global_coefficient", "max_section_depth", "tax_rate_bp", "rounding_mode", "rounding_step_cents",
  "contractor_role", "total_ht_cents", "total_tax_cents", "total_ttc_cents", "rounding_adjustment_cents",
  "content_revision", "calc_snapshot_content_revision", "calc_snapshot_context", "approval_status", "seal_payload_version",
] as const;
const ITEM_COLUMNS = [
  "id", "parent_id", "item_type", "line_nature", "position", "title", "description", "quantity",
  "unit_price_ht_cents", "tax_rate_bp", "k_fo", "h_mo", "h_mo_majoration", "k_mo", "h_mo_atelier", "k_mo_atelier",
  "labor_role_atelier_id", "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id", "labor_role_id", "pu_ht_cents",
  "line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents", "snapshot_pu_ht_cents", "snapshot_fo_ht_cents",
  "snapshot_mo_ht_cents", "snapshot_mo_atelier_ht_cents", "snapshot_mo_chantier_ht_cents",
] as const;

/**
 * Persisted contractual state, read as `postgres` with explicit column lists:
 * columns added by later sub-lots never enter an existing fingerprint. The
 * marker-5 seal binds the PDF bytes, whose metadata is not reproducible: only
 * its presence is kept, and the seal itself is verified by the real loaders.
 */
async function readRows(environment: WorkerEnvironment, versionId: string) {
  const id = sqlUuid(versionId);
  const pairs = (alias: string, columns: readonly string[]) =>
    columns.map((column) => `'${column}', ${alias}.${column}`).join(", ");
  const sql = `select jsonb_build_object(
  'version', (select jsonb_build_object(${pairs("v", VERSION_COLUMNS)},
      'seal_hash', case when v.seal_payload_version = 5 then null else v.seal_hash end,
      'seal5_hash_present', coalesce(v.seal_payload_version = 5 and v.seal_hash ~ '^[0-9a-f]{64}$', false))
    from public.estimate_versions v where v.id = ${id}),
  'items', (select coalesce(jsonb_agg(jsonb_build_object(${pairs("i", ITEM_COLUMNS)}) order by i.id), '[]'::jsonb)
    from public.estimate_items i where i.version_id = ${id}),
  'document', (select jsonb_build_object('status', d.status, 'client_contract_version', d.client_contract_version,
      'client_contract_sha256', case when d.client_contract_snapshot is null then null
        else encode(sha256(convert_to(d.client_contract_snapshot::text, 'UTF8')), 'hex') end,
      'published_purpose', d.published_purpose, 'published_content_revision', d.published_content_revision,
      'layout_options', d.layout_options, 'terms_snapshot', d.terms_snapshot,
      'offer_document_valid', public.estimate_offer_document_valid(d, v))
    from public.estimate_documents d join public.estimate_versions v on v.id = d.version_id and v.tenant_id = d.tenant_id
    where d.version_id = ${id})
)::text;
select 'ENGINE_FP_READ';
`;
  const lines = await runSql(environment, sql, "ENGINE_FP_READ");
  if (lines.length !== 1) throw new Error("The persisted-state read returned an unexpected shape.");
  const rows = JSON.parse(lines[0]) as {
    version: Record<string, CanonicalJson> | null;
    items: Array<Record<string, CanonicalJson>>;
    document: Record<string, CanonicalJson> | null;
  };
  if (!rows.version || rows.version.id !== versionId) throw new Error(`Version ${versionId} is missing from the owned stack.`);
  return rows;
}

type PersistedRows = Awaited<ReturnType<typeof readRows>>;

function cellPayload(cell: Cell) {
  const value = cell.value;
  return {
    value: value instanceof Date ? value.toISOString() : (value ?? null),
    numFmt: cell.numFmt ?? null,
    bold: cell.font?.bold === true,
  };
}

function worksheetPayload(worksheet: Worksheet) {
  const rows: Array<{ row: number; cells: Array<{ column: number } & ReturnType<typeof cellPayload>> }> = [];
  worksheet.eachRow({ includeEmpty: true }, (row: Row, rowNumber: number) => {
    const cells: Array<{ column: number } & ReturnType<typeof cellPayload>> = [];
    row.eachCell({ includeEmpty: true }, (cell: Cell, column: number) => cells.push({ column, ...cellPayload(cell) }));
    rows.push({ row: rowNumber, cells });
  });
  return { name: worksheet.name, rows };
}

/** The real export route body, parsed back cell by cell (the ZIP bytes embed dates). */
async function readExport(versionId: string) {
  const exported = await streamEstimateVersionXlsx(versionId);
  const bytes = Buffer.from(await new Response(exported.stream).arrayBuffer());
  const { Workbook } = moduleRequire("exceljs") as ExcelJsModule;
  const workbook = new Workbook();
  // ExcelJS declares its own Buffer shape; the Node buffer is what it reads.
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  return {
    filename: exported.filename,
    contentType: exported.contentType,
    progress: exported.progress,
    sheets: workbook.worksheets.map(worksheetPayload),
  };
}

function sealMatrix(source: SealSource) {
  const hash = (options?: Parameters<typeof buildCanonicalEstimateSealPayload>[1]) =>
    computeEstimateSealHash(buildCanonicalEstimateSealPayload(source, options));
  return {
    resolvedDefault: hash(),
    payload4: hash({ payloadVersion: 4 }),
    payload3: hash({ payloadVersion: 3 }),
    payload2: hash({ payloadVersion: 2 }),
    payload1Split: hash({ payloadVersion: 1, includeCalcEngineVersion: false }),
    payload1PreSplit: hash({ payloadVersion: 1, includeCalcEngineVersion: false, includeLaborSplit: false }),
  };
}

async function ownerContext() {
  const context = await getAuthenticatedTenantContext();
  if (context.userId !== OWNER.id || context.tenantId !== TENANT.id || context.tenantRole !== "admin") {
    throw new Error("The synthesized request does not resolve to the corpus owner and tenant.");
  }
  return context;
}

async function readVersion(versionId: string): Promise<VersionRow> {
  const context = await ownerContext();
  const { data, error } = await context.supabase.from("estimate_versions").select("*")
    .eq("tenant_id", context.tenantId).eq("id", versionId).single();
  if (error || !data) throw new Error(`Version ${versionId} is not readable by its owner.`);
  return data as VersionRow;
}

function amountsOf(rows: PersistedRows): Record<string, CanonicalJson> {
  const version = rows.version!;
  return Object.fromEntries(["status", "content_revision", "calc_snapshot_content_revision", "seal_payload_version",
    "total_ht_cents", "total_tax_cents", "total_ttc_cents", "rounding_adjustment_cents"]
    .map((column) => [column, version[column] ?? null]));
}

async function baseStage(environment: WorkerEnvironment, versionId: string): Promise<Stage> {
  const context = await ownerContext();
  const rows = await readRows(environment, versionId);
  const exported = await readExport(versionId);
  const source = await loadEstimateSealSource({ supabase: context.supabase, tenantId: context.tenantId, versionId });
  return {
    components: { rows, export: exported, seal: sealMatrix(source) },
    amounts: amountsOf(rows),
    checks: rows.document ? { offerDocumentValid: rows.document.offer_document_valid ?? null } : {},
  };
}

function preparedPayload(observation: PreparedDocumentObservation) {
  const { items, ...options } = observation.input;
  return {
    input: { ...options, itemIds: items.map((item) => item.id) },
    output: { ...observation.output, rows: observation.output.rows.map(({ item, depth }) => ({ id: item.id, depth })) },
  };
}

function addPrepared(stage: Stage, observations: PreparedDocumentObservation[]) {
  if (observations.length !== 1) {
    throw new Error(`Expected exactly one real document preparation, observed ${observations.length}.`);
  }
  stage.components.prepared = preparedPayload(observations[0]);
}

/** Real offer loader; the volatile PDF digest is replaced only to recompute a reproducible seal 5. */
async function addOffer(stage: Stage, versionId: string, requireSealed: boolean) {
  const context = await ownerContext();
  const offer = await loadVerifiedOfferDocument({
    supabase: context.supabase, tenantId: context.tenantId, versionId, ...(requireSealed ? {} : { requireSealed: false }),
  });
  const { proof } = offer;
  if (proof.clientContractVersion !== 1) throw new Error("A new document must carry client contract 1.");
  const seal = stage.components.seal as ReturnType<typeof sealMatrix>;
  const normalizedProof = {
    ...proof,
    sha256Hash: ZERO_DOCUMENT_HASH,
    filePath: `${proof.tenantId}/${proof.projectId}/${proof.versionId}/${ZERO_DOCUMENT_HASH}.pdf`,
  };
  stage.components.contract = proof.clientContractSnapshot;
  stage.components.proof = {
    proofVersion: proof.proofVersion, tenantId: proof.tenantId, versionId: proof.versionId, projectId: proof.projectId,
    status: proof.status, publishedPurpose: proof.publishedPurpose, publishedDispatchId: proof.publishedDispatchId,
    publishedContentRevision: proof.publishedContentRevision, clientContractVersion: proof.clientContractVersion,
    layoutOptions: proof.layoutOptions, termsSnapshot: proof.termsSnapshot, generatedBy: proof.generatedBy,
  };
  stage.components.seal5 = {
    normalizedDocumentSha256: ZERO_DOCUMENT_HASH,
    hash: computeOfferSealHash({ calculationHash: seal.payload4, snapshot: proof.clientContractSnapshot, documentProof: normalizedProof }),
  };
  stage.checks.offerVerified = true;
  stage.checks.offerSealPayloadVersion = offer.sealPayloadVersion;
  stage.checks.offerStoredSealMatches = offer.version.seal_payload_version === 5
    ? offer.version.seal_hash?.trim().toLowerCase() === offer.sealHash : null;
  stage.amounts.contractSaleHtCents = proof.clientContractSnapshot.totals.saleHtCents;
  stage.amounts.contractTaxCents = proof.clientContractSnapshot.totals.taxCents;
  stage.amounts.contractPayableTtcCents = proof.clientContractSnapshot.totals.payableTtcCents;
  stage.amounts.contractRoundingAdjustmentCents = proof.clientContractSnapshot.totals.roundingAdjustmentCents;
}

async function addSealVerification(stage: Stage, versionId: string) {
  const verification = await verifyEstimateSeal(versionId);
  if (!verification.valid || verification.computed_hash !== verification.stored_hash) {
    throw new Error(`The real seal verification rejected version ${versionId}.`);
  }
  stage.checks.sealVerified = true;
}

/**
 * Stored-document derivation, for issued or frozen versions that the real
 * PDF generator refuses to regenerate. It mirrors only the stored branch of
 * generateEstimatePdfNow (src/lib/estimates/pdf-generator.tsx, at 98408ef0:
 * lines 1616-1621, 1676-1709, 1768-1780 and 1782-1828) and is compared with
 * the real emission preparation whenever one exists.
 */
function mirrorStoredDocument(version: VersionRow, items: ItemRow[], layoutOptions: unknown) {
  const calcEngineVersion = resolveCalcEngineVersion(version);
  const preserveStoredSnapshot = calcEngineVersion === 1
    ? version.status !== "draft"
    : shouldPreserveStoredEstimateV2Snapshot(version);
  if (!preserveStoredSnapshot) throw new Error("The stored-document mirror applies only to issued or frozen versions.");
  const layout = applyEstimateTermsPolicy(
    normalizeEstimatePdfLayoutOptions(layoutOptions ?? DEFAULT_ESTIMATE_PDF_LAYOUT),
    toEstimatePdfTermsConfiguration(null),
  );
  const vatReverseCharge = version.contractor_role === "subcontractor";
  const breakdown = buildLegacyDocumentBreakdown({
    items,
    marginMultiplier: version.margin_multiplier,
    discountCents: calcEngineVersion === 1 ? computeStoredDiscountCents(version, items) : 0,
    taxRateBp: version.tax_rate_bp,
    isLaborSplitEnabled: true,
    laborRateById: {},
    calcEngineVersion,
    globalCoefficient: version.global_coefficient,
    preserveStoredSnapshot: true,
    versionTotals: {
      status: version.status,
      discount_bp: version.discount_bp,
      discount_mode: version.discount_mode,
      discount_steps: version.discount_steps,
      discount_amount_cents: version.discount_amount_cents,
      calc_engine_version: version.calc_engine_version,
      content_revision: version.content_revision,
      calc_snapshot_content_revision: version.calc_snapshot_content_revision,
      calc_snapshot_context: version.calc_snapshot_context,
      total_ht_cents: version.total_ht_cents,
      total_tax_cents: calcEngineVersion === 1
        ? version.total_tax_cents : version.total_tax_cents - version.rounding_adjustment_cents,
      total_ttc_cents: version.total_ttc_cents,
      rounding_adjustment_cents: version.rounding_adjustment_cents,
    },
  });
  const input = {
    items,
    breakdown,
    calcEngineVersion,
    preserveStoredSnapshot,
    vatReverseCharge,
    taxRateBp: version.tax_rate_bp,
    currency: version.currency,
    validiteJours: version.validite_jours,
    layout,
  };
  const output = prepareEstimateDocumentData(input);
  const issuer = normalizeDocumentIssuerDisplay({
    issuerName: OWNER.fullName, issuerRole: OWNER.jobTitle, issuerEmail: OWNER.workEmail, fallbackName: COMPANY_INFO.name,
  });
  const totals = breakdown.totals;
  const contract = captureOfferClientContract({
    version: {
      id: version.id, tenantId: version.tenant_id, projectId: version.project_id, number: version.version_number,
      contentRevision: version.content_revision, calcEngineVersion, dateDevis: version.date_devis,
      validiteJours: version.validite_jours, currency: normalizeEstimateCurrency(version.currency) ?? "EUR",
      contractorRole: vatReverseCharge ? "subcontractor" : "principal", taxRateBp: version.tax_rate_bp,
    },
    project: {
      name: PROJECT.name, reference: PROJECT.reference,
      estimateReference: formatEstimateReference(PROJECT.estimateReference, version.version_number),
      clientName: PROJECT.clientName, siteAddress: PROJECT.siteAddress,
    },
    issuer: {
      userId: OWNER.id, displayName: issuer.displayName, displayRole: issuer.displayRole || null,
      phone: OWNER.phone, email: issuer.displayEmail || null,
    },
    company: COMPANY_INFO,
    sourceRows: items,
    prepared: output,
    sourceLineIds: new Set(breakdown.lineById.keys()),
    footer: {
      totalHtCents: totals.saleTotalCents, actualVatCents: totals.taxCents,
      amountDueCents: totals.roundedTtcCents, roundingAdjustmentCents: totals.roundingAdjustmentCents,
    },
    exclusions: version.exclusions,
  });
  return { observation: { input, output } as PreparedDocumentObservation, contract };
}

async function addMirror(stage: Stage, family: FamilySpec, versionId: string, emission?: PreparedDocumentObservation) {
  const context = await ownerContext();
  const version = await readVersion(versionId);
  const items = await readAllEstimateItems({ supabase: context.supabase, tenantId: context.tenantId, versionId });
  const rows = stage.components.rows as PersistedRows;
  const layout = rows.document?.layout_options
    ?? (family.documentPreset ? ESTIMATE_PDF_PRESETS[family.documentPreset] : null);
  const mirror = mirrorStoredDocument(version, items, layout);
  stage.components.mirrorPrepared = preparedPayload(mirror.observation);
  stage.components.mirrorContract = mirror.contract;
  if (emission) {
    stage.checks.mirrorMatchesEmission = canonicalText(preparedPayload(mirror.observation)) === canonicalText(preparedPayload(emission));
  }
}

async function versionToken(versionId: string) {
  const version = await readVersion(versionId);
  return { updatedAt: version.updated_at, contentRevision: version.content_revision };
}

function documentLayout(family: FamilySpec) {
  return family.documentPreset ? { ...ESTIMATE_PDF_PRESETS[family.documentPreset] } : undefined;
}

/** POST /api/estimates/[versionId]/pdf without `force`: claim, then generate. */
async function documentStage(environment: WorkerEnvironment, family: FamilySpec) {
  const versionId = familyVersionId(family);
  const { observations } = await observePreparedDocuments(async () => {
    const publicationClaim = await markEstimatePdfProcessing(versionId, LOCK_SESSION_ID);
    await generateEstimatePdfNow(versionId, {
      force: false, triggeredBy: "manual", layout: documentLayout(family), publicationClaim,
    });
  });
  const stage = await baseStage(environment, versionId);
  addPrepared(stage, observations);
  await addOffer(stage, versionId, false);
  return stage;
}

/** PATCH /api/estimates/[versionId]/status {status: "sent"} by the tenant admin. */
async function emissionStage(environment: WorkerEnvironment, family: FamilySpec) {
  const versionId = familyVersionId(family);
  const token = await versionToken(versionId);
  const { observations } = await observePreparedDocuments(() =>
    patchEstimateStatus(versionId, { status: "sent", force: true }, token.updatedAt, { draftLockSessionId: LOCK_SESSION_ID }));
  const stage = await baseStage(environment, versionId);
  addPrepared(stage, observations);
  await addOffer(stage, versionId, true);
  await addSealVerification(stage, versionId);
  await addMirror(stage, family, versionId, observations[0]);
  return stage;
}

/** PATCH /api/estimates/[versionId]/status {status: "accepted"}. */
async function acceptanceStage(environment: WorkerEnvironment, family: FamilySpec) {
  const versionId = familyVersionId(family);
  const token = await versionToken(versionId);
  await patchEstimateStatus(versionId, { status: "accepted" }, token.updatedAt, {});
  const stage = await baseStage(environment, versionId);
  await addOffer(stage, versionId, true);
  await addSealVerification(stage, versionId);
  await addMirror(stage, family, versionId);
  return stage;
}

/** Real v2 freeze, as the pre-contract send path did (purpose `send`). */
async function freezeStage(environment: WorkerEnvironment, family: FamilySpec) {
  const versionId = familyVersionId(family);
  const context = await ownerContext();
  const token = await versionToken(versionId);
  await freezeEstimateV2Snapshot({
    supabase: context.supabase, rpcClient: createServiceRoleClient(), tenantId: context.tenantId, versionId,
    expectedUpdatedAt: token.updatedAt, expectedContentRevision: token.contentRevision,
    actorUserId: context.userId, purpose: "send",
  });
  const stage = await baseStage(environment, versionId);
  await addMirror(stage, family, versionId);
  return stage;
}

/**
 * Synthetic historical issuance, the only bypass of the application path:
 * versions issued before contract 1 can no longer be produced by today's
 * code. The seal is today's builder output for the historical payload and is
 * pinned by the baseline; the real verifier must accept it afterwards.
 */
async function issuedStage(environment: WorkerEnvironment, family: FamilySpec) {
  const seal = family.historicalSeal;
  if (!seal) throw new Error(`Family ${family.key} has no historical seal.`);
  const versionId = familyVersionId(family);
  const context = await ownerContext();
  const source = await loadEstimateSealSource({ supabase: context.supabase, tenantId: context.tenantId, versionId });
  const hash = computeEstimateSealHash(buildCanonicalEstimateSealPayload(source, {
    payloadVersion: seal.payloadVersion,
    ...(seal.includeCalcEngineVersion === undefined ? {} : { includeCalcEngineVersion: seal.includeCalcEngineVersion }),
    ...(seal.includeLaborSplit === undefined ? {} : { includeLaborSplit: seal.includeLaborSplit }),
  }));
  if (!/^[0-9a-f]{64}$/.test(hash) || !["sent", "accepted"].includes(seal.status) ||
    (seal.marker !== null && ![1, 2, 3, 4].includes(seal.marker))) {
    throw new Error("Invalid synthetic historical seal.");
  }
  const id = sqlUuid(versionId);
  await runSql(environment, `begin;
set local lock_timeout = '5s';
alter table public.estimate_versions disable trigger user;
update public.estimate_versions set status = '${seal.status}', seal_hash = '${hash}', seal_payload_version = ${seal.marker ?? "null"}
where id = ${id} and status = 'draft' and seal_hash is null and seal_payload_version is null;
do $issued$
begin
  if (select count(*) from public.estimate_versions where id = ${id} and status = '${seal.status}' and seal_hash = '${hash}') <> 1 then
    raise exception 'ENGINE_FP_ISSUE: the synthetic historical issuance did not apply exactly once';
  end if;
end
$issued$;
alter table public.estimate_versions enable trigger user;
delete from public.draft_locks where version_id = ${id};
commit;
select 'ENGINE_FP_ISSUED';
`, "ENGINE_FP_ISSUED");
  const stage = await baseStage(environment, versionId);
  stage.amounts.historicalSealHash = hash;
  stage.amounts.historicalSealPayloadVersion = seal.payloadVersion;
  await addSealVerification(stage, versionId);
  await addMirror(stage, family, versionId);
  return stage;
}

/** Error text with the application error code and details, never a stack or a secret. */
function describeError(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const { code, details } = error as Error & { code?: unknown; details?: unknown };
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details).slice(0, 2000)}`;
  return `${typeof code === "string" ? `[${code}] ` : ""}${error.message}${suffix}`;
}

async function runFamily(environment: WorkerEnvironment, family: FamilySpec) {
  const stages: Record<string, Stage> = {};
  const step = async (name: string, run: () => Promise<Stage>) => {
    try {
      stages[name] = await run();
    } catch (error) {
      throw new Error(`${family.key} / ${name}: ${describeError(error)}`, { cause: error });
    }
  };
  await step("seeded", () => baseStage(environment, familyVersionId(family)));
  switch (family.flow) {
    case "export":
      break;
    case "document":
      await step("document", () => documentStage(environment, family));
      break;
    case "emission":
    case "emission-accept":
      await step("document", () => documentStage(environment, family));
      await step("sent", () => emissionStage(environment, family));
      if (family.flow === "emission-accept") await step("accepted", () => acceptanceStage(environment, family));
      break;
    case "historical-v1":
      await step("issued", () => issuedStage(environment, family));
      break;
    case "historical-v2":
      await step("frozen", () => freezeStage(environment, family));
      await step("issued", () => issuedStage(environment, family));
      break;
  }
  return stages;
}

function finalizeStage(environment: WorkerEnvironment, familyKey: string, stageName: string, stage: Stage): StageFingerprint {
  const directory = path.join(environment.evidence, "payloads", familyKey, stageName);
  fs.mkdirSync(directory, { recursive: true });
  const sha256: Record<string, string> = {};
  for (const [component, payload] of Object.entries(stage.components).sort(([left], [right]) => left.localeCompare(right))) {
    const canonical = canonicalize(payload, `${familyKey}.${stageName}.${component}`);
    sha256[component] = sha256Hex(JSON.stringify(canonical));
    fs.writeFileSync(path.join(directory, `${component}.json`), `${JSON.stringify(canonical, null, 2)}\n`, { flag: "wx" });
  }
  const amounts = canonicalize(stage.amounts) as Record<string, CanonicalJson>;
  const checks = canonicalize(stage.checks) as Record<string, CanonicalJson>;
  return { sha256, amounts, checks };
}

async function createOwner(environment: WorkerEnvironment) {
  const service = createClient<Database>(environment.apiUrl, environment.serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const { data, error } = await service.auth.admin.createUser({
    id: OWNER.id, email: OWNER.email, password: environment.ownerPassword, email_confirm: true,
    user_metadata: { full_name: OWNER.fullName },
  });
  if (error || data.user?.id !== OWNER.id) {
    throw new Error(`The fixed corpus owner could not be created in the owned Auth service (${error?.code ?? "identity mismatch"}).`);
  }
}

/** Real password sign-in through @supabase/ssr; its cookies form the synthesized request. */
async function signIn(environment: WorkerEnvironment) {
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(environment.apiUrl, environment.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          if (value && options?.maxAge !== 0) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });
  const { data, error } = await client.auth.signInWithPassword({ email: OWNER.email, password: environment.ownerPassword });
  if (error || data.user?.id !== OWNER.id) throw new Error(`The corpus owner could not sign in (${error?.code ?? "identity mismatch"}).`);
  for (let attempt = 0; jar.size === 0 && attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (jar.size === 0) throw new Error("The owner sign-in produced no session cookie.");
  return jar;
}

async function main() {
  const environment = workerEnvironment();
  fs.mkdirSync(environment.evidence, { recursive: true });
  log("creating the fixed corpus owner");
  await createOwner(environment);
  log("seeding the corpus");
  await runSql(environment, renderCorpusSeedSql(), "ENGINE_FP_SEED_COMMITTED");
  const cookies = await signIn(environment);
  openFingerprintRequest({ cookies, headers: new Headers({ [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: LOCK_SESSION_ID }) });
  try {
    await ownerContext();
    const families: FingerprintSet = {};
    for (const family of FAMILIES) {
      log(`family ${family.key} (${family.flow})`);
      const stages = await runFamily(environment, family);
      families[family.key] = {
        versionId: familyVersionId(family),
        engine: family.engine,
        flow: family.flow,
        stages: Object.fromEntries(Object.entries(stages)
          .map(([name, stage]) => [name, finalizeStage(environment, family.key, name, stage)])),
      };
    }
    const result = {
      schemaVersion: "engine-document-fingerprints-worker-1",
      corpusSha256: corpusDigest(),
      runtime: {
        node: process.version, icu: process.versions.icu ?? null, platform: `${process.platform}-${process.arch}`,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, nodeEnv: process.env.NODE_ENV ?? null,
      },
      families,
    };
    fs.writeFileSync(path.join(environment.evidence, "worker-result.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    log(`recorded ${Object.keys(families).length} families`);
  } finally {
    closeFingerprintRequest();
  }
}

main().catch((error: unknown) => {
  console.error(`ENGINE_FP worker failed: ${describeError(error)}`);
  process.exitCode = 1;
});
