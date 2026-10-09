import { Badge } from "@/components/ui/badge";
import {
  actionLabel,
  confidenceText,
  evidenceTypeLabel,
  type FlatStructureDraftNode,
} from "@/lib/estimates/estimate-structure-draft";
import type { EstimateStructureDraftNodeAction } from "@/lib/estimates/client";
import { cn } from "@/lib/utils";

type PreviewNodeCardProps = {
  node: FlatStructureDraftNode;
  isDisabled: boolean;
  resolvedAction: EstimateStructureDraftNodeAction;
};

const ACTION_BADGE_VARIANT: Record<
  EstimateStructureDraftNodeAction,
  "success" | "warning" | "neutral"
> = {
  create: "success",
  merge: "warning",
  skip: "neutral",
};

export function PreviewNodeCard({
  node,
  isDisabled,
  resolvedAction,
}: PreviewNodeCardProps) {
  return (
    <details
      className={cn(
        "rounded-lg border p-4",
        isDisabled ? "border-dashed border-border bg-surface-subtle" : "border-border bg-surface"
      )}
    >
      <summary
        className="flex cursor-pointer list-none items-start gap-3 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        style={{ paddingLeft: `${(node.hierarchyLevel - 1) * 18}px` }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "font-medium",
                isDisabled ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {node.label}
            </span>
            <Badge size="sm" variant={ACTION_BADGE_VARIANT[resolvedAction] ?? "neutral"}>
              {actionLabel(resolvedAction)}
            </Badge>
            {isDisabled ? (
              <Badge size="sm" variant="outline">
                Non retenu
              </Badge>
            ) : null}
            {node.duplicateMatchPath ? (
              <span className="text-xs text-warning">
                {node.duplicateMatchPath}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{confidenceText(node)}</p>
        </div>
      </summary>
      <div className="mt-3 grid gap-3 border-t border-border-subtle pt-3 md:grid-cols-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Faits
          </p>
          <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
            {node.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Hypothèses
          </p>
          <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
            {node.hypotheses.length > 0 ? (
              node.hypotheses.map((entry) => <li key={entry}>{entry}</li>)
            ) : (
              <li>Aucune hypothèse supplémentaire.</li>
            )}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            Inférences
          </p>
          <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
            {node.inferences.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          {node.provenance.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {node.provenance.map((entry) => (
                <li
                  key={`${node.id}-${entry.type}-${entry.label}`}
                  className="inline-flex items-center rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-micro text-foreground-secondary"
                >
                  {evidenceTypeLabel(entry.type)} · {entry.label}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </details>
  );
}
