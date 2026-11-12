import type {
  TakeoffDpgfComparisonProof,
  TakeoffDpgfComparisonRow,
  TakeoffDpgfReviewDecision,
} from "@/lib/takeoff/types";
import { dpgfRowRetainedQuantity } from "@/lib/takeoff/dpgf-quantity-policy";

import {
  DECISION_LABELS,
  PROOF_KIND_LABELS,
  type SortKey,
} from "@/components/takeoff/takeoff-dpgf-compare-view/constants";

export function formatNumber(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatConfidence(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Indéterminée";
  return value >= 0.8 ? "Élevée" : value >= 0.5 ? "Moyenne" : "Faible";
}

export function getDecisionImpactText(
  decision: TakeoffDpgfReviewDecision | null,
  row: TakeoffDpgfComparisonRow | null
): string | null {
  if (!decision || !row) return null;
  const unit = row.quantity_unit ?? "";
  // TI-696: what the application writes, the sum the line holds (dpgfRowRetainedQuantity), whatever the decision.
  const retained = dpgfRowRetainedQuantity(row);
  switch (decision) {
    case "keep_dpgf":
      return `Quantité retenue : ${formatNumber(retained ?? row.dpgf_quantity)} ${unit}`.trim();
    case "keep_takeoff":
      if (row.takeoff_quantity === null) return "Quantité métrée non consolidée";
      return `Quantité retenue : ${formatNumber(retained ?? row.takeoff_quantity)} ${unit} (${formatPercent(row.delta_percent)})`.trim();
    case "manual_fix":
      return "Vous devrez saisir la quantité corrigée manuellement.";
    case "out_of_scope":
      return "Le métré rapproché ne sera pas appliqué à cette ligne DPGF.";
  }
}

/**
 * TI-696: what a row shows as measured: the total its DPGF line will hold when other takeoffs feed it (the gap is judged
 * on it), with this takeoff's own measure; else this takeoff's measure.
 */
export function measuredQuantityLabel(row: TakeoffDpgfComparisonRow) {
  if (row.takeoff_quantity === null) return "Quantité métrée non consolidée";
  const unit = row.quantity_unit ?? "";
  return row.composition
    ? `${formatNumber(row.composition.total_quantity)} ${unit} (ce métré : ${formatNumber(row.takeoff_quantity)})`.replace(/\s+\(/, " (").trim()
    : `${formatNumber(row.takeoff_quantity)} ${unit}`.trim();
}

export function formatProofConfidence(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Confiance n/a";
  return `Confiance ${value >= 0.8 ? "élevée" : value >= 0.5 ? "moyenne" : "faible"}`;
}

export function buildSearchText(row: TakeoffDpgfComparisonRow) {
  return [
    row.line_label,
    row.dpgf.description,
    row.linked_takeoff_items.map((item) => item.designation).join(" "),
    row.proofs
      .map((proof) => [proof.label, proof.source, proof.note].filter(Boolean).join(" "))
      .join(" "),
    row.applied_decision?.reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("fr-FR");
}

export function sortRows(rows: TakeoffDpgfComparisonRow[], sortKey: SortKey) {
  return [...rows].sort((left, right) => {
    switch (sortKey) {
      case "confidence_desc":
        return right.confidence_score - left.confidence_score;
      case "delta_desc":
        return Math.abs(right.delta_percent ?? -1) - Math.abs(left.delta_percent ?? -1);
      case "matching_desc":
        return right.matching_score - left.matching_score;
      case "position":
      default:
        return left.dpgf.position - right.dpgf.position;
    }
  });
}

function toCsvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value).replaceAll("\"", "\"\"");
  return `"${stringValue}"`;
}

/** The review's rows as CSV. TI-696: with the total the gap is judged on and the quantity the application retains. */
export function buildRowsCsv(
  rows: TakeoffDpgfComparisonRow[],
  statusLabels: Record<TakeoffDpgfComparisonRow["review_status"], string>
) {
  const header = [
    "position_dpgf",
    "ligne",
    "statut_review",
    "decision_suggeree",
    "decision_appliquee",
    "provenance_decision",
    "matched_by",
    "quantite_dpgf",
    "quantite_takeoff",
    "quantite_totale",
    "quantite_retenue",
    "unite",
    "delta_absolu",
    "delta_percent",
    "matching_score",
    "confidence_score",
    "preuves",
  ];
  const lines = rows.map((row) =>
    [
      row.dpgf.position,
      row.line_label,
      statusLabels[row.review_status],
      row.suggested_decision ? DECISION_LABELS[row.suggested_decision] : "",
      row.applied_decision ? DECISION_LABELS[row.applied_decision.decision] : "",
      row.applied_decision
        ? row.applied_decision.source === "carried_over"
          ? `carried_over_v${row.applied_decision.carried_over_from_version_number ?? "?"}`
          : "current_version"
        : "",
      row.matched_by ?? "",
      row.dpgf_quantity,
      row.takeoff_quantity,
      row.takeoff_quantity === null ? null : row.composition?.total_quantity ?? row.takeoff_quantity,
      dpgfRowRetainedQuantity(row),
      row.quantity_unit,
      row.delta_absolute,
      row.delta_percent,
      row.matching_score,
      row.confidence_score,
      row.proofs.map((proof) => `${PROOF_KIND_LABELS[proof.kind]}:${proof.label}`).join(" | "),
    ]
      .map((cell) => toCsvCell(cell))
      .join(",")
  );

  return [header.join(","), ...lines].join("\n");
}

export function exportRowsAsCsv(
  rows: TakeoffDpgfComparisonRow[],
  statusLabels: Record<TakeoffDpgfComparisonRow["review_status"], string>
) {
  const content = buildRowsCsv(rows, statusLabels);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "takeoff-dpgf-review.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildProofGroups(selectedRow: TakeoffDpgfComparisonRow | null) {
  if (!selectedRow) {
    return {
      fact: [],
      hypothesis: [],
      inference: [],
    } satisfies Record<TakeoffDpgfComparisonProof["kind"], TakeoffDpgfComparisonProof[]>;
  }

  return {
    fact: selectedRow.proofs.filter((proof) => proof.kind === "fact"),
    hypothesis: selectedRow.proofs.filter((proof) => proof.kind === "hypothesis"),
    inference: selectedRow.proofs.filter((proof) => proof.kind === "inference"),
  } satisfies Record<TakeoffDpgfComparisonProof["kind"], TakeoffDpgfComparisonProof[]>;
}
