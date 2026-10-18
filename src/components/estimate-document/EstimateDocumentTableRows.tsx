import {
  EMPTY_SECTION_TOTALS,
  type EstimateDocumentRow,
  type EstimateDocumentLineSplit,
  type EstimateDocumentV3Line,
  type EstimateItem,
} from "@/components/estimate-document/prepare-estimate-document-data";
import { ESTIMATE_V3_STATUS_DOCUMENT_LABELS } from "@/lib/estimates/v3-document-presentation";
import { type SectionTotals } from "@/lib/estimate-calculations";
import {
  formatCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

type EstimateDocumentTableRowsProps = {
  rows: EstimateDocumentRow[];
  numberingById: Record<string, string>;
  sectionTotalsById: Record<string, SectionTotals>;
  lineSplitsById: Record<string, EstimateDocumentLineSplit>;
  lineUnitPriceHtById: Record<string, number>;
  currency: SupportedEstimateCurrency;
  layout: EstimatePdfLayoutOptions;
  /** Lot 2, sous-lot 2.7 : lignes d'un document v3 (unité du référentiel, brut, statut). */
  v3LinesById?: Record<string, EstimateDocumentV3Line>;
};

type EstimateDocumentSectionRowProps = {
  item: EstimateItem;
  depth: number;
  numberingById: Record<string, string>;
  sectionTotalsById: Record<string, SectionTotals>;
  currency: SupportedEstimateCurrency;
  layout: EstimatePdfLayoutOptions;
};

type EstimateDocumentLineRowProps = {
  item: EstimateItem;
  depth: number;
  currency: SupportedEstimateCurrency;
  split: EstimateDocumentLineSplit;
  unitPriceHtCents: number;
  layout: EstimatePdfLayoutOptions;
  v3Line?: EstimateDocumentV3Line;
};

function formatQuantity(value: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 3,
  }).format(value ?? 0);
}

function resolveTitle(item: EstimateItem) {
  const title = item.title?.trim();
  return title || "Sans titre";
}

function EstimateDocumentSectionRow({
  item,
  depth,
  numberingById,
  sectionTotalsById,
  currency,
  layout,
}: EstimateDocumentSectionRowProps) {
  const totals = sectionTotalsById[item.id] ?? EMPTY_SECTION_TOTALS;
  const resolvedCurrency = currency;
  const sectionRowClassName = [
    "print-color-adjust print-avoid-break-inside",
    depth === 0
      ? "bg-brand-blue text-white"
      : depth === 1
        ? "bg-[var(--slate-200)] text-[var(--slate-800)]"
        : depth === 2
          ? "bg-white text-[var(--slate-800)]"
          : "bg-[var(--slate-50)] text-[var(--slate-700)]",
  ].join(" ");
  const cellPadding =
    layout.density === "compact"
      ? "py-1.5"
      : layout.density === "comfortable"
        ? "py-3.5"
        : "py-2.5";
  const subtotal = layout.showSectionSubtotals ? totals : null;

  return (
    <tr className={sectionRowClassName}>
      <td
        className={`px-4 sm:px-6 print:px-4 ${cellPadding} ${depth === 2 ? "border-l-4 border-l-brand-orange" : ""}`}
      >
        <div style={{ paddingLeft: `${depth * 14}px` }}>
          <div className={`${depth === 0 ? "text-[11px]" : "text-xs"} font-bold uppercase tracking-wide`}>
            {layout.showNumbering && numberingById[item.id] ? (
              <span className={`mr-2 ${depth === 0 ? "text-white/80" : "text-[var(--slate-500)]"}`}>
                {numberingById[item.id]}
              </span>
            ) : null}
            <span>{resolveTitle(item)}</span>
          </div>
        </div>
      </td>
      <td className={`w-16 px-2 text-center sm:px-3 print:px-2 ${cellPadding}`}>
        -
      </td>
      <td className={`w-14 px-2 text-center sm:px-3 print:px-2 ${cellPadding}`}>
        -
      </td>
      {layout.priceMode === "unit_and_total" ? (
        <td className={`w-24 px-2 text-right sm:px-3 print:px-2 ${cellPadding}`}>
          -
        </td>
      ) : null}
      {layout.priceMode === "fo_mo_and_total" ? (
        <>
          <td className={`w-24 px-2 text-right font-semibold sm:px-3 print:px-2 ${cellPadding}`}>
            {subtotal ? formatCurrency(subtotal.foTotalCents, resolvedCurrency) : null}
          </td>
          <td className={`w-24 px-2 text-right font-semibold sm:px-3 print:px-2 ${cellPadding}`}>
            {subtotal ? formatCurrency(subtotal.moTotalCents, resolvedCurrency) : null}
          </td>
        </>
      ) : null}
      <td className={`w-28 px-3 text-right font-bold sm:px-4 print:px-2 ${cellPadding}`}>
        {subtotal ? formatCurrency(subtotal.totalHtCents, resolvedCurrency) : null}
      </td>
    </tr>
  );
}

function EstimateDocumentLineRow({
  item,
  depth,
  currency,
  split,
  unitPriceHtCents,
  layout,
  v3Line,
}: EstimateDocumentLineRowProps) {
  const resolvedCurrency = currency;
  const cellPadding =
    layout.density === "compact"
      ? "py-1.5"
      : layout.density === "comfortable"
        ? "py-3.5"
        : "py-2.5";
  // Lot 2, sous-lot 2.7 (D7, D9) : une ligne v3 imprime l'unité du référentiel et ses montants
  // bruts ; une ligne non chiffrée imprime son statut au lieu d'un montant.
  const v3Priced = v3Line?.pricingStatus === "priced";
  const amount = (cents: number) => (v3Line && !v3Priced ? "-" : formatCurrency(cents, resolvedCurrency));
  const unit = v3Line ? (v3Line.unitLabel ?? "-") : (item.description?.trim() || "-");
  const total = v3Line && !v3Priced
    ? ESTIMATE_V3_STATUS_DOCUMENT_LABELS[v3Line.pricingStatus]
    : formatCurrency(split.totalHtCents, resolvedCurrency);

  return (
    <tr className="bg-white print-color-adjust print-avoid-break-inside">
      <td className={`px-4 font-medium text-slate-800 sm:px-6 print:px-4 print:text-slate-900 ${cellPadding}`}>
        <div
          style={{ paddingLeft: `${depth * 16}px` }}
          className="flex items-center gap-2"
        >
          <span>{resolveTitle(item)}</span>
        </div>
      </td>
      <td className={`w-16 px-2 text-center font-semibold sm:px-3 print:px-2 ${cellPadding}`}>
        {formatQuantity(item.quantity)}
      </td>
      <td className={`w-14 px-2 text-center sm:px-3 print:px-2 ${cellPadding}`}>
        {unit}
      </td>
      {layout.priceMode === "unit_and_total" ? (
        <td className={`w-24 px-2 text-right sm:px-3 print:px-2 ${cellPadding}`}>
          {amount(unitPriceHtCents)}
        </td>
      ) : null}
      {layout.priceMode === "fo_mo_and_total" ? (
        <>
          <td className={`w-24 px-2 text-right sm:px-3 print:px-2 ${cellPadding}`}>
            {amount(split.foTotalCents)}
          </td>
          <td className={`w-24 px-2 text-right sm:px-3 print:px-2 ${cellPadding}`}>
            {amount(split.moTotalCents)}
          </td>
        </>
      ) : null}
      <td className={`w-28 px-3 text-right font-bold sm:px-4 print:px-2 ${cellPadding}`}>
        {total}
      </td>
    </tr>
  );
}

export function EstimateDocumentTableRows({
  rows,
  numberingById,
  sectionTotalsById,
  lineSplitsById,
  lineUnitPriceHtById,
  currency,
  layout,
  v3LinesById,
}: EstimateDocumentTableRowsProps) {
  return (
    <>
      {rows.map(({ item, depth }) =>
        item.item_type === "section" ? (
          <EstimateDocumentSectionRow
            key={item.id}
            item={item}
            depth={depth}
            numberingById={numberingById}
            sectionTotalsById={sectionTotalsById}
            currency={currency}
            layout={layout}
          />
        ) : (
          <EstimateDocumentLineRow
            key={item.id}
            item={item}
            depth={depth}
            currency={currency}
            split={lineSplitsById[item.id] ?? {
              foTotalCents: item.line_total_ht_cents ?? 0,
              moTotalCents: 0,
              totalHtCents: item.line_total_ht_cents ?? 0,
            }}
            unitPriceHtCents={
              lineUnitPriceHtById[item.id] ?? item.pu_ht_cents ?? 0
            }
            layout={layout}
            v3Line={v3LinesById?.[item.id]}
          />
        )
      )}
    </>
  );
}
