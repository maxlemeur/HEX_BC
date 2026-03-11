import type { EstimateStructureDraft } from "@/lib/estimates/client";
import {
  confidenceText,
  isWeakSignalNode,
  summarizeNodeProvenance,
  type FlatStructureDraftNode,
  type NodeOverrideState,
  type TreeFilterKey,
} from "@/lib/estimates/estimate-structure-draft";

import { PreviewNodeCard } from "./PreviewNodeCard";
import { TREE_FILTER_CHIPS } from "./shared";

type SelectionStepProps = {
  draft: EstimateStructureDraft;
  selectedRootIds: string[];
  onToggleRootSelection: (nodeId: string) => void;
  isAssemblyOnlyWeakMode: boolean;
  activeFilters: Set<TreeFilterKey>;
  onToggleFilter: (key: TreeFilterKey) => void;
  filterCounts: Record<TreeFilterKey, number>;
  flatNodes: FlatStructureDraftNode[];
  filteredFlatNodeIds: Set<string> | null;
  overrides: Record<string, NodeOverrideState>;
};

export function SelectionStep({
  draft,
  selectedRootIds,
  onToggleRootSelection,
  isAssemblyOnlyWeakMode,
  activeFilters,
  onToggleFilter,
  filterCounts,
  flatNodes,
  filteredFlatNodeIds,
  overrides,
}: SelectionStepProps) {
  const hasFilteredPreviewResults =
    filteredFlatNodeIds === null || filteredFlatNodeIds.size > 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[280px,minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--slate-200)] p-4">
          <h3 className="text-sm font-semibold text-[var(--slate-900)]">
            Lots a retenir
          </h3>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Chaque lot coche sera inclus avec son sous-arbre.
          </p>
          {isAssemblyOnlyWeakMode && selectedRootIds.length === 0 ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Aucune suggestion defendable n&apos;est preselectionnee dans ce contexte.
              Selectionnez manuellement un lot faible confiance si vous souhaitez poursuivre,
              ou enrichissez d&apos;abord les sources affaire.
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            {draft.nodes.map((node) => (
              <label
                key={node.id}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--slate-200)] p-3"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selectedRootIds.includes(node.id)}
                  onChange={() => onToggleRootSelection(node.id)}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--slate-900)]">
                    {node.label}
                  </p>
                  <p className="mt-1 text-xs text-[var(--slate-500)]">
                    {confidenceText(node)}
                  </p>
                  {node.provenance.length > 0 ? (
                    <p className="mt-1 text-xs text-[var(--slate-500)]">
                      Provenance: {summarizeNodeProvenance(node)}
                    </p>
                  ) : null}
                  {node.duplicateMatchPath ? (
                    <p className="mt-1 text-xs text-[var(--amber-700)]">
                      Doublon potentiel: {node.duplicateMatchPath}
                    </p>
                  ) : null}
                  {isWeakSignalNode(node) ? (
                    <p className="mt-1 text-xs text-[var(--rose-700)]">
                      Suggestion issue des assemblages seuls, non preselectionnee par defaut.
                    </p>
                  ) : null}
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--slate-200)] p-4">
          <h3 className="text-sm font-semibold text-[var(--slate-900)]">
            Preview arborescente
          </h3>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="group"
            aria-label="Filtrer les noeuds"
          >
            {TREE_FILTER_CHIPS.map((chip) => {
              const isActive = activeFilters.has(chip.key);
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={isActive}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    isActive ? chip.activeClass : chip.inactiveClass
                  }`}
                  onClick={() => onToggleFilter(chip.key)}
                >
                  {chip.label}
                  <span className="text-[10px] opacity-70">{filterCounts[chip.key]}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-3">
            {!hasFilteredPreviewResults ? (
              <div className="rounded-xl border border-dashed border-[var(--slate-300)] bg-[var(--slate-50)] p-4 text-sm text-[var(--slate-600)]">
                Aucun nœud ne correspond aux filtres actifs.
                Desactivez un filtre pour réafficher la preview.
              </div>
            ) : null}
            {flatNodes.map((node) => {
              if (filteredFlatNodeIds && !filteredFlatNodeIds.has(node.id)) {
                return null;
              }

              const isDisabled =
                node.hierarchyLevel === 1 && !selectedRootIds.includes(node.id);
              const resolvedAction = overrides[node.id]?.action ?? node.defaultAction;

              return (
                <PreviewNodeCard
                  key={node.id}
                  node={node}
                  isDisabled={isDisabled}
                  resolvedAction={resolvedAction}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
