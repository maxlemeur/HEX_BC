import "server-only";

import { createHash } from "node:crypto";

import { mapSupabaseError } from "@/lib/http/api-response";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { readAllRows } from "@/lib/supabase/read-all";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  type AuthenticatedTakeoffContext,
} from "@/lib/takeoff/job-read-server";
import { TAKEOFF_PAGE_TRIAGE_TEXT, takeoffPageTriageRenderLimits } from "@/lib/takeoff/page-triage-server";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import {
  normalizePlanLocationValue,
  readPlanLocation,
  resolvePlanLocation,
  type PlanLocationAnnotationValues,
  type PlanLocationReading,
} from "@/lib/takeoff/plan-location";
import {
  takeoffJobPlanLocationsSchema,
  takeoffPlanFileLocationSchema,
  takeoffPlanLocationSaveSchema,
  type TakeoffJobPlanLocation,
  type TakeoffJobPlanLocations,
  type TakeoffPlanFileLocation,
} from "@/lib/takeoff/plan-location-contracts";
import { PLAN_FILE_MAX_SIZE_BYTES } from "@/lib/takeoff/plans";
import type { PlanRevisionDecision } from "@/lib/takeoff/plan-revision-identity";
import { parsePreparationSnapshot } from "@/lib/takeoff/preparation-source-loader";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import { isRecord } from "@/lib/value-guards";

/**
 * The building and the level of a plan revision, read and corrected in one place (lot 3, migration B). A revision is
 * the source the database resolves for a plan file (its dossier piece, or itself) at the SHA-256 of the bytes this
 * server read: a value is never shown on bytes it was not made for, and a correction is written through the current
 * copy only, by `set_takeoff_plan_location`, which re-checks the member, the source and the generation it saw. Nothing
 * here writes a plan file, a preparation, a job or an estimate.
 */

/** Title blocks read per plan, and per analysis across its plans: a plan centre or review opening, never a poll. */
const MAX_PAGES_READ = 12;
const MAX_JOB_PAGES_READ = 40;

type Supabase = AuthenticatedTakeoffContext["supabase"];
type SourceRow = { source_kind: "intake_document" | "plan_file"; source_id: string; plan_file_id: string; current_copy: boolean; can_write: boolean };
type RevisionKey = { source_kind: SourceRow["source_kind"]; source_id: string; content_hash: string };
type AnnotationRow = PlanLocationAnnotationValues & RevisionKey & {
  id: string; revision: number; carried_from_id: string | null; document_name: string;
  updated_by: string; updated_at: string; created_at: string;
};
type PlanFileRow = { id: string; plan_set_id: string; file_name: string; file_path: string; file_size_bytes: number; page_count: number | null; metadata: Record<string, unknown> | null };
type LoadedPlanFile = { projectId: string; file: PlanFileRow; source: SourceRow; documentName: string };

const ANNOTATION_SELECT = "id,source_kind,source_id,content_hash,revision,building,level,carried_from_id,document_name,updated_by,updated_at,created_at";

function notFound(message: string): never {
  throw new TakeoffError({ status: 404, code: TakeoffErrorCode.NOT_FOUND, message, retryable: false });
}

function readFailure(error: unknown, message: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sameKey = (left: RevisionKey, right: RevisionKey) =>
  left.source_kind === right.source_kind && left.source_id === right.source_id && left.content_hash === right.content_hash;

async function readSource(supabase: Supabase, projectId: string, planFileId: string): Promise<SourceRow | null> {
  const { data, error } = await supabase.rpc("read_takeoff_plan_location_source" as never,
    { p_project_id: projectId, p_plan_file_id: planFileId } as never);
  if (error) readFailure(error, "Impossible d’identifier la version du plan.");
  return ((data ?? []) as SourceRow[])[0] ?? null;
}

/** The bytes under the member's own Storage rights; null when they cannot be read. */
async function readPlanBytes(supabase: Supabase, filePath: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from(PLAN_FILES_BUCKET).download(filePath);
  if (error || !data || data.size === 0 || data.size > PLAN_FILE_MAX_SIZE_BYTES) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** The title block text of the first pages (or of the given ones); null pages could not be read. */
async function readTitleBlocks(bytes: Uint8Array, pages: number[]) {
  if (!pages.length) return { pageCount: null, pages: [], failed: false };
  const result = await renderPdfPages(bytes, {
    pages, maxTextCharsPerPage: 200, maxTextItemsPerPage: TAKEOFF_PAGE_TRIAGE_TEXT.maxTextItemsPerPage,
    textRegion: TAKEOFF_PAGE_TRIAGE_TEXT.textRegion, limits: takeoffPageTriageRenderLimits(pages.length),
  });
  const read = new Map(result.pages.map((page) => [page.page, page.failed ? null : page.regionText ?? ""]));
  return {
    pageCount: result.pageCount,
    pages: pages.filter((page) => !result.missingPages.includes(page)).map((page) => ({ page, titleBlockText: read.get(page) ?? null })),
    failed: result.status === "failed",
  };
}

async function readLocationOfBytes(bytes: Uint8Array, documentName: string, pages: number[], pageCount: number | null) {
  const titleBlocks = await readTitleBlocks(bytes, pages);
  return {
    reading: readPlanLocation({ documentName, pageCount: titleBlocks.pageCount ?? pageCount, pages: titleBlocks.pages }),
    failed: titleBlocks.failed,
  };
}

async function listAnnotations(supabase: Supabase, tenantId: string, projectId: string): Promise<AnnotationRow[]> {
  const { data, error } = await readAllRows(() => supabase.from("takeoff_plan_locations" as never)
    .select(ANNOTATION_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, tenantId as never).eq("project_id" as never, projectId as never)
    .order("updated_at" as never, { ascending: false }).order("id" as never));
  if (error) readFailure(error, "Impossible de charger les localisations des plans.");
  return (data ?? []) as unknown as AnnotationRow[];
}

async function authorNames(supabase: Supabase, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, string>();
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  if (error) readFailure(error, "Impossible de charger les auteurs des localisations.");
  return new Map((data ?? []).filter((row) => typeof row.full_name === "string" && row.full_name.trim())
    .map((row) => [row.id, row.full_name!.trim()] as const));
}

function annotationOut(row: AnnotationRow, names: Map<string, string>) {
  return {
    id: row.id, revision: row.revision, building: row.building, level: row.level, carried_from_id: row.carried_from_id,
    document_name: row.document_name, updated_by: row.updated_by, updated_by_name: names.get(row.updated_by) ?? null,
    updated_at: row.updated_at, created_at: row.created_at,
  };
}

/**
 * The revisions the member's own decisions tie to these bytes: a pair of plans the preparation settled as one plan
 * (one replaces the other). Two pieces that merely share a name (two buildings' « Plan RDC ») are never linked.
 */
async function decidedPeers(supabase: Supabase, projectId: string, planFileId: string, contentHash: string,
  decisions: readonly PlanRevisionDecision[]): Promise<RevisionKey[]> {
  const peers: RevisionKey[] = [];
  for (const { left, right, choice } of decisions) {
    if (choice === "distinct") continue;
    const other = left.document_id === planFileId && left.content_hash === contentHash ? right
      : right.document_id === planFileId && right.content_hash === contentHash ? left : null;
    if (!other || other.document_id === planFileId) continue;
    const source = await readSource(supabase, projectId, other.document_id);
    if (source) peers.push({ source_kind: source.source_kind, source_id: source.source_id, content_hash: other.content_hash });
  }
  return peers;
}

/** The latest correction of another revision of the same plan: same source with other bytes, or a decided peer. */
function carryOverFor(rows: readonly AnnotationRow[], key: RevisionKey, peers: readonly RevisionKey[]) {
  const row = rows.find((candidate) => !sameKey(candidate, key) && (
    (candidate.source_kind === key.source_kind && candidate.source_id === key.source_id) || peers.some((peer) => sameKey(peer, candidate))));
  return row ? { row, same_source: row.source_kind === key.source_kind && row.source_id === key.source_id } : null;
}

async function readPreparationDraft(context: AuthenticatedTakeoffContext, projectId: string) {
  const { data, error } = await context.supabase.from("takeoff_preparations" as never).select("draft" as never)
    .eq("tenant_id" as never, context.tenantId as never).eq("project_id" as never, projectId as never).maybeSingle();
  if (error) readFailure(error, "Impossible de charger la préparation de l’affaire.");
  const draft = (data as { draft?: unknown } | null)?.draft;
  return isRecord(draft) ? draft : null;
}

function revisionDecisions(preparation: Record<string, unknown> | null): PlanRevisionDecision[] {
  const decisions = preparation?.plan_revision_decisions;
  return Array.isArray(decisions) ? decisions.filter((entry): entry is PlanRevisionDecision => isRecord(entry)
    && isRecord(entry.left) && isRecord(entry.right) && typeof entry.left.document_id === "string" && typeof entry.right.document_id === "string"
    && typeof entry.left.content_hash === "string" && typeof entry.right.content_hash === "string"
    && (entry.choice === "left" || entry.choice === "right" || entry.choice === "distinct")) : [];
}

/** The brief's and the scope's buildings and levels: typing aids only. */
function suggestions(preparation: Record<string, unknown> | null) {
  const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  const scope = isRecord(preparation?.scope) ? preparation.scope : {};
  const brief = isRecord(preparation?.provenance) && isRecord(preparation.provenance.brief_context) ? preparation.provenance.brief_context : {};
  const clean = (values: string[]) => [...new Set(values.flatMap((value) => {
    try { return [normalizePlanLocationValue(value)].filter((entry): entry is string => entry !== null); } catch { return []; }
  }))].slice(0, 20);
  return { building: clean([...strings(scope.buildings), ...strings(brief.buildings)]), level: clean(strings(scope.levels)) };
}

async function loadPlanFile(context: AuthenticatedTakeoffContext, setId: string, fileId: string): Promise<LoadedPlanFile> {
  const { data: set, error: setError } = await context.supabase.from("plan_sets").select("id,project_id")
    .eq("tenant_id", context.tenantId).eq("id", setId).maybeSingle();
  if (setError) readFailure(setError, "Impossible de charger le jeu de plans.");
  if (!set?.project_id) notFound("Jeu de plans introuvable.");
  const { data: file, error: fileError } = await context.supabase.from("plan_files")
    .select("id,plan_set_id,file_name,file_path,file_size_bytes,page_count,metadata")
    .eq("tenant_id", context.tenantId).eq("id", fileId).eq("plan_set_id", setId).maybeSingle();
  if (fileError) readFailure(fileError, "Impossible de charger le plan.");
  if (!file) notFound("Plan introuvable.");
  const source = await readSource(context.supabase, set.project_id, fileId);
  if (!source) notFound("Plan introuvable.");
  const row = file as unknown as PlanFileRow;
  return { projectId: set.project_id, file: row, source, documentName: getPlanFileDisplayName({ file_name: row.file_name, metadata: row.metadata }) };
}

async function buildPlanFileLocation(context: AuthenticatedTakeoffContext, loaded: LoadedPlanFile, knownBytes?: Uint8Array): Promise<TakeoffPlanFileLocation> {
  const bytes = knownBytes ?? await readPlanBytes(context.supabase, loaded.file.file_path);
  if (!bytes) notFound("Le PDF de ce plan est introuvable : sa localisation ne peut pas être lue.");
  const contentHash = sha256(bytes);
  const key: RevisionKey = { source_kind: loaded.source.source_kind, source_id: loaded.source.source_id, content_hash: contentHash };
  const pageCount = loaded.file.page_count;
  const pages = Array.from({ length: Math.min(pageCount ?? MAX_PAGES_READ, MAX_PAGES_READ) }, (_, index) => index + 1);
  let reading: PlanLocationReading;
  let readingIssue: TakeoffPlanFileLocation["reading_issue"] = null;
  try {
    const read = await readLocationOfBytes(bytes, loaded.documentName, pages, pageCount);
    reading = read.reading;
    if (read.failed) readingIssue = "unreadable";
  } catch {
    reading = readPlanLocation({ documentName: loaded.documentName, pageCount, pages: [] });
    readingIssue = "unreadable";
  }
  const [rows, preparation] = await Promise.all([
    listAnnotations(context.supabase, context.tenantId, loaded.projectId),
    readPreparationDraft(context, loaded.projectId),
  ]);
  const exact = rows.find((row) => sameKey(row, key)) ?? null;
  const carry = exact ? null : carryOverFor(rows, key,
    await decidedPeers(context.supabase, loaded.projectId, loaded.file.id, contentHash, revisionDecisions(preparation)));
  const names = await authorNames(context.supabase, [exact?.updated_by, carry?.row.updated_by].filter((id): id is string => Boolean(id)));
  return takeoffPlanFileLocationSchema.parse({
    project_id: loaded.projectId, plan_set_id: loaded.file.plan_set_id, plan_file_id: loaded.file.id, document_name: loaded.documentName,
    revision: key, current_copy: loaded.source.current_copy, reading, reading_issue: readingIssue,
    annotation: exact ? annotationOut(exact, names) : null,
    carry_over: carry ? { ...annotationOut(carry.row, names), content_hash: carry.row.content_hash, same_source: carry.same_source } : null,
    location: resolvePlanLocation({ reading, annotation: exact, carryOver: carry?.row ?? null }),
    suggestions: suggestions(preparation),
    can_edit: loaded.source.can_write && loaded.source.current_copy,
  });
}

function parseIds(setId: string, fileId: string) {
  return {
    setId: parseWithSchema(takeoffJobIdSchema, setId, "Identifiant du jeu de plans invalide.").toLowerCase(),
    fileId: parseWithSchema(takeoffJobIdSchema, fileId, "Identifiant du plan invalide.").toLowerCase(),
  };
}

export async function readTakeoffPlanFileLocation(input: { setId: string; fileId: string }) {
  const { setId, fileId } = parseIds(input.setId, input.fileId);
  const context = await getAuthenticatedTakeoffContext();
  return buildPlanFileLocation(context, await loadPlanFile(context, setId, fileId));
}

function saveRefused(error: { message?: string; code?: string }): never {
  const message = error.message ?? "";
  if (message.includes("TAKEOFF_PLAN_LOCATION_CONFLICT")) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "La localisation de ce plan a été enregistrée entre-temps, dans un autre onglet ou par un autre membre. La valeur enregistrée est affichée : vérifiez-la avant d’enregistrer à nouveau.",
      details: { reason: "TAKEOFF_PLAN_LOCATION_CONFLICT" } });
  }
  if (message.includes("TAKEOFF_PLAN_LOCATION_SOURCE_STALE")) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Ce plan vient d’être remplacé dans le dossier. Rechargez la page des plans avant de corriger sa localisation.",
      details: { reason: "TAKEOFF_PLAN_LOCATION_SOURCE_STALE" } });
  }
  if (message.includes("TAKEOFF_PLAN_LOCATION_FORBIDDEN")) {
    throw new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false,
      message: "Seuls les opérateurs de l’affaire corrigent la localisation d’un plan." });
  }
  if (message.includes("TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND")) notFound("Plan introuvable.");
  if (message.includes("TAKEOFF_PLAN_LOCATION_VALUE_INVALID") || message.includes("TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID")
    || message.includes("TAKEOFF_PLAN_LOCATION_REVISION_INVALID")) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: "Cette localisation ne peut pas être enregistrée : vérifiez le bâtiment et le niveau saisis." });
  }
  readFailure(error, "Impossible d’enregistrer la localisation du plan.");
}

export async function saveTakeoffPlanFileLocation(input: { setId: string; fileId: string; body: unknown }) {
  const { setId, fileId } = parseIds(input.setId, input.fileId);
  const body = parseWithSchema(takeoffPlanLocationSaveSchema, input.body, "Localisation invalide.");
  let building: string | null;
  let level: string | null;
  try {
    building = body.building === null ? null : normalizePlanLocationValue(body.building);
    level = body.level === null ? null : normalizePlanLocationValue(body.level);
  } catch (error) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: error instanceof RangeError ? error.message : "Localisation invalide." });
  }
  const context = await getAuthenticatedTakeoffContext();
  const loaded = await loadPlanFile(context, setId, fileId);
  if (!loaded.source.can_write) saveRefused({ message: "TAKEOFF_PLAN_LOCATION_FORBIDDEN" });
  if (!loaded.source.current_copy) saveRefused({ message: "TAKEOFF_PLAN_LOCATION_SOURCE_STALE" });
  // The revision is the bytes this server reads now, never the digest a screen sends.
  const bytes = await readPlanBytes(context.supabase, loaded.file.file_path);
  if (!bytes) notFound("Le PDF de ce plan est introuvable : sa localisation ne peut pas être enregistrée.");
  if (sha256(bytes) !== body.content_hash) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false,
      message: "Le contenu de ce plan a changé depuis son affichage. Vérifiez sa nouvelle localisation avant de l’enregistrer.",
      details: { reason: "TAKEOFF_PLAN_LOCATION_REVISION_CHANGED" } });
  }
  const { error } = await context.supabase.rpc("set_takeoff_plan_location" as never, {
    p_project_id: loaded.projectId, p_plan_file_id: loaded.file.id, p_content_hash: body.content_hash,
    p_expected_revision: body.expected_revision, p_building: building, p_level: level,
    p_document_name: loaded.documentName, p_carried_from_id: body.carried_from_id,
  } as never);
  if (error) saveRefused(error);
  return buildPlanFileLocation(context, loaded, bytes);
}

/**
 * The location of each plan an analysis read, at the revision its preparation attested. The reading is made from
 * those bytes only while they are still the plan's; otherwise only the file name and the corrections remain.
 */
export async function readTakeoffJobPlanLocations(jobId: string): Promise<TakeoffJobPlanLocations> {
  jobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant du métré invalide.").toLowerCase();
  const context = await getAuthenticatedTakeoffContext();
  const job = await getTakeoffJobDetailByIdOrThrow({ supabase: context.supabase, tenantId: context.tenantId, jobId });
  const { data, error } = await context.supabase.from("takeoff_jobs").select("preparation_snapshot")
    .eq("tenant_id", context.tenantId).eq("id", jobId).maybeSingle();
  if (error) readFailure(error, "Impossible de charger la préparation du métré.");
  let snapshot: ReturnType<typeof parsePreparationSnapshot> = null;
  try { snapshot = parsePreparationSnapshot(data?.preparation_snapshot); } catch { snapshot = null; }
  const sources = (snapshot?.preparation.sources ?? []).filter((source) => source.kind === "plan" && source.active && source.confirmed
    && !source.document_id.startsWith("upload:") && takeoffJobIdSchema.safeParse(source.document_id).success);
  if (!snapshot || !sources.length) {
    return takeoffJobPlanLocationsSchema.parse({ job_id: jobId, project_id: job.project_id, plans: [], without_preparation: !snapshot, can_edit: false });
  }
  const rows = await listAnnotations(context.supabase, context.tenantId, job.project_id);
  const decisions = snapshot.preparation.plan_revision_decisions ?? [];
  let pagesLeft = MAX_JOB_PAGES_READ;
  let canEdit = false;
  const plans: TakeoffJobPlanLocation[] = [];
  const authors = new Set<string>();
  const pending: Array<{ plan: Omit<TakeoffJobPlanLocation, "annotation" | "carry_over">; exact: AnnotationRow | null; carry: ReturnType<typeof carryOverFor> }> = [];
  for (const source of sources) {
    const planFileId = source.document_id.toLowerCase();
    const sourceRow = await readSource(context.supabase, job.project_id, planFileId);
    canEdit ||= Boolean(sourceRow?.can_write && sourceRow.current_copy);
    const { data: file, error: fileError } = await context.supabase.from("plan_files").select("file_path,page_count")
      .eq("tenant_id", context.tenantId).eq("id", planFileId).maybeSingle();
    if (fileError) readFailure(fileError, "Impossible de charger un plan du métré.");
    const bytes = sourceRow && file && file.file_path === source.file_path ? await readPlanBytes(context.supabase, file.file_path) : null;
    const status = !sourceRow || !bytes ? "unavailable" : sha256(bytes) === source.content_hash ? "current" : "changed";
    let reading = readPlanLocation({ documentName: source.document_name, pageCount: source.page_count, pages: [] });
    if (status === "current" && bytes && pagesLeft > 0) {
      const wanted = (source.pages.length ? source.pages : Array.from({ length: source.page_count ?? MAX_PAGES_READ }, (_, index) => index + 1))
        .slice(0, Math.min(MAX_PAGES_READ, pagesLeft));
      pagesLeft -= wanted.length;
      try { reading = (await readLocationOfBytes(bytes, source.document_name, wanted, source.page_count)).reading; } catch { /* the file name reading stays */ }
    }
    const key = sourceRow && source.content_hash
      ? { source_kind: sourceRow.source_kind, source_id: sourceRow.source_id, content_hash: source.content_hash } : null;
    const exact = key ? rows.find((row) => sameKey(row, key)) ?? null : null;
    const carry = key && !exact
      ? carryOverFor(rows, key, await decidedPeers(context.supabase, job.project_id, planFileId, key.content_hash, decisions)) : null;
    for (const id of [exact?.updated_by, carry?.row.updated_by]) if (id) authors.add(id);
    pending.push({ exact, carry, plan: {
      plan_file_id: planFileId, plan_set_id: source.plan_set_id, document_name: source.document_name, pages: source.pages,
      revision: key, status, reading, location: resolvePlanLocation({ reading, annotation: exact, carryOver: carry?.row ?? null }),
    } });
  }
  const names = await authorNames(context.supabase, [...authors]);
  for (const { plan, exact, carry } of pending) {
    plans.push({ ...plan, annotation: exact ? annotationOut(exact, names) : null,
      carry_over: carry ? { ...annotationOut(carry.row, names), content_hash: carry.row.content_hash, same_source: carry.same_source } : null });
  }
  return takeoffJobPlanLocationsSchema.parse({ job_id: jobId, project_id: job.project_id, plans, without_preparation: false, can_edit: canEdit });
}
