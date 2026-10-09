import {
  actionBadgeClass,
  actionLabel,
  confidenceText,
  evidenceTypeLabel,
  type FlatStructureDraftNode,
} from "@/lib/estimates/estimate-structure-draft";
import type { EstimateStructureDraftNodeAction } from "@/lib/estimates/client";

type PreviewNodeCardProps = {
  node: FlatStructureDraftNode;
  isDisabled: boolean;
  resolvedAction: EstimateStructureDraftNodeAction;
};

export function PreviewNodeCard({
  node,
  isDisabled,
  resolvedAction,
}: PreviewNodeCardProps) {
  return (
    <details
      className={`rounded-xl border border-border bg-surface p-4 ${
        isDisabled ? "opacity-45" : ""
      }`}
    >
      <summary
        className="flex cursor-pointer list-none items-start gap-3"
        style={{ paddingLeft: `${(node.hierarchyLevel - 1) * 18}px` }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{node.label}</span>
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${actionBadgeClass(
                resolvedAction,
              )}`}
            >
              {actionLabel(resolvedAction)}
            </span>
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
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Faits
          </p>
          <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
            {node.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Hypotheses
          </p>
          <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
            {node.hypotheses.length > 0 ? (
              node.hypotheses.map((entry) => <li key={entry}>{entry}</li>)
            ) : (
              <li>Aucune hypothese supplementaire.</li>
            )}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Inferences
          </p>
          <ul className="mt-2 space-y-1 text-sm text-foreground-secondary">
            {node.inferences.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          {node.provenance.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {node.provenance.map((entry) => (
                <span
                  key={`${node.id}-${entry.type}-${entry.label}`}
                  className="inline-flex items-center rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[11px] text-slate-600"
                >
                  {evidenceTypeLabel(entry.type)} · {entry.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </details>
  );
}
