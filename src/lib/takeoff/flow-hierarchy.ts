import type { PlanSetListItem } from "@/lib/takeoff/types";

export const TAKEOFF_FLOW_KINDS = ["principal", "adjacent", "legacy"] as const;
export type TakeoffFlowKind = (typeof TAKEOFF_FLOW_KINDS)[number];

export type TakeoffFlowDescriptor = {
  kind: TakeoffFlowKind;
  label: string;
  summary: string;
  badgeClassName: string;
};

export function resolvePlanSetFlowDescriptor(
  planSet: Pick<PlanSetListItem, "estimate_version_id">
): TakeoffFlowDescriptor {
  if (planSet.estimate_version_id) {
    return {
      kind: "legacy",
      label: "Fallback legacy",
      summary:
        "Jeu rattache a une version de devis historique. A conserver comme recours explicite, pas comme voie par defaut.",
      badgeClassName:
        "bg-[var(--warning)]/10 text-[var(--warning)] ring-1 ring-[var(--warning)]/20",
    };
  }

  return {
    kind: "principal",
    label: "Flux principal",
    summary:
      "Jeu gere au niveau de l'affaire. C'est la voie par defaut pour lancer et reprendre le metre.",
    badgeClassName:
      "bg-[var(--success)]/10 text-[var(--success)] ring-1 ring-[var(--success)]/20",
  };
}

export function countLegacyPlanSets(
  planSets: Array<Pick<PlanSetListItem, "estimate_version_id">>
): number {
  return planSets.filter((planSet) => resolvePlanSetFlowDescriptor(planSet).kind === "legacy")
    .length;
}
