"use client";

import { ESTIMATE_COLUMN_GROUPS, ESTIMATE_COLUMN_LABELS } from "@/hooks/useEstimateColumnOrder";
import type { EstimateColumnId } from "@/hooks/useEstimateColumnWidths";

type Props = {
  order: readonly EstimateColumnId[];
  isLaborSplitEnabled: boolean;
  onMoveColumn: (id: EstimateColumnId, direction: -1 | 1) => void;
};

export function EstimateColumnOrderControls({ order, isLaborSplitEnabled, onMoveColumn }: Props) {
  const applicableGroups = ESTIMATE_COLUMN_GROUPS.filter((group) => {
    if (group[0] === "designation") return false;
    const splitGroup = group[0] === "labor_hours_workshop" || group[0] === "labor_hours_site";
    return isLaborSplitEnabled ? group[0] !== "labor_hours" : !splitGroup;
  });
  return (
    <details className="mt-3 rounded-lg border border-border p-2">
      <summary className="cursor-pointer text-sm">Ordre des colonnes, par groupe</summary>
      <p className="my-2 text-xs text-muted-foreground">
        La désignation reste fixe. Les groupes de calcul restent réunis.
      </p>
      {applicableGroups.map((group) => {
        const columns = order.filter((id) => group.includes(id));
        return (
          <div key={group[0]} className="border-t border-border py-1">
            {columns.map((id, index) => (
              <div key={id} className="flex min-h-9 items-center justify-between gap-2 text-sm">
                <span>{ESTIMATE_COLUMN_LABELS[id]}</span>
                <span className="flex gap-1">
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Déplacer ${ESTIMATE_COLUMN_LABELS[id]} vers la gauche`} disabled={index === 0} onClick={() => onMoveColumn(id, -1)}>←</button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Déplacer ${ESTIMATE_COLUMN_LABELS[id]} vers la droite`} disabled={index === columns.length - 1} onClick={() => onMoveColumn(id, 1)}>→</button>
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </details>
  );
}
