import type {
  NodeMergeState,
  NodeOverrideState,
  FlatStructureDraftNode,
} from "@/lib/estimates/estimate-structure-draft";
import type { EstimateStructureDraftNodeAction } from "@/lib/estimates/client";
import { confidenceText } from "@/lib/estimates/estimate-structure-draft";

type OverrideCardProps = {
  node: FlatStructureDraftNode;
  override: NodeOverrideState | undefined;
  nodeMergeState: NodeMergeState | undefined;
  onUpdateOverride: (nodeId: string, patch: Partial<NodeOverrideState>) => void;
};

export function OverrideCard({
  node,
  override,
  nodeMergeState,
  onUpdateOverride,
}: OverrideCardProps) {
  const action = override?.action ?? node.defaultAction;
  const mergeCandidates = nodeMergeState?.mergeCandidates ?? [];
  const canMerge = !nodeMergeState?.blockingReason && mergeCandidates.length > 0;
  const mergeTargetValue =
    action === "merge" &&
    override?.mergeIntoItemId &&
    mergeCandidates.some((section) => section.id === override.mergeIntoItemId)
      ? override.mergeIntoItemId
      : "";
  let mergeGuidanceText: string | null = null;

  if (action === "merge") {
    if (nodeMergeState?.blockingReason) {
      mergeGuidanceText = nodeMergeState.blockingReason;
    } else if (mergeCandidates.length === 0) {
      mergeGuidanceText =
        "Aucune cible de fusion compatible n'existe sous le parent final.";
    } else if (nodeMergeState?.requiresExplicitMergeTarget) {
      mergeGuidanceText =
        "Selectionnez une cible de fusion compatible avant application.";
    } else if (nodeMergeState?.resolvedMergeTargetPath) {
      mergeGuidanceText = `Cible retenue: ${nodeMergeState.resolvedMergeTargetPath}`;
    }
  }

  return (
    <div
      data-testid={`estimate-structure-draft-node-${node.id}`}
      className="rounded-xl border border-[var(--slate-200)] bg-white p-4"
    >
      <div
        className="flex flex-wrap items-center gap-3"
        style={{ paddingLeft: `${(node.hierarchyLevel - 1) * 18}px` }}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--slate-900)]">{node.path.join(" > ")}</p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">{confidenceText(node)}</p>
        </div>
        <select
          className="input h-9 min-w-[170px]"
          value={action}
          onChange={(event) =>
            onUpdateOverride(node.id, {
              action: event.target.value as EstimateStructureDraftNodeAction,
            })
          }
        >
          <option value="create">Creer</option>
          <option value="merge" disabled={!canMerge}>
            Fusionner
          </option>
          <option value="skip">Ignorer</option>
        </select>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr),minmax(0,1fr),minmax(0,1fr)]">
        <label className="form-label block">
          Renommer avant application
          <input
            className="input mt-2 w-full"
            value={override?.renameTo ?? ""}
            onChange={(event) =>
              onUpdateOverride(node.id, {
                renameTo: event.target.value,
              })
            }
            placeholder={node.label}
            disabled={action === "skip"}
          />
        </label>

        <label className="form-label block">
          Cible de fusion
          <select
            className="input mt-2 w-full"
            value={mergeTargetValue}
            onChange={(event) =>
              onUpdateOverride(node.id, {
                mergeIntoItemId: event.target.value,
              })
            }
            disabled={action !== "merge" || !canMerge}
          >
            <option value="">
              {nodeMergeState?.requiresExplicitMergeTarget ? "Choisir une cible" : "Auto"}
            </option>
            {mergeCandidates.map((section) => (
              <option key={section.id} value={section.id}>
                {section.path}
              </option>
            ))}
          </select>
          {mergeGuidanceText ? (
            <p className="mt-2 text-xs text-[var(--amber-700)]">{mergeGuidanceText}</p>
          ) : null}
        </label>

        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
            Preuve
          </p>
          <p className="mt-2 text-sm text-[var(--slate-700)]">
            {node.provenance.length > 0
              ? node.provenance
                  .map((entry) =>
                    entry.excerpt ? `${entry.label}: ${entry.excerpt}` : entry.label,
                  )
                  .join(" · ")
              : "Aucune provenance detaillee."}
          </p>
        </div>
      </div>
    </div>
  );
}
