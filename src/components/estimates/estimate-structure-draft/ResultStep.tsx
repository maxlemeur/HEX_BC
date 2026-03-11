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
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg text-emerald-700">
          {"\u2713"}
        </span>
        <h3 className="text-lg font-semibold text-[var(--slate-900)]">
          Structure appliquee
        </h3>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
          <p className="text-2xl font-semibold text-emerald-700">
            {applyResult.createdCount}
          </p>
          <p className="mt-1 text-sm text-emerald-600">creation(s)</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
          <p className="text-2xl font-semibold text-amber-700">
            {applyResult.mergedCount}
          </p>
          <p className="mt-1 text-sm text-amber-600">fusion(s)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-2xl font-semibold text-slate-600">
            {applyResult.skippedCount}
          </p>
          <p className="mt-1 text-sm text-slate-500">ignoree(s)</p>
        </div>
      </div>

      {createdNodes.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-[var(--slate-700)]">
            Sections creees
          </h4>
          <ul className="mt-2 space-y-1">
            {createdNodes.map((node) => (
              <li
                key={node.id}
                className="rounded-lg border-l-4 border-emerald-400 bg-emerald-50 px-3 py-2 text-sm text-[var(--slate-800)]"
              >
                {node.path.join(" > ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {mergedNodes.length > 0 ? (
        <div>
          <h4 className="text-sm font-semibold text-[var(--slate-700)]">
            Sections fusionnees
          </h4>
          <ul className="mt-2 space-y-1">
            {mergedNodes.map((node) => (
              <li
                key={node.id}
                className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-[var(--slate-800)]"
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
