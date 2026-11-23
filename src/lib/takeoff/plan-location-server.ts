import "server-only";

import { createHash } from "node:crypto";

import { mapSupabaseError } from "@/lib/http/api-response";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  type AuthenticatedTakeoffContext,
} from "@/lib/takeoff/job-read-server";
import { TAKEOFF_PAGE_TRIAGE_TEXT, takeoffPageTriageRenderLimits } from "@/lib/takeoff/page-triage-server";
import {
  PLAN_FILE_ORIGINAL_NAME_KEY,
  buildPlanFileStoragePath,
  getPlanFileDisplayName,
  normalizePlanFileOriginalName,
  sanitizePlanPdfFilename,
} from "@/lib/takeoff/plan-file-display-name";
import {
  normalizePlanLocationValue,
  readPlanLocation,
  resolvePlanLocation,
  selectPlanLocationCarryOver,
  type PlanLocationAnnotationValues,
  type PlanLocationCarryValues,
  type PlanLocationChoice,
  type PlanLocationField,
  type PlanLocationReading,
  type PlanLocationRevisionKey,
} from "@/lib/takeoff/plan-location";
import {
  takeoffJobPlanLocationsSchema,
  takeoffPlanFileLocationSchema,
  takeoffPlanLocationSaveSchema,
  type PlanLocationReplacement,
  type TakeoffJobPlanLocation,
  type TakeoffJobPlanLocations,
  type TakeoffPlanFileLocation,
} from "@/lib/takeoff/plan-location-contracts";
import { PLAN_FILE_MAX_SIZE_BYTES, planFileIdSchema, planSetIdSchema } from "@/lib/takeoff/plans";
import { validPlanRevisionDecisions, type PlanRevisionDecision } from "@/lib/takeoff/plan-revision-identity";
import { getDeducedPlanCandidates } from "@/lib/takeoff/preparation-from-dossier";
import { takeoffPreparationSchema, type TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { parsePreparationSnapshot } from "@/lib/takeoff/preparation-source-loader";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import { isRecord } from "@/lib/value-guards";

/**
 * The building and the level of a plan revision, read and corrected in one place (lot 3, migration B). A revision is
 * the source the database resolves for a plan file (its dossier piece, or itself) at the SHA-256 of the bytes this
 * server read: a value is never shown on bytes it was not made for. A save is attested by this server (it reads the
 * bytes with its service role, from the plan file's own canonical path, and records their digest for the member and
 * this save), then written under the member's session by `set_takeoff_plan_location`, which re-checks the member, the
 * source, the carried origin and the generation they saw. Nothing here writes a plan file, a preparation, a job or an
 * estimate.
 */

/** Title blocks read per plan, and per review across its plans: a plan centre or review opening, never a poll. */
const MAX_PAGES_READ = 12;
const MAX_JOB_PAGES_READ = 40;

type Supabase = AuthenticatedTakeoffContext["supabase"];
type SourceRow = { source_kind: PlanLocationRevisionKey["source_kind"]; source_id: string; plan_file_id: string; current_copy: boolean; can_write: boolean };
type FieldColumns = { choice: PlanLocationChoice; value: string | null; carried: boolean; set_by: string; set_at: string; set_revision: number };
type AnnotationRow = PlanLocationRevisionKey & {
  id: string; revision: number; carried_from_id: string | null; carried_from_revision: number | null; document_name: string;
  updated_by: string; updated_at: string; created_at: string;
  building_choice: PlanLocationChoice; building: string | null; building_carried: boolean; building_set_by: string;
  building_set_at: string; building_set_revision: number;
  level_choice: PlanLocationChoice; level: string | null; level_carried: boolean; level_set_by: string;
  level_set_at: string; level_set_revision: number;
};
type PlanFileRow = { id: string; plan_set_id: string; file_name: string; file_path: string; file_size_bytes: number; page_count: number | null; metadata: unknown };
type LoadedPlanFile = { projectId: string; file: PlanFileRow; source: SourceRow; documentName: string; originalName: string | null };
type Carry = { row: AnnotationRow; same_source: boolean } | null;

const ANNOTATION_SELECT = ["id", "source_kind", "source_id", "content_hash", "revision", "carried_from_id", "carried_from_revision",
  "document_name", "updated_by", "updated_at", "created_at",
  ...(["building", "level"] as const).flatMap((field) => [`${field}_choice`, field, `${field}_carried`, `${field}_set_by`, `${field}_set_at`,
    `${field}_set_revision`])].join(",");

function notFound(message: string): never {
  throw new TakeoffError({ status: 404, code: TakeoffErrorCode.NOT_FOUND, message, retryable: false });
}

function readFailure(error: unknown, message: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false });
}

function conflict(reason: string, message: string, details: Record<string, unknown> = {}): never {
  throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: false, message, details: { reason, ...details } });
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sameKey = (left: PlanLocationRevisionKey, right: PlanLocationRevisionKey) =>
  left.source_kind === right.source_kind && left.source_id === right.source_id && left.content_hash === right.content_hash;
const fieldOf = (row: AnnotationRow, field: PlanLocationField): FieldColumns => ({
  choice: row[`${field}_choice`], value: row[field], carried: row[`${field}_carried`], set_by: row[`${field}_set_by`],
  set_at: row[`${field}_set_at`], set_revision: row[`${field}_set_revision`],
});
const choicesOf = (row: AnnotationRow | null): PlanLocationAnnotationValues | null => row ? {
  building: { choice: row.building_choice, value: row.building }, level: { choice: row.level_choice, value: row.level } } : null;
const carryValuesOf = (row: AnnotationRow | null | undefined): PlanLocationCarryValues | null => row ? {
  building: row.building_choice === "value" ? row.building : null, level: row.level_choice === "value" ? row.level : null } : null;

/**
 * The earlier correction offered for a revision without its own, when it sets at least one value: one that left both
 * fields to the reading or to be specified carries nothing, and an older one would contradict it.
 */
function carryOf(rows: readonly AnnotationRow[], key: PlanLocationRevisionKey, replaced: readonly PlanLocationRevisionKey[]): Carry {
  const selected = selectPlanLocationCarryOver(rows, key, replaced);
  const values = carryValuesOf(selected?.row);
  return selected && values && (values.building !== null || values.level !== null) ? selected : null;
}

function originalNameOf(metadata: unknown) {
  const name = isRecord(metadata) ? metadata[PLAN_FILE_ORIGINAL_NAME_KEY] : undefined;
  return typeof name === "string" ? normalizePlanFileOriginalName(name) || null : null;
}

async function readSource(supabase: Supabase, projectId: string, planFileId: string): Promise<SourceRow | null> {
  const { data, error } = await supabase.rpc("read_takeoff_plan_location_source", { p_project_id: projectId, p_plan_file_id: planFileId });
  if (error) readFailure(error, "Impossible d’identifier la version du plan.");
  return ((data ?? []) as SourceRow[])[0] ?? null;
}

/**
 * The bytes of a plan file whose row the member reads and whose affaire names its source. Read with the service role,
 * as the attested plan of a review is (the Storage rule of plan files serves only owners and admins, while a director
 * reads the affaire), and only from the path its identity gives (tenant, set, file, sanitized name): a historical row
 * pointing elsewhere is never followed. The bytes never leave this server; only their digest and reading do.
 */
export async function readPlanBytes(tenantId: string, file: { id: string; plan_set_id: string; file_name: string; file_path: string;
  file_size_bytes: number }): Promise<{ bytes: Uint8Array } | { bytes: null; notStored: boolean }> {
  if (file.file_size_bytes > PLAN_FILE_MAX_SIZE_BYTES || file.file_path !== buildPlanFileStoragePath({
    tenantId, setId: file.plan_set_id, fileId: file.id, fileName: sanitizePlanPdfFilename(file.file_name),
  })) return { bytes: null, notStored: false };
  const { data, error } = await createServiceRoleClient().storage.from(PLAN_FILES_BUCKET).download(file.file_path);
  if (error || !data || data.size === 0 || data.size > PLAN_FILE_MAX_SIZE_BYTES) {
    const failure = error as { status?: number; statusCode?: string } | null;
    const status = Number(failure?.statusCode ?? failure?.status);
    console.error("takeoff.plan_location.read_failed", { status: Number.isFinite(status) ? status : null, size: data?.size ?? null,
      message: (error?.message ?? "").slice(0, 200) });
    // Storage answers 400 or 404 for an object that is not there (yet).
    return { bytes: null, notStored: Boolean(error) && (status === 400 || status === 404) };
  }
  return { bytes: new Uint8Array(await data.arrayBuffer()) };
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

/** The reading of these bytes; a PDF that cannot be read leaves its known name only, with the title block unread. */
async function readLocationOfBytes(bytes: Uint8Array, originalName: string | null, pages: number[], pageCount: number | null) {
  try {
    const titleBlocks = await readTitleBlocks(bytes, pages);
    if (titleBlocks.failed) return { reading: readPlanLocation({ originalName, pageCount, pages: [] }), failed: true };
    return { reading: readPlanLocation({ originalName, pageCount: titleBlocks.pageCount ?? pageCount, pages: titleBlocks.pages }), failed: false };
  } catch {
    return { reading: readPlanLocation({ originalName, pageCount, pages: [] }), failed: true };
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

/** The annotations as shown: each field with the member who made its current choice, in the same row. */
async function describer(supabase: Supabase, annotations: readonly AnnotationRow[]) {
  const people = [...new Set(annotations.flatMap((row) => [row.updated_by, row.building_set_by, row.level_set_by]))];
  const names = new Map<string, string>();
  if (people.length) {
    const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", people);
    if (error) readFailure(error, "Impossible de charger les auteurs des localisations.");
    for (const profile of data ?? []) if (profile.full_name?.trim()) names.set(profile.id, profile.full_name.trim());
  }
  const field = (row: AnnotationRow, name: PlanLocationField) => {
    const columns = fieldOf(row, name);
    return { ...columns, set_by_name: names.get(columns.set_by) ?? null };
  };
  return {
    annotation: (row: AnnotationRow) => ({
      id: row.id, revision: row.revision, building: field(row, "building"), level: field(row, "level"),
      carried_from_id: row.carried_from_id, carried_from_revision: row.carried_from_revision, document_name: row.document_name,
      updated_by: row.updated_by, updated_by_name: names.get(row.updated_by) ?? null, updated_at: row.updated_at, created_at: row.created_at,
    }),
    // Each field with its own value, author and date: a later edit of the other field credits no one else.
    carry: ({ row, same_source }: NonNullable<Carry>) => {
      const values = carryValuesOf(row)!;
      const field = (name: PlanLocationField) => ({
        value: values[name], set_by_name: names.get(row[`${name}_set_by`]) ?? null, set_at: row[`${name}_set_at`] });
      return { id: row.id, revision: row.revision, building: field("building"), level: field("level"), document_name: row.document_name,
        content_hash: row.content_hash, same_source };
    },
  };
}

/**
 * The revisions these bytes replace by the member's own decision: in a pair the preparation's validator accepts among
 * the plans it can retain (active, or an alternate of a retained one: the dossier resolver's candidates), at the
 * digests decided, in a same-plan relationship, the side it set aside for this one. Never the newer side, never a
 * stale decision, never a plan the member excluded, never a plan that merely shares a name.
 */
async function replacedRevisions(supabase: Supabase, projectId: string, planFileId: string, contentHash: string,
  sources: readonly TakeoffPreparationSource[], decisions: readonly PlanRevisionDecision[]): Promise<PlanLocationRevisionKey[]> {
  const replaced: PlanLocationRevisionKey[] = [];
  for (const { left, right, choice } of validPlanRevisionDecisions(getDeducedPlanCandidates(sources), decisions)) {
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
  const parsed = takeoffPreparationSchema.safeParse(data?.draft);
  return parsed.success ? parsed.data : null;
}

/** The brief's and the scope's buildings and levels: typing aids only. */
function suggestions(preparation: ReturnType<typeof takeoffPreparationSchema.parse> | null) {
  const clean = (values: readonly string[]) => [...new Set(values.flatMap((value) => {
    try { return [normalizePlanLocationValue(value)].filter((entry): entry is string => entry !== null); } catch { return []; }
  }))].slice(0, 20);
  return {
    building: clean([...(preparation?.scope.buildings ?? []), ...(preparation?.provenance?.brief_context.buildings ?? [])]),
    level: clean(preparation?.scope.levels ?? []),
  };
}

/**
 * The current copy of a dossier piece in this affaire, when the member reads one: a plan file whose source, as the
 * database resolves it, is that same piece. Metadata naming the piece is only a lead: a plan uploaded outside the
 * dossier may carry it, and its source is then the file itself.
 */
async function currentCopyOf(context: AuthenticatedTakeoffContext, projectId: string, source: SourceRow): Promise<PlanLocationReplacement | null> {
  if (source.source_kind !== "intake_document") return null;
  const { data, error } = await context.supabase.from("plan_files").select("id,plan_set_id")
    .eq("tenant_id", context.tenantId).contains("metadata", { intake_document_id: source.source_id });
  if (error) readFailure(error, "Impossible de retrouver la copie actuelle du plan.");
  for (const copy of (data ?? []) as Array<{ id: string; plan_set_id: string }>) {
    if (copy.id === source.plan_file_id) continue;
    const candidate = await readSource(context.supabase, projectId, copy.id);
    if (candidate?.current_copy && candidate.source_kind === source.source_kind && candidate.source_id === source.source_id) {
      return { plan_set_id: copy.plan_set_id, plan_file_id: copy.id };
    }
  }
  return null;
}

/**
 * The one answer for a copy the dossier replaced, whichever step found it (the row gone, the bytes gone, the command
 * refusing it): the plan was replaced, with its current copy when one exists.
 */
async function replacedConflict(context: AuthenticatedTakeoffContext, projectId: string, source: SourceRow): Promise<never> {
  const replacement = await currentCopyOf(context, projectId, source);
  conflict("TAKEOFF_PLAN_LOCATION_SOURCE_STALE", replacement
    ? "Ce plan a été remplacé dans le dossier : sa version actuelle est affichée, avec ce qui s’y applique."
    : "Ce plan a été remplacé dans le dossier. Rechargez la page des plans avant de corriger sa localisation.",
  { replacement });
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
  const source = await readSource(context.supabase, set.project_id, fileId);
  if (!source) notFound("Plan introuvable.");
  // A copy the dossier sync has removed since the page was opened: its piece is still known, its current copy named.
  if (!file) return replacedConflict(context, set.project_id, source);
  const row = file as PlanFileRow;
  const metadata = isRecord(row.metadata) ? row.metadata : null;
  return { projectId: set.project_id, file: row, source, originalName: originalNameOf(metadata),
    documentName: getPlanFileDisplayName({ file_name: row.file_name, metadata }) };
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
  const carry: Carry = exact ? null : carryOf(rows, key, await replacedRevisions(context.supabase, loaded.projectId,
    loaded.file.id, contentHash, preparation?.sources ?? [], preparation?.plan_revision_decisions ?? []));
  return { key, exact, carry, preparation };
}

async function buildPlanFileLocation(context: AuthenticatedTakeoffContext, loaded: LoadedPlanFile, bytes: Uint8Array): Promise<TakeoffPlanFileLocation> {
  const { key, exact, carry, preparation } = await describePlanFile(context, loaded, bytes);
  const pageCount = loaded.file.page_count;
  const pages = Array.from({ length: Math.min(pageCount ?? MAX_PAGES_READ, MAX_PAGES_READ) }, (_, index) => index + 1);
  const { reading, failed } = await readLocationOfBytes(bytes, loaded.originalName, pages, pageCount);
  const describe = await describer(context.supabase, [exact, carry?.row].filter((row): row is AnnotationRow => Boolean(row)));
  return takeoffPlanFileLocationSchema.parse({
    project_id: loaded.projectId, plan_set_id: loaded.file.plan_set_id, plan_file_id: loaded.file.id, document_name: loaded.documentName,
    revision: key, current_copy: loaded.source.current_copy, reading, reading_issue: failed ? "unreadable" : null,
    annotation: exact ? describe.annotation(exact) : null,
    carry_over: carry ? describe.carry(carry) : null,
    location: resolvePlanLocation({ reading, annotation: choicesOf(exact), carryOver: carryValuesOf(carry?.row) }),
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

/**
 * The plan's bytes. When they are not there: a copy the dossier replaced meanwhile is told as such; the dossier's
 * current copy whose bytes are not uploaded yet (the sync records the copy before it uploads it) is being prepared, to
 * try again in a moment; anything else is missing.
 */
async function currentBytes(context: AuthenticatedTakeoffContext, loaded: LoadedPlanFile): Promise<Uint8Array> {
  const read = await readPlanBytes(context.tenantId, loaded.file);
  if (read.bytes) return read.bytes;
  const now = await readSource(context.supabase, loaded.projectId, loaded.file.id);
  if (!now?.current_copy) return replacedConflict(context, loaded.projectId, now ?? loaded.source);
  if (read.notStored && now.source_kind === "intake_document") {
    conflict("TAKEOFF_PLAN_LOCATION_COPY_PENDING", "La copie de ce plan est en cours de préparation dans le dossier : réessayez dans un instant.",
      { replacement: { plan_set_id: loaded.file.plan_set_id, plan_file_id: loaded.file.id } });
  }
  notFound("Le PDF de ce plan est introuvable ou trop volumineux : sa localisation ne peut pas être lue.");
}

export async function readTakeoffPlanFileLocation(input: { setId: string; fileId: string }) {
  const { setId, fileId } = parseIds(input.setId, input.fileId);
  const context = await getAuthenticatedTakeoffContext();
  const loaded = await loadPlanFile(context, setId, fileId);
  // A copy the dossier replaced whose bytes are not cleaned up yet is followed to its replacement, as once it is gone.
  if (!loaded.source.current_copy) return replacedConflict(context, loaded.projectId, loaded.source);
  return buildPlanFileLocation(context, loaded, await currentBytes(context, loaded));
}

function saveRefused(error: { message?: string; code?: string }): never {
  const message = error.message ?? "";
  if (message.includes("TAKEOFF_PLAN_LOCATION_CONFLICT")) {
    conflict("TAKEOFF_PLAN_LOCATION_CONFLICT", "La localisation de ce plan a été enregistrée entre-temps, dans un autre onglet ou par un autre membre. La valeur enregistrée est affichée : vérifiez-la avant d’enregistrer à nouveau.");
  }
  if (message.includes("TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED")) {
    conflict("TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED", "La correction de la version précédente a changé depuis son affichage : vérifiez ce qui est repris avant de valider.");
  }
  if (message.includes("TAKEOFF_PLAN_LOCATION_FORBIDDEN") || message.includes("TAKEOFF_PLAN_LOCATION_NOT_ATTESTED")) {
    throw new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false,
      message: "Seuls les opérateurs de l’affaire corrigent la localisation d’un plan." });
  }
  if (message.includes("TAKEOFF_PLAN_LOCATION_SOURCE_NOT_FOUND")) notFound("Plan introuvable.");
  if (message.includes("TAKEOFF_PLAN_LOCATION_CARRY_OVER_MIXED")) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: "Un autre champ de ce plan est repris d’une autre correction : saisissez-le ou choisissez la lecture du plan avant de reprendre celui-ci." });
  }
  if (message.includes("TAKEOFF_PLAN_LOCATION_VALUE_INVALID") || message.includes("TAKEOFF_PLAN_LOCATION_CARRY_OVER_INVALID")
    || message.includes("TAKEOFF_PLAN_LOCATION_ATTESTATION_INVALID")) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: "Cette localisation ne peut pas être enregistrée : vérifiez le bâtiment et le niveau saisis." });
  }
  readFailure(error, "Impossible d’enregistrer la localisation du plan.");
}

export async function saveTakeoffPlanFileLocation(input: { setId: string; fileId: string; body: unknown }) {
  const { setId, fileId } = parseIds(input.setId, input.fileId);
  const body = parseWithSchema(takeoffPlanLocationSaveSchema, input.body, "Localisation invalide.");
  const choices = { building: body.building, level: body.level };
  try {
    for (const field of ["building", "level"] as const) {
      const value = choices[field].value === null ? null : normalizePlanLocationValue(choices[field].value);
      if ((choices[field].choice === "value") !== (value !== null)) throw new RangeError("Saisissez une valeur, ou choisissez la lecture du plan ou « À préciser ».");
      choices[field] = { choice: choices[field].choice, value };
    }
  } catch (error) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: error instanceof RangeError ? error.message : "Localisation invalide." });
  }
  const context = await getAuthenticatedTakeoffContext();
  const loaded = await loadPlanFile(context, setId, fileId);
  if (!loaded.source.can_write) saveRefused({ message: "TAKEOFF_PLAN_LOCATION_FORBIDDEN" });
  if (!loaded.source.current_copy) await replacedConflict(context, loaded.projectId, loaded.source);
  // The revision is the bytes this server reads now, never the digest a screen sends.
  const bytes = await currentBytes(context, loaded);
  const contentHash = sha256(bytes);
  if (contentHash !== body.content_hash) {
    conflict("TAKEOFF_PLAN_LOCATION_REVISION_CHANGED", "Le contenu de ce plan a changé depuis son affichage. Vérifiez sa nouvelle localisation avant de l’enregistrer.");
  }
  // A carried value comes only from the earlier correction the server offers for these bytes now, at the generation
  // the member saw.
  let carry: Carry = null;
  if (body.carried_from) {
    carry = (await describePlanFile(context, loaded, bytes)).carry;
    if (carry?.row.id !== body.carried_from.id || carry.row.revision !== body.carried_from.revision) {
      conflict("TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED", "La correction de la version précédente a changé depuis son affichage : vérifiez ce qui est repris avant de valider.");
    }
  }
  const { data: attestation, error: attestError } = await createServiceRoleClient().rpc("attest_takeoff_plan_revision", {
    p_tenant_id: context.tenantId, p_actor_id: context.userId, p_project_id: loaded.projectId, p_plan_file_id: loaded.file.id,
    p_content_hash: contentHash, p_document_name: loaded.documentName,
    ...(carry ? { p_carry_from_id: carry.row.id, p_carry_from_revision: carry.row.revision } : {}),
  });
  // A copy the dossier replaced after it was read gets the same answer as one replaced before.
  const refused = async (failure: { message?: string; code?: string }): Promise<never> => {
    if (failure.message?.includes("TAKEOFF_PLAN_LOCATION_SOURCE_STALE")) await replacedConflict(context, loaded.projectId, loaded.source);
    return saveRefused(failure);
  };
  if (attestError || typeof attestation !== "string") return refused(attestError ?? { message: "attestation missing" });
  const { error } = await context.supabase.rpc("set_takeoff_plan_location", {
    p_attestation_id: attestation, p_expected_revision: body.expected_revision,
    p_building_choice: choices.building.choice, p_building: choices.building.value as string,
    p_level_choice: choices.level.choice, p_level: choices.level.value as string,
    p_carried_fields: body.carried_from?.fields ?? [],
  });
  if (error) await refused(error);
  return buildPlanFileLocation(context, loaded, bytes);
}

/**
 * The location of each plan an analysis read, at the revision its preparation attested. A plan's bytes are read only
 * once the affaire names its source for the member and from the plan file's own canonical path; the title block is
 * read only while those bytes are still the plan's, and no other revision's correction is offered on an analysis's
 * bytes unless they are the plan's current ones.
 */
export async function readTakeoffJobPlanLocations(jobId: string): Promise<TakeoffJobPlanLocations> {
  jobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant du métré invalide.").toLowerCase();
  const context = await getAuthenticatedTakeoffContext();
  const job = await getTakeoffJobDetailByIdOrThrow({ supabase: context.supabase, tenantId: context.tenantId, jobId })
    .catch((error: unknown) => {
      if (error instanceof TakeoffError && error.code === TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND) notFound("Cette analyse est introuvable.");
      throw error;
    });
  // A plan of this analysis is read by it once its reading ended with a result; until then it is only selected.
  const readByJob = job.status === "completed" || job.status === "applied";
  const { data, error } = await context.supabase.from("takeoff_jobs").select("preparation_snapshot")
    .eq("tenant_id", context.tenantId).eq("id", jobId).maybeSingle();
  if (error) readFailure(error, "Impossible de charger la préparation du métré.");
  let snapshot: ReturnType<typeof parsePreparationSnapshot> = null;
  let unreadable = false;
  try { snapshot = parsePreparationSnapshot(data?.preparation_snapshot); } catch { snapshot = null; unreadable = true; }
  const preparation = snapshot ? "attested" : unreadable ? "unreadable" : "none";
  const sources = (snapshot?.preparation.sources ?? []).filter((source) => source.kind === "plan" && source.active && source.confirmed
    && !source.document_id.startsWith("upload:") && takeoffJobIdSchema.safeParse(source.document_id).success);
  if (!snapshot || !sources.length) {
    return takeoffJobPlanLocationsSchema.parse({ job_id: jobId, project_id: job.project_id, plans: [], without_preparation: !snapshot,
      preparation, can_edit: false });
  }
  const rows = await listAnnotations(context.supabase, context.tenantId, job.project_id);
  let pagesLeft = MAX_JOB_PAGES_READ;
  let canEdit = false;
  const pending: Array<{ plan: Omit<TakeoffJobPlanLocation, "annotation" | "carry_over">; exact: AnnotationRow | null; carry: Carry }> = [];
  for (const source of sources) {
    const planFileId = source.document_id.toLowerCase();
    const sourceRow = await readSource(context.supabase, job.project_id, planFileId);
    // The dossier replaced the copy this analysis read: its piece's current copy is where a correction is made now.
    const replacement = sourceRow && !sourceRow.current_copy ? await currentCopyOf(context, job.project_id, sourceRow) : null;
    canEdit ||= Boolean(sourceRow?.can_write && (sourceRow.current_copy || replacement));
    let file: (PlanFileRow & { id: string }) | null = null;
    if (sourceRow) {
      const { data: row, error: fileError } = await context.supabase.from("plan_files")
        .select("id,plan_set_id,file_name,file_path,file_size_bytes,page_count,metadata")
        .eq("tenant_id", context.tenantId).eq("id", planFileId).maybeSingle();
      if (fileError) readFailure(fileError, "Impossible de charger un plan du métré.");
      file = row as PlanFileRow | null;
    }
    const bytes = sourceRow && file && file.file_path === source.file_path ? (await readPlanBytes(context.tenantId, file)).bytes : null;
    const status = !sourceRow || !bytes ? "unavailable" : sha256(bytes) === source.content_hash ? "current" : "changed";
    const originalName = originalNameOf(file?.metadata);
    let reading: PlanLocationReading = readPlanLocation({ originalName, pageCount: source.page_count, pages: [] });
    let readingIssue: TakeoffJobPlanLocation["reading_issue"] = status === "current" ? null : "not_current";
    if (status === "current" && bytes) {
      if (pagesLeft <= 0) readingIssue = "budget";
      else {
        const wanted = (source.pages.length ? source.pages : Array.from({ length: source.page_count ?? MAX_PAGES_READ }, (_, index) => index + 1))
          .slice(0, Math.min(MAX_PAGES_READ, pagesLeft));
        pagesLeft -= wanted.length;
        const read = await readLocationOfBytes(bytes, originalName, wanted, source.page_count);
        reading = read.reading;
        if (read.failed) readingIssue = "unreadable";
      }
    }
    const key = sourceRow && source.content_hash
      ? { source_kind: sourceRow.source_kind, source_id: sourceRow.source_id, content_hash: source.content_hash } : null;
    const exact = key ? rows.find((row) => sameKey(row, key)) ?? null : null;
    const carry: Carry = key && !exact && status === "current"
      ? carryOf(rows, key, await replacedRevisions(context.supabase, job.project_id, planFileId, key.content_hash,
        snapshot.preparation.sources, snapshot.preparation.plan_revision_decisions ?? []))
      : null;
    pending.push({ exact, carry, plan: {
      plan_file_id: planFileId, plan_set_id: source.plan_set_id, document_name: source.document_name, pages: source.pages,
      revision: key, status, read_state: status === "unavailable" ? "unavailable" : readByJob ? "read" : "selected",
      replacement, reading, reading_issue: readingIssue,
      location: resolvePlanLocation({ reading, annotation: choicesOf(exact), carryOver: carryValuesOf(carry?.row) }),
    } });
  }
  const describe = await describer(context.supabase, pending.flatMap(({ exact, carry }) => [exact, carry?.row])
    .filter((row): row is AnnotationRow => Boolean(row)));
  const plans = pending.map(({ plan, exact, carry }) => ({ ...plan, annotation: exact ? describe.annotation(exact) : null,
    carry_over: carry ? describe.carry(carry) : null }));
  return takeoffJobPlanLocationsSchema.parse({ job_id: jobId, project_id: job.project_id, plans, without_preparation: false,
    preparation, can_edit: canEdit });
}
