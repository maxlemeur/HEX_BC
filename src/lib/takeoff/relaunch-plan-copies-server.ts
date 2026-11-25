import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";
import { TakeoffError, TakeoffErrorCode } from "./errors";
import { describePlansWithoutCopy } from "./launch-request";
import type { TakeoffPreparationSnapshot } from "./preparation";
import { isTakeoffSourceVisible } from "./request-activity";
import { readTakeoffVisibleSources } from "./source-visibility-server";
import type { Database } from "@/types/database";

// The copies of a relaunched analysis's plans (lot 3, one analysis per plan): the source the database recorded for each
// copy (`takeoff_plan_location_sources`, migration 20261121040445_takeoff_plan_locations.sql), the current copy the
// plan-location reader decides, and the identities a relaunch can have had across the dossier's replacements. Read by the
// server after the affaire's access check (launch-request-server.ts).

type Service = SupabaseClient<Database>;
type Context = AuthenticatedTenantContext;

function databaseError(error: { code?: string; message: string }, message: string): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, message);
}

/**
 * The dossier piece behind each copy of a plan set, as the database recorded the copy's source at its insert
 * (`takeoff_plan_location_sources`, the source kind « intake_document »): a copy uploaded to the plan set is its own plan,
 * whatever its metadata names. Kept once a copy is gone. Read by the server, after the affaire's access check.
 */
export async function recordedPlanPieces(service: Service, tenantId: string, planSetId: string, fileIds: readonly string[]) {
  const ids = [...new Set(fileIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return new Map<string, string>();
  const { data, error } = await service.from("takeoff_plan_location_sources").select("plan_file_id, source_kind, source_id")
    .eq("tenant_id", tenantId).eq("plan_set_id", planSetId).in("plan_file_id", ids);
  if (error) databaseError(error, "Impossible de lire les plans de l’affaire.");
  return new Map((data ?? []).filter((row) => row.source_kind === "intake_document")
    .map((row) => [row.plan_file_id.toLowerCase(), row.source_id.toLowerCase()]));
}

/** The recorded source of each copy named (`takeoff_plan_location_sources`), read in pieces of a hundred copies. */
export async function recordedCopySources(service: Service, tenantId: string, projectId: string, fileIds: readonly string[]) {
  const ids = [...new Set(fileIds.map((id) => id.toLowerCase()))];
  const sources = new Map<string, { kind: string; id: string }>();
  for (let from = 0; from < ids.length; from += 100) {
    const { data, error } = await service.from("takeoff_plan_location_sources").select("plan_file_id, source_kind, source_id")
      .eq("tenant_id", tenantId).eq("project_id", projectId).in("plan_file_id", ids.slice(from, from + 100));
    if (error) databaseError(error, "Impossible de lire les plans de l’affaire.");
    for (const row of data ?? []) sources.set(row.plan_file_id.toLowerCase(), { kind: row.source_kind, id: row.source_id.toLowerCase() });
  }
  return sources;
}

/** The rows of a read of the copies' recorded sources, a page (PostgREST's ceiling, supabase/config.toml). */
const REGISTRY_PAGE = 1000;

/**
 * The other identities a command naming no plan can have had since the analysis it replaces: for each copy of its plans'
 * pieces recorded since the copies that analysis read (each a new copy, recorded at its insert in
 * `takeoff_plan_location_sources` and kept once the copy is gone), the copies its plans had then, the latest first (two
 * copies recorded at the same time each count). Read only when another identity holds the command's key: two
 * statements, and one replay per copy recorded since the analysis.
 */
export async function relaunchIdentities(service: Service, tenantId: string, planSetId: string, sealed: string[]) {
  const own = await service.from("takeoff_plan_location_sources").select("plan_file_id, source_kind, source_id").eq("tenant_id", tenantId)
    .eq("plan_set_id", planSetId).in("plan_file_id", sealed);
  if (own.error) databaseError(own.error, "Impossible de lire les plans de l’affaire.");
  const pieceOf = new Map((own.data ?? []).filter((row) => row.source_kind === "intake_document")
    .map((row) => [row.plan_file_id.toLowerCase(), row.source_id.toLowerCase()]));
  if (pieceOf.size === 0) return [];
  // The pieces' copies in the database's order of recording (its own timestamps, then the copy), a page at a time. The
  // registry only grows (a copy's source is recorded once), so a page read later is never shifted. Copies recorded at the
  // same instant share a moment: they are the same time for the identities.
  const history: Array<{ id: string; piece: string; moment: number }> = [];
  let previous: string | null = null;
  for (let from = 0; ; from += REGISTRY_PAGE) {
    const { data, error } = await service.from("takeoff_plan_location_sources").select("plan_file_id, source_id, recorded_at")
      .eq("tenant_id", tenantId).eq("plan_set_id", planSetId).eq("source_kind", "intake_document")
      .in("source_id", [...new Set(pieceOf.values())]).order("recorded_at").order("plan_file_id").range(from, from + REGISTRY_PAGE - 1);
    if (error) databaseError(error, "Impossible de lire les plans de l’affaire.");
    for (const row of data ?? []) {
      const moment: number = (history.at(-1)?.moment ?? -1) + (row.recorded_at === previous ? 0 : 1);
      previous = row.recorded_at;
      history.push({ id: row.plan_file_id.toLowerCase(), piece: row.source_id.toLowerCase(), moment });
    }
    if ((data ?? []).length < REGISTRY_PAGE) break;
  }
  // Per piece, the copy the analysis read: only the copies recorded since count.
  const since = new Map<string, number>();
  for (const copy of history) {
    if (sealed.includes(copy.id)) since.set(copy.piece, Math.max(since.get(copy.piece) ?? -1, copy.moment));
  }
  const latest = (piece: string, moment: number) => history.filter((copy) => copy.piece === piece && copy.moment <= moment).at(-1)?.id;
  const seen = new Set([sealed.join()]);
  return history.filter((copy) => copy.moment >= (since.get(copy.piece) ?? Infinity) && !sealed.includes(copy.id)).reverse()
    .flatMap((copy) => {
      const identity = [...new Set(sealed.map((id) => {
        const piece = pieceOf.get(id);
        if (!piece) return id;
        return piece === copy.piece ? copy.id : latest(piece, copy.moment) ?? id;
      }))].sort();
      if (seen.has(identity.join())) return [];
      seen.add(identity.join());
      return [identity];
    });
}

/** The plans a relaunch reads at their current copies (`scope`), and those of the analysis with no current copy now. */
export type CurrentPlanCopies = { scope: string[]; withoutCopy: Array<{ id: string; piece: string | null; removed: boolean }> };

/**
 * Each plan copy an analysis read, at its piece's current working copy in the plan set, by the plan-location reader's
 * own decision (read_takeoff_plan_location_source, under the member's session: the dossier piece's generation and
 * source, the copy's deletion): the same copy while it is current; else the one current copy of its piece (a new
 * generation is a new copy, under a new identifier; an older copy can still be in the plan set until the sync reserves
 * it for its cleanup). A copy with no piece (an upload to the plan set) or with several current copies keeps its own
 * identity, and the command then refuses it; `withoutCopy` names the plans with no current copy at all, and whether their
 * piece left the dossier (or only its copy is missing for now).
 */
export async function currentPlanCopies(service: Service, context: Context, projectId: string, planSetId: string,
  plans: readonly string[], match: "replace" | "exact" = "replace"): Promise<CurrentPlanCopies> {
  const sourceOf = async (planFileId: string) => {
    const { data, error } = await context.supabase.rpc("read_takeoff_plan_location_source",
      { p_project_id: projectId, p_plan_file_id: planFileId });
    if (error) databaseError(error, "Impossible de lire les plans de l’affaire.");
    const row = ((data ?? []) as Array<{ source_kind: string; source_id: string; current_copy: boolean | null }>)[0];
    return row ? { piece: row.source_kind === "intake_document" ? row.source_id.toLowerCase() : null, current: row.current_copy === true }
      : null;
  };
  const sealed = await Promise.all(plans.map(async (id) => ({ id, source: await sourceOf(id) })));
  const pieces = new Set(match === "replace"
    ? sealed.flatMap(({ source }) => (source && !source.current && source.piece ? [source.piece] : [])) : []);
  const currentOf = new Map<string, string[]>();
  if (pieces.size) {
    // Only a copy the plan set holds can be current (at most its twenty files): its copies, then their recorded pieces.
    const held = await readAllRows(() => service.from("plan_files").select("id", { count: "exact" }).eq("tenant_id", context.tenantId)
      .eq("plan_set_id", planSetId).order("id"));
    if (held.error) databaseError(held.error, "Impossible de lire les plans de l’affaire.");
    const heldIds = (held.data ?? []).map((row) => row.id.toLowerCase()).filter((id) => !plans.includes(id));
    const recorded = heldIds.length ? await service.from("takeoff_plan_location_sources").select("plan_file_id, source_kind, source_id")
      .eq("tenant_id", context.tenantId).eq("plan_set_id", planSetId).in("plan_file_id", heldIds) : { data: [], error: null };
    if (recorded.error) databaseError(recorded.error, "Impossible de lire les plans de l’affaire.");
    const candidates = (recorded.data ?? []).filter((row) => row.source_kind === "intake_document" && pieces.has(row.source_id.toLowerCase()))
      .map((row) => ({ id: row.plan_file_id.toLowerCase(), piece: row.source_id.toLowerCase() }));
    for (const candidate of await Promise.all(candidates.map(async (copy) => ({ ...copy, source: await sourceOf(copy.id) })))) {
      if (candidate.source?.current) currentOf.set(candidate.piece, [...(currentOf.get(candidate.piece) ?? []), candidate.id]);
    }
  }
  // A copy the reader does not call current is never read: its piece's one current copy is, else it has no copy now
  // (missing, unreadable, or several current copies: never chosen for the member).
  const gone: Array<{ id: string; piece: string | null }> = [];
  const scope: string[] = [];
  for (const { id, source } of sealed) {
    if (source?.current) {
      scope.push(id);
      continue;
    }
    const now = source?.piece ? currentOf.get(source.piece) ?? [] : [];
    if (now.length === 1) scope.push(now[0]!);
    else gone.push({ id, piece: source?.piece ?? null });
  }
  // Whether the piece of a plan without a copy is still a plan of the dossier: only the wording of the refusal depends on it.
  const goneIds = [...new Set(gone.flatMap(({ piece }) => (piece ? [piece] : [])))];
  const dossier = goneIds.length ? await service.from("affaire_intake_documents")
    .select("id, deleted_at, deletion_token, upload_status, classification_status, document_kind")
    .eq("tenant_id", context.tenantId).eq("project_id", projectId).in("id", goneIds) : { data: [], error: null };
  if (dossier.error) databaseError(dossier.error, "Impossible de lire le dossier de l’affaire.");
  const stillPlans = new Set(((dossier.data ?? []) as Array<{ id: string; deleted_at: string | null; deletion_token: string | null;
    upload_status: string; classification_status: string; document_kind: string }>)
    .filter((piece) => !piece.deleted_at && !piece.deletion_token && piece.upload_status === "uploaded"
      && piece.classification_status === "classified" && piece.document_kind === "plans").map((piece) => piece.id.toLowerCase()));
  return { scope: [...new Set(scope)].sort(),
    withoutCopy: gone.map(({ id, piece }) => ({ id, piece, removed: !piece || !stillPlans.has(piece) })) };
}

export async function checkCurrentCommandCopies(service: Service,
  input: { context: Context; projectId: string; planSetId: string }, plans: readonly string[], snapshot: TakeoffPreparationSnapshot) {
  const { context } = input;
  const byId = new Map(snapshot.preparation.sources.map((source) => [source.document_id, source.document_name]));
  const checked = await currentPlanCopies(service, context, input.projectId, input.planSetId, plans, "exact");
  if (checked.withoutCopy.length > 0) {
    const visible = await readTakeoffVisibleSources({ supabase: context.supabase, tenantId: context.tenantId,
      projectId: input.projectId, ids: checked.withoutCopy.flatMap(({ id, piece }) => [id, piece]) });
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
      message: `${describePlansWithoutCopy(checked.withoutCopy.map(({ id, piece, removed }, index) => ({
        name: isTakeoffSourceVisible(visible, id, piece) ? byId.get(id) ?? `Plan ${index + 1}` : `Plan ${index + 1}`,
        reason: removed ? "removed" : "copy_missing",
      })))}. Actualisez les plans à relancer.` });
  }
}
