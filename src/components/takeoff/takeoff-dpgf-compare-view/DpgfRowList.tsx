"use client";

import { Badge } from "@/components/ui/badge";
import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

import {
  RISK_SEVERITY_LABELS,
  RISK_SEVERITY_VARIANT,
  STATUS_BADGE_VARIANT,
  STATUS_LABELS,
  STATUS_PANEL_CSS,
} from "@/components/takeoff/takeoff-dpgf-compare-view/constants";
import {
  formatConfidence,
  formatNumber,
  formatPercent,
} from "@/components/takeoff/takeoff-dpgf-compare-view/utils";

type DpgfRowListProps = {
  filteredRows: TakeoffDpgfComparisonRow[];
  selectedRowId: string | null;
  onSelectRow: (rowId: string) => void;
};

export function DpgfRowList({
  filteredRows,
  selectedRowId,
  onSelectRow,
}: Readonly<DpgfRowListProps>) {
  if (filteredRows.length === 0) {
    return (
      <section className="space-y-3">
        <div className="rounded-[28px] border border-dashed border-border bg-surface p-10 text-center text-sm text-muted-foreground">
          Aucun résultat pour ce filtre.
        </div>
      </section>
    );
  }

  return (
    <section className="min-w-0 space-y-3" aria-label="Lignes DPGF">
      {filteredRows.map((row) => {
        const isSelected = row.line_id === selectedRowId;
        const quantityLabel =
          row.takeoff_quantity === null
            ? "Quantité métrée non consolidée"
            : `${formatNumber(row.takeoff_quantity)} ${row.quantity_unit ?? ""}`.trim();

        return (
          <button
            key={row.line_id}
            type="button"
            className={`w-full min-w-0 rounded-[28px] border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:hover:translate-y-0 sm:p-5 ${
              isSelected ? "border-info-border bg-info-subtle" : STATUS_PANEL_CSS[row.review_status]
            }`}
            style={{ contentVisibility: "auto" }}
            onClick={() => onSelectRow(row.line_id)}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    Position {row.dpgf.position}
                  </p>
                  <Badge variant={STATUS_BADGE_VARIANT[row.review_status]} size="sm">
                    {STATUS_LABELS[row.review_status]}
                  </Badge>
                  {row.risk ? (
                    <Badge variant={RISK_SEVERITY_VARIANT[row.risk.severity]} size="sm">
                      {RISK_SEVERITY_LABELS[row.risk.severity]} · {row.risk.score}/100
                    </Badge>
                  ) : null}
                  {row.matched_by ? (
                    <Badge variant={row.matched_by === "manual" ? "info" : "neutral"} size="sm">
                      {row.matched_by === "manual" ? "Lien manuel" : "Auto"}
                    </Badge>
                  ) : null}
                </div>
                <h3 className="mt-2 break-words text-lg font-semibold text-foreground">
                  {row.line_label}
                </h3>
                {row.dpgf.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{row.dpgf.description}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border-subtle bg-surface px-4 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                  Confiance
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {formatConfidence(row.confidence_score)}
                </p>
                {row.risk?.causes[0] ? (
                  <p className="mt-1 text-xs text-muted-foreground">{row.risk.causes[0]}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-border-subtle bg-surface p-3">
                <p className="text-xs text-muted-foreground">DPGF</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {formatNumber(row.dpgf_quantity)} {row.dpgf.unit ?? ""}
                </p>
              </div>
              <div className="rounded-2xl border border-border-subtle bg-surface p-3">
                <p className="text-xs text-muted-foreground">Métré</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {quantityLabel}
                </p>
              </div>
              <div className="rounded-2xl border border-border-subtle bg-surface p-3">
                <p className="text-xs text-muted-foreground">Écart</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {formatNumber(row.delta_absolute)} · {formatPercent(row.delta_percent)}
                </p>
              </div>
              <div className="rounded-2xl border border-border-subtle bg-surface p-3">
                <p className="text-xs text-muted-foreground">Preuves</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {row.proofs.length}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {row.linked_takeoff_items.length > 0 ? (
                row.linked_takeoff_items.slice(0, 3).map((item) => (
                  <Badge key={item.item_id} variant="neutral" size="sm" className="max-w-full">
                    <span className="truncate">{item.designation}</span>
                  </Badge>
                ))
              ) : (
                <Badge variant="neutral" size="sm">
                  Aucun item de métré relié
                </Badge>
              )}
              {row.linked_takeoff_items.length > 3 ? (
                <Badge variant="neutral" size="sm">
                  +{row.linked_takeoff_items.length - 3} autres
                </Badge>
              ) : null}
            </div>
          </button>
        );
      })}
    </section>
  );
}
