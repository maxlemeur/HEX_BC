import {
  EMPTY_SECTION_TOTALS,
  type EstimateDocumentRow,
  type EstimateItem,
} from "@/components/estimate-document/prepare-estimate-document-data";
import { type SectionTotals } from "@/lib/estimate-calculations";
import {
  formatCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";

type EstimateDocumentTableRowsProps = {
  rows: EstimateDocumentRow[];
  numberingById: Record<string, string>;
  sectionTotalsById: Record<string, SectionTotals>;
  currency: SupportedEstimateCurrency;
};

type EstimateDocumentSectionRowProps = {
  item: EstimateItem;
  depth: number;
  numberingById: Record<string, string>;
  sectionTotalsById: Record<string, SectionTotals>;
  currency: SupportedEstimateCurrency;
};

type EstimateDocumentLineRowProps = {
  item: EstimateItem;
  depth: number;
  numberingById: Record<string, string>;
  currency: SupportedEstimateCurrency;
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
}: EstimateDocumentSectionRowProps) {
  const totals = sectionTotalsById[item.id] ?? EMPTY_SECTION_TOTALS;
  const resolvedCurrency = currency;
  const sectionRowClassName =
    depth === 0
      ? "bg-[var(--slate-300)] print-color-adjust"
      : "bg-[var(--slate-200)] print-color-adjust";

  return (
    <tr className={sectionRowClassName}>
      <td className="px-6 py-3 print:px-4 print:py-2">
        <div style={{ paddingLeft: `${depth * 16}px` }}>
          <div className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
            {numberingById[item.id] ? (
              <span className="mr-2 font-semibold text-[var(--slate-600)]">
                {numberingById[item.id]}
              </span>
            ) : null}
            <span>{resolveTitle(item)}</span>
          </div>
        </div>
      </td>
      <td className="w-20 px-3 py-3 text-center text-slate-500 print:px-2 print:py-2">-</td>
      <td className="w-16 px-3 py-3 text-center text-slate-500 print:px-2 print:py-2">-</td>
      <td className="w-28 px-3 py-3 text-right text-slate-500 print:px-2 print:py-2">-</td>
      <td className="w-32 px-4 py-3 text-right font-medium text-slate-600 print:px-2 print:py-2 print:text-slate-700">
        {formatCurrency(totals.totalHtCents, resolvedCurrency)}
      </td>
    </tr>
  );
}

function EstimateDocumentLineRow({
  item,
  depth,
  numberingById,
  currency,
}: EstimateDocumentLineRowProps) {
  const resolvedCurrency = currency;

  return (
    <tr className="bg-white print-color-adjust">
      <td className="px-6 py-4 font-medium text-slate-800 print:px-4 print:py-2 print:text-slate-900">
        <div
          style={{ paddingLeft: `${depth * 16}px` }}
          className="flex items-center gap-2"
        >
          <span>{resolveTitle(item)}</span>
        </div>
      </td>
      <td className="w-20 px-3 py-4 text-center font-semibold print:px-2 print:py-2">
        {formatQuantity(item.quantity)}
      </td>
      <td className="w-16 px-3 py-4 text-center print:px-2 print:py-2">
        {item.description?.trim() || "-"}
      </td>
      <td className="w-28 px-3 py-4 text-right print:px-2 print:py-2">
        {formatCurrency(item.pu_ht_cents ?? 0, resolvedCurrency)}
      </td>
      <td className="w-32 px-4 py-4 text-right font-bold print:px-2 print:py-2">
        {formatCurrency(item.line_total_ht_cents ?? 0, resolvedCurrency)}
      </td>
    </tr>
  );
}

export function EstimateDocumentTableRows({
  rows,
  numberingById,
  sectionTotalsById,
  currency,
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
          />
        ) : (
          <EstimateDocumentLineRow
            key={item.id}
            item={item}
            depth={depth}
            numberingById={numberingById}
            currency={currency}
          />
        )
      )}
    </>
  );
}
