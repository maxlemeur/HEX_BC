"use client";

import { Badge } from "@/components/ui/Badge";
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
        <div className="rounded-[28px] border border-dashed border-[var(--border)] bg-white p-10 text-center text-sm text-[var(--slate-600)]">
          Aucun résultat pour ce filtre.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {filteredRows.map((row) => {
        const isSelected = row.line_id === selectedRowId;
        const quantityLabel =
          row.takeoff_quantity === null
            ? "Quantité takeoff non consolidée"
            : `${formatNumber(row.takeoff_quantity)} ${row.quantity_unit ?? ""}`.trim();

        return (
          <button
            key={row.line_id}
            type="button"
            className={`w-full rounded-[28px] border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 ${
              isSelected ? "border-sky-300 bg-sky-50/80" : STATUS_PANEL_CSS[row.review_status]
            }`}
            style={{ contentVisibility: "auto" }}
            onClick={() => onSelectRow(row.line_id)}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
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
                <h3 className="mt-2 text-lg font-semibold text-[var(--slate-950)]">
                  {row.line_label}
                </h3>
                {row.dpgf.description ? (
                  <p className="mt-1 text-sm text-[var(--slate-600)]">{row.dpgf.description}</p>
                ) : null}
              </div>

              <div className="rounded-2xl border border-white/60 bg-white/70 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                  Confiance
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--slate-950)]">
                  {formatConfidence(row.confidence_score)}
                </p>
                {row.risk?.causes[0] ? (
                  <p className="mt-1 text-xs text-[var(--slate-600)]">{row.risk.causes[0]}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-white/70 bg-white/75 p-3">
                <p className="text-xs text-[var(--slate-500)]">DPGF</p>
                <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
                  {formatNumber(row.dpgf_quantity)} {row.dpgf.unit ?? ""}
                </p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/75 p-3">
                <p className="text-xs text-[var(--slate-500)]">Takeoff</p>
                <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
                  {quantityLabel}
                </p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/75 p-3">
                <p className="text-xs text-[var(--slate-500)]">Écart</p>
                <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
                  {formatNumber(row.delta_absolute)} · {formatPercent(row.delta_percent)}
                </p>
              </div>
              <div className="rounded-2xl border border-white/70 bg-white/75 p-3">
                <p className="text-xs text-[var(--slate-500)]">Preuves</p>
                <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
                  {row.proofs.length}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {row.linked_takeoff_items.length > 0 ? (
                row.linked_takeoff_items.slice(0, 3).map((item) => (
                  <Badge key={item.item_id} variant="neutral" size="sm">
                    {item.designation}
                  </Badge>
                ))
              ) : (
                <Badge variant="neutral" size="sm">
                  Aucun item takeoff relié
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
