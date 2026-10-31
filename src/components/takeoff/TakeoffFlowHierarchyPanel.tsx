import { Fragment } from "react";

import { JourneyHelp } from "@/components/journey/JourneyPage";
import type { TakeoffFlowKind } from "@/lib/takeoff/flow-hierarchy";

type TakeoffFlowHierarchyPanelProps = {
  currentKind: Exclude<TakeoffFlowKind, "legacy">;
  legacyPlanSetCount: number;
};

const FLOW_CARDS: Array<{
  kind: TakeoffFlowKind;
  label: string;
  summary: string;
}> = [
  {
    kind: "principal",
    label: "Parcours recommandé",
    summary:
      "Ajoutez les plans, lancez l’analyse, contrôlez les quantités, puis intégrez-les au devis.",
  },
  {
    kind: "adjacent",
    label: "Suivi et reprise",
    summary:
      "Suivez les analyses, les exceptions et les reprises depuis cette page.",
  },
  {
    kind: "legacy",
    label: "Anciens jeux de plans",
    summary:
      "Rouvrez les jeux rattachés à d’anciennes versions du devis.",
  },
];

/** How the métré is organised, folded to one quiet line at the foot of the « Repères ». */
export function TakeoffFlowHierarchyPanel({
  currentKind,
  legacyPlanSetCount,
}: TakeoffFlowHierarchyPanelProps) {
  return (
    <JourneyHelp summary="Comment s’organise un métré ?">
      <dl>
        {FLOW_CARDS.map((card) => (
          <Fragment key={card.kind}>
            <dt>
              {card.label}
              {card.kind === currentKind ? " · page actuelle" : null}
            </dt>
            <dd>
              {card.summary}
              {card.kind === "legacy" && legacyPlanSetCount > 0
                ? ` ${legacyPlanSetCount} ancien${legacyPlanSetCount > 1 ? "s" : ""} jeu${legacyPlanSetCount > 1 ? "x" : ""} disponible${legacyPlanSetCount > 1 ? "s" : ""}.`
                : null}
            </dd>
          </Fragment>
        ))}
      </dl>
    </JourneyHelp>
  );
}
