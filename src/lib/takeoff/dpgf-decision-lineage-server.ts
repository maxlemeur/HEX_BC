import "server-only";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { selectInChunks } from "@/lib/supabase/in-chunks";
import { listTakeoffDpgfEstimateItems, listTakeoffDpgfReviewDecisions } from "@/lib/takeoff/dpgf-comparison-repository";
import {
  carryTakeoffDpgfReviewDecisions,
  type DocumentaryDpgfLine,
  type TakeoffDpgfEstimateItem,
} from "@/lib/takeoff/dpgf-comparison-preparation";
import type { AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import type { TakeoffDpgfReviewDecisionRecord } from "@/lib/takeoff/types";

type Decision = TakeoffDpgfReviewDecisionRecord;

export async function loadDpgfDecisionAncestors(input: {
  supabase: AuthenticatedTakeoffContext["supabase"];
  tenantId: string;
  projectId: string;
  jobId: string;
  versionId: string;
  linkedFromVersionId: string | null;
  currentDecisions: Decision[];
}) {
  const versions = new Map<string, { items: TakeoffDpgfEstimateItem[]; decisions: Decision[] }>();
  const visited = new Set([input.versionId]);
  const pending = new Set<string>();
  function enqueue(id: string | null) {
    if (id && !visited.has(id)) pending.add(id);
  }
  enqueue(input.linkedFromVersionId);
  for (const decision of input.currentDecisions) enqueue(decision.carried_over_from_version_id);
  while (pending.size) {
    const ids = [...pending];
    pending.clear();
    for (const id of ids) visited.add(id);
    const { data, error } = await selectInChunks(ids, chunk => input.supabase.from("estimate_versions")
      .select("id").eq("tenant_id", input.tenantId).eq("project_id", input.projectId).in("id", chunk));
    if (error) throw mapSupabaseError(error, "Impossible de retrouver les versions source du DPGF.");
    await Promise.all(data.map(async ({ id }) => {
      const scope = { supabase: input.supabase, tenantId: input.tenantId, jobId: input.jobId, versionId: id };
      const decisions = await listTakeoffDpgfReviewDecisions(scope);
      const items = decisions.length ? await listTakeoffDpgfEstimateItems(scope) : [];
      versions.set(id, { items, decisions });
      for (const decision of decisions) enqueue(decision.carried_over_from_version_id);
    }));
  }
  return versions;
}

type DecisionVersion = { lines: DocumentaryDpgfLine[]; decisions: Decision[] };

/** A duplicated estimate stores its own copy of a decision. Check every copied
 * link against the source lines before treating the copy as a local decision. */
export function resolveDpgfDecisionLineage(input: {
  versions: Map<string, DecisionVersion>;
  versionId: string;
  linkedFromVersionId: string | null;
  linkedFromVersionNumber: number | null;
}) {
  const valid = new Map<string, Decision[]>();
  const visiting = new Set<string>();

  function carryFrom(parentId: string, target: DecisionVersion, versionNumber: number | null) {
    const parent = input.versions.get(parentId);
    if (!parent) return new Map<string, Decision>();
    return carryTakeoffDpgfReviewDecisions({
      decisions: validated(parentId), sourceLines: parent.lines, targetLines: target.lines,
      linkedFromVersionId: parentId, linkedFromVersionNumber: versionNumber,
    });
  }

  function validated(versionId: string): Decision[] {
    const cached = valid.get(versionId);
    if (cached) return cached;
    const version = input.versions.get(versionId);
    if (!version || visiting.has(versionId)) return [];
    visiting.add(versionId);
    const fromParent = new Map<string, Map<string, Decision>>();
    const result = version.decisions.filter(decision => {
      const parentId = decision.carried_over_from_version_id;
      if (!parentId) return true;
      let inherited = fromParent.get(parentId);
      if (!inherited) {
        inherited = carryFrom(parentId, version, decision.carried_over_from_version_number);
        fromParent.set(parentId, inherited);
      }
      return inherited.has(decision.estimate_item_id);
    });
    visiting.delete(versionId);
    valid.set(versionId, result);
    return result;
  }

  const reviewDecisions = validated(input.versionId);
  const target = input.versions.get(input.versionId)!;
  const carriedReviewDecisions = input.linkedFromVersionId
    ? carryFrom(input.linkedFromVersionId, target, input.linkedFromVersionNumber)
    : new Map<string, Decision>();
  // A rejected stored decision must not be replaced by a more distant ancestor.
  for (const decision of target.decisions) carriedReviewDecisions.delete(decision.estimate_item_id);
  return { reviewDecisions, carriedReviewDecisions };
}
