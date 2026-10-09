import { useId } from "react";

import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
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
  const fieldId = useId();
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
        "Sélectionnez une cible de fusion compatible avant application.";
    } else if (nodeMergeState?.resolvedMergeTargetPath) {
      mergeGuidanceText = `Cible retenue : ${nodeMergeState.resolvedMergeTargetPath}`;
    }
  }

  const nodePath = node.path.join(" > ");

  return (
    <div
      data-testid={`estimate-structure-draft-node-${node.id}`}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div
        className="flex flex-wrap items-center gap-3"
        style={{ paddingLeft: `${(node.hierarchyLevel - 1) * 18}px` }}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{nodePath}</p>
          <p className="mt-1 text-xs text-muted-foreground">{confidenceText(node)}</p>
        </div>
        <NativeSelect
          size="sm"
          wrapperClassName="w-auto min-w-[170px]"
          aria-label={`Action pour ${nodePath}`}
          value={action}
          onChange={(event) =>
            onUpdateOverride(node.id, {
              action: event.target.value as EstimateStructureDraftNodeAction,
            })
          }
        >
          <option value="create">Créer</option>
          <option value="merge" disabled={!canMerge}>
            Fusionner
          </option>
          <option value="skip">Ignorer</option>
        </NativeSelect>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${fieldId}-rename`}>Renommer avant application</FieldLabel>
          <Input
            id={`${fieldId}-rename`}
            size="sm"
            value={override?.renameTo ?? ""}
            onChange={(event) =>
              onUpdateOverride(node.id, {
                renameTo: event.target.value,
              })
            }
            placeholder={node.label}
            disabled={action === "skip"}
          />
        </div>

        <div className="space-y-1.5">
          <FieldLabel htmlFor={`${fieldId}-merge-target`}>Cible de fusion</FieldLabel>
          <NativeSelect
            id={`${fieldId}-merge-target`}
            size="sm"
            value={mergeTargetValue}
            onChange={(event) =>
              onUpdateOverride(node.id, {
                mergeIntoItemId: event.target.value,
              })
            }
            disabled={action !== "merge" || !canMerge}
            aria-describedby={mergeGuidanceText ? `${fieldId}-merge-guidance` : undefined}
          >
            <option value="">
              {nodeMergeState?.requiresExplicitMergeTarget ? "Choisir une cible" : "Automatique"}
            </option>
            {mergeCandidates.map((section) => (
              <option key={section.id} value={section.id}>
                {section.path}
              </option>
            ))}
          </NativeSelect>
          {mergeGuidanceText ? (
            <p id={`${fieldId}-merge-guidance`} className="text-xs text-warning">
              {mergeGuidanceText}
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-border bg-surface-subtle p-3">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Preuve
          </p>
          <p className="mt-2 text-sm text-foreground-secondary">
            {node.provenance.length > 0
              ? node.provenance
                  .map((entry) =>
                    entry.excerpt ? `${entry.label} : ${entry.excerpt}` : entry.label,
                  )
                  .join(" · ")
              : "Aucune provenance détaillée."}
          </p>
        </div>
      </div>
    </div>
  );
}
