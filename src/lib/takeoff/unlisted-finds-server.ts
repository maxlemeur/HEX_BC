import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { conflict, mapSupabaseError, unprocessableEntity } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { selectInChunks } from "@/lib/supabase/in-chunks";
import { asRecord } from "@/lib/value-guards";
import type { Database, Json } from "@/types/database";
import { itemListEntries, withAddedItems } from "./item-list";
import { derivedIntent, itemListGestureDigest, readItemListOverview, listWriteFailure, memberNames, readOrdered,
  readStoredItemList, requireListWriter } from "./item-list-server";
import { assertTakeoffEnabled } from "./feature-flags";
import { posteSourceId } from "./poste-list";
import { parseTakeoffRequestManifest } from "./request-activity";
import { readTakeoffVisibleSources } from "./source-visibility-server";
import { designationKey, type FindCommand, type FindsView } from "./unlisted-finds";

type Client = SupabaseClient<Database>;
type Publication = { job_id: string; launch_unit_key: string; answer_count: number; pages: number[];
  takeoff_launch_requests: { manifest: Json }; takeoff_list_revisions: { item_count: number } };
type Decision = Database["public"]["Tables"]["takeoff_find_decisions"]["Row"];
const readFailure = "Impossible de lire les ouvrages hors liste.";

async function requireFindsAccess(projectId: string) {
  const access = await requireAffaireAccess(projectId, "read");
  await assertTakeoffEnabled(access.context.tenantId, { supabase: access.context.supabase });
  return access;
}

export async function readUnlistedFinds(projectId: string): Promise<FindsView> {
  const { context, project } = await requireFindsAccess(projectId);
  const scope = { tenantId: context.tenantId, projectId: project.id };
  const member = context.supabase as unknown as Client;
  const service = createServiceRoleClient();
  const [list, right, decisions, publications] = await Promise.all([
    readItemListOverview(member, service, scope),
    service.rpc("takeoff_item_list_may_write", { p_actor: context.userId, p_project_id: project.id, p_tenant_id: context.tenantId }),
    readOrdered<Decision>((from, to) => member.from("takeoff_find_decisions").select("*",{ count: "exact" })
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).is("undone_at",null).order("decided_at").order("id").range(from,to)),
    readOrdered<Publication>((from,to) => service.from("takeoff_item_answer_publications")
      .select("job_id,launch_unit_key,answer_count,pages,takeoff_launch_requests!inner(manifest),takeoff_list_revisions!inner(item_count)", { count: "exact" })
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).order("published_at",{ ascending: false })
      .order("job_id").range(from,to)),
  ]);
  if (right.error) throw mapSupabaseError(right.error, readFailure);
  const candidates = publications.flatMap(row => {
    const raw = row.takeoff_launch_requests.manifest;
    const manifest = parseTakeoffRequestManifest(raw);
    const unit = manifest?.units.find(unit => unit.key === row.launch_unit_key);
    const plan = unit?.plans.length === 1 && manifest?.plans.get(unit.plans[0]);
    if (!plan || !plan.planFileId || !plan.logicalId) return [];
    const retainedPages = new Set(plan.pages);
    const unitPages = new Set(unit.pages ?? []);
    const pages = new Set(row.pages.filter(page => (!retainedPages.size || retainedPages.has(page))
      && (!unitPages.size || unitPages.has(page)) && (plan.pageCount === null || page <= plan.pageCount)));
    return [{ jobId: row.job_id, planKey: plan.logicalId, fileId: plan.planFileId, documentId: plan.documentId,
      planName: plan.name, total: row.takeoff_list_revisions.item_count, pages,
      wholePlan: plan.pageCount !== null && pages.size === plan.pageCount,
      wholeList: !Array.isArray(asRecord(asRecord(asRecord(raw)?.order)?.list)?.asked_item_ids)
        && row.answer_count === row.takeoff_list_revisions.item_count }];
  });
  const documentIds = [...new Set([...candidates.map(p => p.documentId), ...decisions.map(d => d.intake_document_id)]
    .filter((id): id is string => !!id))];
  const [visibility, documents] = await Promise.all([
    readTakeoffVisibleSources({ ...scope, supabase: context.supabase, ids: candidates.flatMap(plan => [plan.fileId, plan.documentId]) }),
    selectInChunks(documentIds, ids => member.from("affaire_intake_documents").select("id").eq("tenant_id",scope.tenantId)
      .eq("project_id",scope.projectId).is("deleted_at",null).is("deletion_token",null).in("id",ids)),
  ]);
  if (documents.error) throw mapSupabaseError(documents.error, readFailure);
  const readableDocuments = new Set(documents.data.map(d => d.id));
  const documentLink = (id: string | null) => id && readableDocuments.has(id) ? id : null;
  // Only a later reading of the entire list replaces a page's findings. A targeted measurement adds its evidence.
  const supersededPages = new Map<string, Set<number>>();
  const retained = candidates.flatMap(plan => {
    if (visibility !== "all" && !visibility.planFiles.has(plan.fileId)
      && !(plan.documentId === plan.planKey && visibility.documents.has(plan.documentId))) return [];
    const superseded = supersededPages.get(plan.planKey);
    const visiblePages = new Set([...plan.pages].filter(page => !superseded?.has(page)));
    const evaluateMismatch = !superseded && plan.wholeList && plan.wholePlan;
    if (plan.wholeList) {
      const covered = superseded ?? new Set<number>();
      for (const page of plan.pages) covered.add(page);
      supersededPages.set(plan.planKey, covered);
    }
    return visiblePages.size ? [{ ...plan, visiblePages, evaluateMismatch }] : [];
  });
  const jobs = await selectInChunks(retained.map(plan => plan.jobId), ids => service.from("takeoff_item_answer_publications")
    .select("job_id,unlisted_findings,takeoff_results!inner(warnings)").eq("tenant_id",context.tenantId)
    .eq("project_id", project.id).in("job_id",ids));
  if (jobs.error) throw mapSupabaseError(jobs.error, readFailure);
  const byJob = new Map(jobs.data.map(row => [row.job_id,row]));
  const names = await memberNames(member, decisions.map(row => row.decided_by));
  const findDecisions: FindsView["decisions"] = decisions.map(d => ({
    id: d.id, jobId: d.job_id, index: d.finding_index, planKey: d.plan_logical_id, fileId: d.plan_file_id,
    documentId: documentLink(d.intake_document_id), planName: d.plan_name, page: d.page, evidence: d.evidence, designation: d.designation,
    reason: d.reason as FindsView["decisions"][number]["reason"], detail: d.detail, itemId: d.item_id,
    author: names[d.decided_by] ?? d.decided_by, date: d.decided_at,
  }));
  const coordinate = new Set(decisions.map(d => `${d.job_id}:${d.finding_index}`));
  const decisionJobs = new Map(decisions.map(d => [JSON.stringify([d.plan_logical_id,d.designation_key]),d.job_id]));
  const finds: FindsView["finds"] = [];
  const notices: FindsView["notices"] = [];
  for (const plan of retained) {
    const row = byJob.get(plan.jobId);
    if (!row) continue;
    const entries = Array.isArray(row.unlisted_findings) ? row.unlisted_findings : [];
    for (const [index, entry] of entries.entries()) {
      const f = asRecord(entry);
      if (!f || typeof f.page !== "number" || !plan.visiblePages.has(f.page) || typeof f.evidence !== "string" || typeof f.designation !== "string") continue;
      const key = JSON.stringify([plan.planKey,designationKey(f.designation)]);
      const decisionJob = decisionJobs.get(key);
      if (coordinate.has(`${plan.jobId}:${index}`) || (decisionJob && decisionJob !== plan.jobId)) continue;
      finds.push({ jobId: plan.jobId, index, planKey: plan.planKey, fileId: plan.fileId, documentId: documentLink(plan.documentId),
        planName: plan.planName, designation: f.designation, page: f.page, evidence: f.evidence });
    }
    const warnings = row.takeoff_results.warnings;
    const truncated = Array.isArray(warnings) && warnings.some(w => asRecord(w)?.code === "POSTE_HORS_LISTE_TRONQUE");
    if (!entries.length && !truncated) continue;
    const count = plan.evaluateMismatch ? await member.from("takeoff_item_answers").select("id",{ count: "exact",head: true })
      .eq("job_id",plan.jobId).eq("outcome","not_found") : null;
    if (count?.error) throw mapSupabaseError(count.error, readFailure);
    notices.push({ planKey: plan.planKey, planName: plan.planName, total: plan.total, outside: entries.length,
      missing: count?.count ?? 0, truncated });
  }
  return { revisionId: list.revisionId, revision: list.revision ?? 0, canWrite: right.data === true, decisions: findDecisions, finds, notices,
    sections: list.sections, originLine: list.originLine };
}

function writeFailure(error: {message: string}): never {
  if (error.message.includes("TAKEOFF_FIND_ALREADY_DECIDED")) throw conflict("Cet ouvrage a déjà fait l’objet d’une décision. Actualisez la liste.");
  if (error.message.includes("TAKEOFF_FIND_")) throw unprocessableEntity("Vérifiez l’ouvrage et le motif de la décision.");
  return listWriteFailure(error);
}

export async function decideUnlistedFinds(projectId: string, command: FindCommand) {
  const { context, project } = await requireFindsAccess(projectId);
  const scope = { tenantId: context.tenantId, projectId: project.id };
  const service = createServiceRoleClient();
  const actor = context.userId;
  await requireListWriter(service,scope,actor);
  const args = { p_tenant_id: scope.tenantId, p_project_id: scope.projectId, p_actor: actor };
  if (command.kind !== "add") {
    const result = command.kind === "undo" ? await service.rpc("undo_takeoff_find_dismissal",{ ...args, p_decision_id: command.decisionId })
      : await service.rpc("dismiss_takeoff_find",{ ...args, p_job_id: command.jobId, p_finding_index: command.index,
        p_reason: command.reason, p_detail: command.detail, p_intent_key: command.intentKey });
    if (result.error) writeFailure(result.error);
    return { itemIds: [] };
  }
  const stored = await readStoredItemList(service,scope);
  const addedAt = new Date().toISOString();
  const currentItems = new Map(stored?.revision.items.map(item => [item.id,item]));
  const current = stored?.row.revision === command.expectedRevision;
  const additions = command.entries.map(entry => {
    const section = entry.section;
    const path = section.kind === "new" ? [{ id: `section-${itemListGestureDigest({ title: section.title }).slice(0,32)}`,
      title: section.title, order: 1000000 }] : section.kind === "existing" ? currentItems.get(section.itemId)?.sections : null;
    if (current && section.kind === "existing" && !path) throw conflict("La section choisie a changé.");
    return { label: entry.label, expectedUnit: entry.unit, measurementBasis: null, qualifiers: {}, sectionPath: path ?? null,
      addedBy: actor, addedAt, intentId: derivedIntent(command.intentKey,`${entry.jobId}:${entry.index}`) };
  });
  const refs = additions.map((a,i) => ({ job_id: command.entries[i].jobId, finding_index: command.entries[i].index,
    item_id: posteSourceId(scope,{ kind: "manual", intentId: a.intentId, addedBy: actor, addedAt,
      addedInRevision: command.expectedRevision + 1 }) }));
  if (new Set(refs.map(ref => ref.item_id)).size !== refs.length) throw unprocessableEntity("Un ouvrage figure deux fois dans la sélection.");
  const result = await service.rpc("add_takeoff_finds_to_list",{ ...args, p_expected_revision: command.expectedRevision,
    p_intent_key: command.intentKey, p_gesture_sha256: itemListGestureDigest(command), p_finds: refs,
    p_entries: current && stored ? itemListEntries(withAddedItems(stored.revision,additions)) as unknown as Json : [] });
  if (result.error) writeFailure(result.error);
  return { itemIds: refs.map(ref => ref.item_id) };
}
