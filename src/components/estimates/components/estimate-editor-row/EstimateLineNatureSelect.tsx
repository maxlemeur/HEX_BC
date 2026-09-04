"use client";

import {
  ESTIMATE_LINE_NATURE_LABELS,
  ESTIMATE_LINE_NATURES,
  resolveEstimateLineNature,
  type EstimateLineNature,
} from "@/lib/estimates/line-nature";
import type {
  EstimateItem,
  ItemPatch,
} from "@/components/estimates/components/estimate-editor-row/shared";

type EstimateLineNatureSelectProps = {
  item: EstimateItem;
  navigationRowId?: string;
  isReadOnly: boolean;
  onPatchItem: (
    itemId: string,
    patch: ItemPatch,
    options?: { persist?: boolean },
  ) => void;
};

const COMPACT_LINE_NATURE_LABELS: Record<EstimateLineNature, string> = {
  supply_only: "Fournitures",
  supply_and_labor: "Fournitures + MO",
  labor_only: "Main-d’œuvre",
};

export function EstimateLineNatureSelect({
  item,
  navigationRowId = item.id,
  isReadOnly,
  onPatchItem,
}: EstimateLineNatureSelectProps) {
  const selectedNature = resolveEstimateLineNature(item);
  const descriptionId = `estimate-line-nature-description-${item.id}`;
  const fullLabel = ESTIMATE_LINE_NATURE_LABELS[selectedNature];
  const compactLabel = COMPACT_LINE_NATURE_LABELS[selectedNature];
  const lineLabel = item.title || "sans titre";

  if (isReadOnly) {
    return (
      <span
        className="estimate-line-nature-picker estimate-line-nature-picker--readonly"
        title={`${fullLabel} — nature de ligne en lecture seule.`}
        data-cell-id={`${navigationRowId}::line_nature`}
        tabIndex={-1}
        onFocus={(event) => event.stopPropagation()}
        onBlur={(event) => event.stopPropagation()}
      >
        <span className="estimate-line-nature-picker__label">
          {compactLabel}
          <span className="sr-only">
            {` — nature de ligne pour ${lineLabel}, en lecture seule`}
          </span>
        </span>
      </span>
    );
  }

  return (
    <label
      className="estimate-line-nature-picker"
      title={`${fullLabel} — cliquer pour modifier la nature de la ligne.`}
    >
      <span className="estimate-line-nature-picker__label" aria-hidden="true">
        {compactLabel}
        <span className="estimate-line-nature-picker__chevron">▾</span>
      </span>
      <select
        className="estimate-line-nature-picker__select"
        value={selectedNature}
        aria-label={`${compactLabel} — nature de ligne pour ${lineLabel}`}
        aria-describedby={descriptionId}
        data-cell-id={`${navigationRowId}::line_nature`}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onFocus={(event) => event.stopPropagation()}
        onBlur={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) =>
          onPatchItem(
            item.id,
            { line_nature: event.currentTarget.value as EstimateLineNature },
            { persist: true },
          )
        }
      >
        {ESTIMATE_LINE_NATURES.map((nature) => (
          <option key={nature} value={nature}>
            {ESTIMATE_LINE_NATURE_LABELS[nature]}
          </option>
        ))}
      </select>
      <span hidden id={descriptionId}>
        La désignation reste libre. La nature détermine les données de
        fournitures et de main-d’œuvre attendues avant publication.
      </span>
    </label>
  );
}
