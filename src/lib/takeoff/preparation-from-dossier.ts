import { isSameDocument } from "@/lib/takeoff/page-contributions";
import { findPlanRevisionConflicts, getDeclaredPlanReference, inferPlanLogicalReference, validPlanRevisionDecisions } from "@/lib/takeoff/plan-revision-identity";
import { createEmptyTakeoffPreparation, type TakeoffPreparation, type TakeoffPreparationSource } from "@/lib/takeoff/preparation";

export const DETAILED_TAKEOFF_PROCESSING = { level: "C", provider: "chatgpt" } as const;

export function getDeducedPlanCandidates(sources: readonly TakeoffPreparationSource[]) {
  const plans = sources.filter((source) => source.kind === "plan");
  const included = new Set(plans.filter((source) => source.active).map((source) => source.document_id));
  let previousSize = -1;
  while (previousSize !== included.size) {
    previousSize = included.size;
    for (const plan of plans) {
      if (plan.alternate_of && included.has(plan.alternate_of)) included.add(plan.document_id);
    }
  }
  return plans.filter((source) => included.has(source.document_id));
}

export function buildDeducedTakeoffPreparation(input: {
  sources: TakeoffPreparationSource[];
  planSetId: string;
  saved?: TakeoffPreparation | null;
  buildings?: string[];
  lots?: string[];
  zones?: string[];
}): TakeoffPreparation {
  const previous = input.saved;
  const preparation = previous ?? createEmptyTakeoffPreparation();
  const useDefaultObjective = !previous?.objective;
  const legacySelections = new Set(preparation.sources.filter((source) => source.active && source.plan_set_id).map((source) => source.plan_set_id));
  const savedById = new Map(preparation.sources.map((source) => [source.document_id, source]));
  const applySelection = (source: TakeoffPreparationSource) => {
    const saved = savedById.get(source.document_id);
    const result = { ...(saved ?? source) };
    if (source.kind !== "plan") {
      result.active = saved?.active ?? (source.kind === "dpgf" || source.kind === "cctp");
      return result;
    }
    const wasCurrentSet = preparation.provenance ? preparation.provenance.plan_set_id === source.plan_set_id : legacySelections.has(source.plan_set_id);
    const selected = wasCurrentSet ? saved?.active : saved?.selected_in_plan_set;
    const currentSet = source.plan_set_id === input.planSetId;
    result.active = currentSet && (selected ?? true);
    if (currentSet || selected === undefined) delete result.selected_in_plan_set;
    else result.selected_in_plan_set = selected;
    return result;
  };
  const sources = input.sources.map(applySelection);
  // Keep an unavailable selected reference visible so it cannot silently disappear.
  const currentIds = new Set(sources.map((source) => source.document_id));
  sources.push(...preparation.sources.filter((source) => !source.document_id.startsWith("upload:") && !currentIds.has(source.document_id)).map(applySelection));
  return {
    ...preparation,
    provenance: {
      kind: "dossier", rule_version: 1, converted_from_legacy: preparation.provenance?.converted_from_legacy ?? Boolean(previous), plan_set_id: input.planSetId,
      brief_context: { buildings: input.buildings ?? [], lots: input.lots ?? [], zones: input.zones ?? [] },
    },
    objective: preparation.objective ?? "measure_all",
    processing: DETAILED_TAKEOFF_PROCESSING,
    scope: {
      ...preparation.scope,
      inclusions: previous?.scope.inclusions.length ? previous.scope.inclusions : ["Toutes les pages et tous les ouvrages des plans retenus"],
    },
    sources,
    conventions: useDefaultObjective ? {
      unit: null, unit_mode: "per_item", measurement_basis: "documentary_evidence", calibration: null, purchase: null, confirmed: false,
    } : preparation.conventions,
    destination: preparation.destination.kind === "analysis_only"
      ? { ...preparation.destination, estimate_version_id: null }
      : preparation.destination,
  };
}

export function resolveDeducedPlanVersions(preparation: TakeoffPreparation): TakeoffPreparation {
  const draft = structuredClone(preparation);
  const plans = getDeducedPlanCandidates(draft.sources);
  for (const plan of plans) {
    plan.active = true;
    plan.pages = plan.pages_before_deduplication ?? plan.pages;
    delete plan.alternate_of;
    delete plan.pages_before_deduplication;
  }
  const choices = validPlanRevisionDecisions(plans, draft.plan_revision_decisions ?? []);
  draft.plan_revision_decisions = choices;
  if (findPlanRevisionConflicts(plans, choices).length) return draft;
  const retained = new Map<string, (typeof plans)[number]>();
  const byId = new Map(plans.map((plan) => [plan.document_id, plan]));
  for (const plan of plans) {
    const declared = getDeclaredPlanReference(plan);
    plan.declared_logical_document_id = declared;
    plan.logical_document_id = declared ?? inferPlanLogicalReference(plan);
    plan.inferred_logical_reference = !declared;
  }
  for (const choice of choices) {
    if (choice.choice === "distinct") continue;
    const [keep, omit] = choice.choice === "left" ? [choice.left, choice.right] : [choice.right, choice.left];
    const kept = byId.get(keep.document_id)!;
    const omitted = byId.get(omit.document_id)!;
    const reference = [kept, omitted].find((plan) => plan.declared_logical_document_id) ?? kept;
    const logicalReference = reference.logical_document_id ?? inferPlanLogicalReference(reference, true);
    for (const plan of [kept, omitted]) {
      plan.logical_document_id = logicalReference;
      plan.inferred_logical_reference = logicalReference !== plan.declared_logical_document_id || !logicalReference;
    }
    omitted.active = false;
    omitted.alternate_of = keep.document_id;
  }
  const calibrationId = draft.conventions.calibration?.document_id;
  const activePlans = plans.filter((plan) => plan.active).sort((a, b) =>
    Number(b.document_id === calibrationId) - Number(a.document_id === calibrationId) || a.document_id.localeCompare(b.document_id));
  for (const source of activePlans) {
    if (!source.content_hash) continue;
    const prior = retained.get(source.content_hash);
    if (!prior) {
      retained.set(source.content_hash, source);
      continue;
    }
    // Preserve both source identities and the combined page selection in the snapshot.
    prior.pages_before_deduplication ??= prior.pages;
    prior.pages = prior.pages.length && source.pages.length ? [...new Set([...prior.pages, ...source.pages])].sort((a, b) => a - b) : [];
    source.active = false;
    source.alternate_of = prior.document_id;
  }
  const representative = (id: string) => {
    const seen = new Set<string>();
    let plan = byId.get(id);
    while (plan && !plan.active && plan.alternate_of && !seen.has(plan.document_id)) {
      seen.add(plan.document_id);
      plan = byId.get(plan.alternate_of);
    }
    return plan?.active ? plan : null;
  };
  const pageDocument = (plan: TakeoffPreparationSource) => ({
    plan_file_id: plan.document_id, content_hash: plan.content_hash,
    file_name: plan.document_name, logical_document_id: plan.logical_document_id,
  });
  for (const choice of choices) {
    if (choice.choice !== "distinct") continue;
    const left = representative(choice.left.document_id);
    const right = representative(choice.right.document_id);
    if (left && right && left !== right && isSameDocument(pageDocument(left), pageDocument(right))) {
      const distinct = right.declared_logical_document_id && !left.declared_logical_document_id ? left : right;
      distinct.logical_document_id = `pièce:${distinct.document_id}`;
      distinct.inferred_logical_reference = true;
    }
  }
  return draft;
}
