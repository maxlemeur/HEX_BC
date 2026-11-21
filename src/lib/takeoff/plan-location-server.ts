import "server-only";

import { createHash } from "node:crypto";

import { mapSupabaseError } from "@/lib/http/api-response";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
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
  selectPlanLocationCarryOver,
  type PlanLocationAnnotationValues,
  type PlanLocationField,
  type PlanLocationReading,
  type PlanLocationRevisionKey,
} from "@/lib/takeoff/plan-location";
import {
  takeoffJobPlanLocationsSchema,
  takeoffPlanFileLocationSchema,
  takeoffPlanLocationSaveSchema,
  type TakeoffJobPlanLocation,
  type TakeoffJobPlanLocations,
  type TakeoffPlanFileLocation,
} from "@/lib/takeoff/plan-location-contracts";
import { PLAN_FILE_MAX_SIZE_BYTES, planFileIdSchema, planSetIdSchema } from "@/lib/takeoff/plans";
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

/** Title blocks read per plan, and per review across its plans: a plan centre or review opening, never a poll. */
const MAX_PAGES_READ = 12;
const MAX_JOB_PAGES_READ = 40;

type Supabase = AuthenticatedTakeoffContext["supabase"];
type SourceRow = { source_kind: PlanLocationRevisionKey["source_kind"]; source_id: string; plan_file_id: string; current_copy: boolean; can_write: boolean };
type AnnotationRow = PlanLocationAnnotationValues & PlanLocationRevisionKey & {
  id: string; revision: number; carried_from_id: string | null; document_name: string;
  updated_by: string; updated_at: string; created_at: string;
};
type EventRow = { location_id: string; revision: number; action: string; building_before: string | null; level_before: string | null;
  building: string | null; level: string | null; actor_id: string; created_at: string };
type PlanFileRow = { id: string; plan_set_id: string; file_name: string; file_path: string; file_size_bytes: number; page_count: number | null };
type LoadedPlanFile = { projectId: string; file: PlanFileRow; source: SourceRow; documentName: string };
type Carry = { row: AnnotationRow; same_source: boolean } | null;

const ANNOTATION_SELECT = "id,source_kind,source_id,content_hash,revision,building,level,carried_from_id,document_name,updated_by,updated_at,created_at";

function notFound(message: string): never {
  throw new TakeoffError({ status: 404, code: TakeoffErrorCode.NOT_FOUND, message, retryable: false });
}

function readFailure(error: unknown, message: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sameKey = (left: PlanLocationRevisionKey, right: PlanLocationRevisionKey) =>
  left.source_kind === right.source_kind && left.source_id === right.source_id && left.content_hash === right.content_hash;

async function readSource(supabase: Supabase, projectId: string, planFileId: string): Promise<SourceRow | null> {
  const { data, error } = await supabase.rpc("read_takeoff_plan_location_source", { p_project_id: projectId, p_plan_file_id: planFileId });
  if (error) readFailure(error, "Impossible d’identifier la version du plan.");
  return ((data ?? []) as SourceRow[])[0] ?? null;
}

/** The bytes under the member's own Storage rights; null when they cannot be read or exceed a plan's size. */
async function readPlanBytes(supabase: Supabase, file: { file_path: string; file_size_bytes: number }): Promise<Uint8Array | null> {
  if (file.file_size_bytes > PLAN_FILE_MAX_SIZE_BYTES) return null;
  const { data, error } = await supabase.storage.from(PLAN_FILES_BUCKET).download(file.file_path);
  if (error || !data || data.size === 0 || data.size > PLAN_FILE_MAX_SIZE_BYTES) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** The title block text of the given pages; null pages could not be read. */
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

/** The reading of these bytes; a PDF that cannot be read leaves its name only, with the title block marked unread. */
async function readLocationOfBytes(bytes: Uint8Array, documentName: string, pages: number[], pageCount: number | null) {
  try {
    const titleBlocks = await readTitleBlocks(bytes, pages);
    if (titleBlocks.failed) return { reading: readPlanLocation({ documentName, pageCount, pages: [] }), failed: true };
    return { reading: readPlanLocation({ documentName, pageCount: titleBlocks.pageCount ?? pageCount, pages: titleBlocks.pages }), failed: false };
  } catch {
    return { reading: readPlanLocation({ documentName, pageCount, pages: [] }), failed: true };
  }
}

async function listAnnotations(supabase: Supabase, tenantId: string, projectId: string): Promise<AnnotationRow[]> {
  const { data, error } = await readAllRows(() => supabase.from("takeoff_plan_locations")
    .select(ANNOTATION_SELECT, { count: "exact" })
    .eq("tenant_id", tenantId).eq("project_id", projectId)
    .order("updated_at", { ascending: false }).order("id"));
  if (error) readFailure(error, "Impossible de charger les localisations des plans.");
  return (data ?? []) as unknown as AnnotationRow[];
}

/** For each corrected field of these annotations, the member who set its current value and when. */
async function fieldAuthors(supabase: Supabase, annotations: readonly AnnotationRow[]) {
  const ids = [...new Set(annotations.map((row) => row.id))];
  const events: EventRow[] = [];
  if (ids.length) {
    const { data, error } = await readAllRowsInChunks(ids, (chunk) => supabase.from("takeoff_plan_location_events")
      .select("location_id,revision,action,building_before,level_before,building,level,actor_id,created_at", { count: "exact" })
      .in("location_id", chunk));
    if (error) readFailure(error, "Impossible de charger l’historique des localisations.");
    events.push(...((data ?? []) as unknown as EventRow[]));
  }
  const authorOf = (annotation: AnnotationRow, field: PlanLocationField) => {
    if (annotation[field] === null) return null;
    const set = events.filter((event) => event.location_id === annotation.id).sort((left, right) => right.revision - left.revision)
      .find((event) => event[field] === annotation[field] && (event.action === "created" || event[`${field}_before`] !== event[field]));
    return set ? { by: set.actor_id, at: set.created_at } : { by: annotation.updated_by, at: annotation.updated_at };
  };
  const authors = new Map(annotations.map((row) => [row.id, { building: authorOf(row, "building"), level: authorOf(row, "level") }] as const));
  const people = [...new Set([...annotations.map((row) => row.updated_by),
    ...[...authors.values()].flatMap((fields) => [fields.building?.by, fields.level?.by])].filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (people.length) {
    const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", people);
    if (error) readFailure(error, "Impossible de charger les auteurs des localisations.");
    for (const profile of data ?? []) if (profile.full_name?.trim()) names.set(profile.id, profile.full_name.trim());
  }
  return (row: AnnotationRow) => {
    const fields = authors.get(row.id) ?? { building: null, level: null };
    const out = (field: PlanLocationField) => {
      const author = fields[field];
      return author ? { ...author, by_name: names.get(author.by) ?? null } : null;
    };
    return {
      id: row.id, revision: row.revision, building: row.building, level: row.level,
      fields: { building: out("building"), level: out("level") },
      carried_from_id: row.carried_from_id, document_name: row.document_name, updated_by: row.updated_by,
      updated_by_name: names.get(row.updated_by) ?? null, updated_at: row.updated_at, created_at: row.created_at,
    };
  };
}

/**
 * The revisions the member's own decisions say these bytes replace: in a pair the preparation settled as one plan, the
 * side it set aside for this one. Never the newer side, and never a plan that merely shares a name.
 */
async function replacedRevisions(supabase: Supabase, projectId: string, planFileId: string, contentHash: string,
  decisions: readonly PlanRevisionDecision[]): Promise<PlanLocationRevisionKey[]> {
  const replaced: PlanLocationRevisionKey[] = [];
  for (const { left, right, choice } of decisions) {
    if (choice === "distinct") continue;
    const [kept, omitted] = choice === "left" ? [left, right] : [right, left];
    if (kept.document_id !== planFileId || kept.content_hash !== contentHash || omitted.document_id === planFileId) continue;
    const source = await readSource(supabase, projectId, omitted.document_id);
    if (source) replaced.push({ source_kind: source.source_kind, source_id: source.source_id, content_hash: omitted.content_hash });
  }
  return replaced;
}

async function readPreparationDraft(context: AuthenticatedTakeoffContext, projectId: string) {
  const { data, error } = await context.supabase.from("takeoff_preparations").select("draft")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId).maybeSingle();
  if (error) readFailure(error, "Impossible de charger la préparation de l’affaire.");
  return isRecord(data?.draft) ? data.draft : null;
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
  const metadata = isRecord(file.metadata) ? file.metadata : null;
  return { projectId: set.project_id, file, source, documentName: getPlanFileDisplayName({ file_name: file.file_name, metadata }) };
}

/** The annotation of the plan's current bytes, and the correction offered for them when they have none. */
async function describePlanFile(context: AuthenticatedTakeoffContext, loaded: LoadedPlanFile, bytes: Uint8Array) {
  const contentHash = sha256(bytes);
  const key: PlanLocationRevisionKey = { source_kind: loaded.source.source_kind, source_id: loaded.source.source_id, content_hash: contentHash };
  const [rows, preparation] = await Promise.all([
    listAnnotations(context.supabase, context.tenantId, loaded.projectId),
    readPreparationDraft(context, loaded.projectId),
  ]);
  const exact = rows.find((row) => sameKey(row, key)) ?? null;
  // These bytes are the plan's current ones: another revision of its source, or one they replace, is earlier.
  const carry: Carry = exact ? null : selectPlanLocationCarryOver(rows, key,
    await replacedRevisions(context.supabase, loaded.projectId, loaded.file.id, contentHash, revisionDecisions(preparation)));
  return { key, exact, carry, preparation };
}

async function buildPlanFileLocation(context: AuthenticatedTakeoffContext, loaded: LoadedPlanFile, bytes: Uint8Array): Promise<TakeoffPlanFileLocation> {
  const { key, exact, carry, preparation } = await describePlanFile(context, loaded, bytes);
  const pageCount = loaded.file.page_count;
  const pages = Array.from({ length: Math.min(pageCount ?? MAX_PAGES_READ, MAX_PAGES_READ) }, (_, index) => index + 1);
  const { reading, failed } = await readLocationOfBytes(bytes, loaded.documentName, pages, pageCount);
  const describe = await fieldAuthors(context.supabase, [exact, carry?.row].filter((row): row is AnnotationRow => Boolean(row)));
  return takeoffPlanFileLocationSchema.parse({
    project_id: loaded.projectId, plan_set_id: loaded.file.plan_set_id, plan_file_id: loaded.file.id, document_name: loaded.documentName,
    revision: key, current_copy: loaded.source.current_copy, reading, reading_issue: failed ? "unreadable" : null,
    annotation: exact ? describe(exact) : null,
    carry_over: carry ? { ...describe(carry.row), content_hash: carry.row.content_hash, same_source: carry.same_source } : null,
    location: resolvePlanLocation({ reading, annotation: exact, carryOver: carry?.row ?? null }),
    suggestions: suggestions(preparation),
    can_edit: loaded.source.can_write && loaded.source.current_copy,
  });
}

function parseIds(setId: string, fileId: string) {
  return {
    setId: parseWithSchema(planSetIdSchema, setId, "Identifiant du jeu de plans invalide.").toLowerCase(),
    fileId: parseWithSchema(planFileIdSchema, fileId, "Identifiant du plan invalide.").toLowerCase(),
  };
}

function bytesOrNotFound(bytes: Uint8Array | null): Uint8Array {
  if (!bytes) notFound("Le PDF de ce plan est introuvable ou trop volumineux : sa localisation ne peut pas être lue.");
  return bytes;
}

export async function readTakeoffPlanFileLocation(input: { setId: string; fileId: string }) {
  const { setId, fileId } = parseIds(input.setId, input.fileId);
  const context = await getAuthenticatedTakeoffContext();
  const loaded = await loadPlanFile(context, setId, fileId);
  return buildPlanFileLocation(context, loaded, bytesOrNotFound(await readPlanBytes(context.supabase, loaded.file)));
}

function conflict(reason: string, message: string): never {
  throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false, message, details: { reason } });
}

function saveRefused(error: { message?: string; code?: string }): never {
  const message = error.message ?? "";
  if (message.includes("TAKEOFF_PLAN_LOCATION_CONFLICT")) {
    conflict("TAKEOFF_PLAN_LOCATION_CONFLICT", "La localisation de ce plan a été enregistrée entre-temps, dans un autre onglet ou par un autre membre. La valeur enregistrée est affichée : vérifiez-la avant d’enregistrer à nouveau.");
  }
  if (message.includes("TAKEOFF_PLAN_LOCATION_SOURCE_STALE")) {
    conflict("TAKEOFF_PLAN_LOCATION_SOURCE_STALE", "Ce plan vient d’être remplacé dans le dossier. Rechargez la page des plans avant de corriger sa localisation.");
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
  const bytes = bytesOrNotFound(await readPlanBytes(context.supabase, loaded.file));
  if (sha256(bytes) !== body.content_hash) {
    conflict("TAKEOFF_PLAN_LOCATION_REVISION_CHANGED", "Le contenu de ce plan a changé depuis son affichage. Vérifiez sa nouvelle localisation avant de l’enregistrer.");
  }
  // A save names as its origin only the correction the plan centre offers for these bytes now.
  if (body.carried_from_id !== null) {
    const { carry } = await describePlanFile(context, loaded, bytes);
    if (carry?.row.id !== body.carried_from_id) {
      conflict("TAKEOFF_PLAN_LOCATION_CONFLICT", "La correction proposée pour ce plan a changé depuis son affichage. Vérifiez-la avant de la valider.");
    }
  }
  const { error } = await context.supabase.rpc("set_takeoff_plan_location", {
    p_project_id: loaded.projectId, p_plan_file_id: loaded.file.id, p_content_hash: body.content_hash,
    p_expected_revision: body.expected_revision, p_document_name: loaded.documentName,
    // Null fields carry no correction: the generated signature types them as text only.
    p_building: building as string, p_level: level as string,
    ...(body.carried_from_id ? { p_carried_from_id: body.carried_from_id } : {}),
  });
  if (error) saveRefused(error);
  return buildPlanFileLocation(context, loaded, bytes);
}

/**
 * The location of each plan an analysis read, at the revision its preparation attested. The reading is made from
 * those bytes only while they are still the plan's; otherwise its title block is marked unread and only the file name
 * and that revision's own correction remain. No correction of another revision is offered on an analysis's bytes
 * unless they are the plan's current ones.
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
  const pending: Array<{ plan: Omit<TakeoffJobPlanLocation, "annotation" | "carry_over">; exact: AnnotationRow | null; carry: Carry }> = [];
  for (const source of sources) {
    const planFileId = source.document_id.toLowerCase();
    const sourceRow = await readSource(context.supabase, job.project_id, planFileId);
    canEdit ||= Boolean(sourceRow?.can_write && sourceRow.current_copy);
    const { data: file, error: fileError } = await context.supabase.from("plan_files").select("file_path,file_size_bytes")
      .eq("tenant_id", context.tenantId).eq("id", planFileId).maybeSingle();
    if (fileError) readFailure(fileError, "Impossible de charger un plan du métré.");
    const bytes = file && file.file_path === source.file_path ? await readPlanBytes(context.supabase, file) : null;
    const status = !sourceRow || !bytes ? "unavailable" : sha256(bytes) === source.content_hash ? "current" : "changed";
    let reading: PlanLocationReading = readPlanLocation({ documentName: source.document_name, pageCount: source.page_count, pages: [] });
    let readingIssue: TakeoffJobPlanLocation["reading_issue"] = status === "current" ? null : "not_current";
    if (status === "current" && bytes) {
      if (pagesLeft <= 0) readingIssue = "budget";
      else {
        const wanted = (source.pages.length ? source.pages : Array.from({ length: source.page_count ?? MAX_PAGES_READ }, (_, index) => index + 1))
          .slice(0, Math.min(MAX_PAGES_READ, pagesLeft));
        pagesLeft -= wanted.length;
        const read = await readLocationOfBytes(bytes, source.document_name, wanted, source.page_count);
        reading = read.reading;
        if (read.failed) readingIssue = "unreadable";
      }
    }
    const key = sourceRow && source.content_hash
      ? { source_kind: sourceRow.source_kind, source_id: sourceRow.source_id, content_hash: source.content_hash } : null;
    const exact = key ? rows.find((row) => sameKey(row, key)) ?? null : null;
    const carry: Carry = key && !exact && status === "current"
      ? selectPlanLocationCarryOver(rows, key, await replacedRevisions(context.supabase, job.project_id, planFileId, key.content_hash, decisions))
      : null;
    pending.push({ exact, carry, plan: {
      plan_file_id: planFileId, plan_set_id: source.plan_set_id, document_name: source.document_name, pages: source.pages,
      revision: key, status, reading, reading_issue: readingIssue,
      location: resolvePlanLocation({ reading, annotation: exact, carryOver: carry?.row ?? null }),
    } });
  }
  const describe = await fieldAuthors(context.supabase, pending.flatMap(({ exact, carry }) => [exact, carry?.row])
    .filter((row): row is AnnotationRow => Boolean(row)));
  const plans = pending.map(({ plan, exact, carry }) => ({ ...plan, annotation: exact ? describe(exact) : null,
    carry_over: carry ? { ...describe(carry.row), content_hash: carry.row.content_hash, same_source: carry.same_source } : null }));
  return takeoffJobPlanLocationsSchema.parse({ job_id: jobId, project_id: job.project_id, plans, without_preparation: false, can_edit: canEdit });
}
