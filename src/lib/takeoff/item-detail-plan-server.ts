import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { ApiError } from "@/lib/http/api-error";
import { mapSupabaseError, notFound, unprocessableEntity } from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { ItemDetailPlanRequest, ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import { getAuthenticatedTakeoffContext, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { getPlanFileDetail } from "@/lib/takeoff/plans";
import { parsePreparationSnapshot } from "@/lib/takeoff/preparation-source-loader";
import { recordedPlanPieces } from "@/lib/takeoff/relaunch-plan-copies-server";
import { checkAttestedTakeoffPlan } from "@/lib/takeoff/vectors/read-server";
import type { Database } from "@/types/database";

/**
 * The plan the detail of an item shows (lot 5), resolved by the server in the affaire the member reads, never from what
 * the address claims, and only as the route that serves its bytes would serve them to this member:
 * - the takeoff module must be on for the tenant, as for both byte routes (getAuthenticatedTakeoffContext);
 * - with a reading (a job of this affaire the member may read), the copy that analysis sealed for that plan, its digest
 *   and pages, even since replaced; « attested » only when the attested bytes' route would serve them
 *   (checkAttestedTakeoffPlan, its own rule), else the original is said unavailable, never replaced by another copy;
 * - without one, the plan retained in the dossier: the one current copy of its piece (or the copy uploaded to the plan
 *   set), as the plan-location reader decides it for the member, signed by the plan centre's own read (getPlanFileDetail)
 *   at this request; a generation named must still be the copy's;
 * - a copy that exists but that the plan centre does not serve this member is « not available to you », apart from « no
 *   copy »; a job of another affaire, a plan that reading did not read, a key foreign to the dossier or a piece its own
 *   read hides (deleted, reserved for deletion) is not found. `source` names a piece of the dossier only.
 * Copies and their recorded sources are listed by the service after these checks, as the relaunch does; nothing of a copy
 * the member may not read is returned but its existence.
 */

type Context = AuthenticatedTakeoffContext;
type Service = SupabaseClient<Database>;
type FileRow = { id: string; plan_set_id: string; file_name: string; page_count: number | null; metadata: unknown };
type PieceRow = { id: string; file_name: string; document_kind: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const metadataOf = (value: unknown) => (value && typeof value === "object" ? value as Record<string, unknown> : {});
/** A dossier copy's own generation; a copy with none (an upload, or made before generations were kept) has none, never a date. */
const generationOf = (file: FileRow | null | undefined) => {
  const generation = metadataOf(file?.metadata).intake_generation;
  return typeof generation === "string" || typeof generation === "number" ? String(generation) : null;
};

function readFailure(error: { code?: string; message: string }, message: string): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, message);
}

const notInDossier = () => notFound("Ce plan est introuvable dans le dossier de l’affaire.", undefined, "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND");

export async function resolveItemDetailPlan(projectId: string, request: ItemDetailPlanRequest): Promise<ItemDetailPlanView> {
  if (request.source && (request.jobId || request.planKey)) {
    throw unprocessableEntity("Une pièce du dossier se nomme seule, sans plan ni lecture.", undefined, "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID");
  }
  if (request.jobId && !request.planKey) {
    throw unprocessableEntity("Le plan de cette lecture n’est pas indiqué.", undefined, "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID");
  }
  const key = (request.source?.documentId ?? request.planKey)?.toLowerCase();
  if (!key) throw unprocessableEntity("Le plan à afficher n’est pas indiqué.", undefined, "TAKEOFF_ITEM_DETAIL_ADDRESS_INVALID");
  const context = await getAuthenticatedTakeoffContext();
  const { project } = await requireAffaireAccess(projectId, "read");
  if (request.jobId) return readingPlan(context, project.id, request.jobId.toLowerCase(), key);
  return dossierPlan(context, project.id, { key, pieceOnly: request.source !== null, generation: request.source?.generation ?? null });
}

async function readingPlan(context: Context, projectId: string, jobId: string, key: string): Promise<ItemDetailPlanView> {
  const { data: job, error } = await context.supabase.from("takeoff_jobs")
    .select("id, plan_set_id, estimate_version_id, status, completed_at, preparation_snapshot")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId).eq("id", jobId).maybeSingle();
  if (error) readFailure(error, "Impossible de lire cette lecture du plan.");
  if (!job) throw notFound("Cette lecture est introuvable sur cette affaire.", undefined, "TAKEOFF_ITEM_DETAIL_READING_NOT_FOUND");
  const planSetId = job.plan_set_id?.toLowerCase() ?? null;
  let snapshot: ReturnType<typeof parsePreparationSnapshot> = null;
  try {
    snapshot = parsePreparationSnapshot(job.preparation_snapshot);
  } catch {
    snapshot = null;
  }
  const sealed = planSetId ? (snapshot?.preparation.sources ?? []).filter((source) => source.kind === "plan" && source.active
    && source.confirmed && source.plan_set_id?.toLowerCase() === planSetId) : [];
  const service = createServiceRoleClient();
  const pieces = planSetId && sealed.length
    ? await recordedPlanPieces(service, context.tenantId, planSetId, sealed.map((source) => source.document_id))
    : new Map<string, string>();
  const logical = (id: string) => pieces.get(id.toLowerCase()) ?? id.toLowerCase();
  const matching = sealed.filter((source) => source.document_id.toLowerCase() === key || logical(source.document_id) === key);
  if (matching.length === 0) throw notFound("Ce plan n’a pas été lu par cette analyse.", undefined, "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND");
  const source = matching[0]!;
  const fileId = source.document_id.toLowerCase();

  // The one rule of the attested bytes' route, then the copy's own row (for its generation, and to tell a copy the plan
  // centre hides from this member from a copy gone).
  const [attested, { data: copy, error: copyError }] = await Promise.all([
    checkAttestedTakeoffPlan(context.supabase, context.tenantId, jobId, source.document_id),
    service.from("plan_files").select("id, plan_set_id, file_name, page_count, metadata")
      .eq("tenant_id", context.tenantId).eq("id", fileId).maybeSingle(),
  ]);
  if (copyError) readFailure(copyError, "Impossible de lire le plan de cette lecture.");
  const document: ItemDetailPlanView["document"] = matching.length > 1 ? { kind: "unavailable", reason: "several_copies" }
    : attested.ok ? { kind: "attested", href: `/api/takeoff/jobs/${encodeURIComponent(jobId)}/vector-plans/${encodeURIComponent(fileId)}` }
      : { kind: "unavailable", reason: attested.reason === "copy_unreadable" && copy ? "not_available_to_you" : "original_unavailable" };
  return {
    plan: {
      key: logical(source.document_id),
      name: source.document_name,
      planFileId: fileId,
      generation: pieces.has(fileId) ? generationOf(copy as FileRow | null) : null,
      contentSha256: source.content_hash?.toLowerCase() ?? null,
      pageCount: source.page_count,
      pagesRead: [...source.pages].sort((left, right) => left - right),
    },
    reading: { jobId, status: job.status, finishedAt: job.completed_at },
    document,
  };
}

/** A piece of the dossier as its own read shows it to the member: uploaded, neither deleted nor reserved for deletion. */
async function readablePiece(context: Context, projectId: string, id: string): Promise<PieceRow | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await context.supabase.from("affaire_intake_documents").select("id, file_name, document_kind")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId).eq("id", id).eq("upload_status", "uploaded")
    .is("deleted_at", null).is("deletion_token", null).maybeSingle();
  if (error) readFailure(error, "Impossible de lire le dossier de l’affaire.");
  return data && data.document_kind === "plans" ? data as PieceRow : null;
}

async function affaireCopies(service: Service, context: Context, projectId: string) {
  const { data: sets, error: setsError } = await service.from("plan_sets").select("id")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId);
  if (setsError) readFailure(setsError, "Impossible de lire les plans de l’affaire.");
  const setIds = (sets ?? []).map((set) => set.id.toLowerCase());
  const files = setIds.length ? await readAllRows(() => service.from("plan_files")
    .select("id, plan_set_id, file_name, page_count, metadata", { count: "exact" })
    .eq("tenant_id", context.tenantId).in("plan_set_id", setIds)) : { data: [], error: null };
  if (files.error) readFailure(files.error, "Impossible de lire les plans de l’affaire.");
  const rows = ((files.data ?? []) as FileRow[]).map((row) => ({ ...row, id: row.id.toLowerCase(), plan_set_id: row.plan_set_id.toLowerCase() }));
  const pieces = new Map<string, string>();
  for (const setId of setIds) {
    const ids = rows.filter((row) => row.plan_set_id === setId).map((row) => row.id);
    for (const [file, piece] of await recordedPlanPieces(service, context.tenantId, setId, ids)) pieces.set(file, piece);
  }
  return { rows, pieces };
}

const unavailable = (key: string, name: string, reason: Extract<ItemDetailPlanView["document"], { kind: "unavailable" }>["reason"],
  ): ItemDetailPlanView => ({
  plan: { key, name, planFileId: null, generation: null, contentSha256: null, pageCount: null, pagesRead: [] },
  reading: null,
  document: { kind: "unavailable", reason },
});

async function dossierPlan(context: Context, projectId: string, input: { key: string; pieceOnly: boolean; generation: string | null },
  ): Promise<ItemDetailPlanView> {
  const service = createServiceRoleClient();
  const { rows, pieces } = await affaireCopies(service, context, projectId);
  const named = input.pieceOnly ? undefined : rows.find((row) => row.id === input.key);
  // A copy named is read as its plan: its piece and every copy of it, or itself for a copy uploaded to the plan set.
  const pieceId = named ? pieces.get(named.id) ?? null : input.key;
  let planKey: string;
  let planName: string;
  let copies: FileRow[];
  if (pieceId) {
    const piece = await readablePiece(context, projectId, pieceId);
    if (!piece) throw notInDossier();
    planKey = piece.id.toLowerCase();
    planName = piece.file_name;
    copies = rows.filter((row) => pieces.get(row.id) === planKey);
  } else {
    // An upload names nothing of the dossier: only the member who may read the copy learns of it.
    const { data, error } = await context.supabase.from("plan_files").select("id").eq("tenant_id", context.tenantId)
      .eq("id", named!.id).maybeSingle();
    if (error) readFailure(error, "Impossible de lire les plans de l’affaire.");
    if (!data) throw notInDossier();
    planKey = named!.id;
    planName = getPlanFileDisplayName({ file_name: named!.file_name, metadata: metadataOf(named!.metadata) });
    copies = [named!];
  }
  if (copies.length === 0) return unavailable(planKey, planName, "no_current_copy");

  // The plan-location reader decides, for the member, whether a copy is its piece's current one (lot 3).
  const current: FileRow[] = [];
  let known = 0;
  for (const copy of copies) {
    const { data, error } = await context.supabase.rpc("read_takeoff_plan_location_source",
      { p_project_id: projectId, p_plan_file_id: copy.id });
    if (error) readFailure(error, "Impossible de lire les plans de l’affaire.");
    const row = ((data ?? []) as Array<{ current_copy: boolean | null }>)[0];
    if (row) known += 1;
    if (row?.current_copy === true) current.push(copy);
  }
  if (known === 0) return unavailable(planKey, planName, "not_available_to_you");
  if (current.length === 0) return unavailable(planKey, planName, "no_current_copy");
  if (current.length > 1) return unavailable(planKey, planName, "several_copies");
  const shown = current[0]!;
  if (input.generation !== null && generationOf(shown) !== input.generation) return unavailable(planKey, planName, "generation_replaced");

  // The plan centre's own read signs the copy for this member at this request: what it refuses is not available to them.
  let url: string | null;
  try {
    const detail = await getPlanFileDetail({ setId: shown.plan_set_id, fileId: shown.id, includeDownloadUrl: true });
    url = (detail.plan_file as { download_url?: string | null }).download_url ?? null;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return unavailable(planKey, planName, "not_available_to_you");
    }
    throw error;
  }
  if (!url) return unavailable(planKey, planName, "no_current_copy");
  return {
    plan: { key: planKey, name: planName, planFileId: shown.id, generation: pieces.has(shown.id) ? generationOf(shown) : null,
      contentSha256: null, pageCount: shown.page_count, pagesRead: [] },
    reading: null,
    document: { kind: "dossier", planSetId: shown.plan_set_id, planFileId: shown.id, url },
  };
}
