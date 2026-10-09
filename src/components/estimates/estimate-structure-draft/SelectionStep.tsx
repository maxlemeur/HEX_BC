import { Alert } from "@/components/ui/alert";
import type { EstimateStructureDraft } from "@/lib/estimates/client";
import {
  confidenceText,
  isWeakSignalNode,
  summarizeNodeProvenance,
  type FlatStructureDraftNode,
  type NodeOverrideState,
  type TreeFilterKey,
} from "@/lib/estimates/estimate-structure-draft";
import { cn } from "@/lib/utils";

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
      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div
          role="group"
          aria-labelledby="estimate-structure-draft-lots-title"
          className="min-w-0 rounded-lg border border-border p-4"
        >
          <h3
            id="estimate-structure-draft-lots-title"
            className="text-sm font-semibold text-foreground"
          >
            Lots à retenir
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Chaque lot coché sera inclus avec son sous-arbre.
          </p>
          {isAssemblyOnlyWeakMode && selectedRootIds.length === 0 ? (
            <Alert variant="warning" className="mt-4">
              Aucune suggestion défendable n&apos;est présélectionnée dans ce contexte.
              Sélectionnez manuellement un lot à faible confiance si vous souhaitez poursuivre,
              ou enrichissez d&apos;abord les sources de l&apos;affaire.
            </Alert>
          ) : null}
          <div className="mt-4 space-y-2">
            {draft.nodes.map((node) => (
              <label
                key={node.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-surface-subtle"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm accent-primary"
                  checked={selectedRootIds.includes(node.id)}
                  onChange={() => onToggleRootSelection(node.id)}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {node.label}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {confidenceText(node)}
                  </p>
                  {node.provenance.length > 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Provenance : {summarizeNodeProvenance(node)}
                    </p>
                  ) : null}
                  {node.duplicateMatchPath ? (
                    <p className="mt-1 text-xs text-warning">
                      Doublon potentiel : {node.duplicateMatchPath}
                    </p>
                  ) : null}
                  {isWeakSignalNode(node) ? (
                    <p className="mt-1 text-xs text-danger">
                      Suggestion issue des ouvrages seuls, non présélectionnée par défaut.
                    </p>
                  ) : null}
                </div>
              </label>
            ))}
          </div>
        </div>

        <section
          aria-labelledby="estimate-structure-draft-preview-title"
          className="min-w-0 rounded-lg border border-border p-4"
        >
          <h3
            id="estimate-structure-draft-preview-title"
            className="text-sm font-semibold text-foreground"
          >
            Aperçu de l&apos;arborescence
          </h3>
          <div
            className="mt-3 flex flex-wrap gap-2"
            role="group"
            aria-label="Filtrer les nœuds"
          >
            {TREE_FILTER_CHIPS.map((chip) => {
              const isActive = activeFilters.has(chip.key);
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={isActive}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    isActive ? chip.activeClass : chip.inactiveClass
                  )}
                  onClick={() => onToggleFilter(chip.key)}
                >
                  {chip.label}
                  <span className="text-micro tabular-nums">{filterCounts[chip.key]}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-3">
            {!hasFilteredPreviewResults ? (
              <p className="rounded-lg border border-dashed border-border-strong bg-surface-subtle p-4 text-sm text-muted-foreground">
                Aucun nœud ne correspond aux filtres actifs.
                Désactivez un filtre pour réafficher l&apos;aperçu.
              </p>
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
        </section>
      </div>
    </div>
  );
}
