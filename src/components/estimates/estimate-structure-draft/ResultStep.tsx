import { CheckIcon } from "lucide-react";

import type { ApplyEstimateStructureDraftResult } from "@/lib/estimates/client";
import type {
  FlatStructureDraftNode,
  NodeOverrideState,
} from "@/lib/estimates/estimate-structure-draft";

type ResultStepProps = {
  applyResult: ApplyEstimateStructureDraftResult;
  selectedNodes: FlatStructureDraftNode[];
  overrides: Record<string, NodeOverrideState>;
};

export function ResultStep({
  applyResult,
  selectedNodes,
  overrides,
}: ResultStepProps) {
  const createdNodes = selectedNodes.filter(
    (node) => (overrides[node.id]?.action ?? node.defaultAction) === "create",
  );
  const mergedNodes = selectedNodes.filter(
    (node) => (overrides[node.id]?.action ?? node.defaultAction) === "merge",
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-10 items-center justify-center rounded-full bg-success-light text-success"
        >
          <CheckIcon className="size-5" />
        </span>
        <h3 className="text-lg font-semibold text-foreground">
          Structure appliquée
        </h3>
      </div>

      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col-reverse rounded-lg border border-success-border bg-success-subtle p-4 text-center">
          <dt className="mt-1 text-sm text-success">création(s)</dt>
          <dd className="text-2xl font-semibold text-success tabular-nums">
            {applyResult.createdCount}
          </dd>
        </div>
        <div className="flex flex-col-reverse rounded-lg border border-warning-border bg-warning-subtle p-4 text-center">
          <dt className="mt-1 text-sm text-warning">fusion(s)</dt>
          <dd className="text-2xl font-semibold text-warning tabular-nums">
            {applyResult.mergedCount}
          </dd>
        </div>
        <div className="flex flex-col-reverse rounded-lg border border-border bg-surface-subtle p-4 text-center">
          <dt className="mt-1 text-sm text-muted-foreground">ignorée(s)</dt>
          <dd className="text-2xl font-semibold text-foreground-secondary tabular-nums">
            {applyResult.skippedCount}
          </dd>
        </div>
      </dl>

      {createdNodes.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-foreground-secondary">
            Sections créées
          </h4>
          <ul className="mt-2 space-y-1">
            {createdNodes.map((node) => (
              <li
                key={node.id}
                className="rounded-lg border-l-4 border-success bg-success-subtle px-3 py-2 text-sm text-foreground"
              >
                {node.path.join(" > ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mergedNodes.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-foreground-secondary">
            Sections fusionnées
          </h4>
          <ul className="mt-2 space-y-1">
            {mergedNodes.map((node) => (
              <li
                key={node.id}
                className="rounded-lg border-l-4 border-warning bg-warning-subtle px-3 py-2 text-sm text-foreground"
              >
                {node.path.join(" > ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
