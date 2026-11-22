import "server-only";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError, notFound, unprocessableEntity } from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { ItemDetailPlanRequest, ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import { getPlanFileDisplayName } from "@/lib/takeoff/plan-file-display-name";
import { parsePreparationSnapshot } from "@/lib/takeoff/preparation-source-loader";
import { recordedPlanPieces } from "@/lib/takeoff/relaunch-plan-copies-server";

/**
 * The plan the detail of an item shows (lot 5), resolved by the server in the affaire the member reads, never from what
 * the address claims:
 * - with a reading (a job of this affaire the member may read), the copy that analysis sealed for that plan, its digest
 *   and pages, even since replaced; its bytes are the attested ones (the takeoff of an affaire, or one sent since), or
 *   the original is said unavailable: a copy made since is never shown in its place;
 * - without one, the plan retained in the dossier: the one current copy of its piece (or the copy uploaded to the plan
 *   set), as the plan-location reader decides it for the member; a generation named by the address must still be it.
 * A job of another affaire, a plan that reading did not read or a plan foreign to the dossier is not found.
 */

type Context = AuthenticatedTenantContext;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type FileRow = { id: string; plan_set_id: string; file_name: string; page_count: number | null; metadata: unknown };

const metadataOf = (value: unknown) => (value && typeof value === "object" ? value as Record<string, unknown> : {});
const generationOf = (file: FileRow | null) => {
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
  const { context, project } = await requireAffaireAccess(projectId, "read");
  return request.jobId
    ? readingPlan(context, project.id, request.jobId.toLowerCase(), key)
    : dossierPlan(context, project.id, key, request.source?.generation ?? null);
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
  const pieces = planSetId && sealed.length
    ? await recordedPlanPieces(createServiceRoleClient(), context.tenantId, planSetId, sealed.map((source) => source.document_id))
    : new Map<string, string>();
  const logical = (id: string) => pieces.get(id.toLowerCase()) ?? id.toLowerCase();
  const matching = sealed.filter((source) => source.document_id.toLowerCase() === key || logical(source.document_id) === key);
  if (matching.length === 0) throw notFound("Ce plan n’a pas été lu par cette analyse.", undefined, "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND");
  const source = matching[0]!;
  const fileId = source.document_id.toLowerCase();

  const [{ data: copy, error: copyError }, attested] = await Promise.all([
    context.supabase.from("plan_files").select("id, plan_set_id, file_name, page_count, metadata")
      .eq("tenant_id", context.tenantId).eq("id", fileId).maybeSingle(),
    attestsItsPlans(context, job),
  ]);
  if (copyError) readFailure(copyError, "Impossible de lire le plan de cette lecture.");
  const document: ItemDetailPlanView["document"] = matching.length > 1
    ? { kind: "unavailable", reason: "several_copies" }
    : attested && source.content_hash && source.file_path
      ? { kind: "attested", href: `/api/takeoff/jobs/${encodeURIComponent(jobId)}/vector-plans/${encodeURIComponent(fileId)}` }
      : { kind: "unavailable", reason: "original_unavailable" };
  return {
    plan: {
      key: logical(source.document_id),
      name: source.document_name,
      planFileId: fileId,
      generation: generationOf(copy as FileRow | null) ?? source.source_updated_at ?? null,
      contentSha256: source.content_hash?.toLowerCase() ?? null,
      pageCount: source.page_count,
      pagesRead: [...source.pages].sort((left, right) => left - right),
    },
    reading: { jobId, status: job.status, finishedAt: job.completed_at },
    document,
  };
}

/** A takeoff of an affaire serves the plans it attested; one launched on a version only once sent (lot 2 M2). */
async function attestsItsPlans(context: Context, job: { id: string; estimate_version_id: string | null }) {
  if (job.estimate_version_id === null) return true;
  const { data, error } = await context.supabase.from("takeoff_send_receipts").select("id")
    .eq("tenant_id", context.tenantId).eq("job_id", job.id).eq("command_kind", "send").limit(1);
  if (error) readFailure(error, "Impossible de lire l’envoi de cette lecture.");
  return (data ?? []).length > 0;
}

async function dossierPlan(context: Context, projectId: string, key: string, generation: string | null): Promise<ItemDetailPlanView> {
  const { data: sets, error: setsError } = await context.supabase.from("plan_sets").select("id")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId);
  if (setsError) readFailure(setsError, "Impossible de lire les plans de l’affaire.");
  const setIds = (sets ?? []).map((set) => set.id.toLowerCase());
  const files = setIds.length ? await readAllRows(() => context.supabase.from("plan_files")
    .select("id, plan_set_id, file_name, page_count, metadata", { count: "exact" })
    .eq("tenant_id", context.tenantId).in("plan_set_id", setIds)) : { data: [], error: null };
  if (files.error) readFailure(files.error, "Impossible de lire les plans de l’affaire.");
  const rows = (files.data ?? []) as FileRow[];

  const service = createServiceRoleClient();
  const pieces = new Map<string, string>();
  for (const setId of setIds) {
    const ids = rows.filter((row) => row.plan_set_id.toLowerCase() === setId).map((row) => row.id);
    for (const [file, piece] of await recordedPlanPieces(service, context.tenantId, setId, ids)) pieces.set(file, piece);
  }
  const candidates = rows.filter((row) => row.id.toLowerCase() === key || pieces.get(row.id.toLowerCase()) === key);
  if (candidates.length === 0) return pieceWithoutCopy(context, projectId, key);

  // The plan-location reader decides, for the member, whether a copy is its piece's current one (lot 3).
  const current: FileRow[] = [];
  for (const candidate of candidates) {
    const { data, error } = await context.supabase.rpc("read_takeoff_plan_location_source",
      { p_project_id: projectId, p_plan_file_id: candidate.id });
    if (error) readFailure(error, "Impossible de lire les plans de l’affaire.");
    const row = ((data ?? []) as Array<{ current_copy: boolean | null }>)[0];
    if (row?.current_copy === true) current.push(candidate);
  }
  const shown = current.length === 1 ? current[0]! : null;
  const named = shown ?? candidates[0]!;
  const logicalKey = pieces.get(named.id.toLowerCase()) ?? named.id.toLowerCase();
  const document: ItemDetailPlanView["document"] = current.length === 0 ? { kind: "unavailable", reason: "no_current_copy" }
    : current.length > 1 ? { kind: "unavailable", reason: "several_copies" }
      : generation !== null && generationOf(shown) !== generation ? { kind: "unavailable", reason: "generation_replaced" }
        : { kind: "dossier", planSetId: shown!.plan_set_id.toLowerCase(), planFileId: shown!.id.toLowerCase() };
  return {
    plan: {
      key: logicalKey,
      name: getPlanFileDisplayName({ file_name: named.file_name, metadata: metadataOf(named.metadata) }),
      planFileId: shown ? shown.id.toLowerCase() : null,
      generation: shown ? generationOf(shown) : null,
      contentSha256: null,
      pageCount: shown?.page_count ?? null,
      pagesRead: [],
    },
    reading: null,
    document,
  };
}

/** A plan of the dossier with no copy in the affaire's plan sets now: named, never drawn; anything else is not found. */
async function pieceWithoutCopy(context: Context, projectId: string, key: string): Promise<ItemDetailPlanView> {
  if (!UUID.test(key)) throw notInDossier();
  const { data, error } = await context.supabase.from("affaire_intake_documents").select("id, file_name, document_kind")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId).eq("id", key).maybeSingle();
  if (error) readFailure(error, "Impossible de lire le dossier de l’affaire.");
  if (!data || data.document_kind !== "plans") throw notInDossier();
  return {
    plan: { key, name: data.file_name, planFileId: null, generation: null, contentSha256: null, pageCount: null, pagesRead: [] },
    reading: null,
    document: { kind: "unavailable", reason: "no_current_copy" },
  };
}
