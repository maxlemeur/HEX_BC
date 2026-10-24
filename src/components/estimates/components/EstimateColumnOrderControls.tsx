"use client";

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";

import { useEstimateV3Grid } from "@/components/estimates/v3/V3LineCells";
import { IconButton } from "@/components/ui/icon-button";
import {
  ESTIMATE_COLUMN_GROUPS,
  ESTIMATE_COLUMN_LABELS,
  ESTIMATE_V3_ONLY_COLUMN_IDS,
} from "@/hooks/useEstimateColumnOrder";
import type { EstimateColumnId } from "@/hooks/useEstimateColumnWidths";

type Props = {
  order: readonly EstimateColumnId[];
  isLaborSplitEnabled: boolean;
  onMoveColumn: (id: EstimateColumnId, direction: -1 | 1) => void;
};

export function EstimateColumnOrderControls({ order, isLaborSplitEnabled, onMoveColumn }: Props) {
  // TI-534 : une v1/v2 n'a pas de colonne « Provision FO ».
  const isV3 = useEstimateV3Grid() !== null;
  const applicableGroups = ESTIMATE_COLUMN_GROUPS.filter((group) => {
    if (group[0] === "designation") return false;
    const splitGroup = group[0] === "labor_hours_workshop" || group[0] === "labor_hours_site";
    return isLaborSplitEnabled ? group[0] !== "labor_hours" : !splitGroup;
  });
  return (
    <details className="mt-3 rounded-lg border border-border p-2">
      <summary className="cursor-pointer rounded-control px-1 py-1 text-sm font-medium text-foreground-secondary outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        Ordre des colonnes, par groupe
      </summary>
      <p className="my-2 text-xs text-muted-foreground">
        La désignation reste fixe. Les groupes de calcul restent réunis.
      </p>
      {applicableGroups.map((group) => {
        const columns = order.filter((id) => group.includes(id) && (isV3 || !ESTIMATE_V3_ONLY_COLUMN_IDS.has(id)));
        return (
          <div key={group[0]} className="border-t border-border py-1">
            {columns.map((id, index) => (
              <div key={id} className="flex min-h-9 items-center justify-between gap-2 text-sm text-foreground-secondary">
                <span>{ESTIMATE_COLUMN_LABELS[id]}</span>
                <span className="flex gap-1">
                  <IconButton
                    type="button"
                    label={`Déplacer ${ESTIMATE_COLUMN_LABELS[id]} vers la gauche`}
                    icon={<ArrowLeftIcon aria-hidden="true" />}
                    disabled={index === 0}
                    onClick={() => onMoveColumn(id, -1)}
                  />
                  <IconButton
                    type="button"
                    label={`Déplacer ${ESTIMATE_COLUMN_LABELS[id]} vers la droite`}
                    icon={<ArrowRightIcon aria-hidden="true" />}
                    disabled={index === columns.length - 1}
                    onClick={() => onMoveColumn(id, 1)}
                  />
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </details>
  );
}
