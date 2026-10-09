import type { PlanSetListItem } from "@/lib/takeoff/types";

export const TAKEOFF_FLOW_KINDS = ["principal", "adjacent", "legacy"] as const;
export type TakeoffFlowKind = (typeof TAKEOFF_FLOW_KINDS)[number];

export type TakeoffFlowDescriptor = {
  kind: TakeoffFlowKind;
  label: string;
  summary: string;
};

export function resolvePlanSetFlowDescriptor(
  planSet: Pick<PlanSetListItem, "estimate_version_id">
): TakeoffFlowDescriptor {
  if (planSet.estimate_version_id) {
    return {
      kind: "legacy",
      label: "Ancien parcours",
      summary:
        "Jeu rattaché à une version de devis historique. À conserver comme recours explicite, pas comme voie par défaut.",
    };
  }

  return {
    kind: "principal",
    label: "Flux principal",
    summary:
      "Jeu géré au niveau de l'affaire. C'est la voie par défaut pour lancer et reprendre le métré.",
  };
}

export function countLegacyPlanSets(
  planSets: Array<Pick<PlanSetListItem, "estimate_version_id">>
): number {
  return planSets.filter((planSet) => resolvePlanSetFlowDescriptor(planSet).kind === "legacy")
    .length;
}
