import type {
  FlatStructureDraftNode,
  NodeMergeState,
  NodeOverrideState,
} from "@/lib/estimates/estimate-structure-draft";
import type { EstimateStructureDraftApplyMode } from "@/lib/estimates/client";

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
      <div className="rounded-2xl border border-[var(--slate-200)] p-4">
        <h3 className="text-sm font-semibold text-[var(--slate-900)]">
          Mode d&apos;application
        </h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="rounded-xl border border-[var(--slate-200)] p-4">
            <input
              type="radio"
              name="estimate-structure-apply-mode"
              checked={mode === "merge_existing"}
              onChange={() => onModeChange("merge_existing")}
            />
            <span className="ml-3 font-medium text-[var(--slate-900)]">
              Fusionner avec l&apos;existant
            </span>
            <p className="mt-2 text-sm text-[var(--slate-500)]">
              Utilise les doublons detectes et cree le reste.
            </p>
          </label>
          <label
            className={`rounded-xl border border-[var(--slate-200)] p-4 ${
              hasExistingItems ? "opacity-50" : ""
            }`}
          >
            <input
              type="radio"
              name="estimate-structure-apply-mode"
              checked={mode === "create_empty"}
              onChange={() => onModeChange("create_empty")}
              disabled={hasExistingItems}
            />
            <span className="ml-3 font-medium text-[var(--slate-900)]">
              Creer a vide
            </span>
            <p className="mt-2 text-sm text-[var(--slate-500)]">
              Reserve aux versions sans structure existante.
            </p>
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--slate-200)] p-4">
        <h3 className="text-sm font-semibold text-[var(--slate-900)]">
          Overrides par noeud
        </h3>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Fait: seules les cibles de fusion compatibles avec le parent final sont proposees.
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
      </div>

      {hasInvalidMergeConfiguration ? (
        <div className="alert alert-warning">
          Corrigez les noeuds signales avant d&apos;appliquer la structure: certaines fusions n&apos;ont pas de cible compatible.
        </div>
      ) : null}
      {submitError ? <div className="alert alert-error">{submitError}</div> : null}
    </div>
  );
}
