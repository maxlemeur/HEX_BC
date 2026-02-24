import {
  EMPTY_SECTION_TOTALS,
  type EstimateDocumentRow,
  type EstimateItem,
} from "@/components/estimate-document/prepare-estimate-document-data";
import {
  UNASSIGNED_SUPPLY_TYPE_KEY,
  type SectionTotals,
} from "@/lib/estimate-calculations";
import {
  formatCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";

type EstimateDocumentTableRowsProps = {
  rows: EstimateDocumentRow[];
  numberingById: Record<string, string>;
  sectionTotalsById: Record<string, SectionTotals>;
  currency: SupportedEstimateCurrency;
  isLaborSplitEnabled: boolean;
  laborRateById: Record<string, number>;
  supplyTypeLabelsById: Record<string, string>;
};

type EstimateDocumentSectionRowProps = {
  item: EstimateItem;
  depth: number;
  numberingById: Record<string, string>;
  sectionTotalsById: Record<string, SectionTotals>;
  currency: SupportedEstimateCurrency;
  isLaborSplitEnabled: boolean;
  supplyTypeLabelsById: Record<string, string>;
};

type EstimateDocumentLineRowProps = {
  item: EstimateItem;
  depth: number;
  numberingById: Record<string, string>;
  currency: SupportedEstimateCurrency;
  isLaborSplitEnabled: boolean;
  laborRateById: Record<string, number>;
  supplyTypeLabelsById: Record<string, string>;
};

function formatQuantity(value: number | null): string {
  if (!Number.isFinite(value ?? NaN)) return "-";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 3,
  }).format(value ?? 0);
}

function formatMajorationPercent(value: number | null | undefined): string {
  const percent = (value ?? 1) * 100;
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(percent);
}

function formatCoefficient(value: number | null | undefined): string {
  const normalized = Number.isFinite(value ?? NaN) ? (value ?? 1) : 1;
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(normalized);
}

function formatLaborSplitLine(params: {
  hours: number | null;
  coefficient: number | null;
  laborRoleId: string | null;
  laborRateById: Record<string, number>;
  currency: SupportedEstimateCurrency;
}) {
  const rate = params.laborRoleId ? (params.laborRateById[params.laborRoleId] ?? 0) : 0;
  return `${formatQuantity(params.hours)} h x K ${formatCoefficient(params.coefficient)} x ${formatCurrency(rate, params.currency)}/h`;
}

function resolveTitle(item: EstimateItem) {
  const title = item.title?.trim();
  return title || "Sans titre";
}

function resolveAid(item: EstimateItem) {
  const aid = item.aid?.trim();
  return aid && aid.length > 0 ? aid : "-";
}

function EstimateDocumentSectionRow({
  item,
  depth,
  numberingById,
  sectionTotalsById,
  currency,
  isLaborSplitEnabled,
  supplyTypeLabelsById,
}: EstimateDocumentSectionRowProps) {
  const totals = sectionTotalsById[item.id] ?? EMPTY_SECTION_TOTALS;
  const resolvedCurrency = currency;

  return (
    <tr className="bg-[var(--slate-50)] print-color-adjust">
      <td className="px-4 py-3 font-mono text-xs text-[var(--slate-600)] print:px-2 print:py-2">
        {resolveAid(item)}
      </td>
      <td colSpan={7} className="px-6 py-3 print:px-4 print:py-2">
        <div style={{ paddingLeft: `${depth * 16}px` }}>
          <div className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
            {numberingById[item.id] ? (
              <span className="mr-2 font-semibold text-[var(--slate-600)]">
                {numberingById[item.id]}
              </span>
            ) : null}
            <span>{resolveTitle(item)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold normal-case tracking-normal text-[var(--slate-600)]">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
              FO {formatCurrency(totals.foTotalCents, resolvedCurrency)}
            </span>
            {isLaborSplitEnabled ? (
              <>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  MO atelier {formatCurrency(totals.moAtelierTotalCents, resolvedCurrency)}
                </span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                  MO chantier {formatCurrency(totals.moChantierTotalCents, resolvedCurrency)}
                </span>
              </>
            ) : (
              <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
                MO {formatCurrency(totals.moTotalCents, resolvedCurrency)}
              </span>
            )}
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
              HT {formatCurrency(totals.totalHtCents, resolvedCurrency)}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">
              TTC {formatCurrency(totals.totalTtcCents, resolvedCurrency)}
            </span>
            {Object.entries(totals.supplyTypeFoTotalsCents ?? {})
              .sort(([, left], [, right]) => right - left)
              .map(([supplyTypeId, cents]) => {
                const label =
                  supplyTypeId === UNASSIGNED_SUPPLY_TYPE_KEY
                    ? "Non classe"
                    : (supplyTypeLabelsById[supplyTypeId] ?? "Type inconnu");

                return (
                  <span
                    key={`${item.id}:print-supply-type:${supplyTypeId}`}
                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5"
                  >
                    {label} {formatCurrency(cents, resolvedCurrency)}
                  </span>
                );
              })}
          </div>
        </div>
      </td>
    </tr>
  );
}

function EstimateDocumentLineRow({
  item,
  depth,
  numberingById,
  currency,
  isLaborSplitEnabled,
  laborRateById,
  supplyTypeLabelsById,
}: EstimateDocumentLineRowProps) {
  const resolvedCurrency = currency;

  return (
    <tr>
      <td className="px-4 py-4 font-mono text-xs text-slate-700 print:px-2 print:py-2">
        {resolveAid(item)}
      </td>
      <td className="px-6 py-4 font-medium text-slate-800 print:px-4 print:py-2 print:text-slate-900">
        <div
          style={{ paddingLeft: `${depth * 16}px` }}
          className="flex items-center gap-2"
        >
          {numberingById[item.id] ? (
            <span className="font-mono text-xs font-semibold text-slate-500">
              {numberingById[item.id]}
            </span>
          ) : null}
          <span>{resolveTitle(item)}</span>
        </div>
      </td>
      <td className="w-20 px-3 py-4 text-center font-semibold print:px-2 print:py-2">
        {formatQuantity(item.quantity)}
      </td>
      <td className="w-16 px-3 py-4 text-center print:px-2 print:py-2">
        {item.description?.trim() || "-"}
      </td>
      <td className="w-32 px-3 py-4 print:px-2 print:py-2">
        {item.supply_type_id
          ? (supplyTypeLabelsById[item.supply_type_id] ?? "Type inconnu")
          : "Non classe"}
      </td>
      <td className="w-24 px-3 py-4 text-center print:px-2 print:py-2">
        {isLaborSplitEnabled ? (
          <div className="space-y-1 text-left text-[11px] leading-tight text-slate-700 print:text-[10px]">
            <div>
              <span className="font-semibold">Atelier:</span>{" "}
              {formatLaborSplitLine({
                hours: item.h_mo_atelier,
                coefficient: item.k_mo_atelier,
                laborRoleId: item.labor_role_atelier_id,
                laborRateById,
                currency: resolvedCurrency,
              })}
            </div>
            <div>
              <span className="font-semibold">Chantier:</span>{" "}
              {formatLaborSplitLine({
                hours: item.h_mo_chantier,
                coefficient: item.k_mo_chantier,
                laborRoleId: item.labor_role_chantier_id,
                laborRateById,
                currency: resolvedCurrency,
              })}
            </div>
            <div>
              <span className="font-semibold">Maj:</span>{" "}
              {formatMajorationPercent(item.h_mo_majoration)} %
            </div>
          </div>
        ) : (
          `${formatMajorationPercent(item.h_mo_majoration)} %`
        )}
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
  isLaborSplitEnabled,
  laborRateById,
  supplyTypeLabelsById,
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
            isLaborSplitEnabled={isLaborSplitEnabled}
            supplyTypeLabelsById={supplyTypeLabelsById}
          />
        ) : (
          <EstimateDocumentLineRow
            key={item.id}
            item={item}
            depth={depth}
            numberingById={numberingById}
            currency={currency}
            isLaborSplitEnabled={isLaborSplitEnabled}
            laborRateById={laborRateById}
            supplyTypeLabelsById={supplyTypeLabelsById}
          />
        )
      )}
    </>
  );
}
