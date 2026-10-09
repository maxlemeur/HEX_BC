import { Alert } from "@/components/ui/alert";
import type {
  FlatStructureDraftNode,
  NodeMergeState,
  NodeOverrideState,
} from "@/lib/estimates/estimate-structure-draft";
import type { EstimateStructureDraftApplyMode } from "@/lib/estimates/client";
import { cn } from "@/lib/utils";

import { OverrideCard } from "./OverrideCard";

type ApplicationStepProps = {
  hasExistingItems: boolean;
  mode: EstimateStructureDraftApplyMode;
  onModeChange: (mode: EstimateStructureDraftApplyMode) => void;
  selectedNodes: FlatStructureDraftNode[];
  overrides: Record<string, NodeOverrideState>;
  onUpdateOverride: (nodeId: string, patch: Partial<NodeOverrideState>) => void;
  nodeMergeStates: Map<string, NodeMergeState>;
  hasInvalidMergeConfiguration: boolean;
  submitError: string | null;
};

const RADIO_CLASS = "mt-0.5 size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed";

export function ApplicationStep({
  hasExistingItems,
  mode,
  onModeChange,
  selectedNodes,
  overrides,
  onUpdateOverride,
  nodeMergeStates,
  hasInvalidMergeConfiguration,
  submitError,
}: ApplicationStepProps) {
  return (
    <div className="space-y-5">
      <div
        role="radiogroup"
        aria-labelledby="estimate-structure-apply-mode-title"
        className="rounded-lg border border-border p-4"
      >
        <h3
          id="estimate-structure-apply-mode-title"
          className="text-sm font-semibold text-foreground"
        >
          Mode d&apos;application
        </h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-4 has-checked:border-primary/40 has-checked:bg-primary/5">
            <input
              type="radio"
              className={RADIO_CLASS}
              name="estimate-structure-apply-mode"
              checked={mode === "merge_existing"}
              onChange={() => onModeChange("merge_existing")}
            />
            <span className="min-w-0">
              <span className="block font-medium text-foreground">
                Fusionner avec l&apos;existant
              </span>
              <span className="mt-2 block text-sm text-muted-foreground">
                Utilise les doublons détectés et crée le reste.
              </span>
            </span>
          </label>
          <label
            className={cn(
              "flex items-start gap-3 rounded-lg border border-border p-4 has-checked:border-primary/40 has-checked:bg-primary/5",
              hasExistingItems ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            )}
          >
            <input
              type="radio"
              className={RADIO_CLASS}
              name="estimate-structure-apply-mode"
              checked={mode === "create_empty"}
              onChange={() => onModeChange("create_empty")}
              disabled={hasExistingItems}
            />
            <span className="min-w-0">
              <span className="block font-medium text-foreground">
                Créer à vide
              </span>
              <span className="mt-2 block text-sm text-muted-foreground">
                Réservé aux versions sans structure existante.
              </span>
            </span>
          </label>
        </div>
      </div>

      <section
        aria-labelledby="estimate-structure-overrides-title"
        className="rounded-lg border border-border p-4"
      >
        <h3
          id="estimate-structure-overrides-title"
          className="text-sm font-semibold text-foreground"
        >
          Ajustements par nœud
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Fait : seules les cibles de fusion compatibles avec le parent final sont proposées.
        </p>
        <div className="mt-4 space-y-3">
          {selectedNodes.map((node) => (
            <OverrideCard
              key={node.id}
              node={node}
              override={overrides[node.id]}
              nodeMergeState={nodeMergeStates.get(node.id)}
              onUpdateOverride={onUpdateOverride}
            />
          ))}
        </div>
      </section>

      {hasInvalidMergeConfiguration ? (
        <Alert variant="warning">
          Corrigez les nœuds signalés avant d&apos;appliquer la structure : certaines fusions n&apos;ont pas de cible compatible.
        </Alert>
      ) : null}
      {submitError ? <Alert variant="danger">{submitError}</Alert> : null}
    </div>
  );
}
