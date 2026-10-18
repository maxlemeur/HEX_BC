import { Card } from "@/components/ui/card";
import type { EstimateItem } from "@/lib/estimates/editor-items";
import {
  ESTIMATE_V3_PRICING_STATUS_OPTIONS,
  formatEstimateV3TaxRate,
  formatEstimateV3UnitLabel,
  type EstimateV3SummaryView,
} from "@/lib/estimates/v3-editor";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";

/**
 * Lot 2, sous-lot 2.6 - lecture d'une v3 sur sa fiche (conception §14 « 2.6 », D7, D8). Montants
 * stockés seulement (aucun recalcul : ils sont vérifiés à chaque sauvegarde par
 * `estimate_v3_assert_draft`, D12, puis figés à l'émission) ; TVA par taux. Depuis 2.7, le document
 * client v3 (lignes brutes, contrat client 2) s'imprime par `EstimateV3PrintPage` et s'émet comme
 * une v1/v2 : cette carte ne le remplace pas.
 */

const STATUS_LABELS = new Map(ESTIMATE_V3_PRICING_STATUS_OPTIONS.map((option) => [option.value, option.label]));
const QUANTITY_FORMAT = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

type Line = Pick<
  EstimateItem,
  "id" | "item_type" | "title" | "unit_code" | "pricing_status" | "quantity" | "tax_rate_bp" | "pu_ht_cents" | "line_total_ht_cents"
>;

export function EstimateV3DraftTotals({
  summary,
  currency,
}: Readonly<{ summary: EstimateV3SummaryView; currency: SupportedEstimateCurrency }>) {
  const money = (cents: number) => formatCurrency(cents, currency);
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: "HT brut", value: money(summary.grossHtCents) },
    ...(summary.discountAppliedCents > 0 ? [{ label: "Remise commerciale", value: `−${money(summary.discountAppliedCents)}` }] : []),
    ...(summary.commercialRoundingCents > 0 ? [{ label: "Arrondi commercial", value: `−${money(summary.commercialRoundingCents)}` }] : []),
    { label: "HT net", value: money(summary.totalHtCents), strong: true },
    ...summary.taxByRate.map((row) => ({
      label: `TVA ${formatEstimateV3TaxRate(row.rateBp)} % sur ${money(row.baseCents)}`,
      value: money(row.taxCents),
    })),
    { label: "TVA", value: money(summary.totalTaxCents) },
    { label: "TTC à payer", value: money(summary.payableTtcCents), strong: true },
  ];
  return (
    <dl className="divide-y divide-border text-sm" data-testid="estimate-v3-draft-totals">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
          <span className={row.strong ? "font-semibold text-foreground" : "text-muted-foreground"}>{row.label}</span>
          <span className={`tabular-nums ${row.strong ? "font-semibold text-foreground" : "text-foreground-secondary"}`}>{row.value}</span>
        </div>
      ))}
    </dl>
  );
}

export function EstimateV3DraftSummary({
  summary,
  items,
  currency,
  issued = false,
}: Readonly<{ summary: EstimateV3SummaryView; items: readonly Line[]; currency: SupportedEstimateCurrency; issued?: boolean }>) {
  const lines = items.filter((item) => item.item_type === "line");
  const money = (cents: number | null) => (cents === null ? "—" : formatCurrency(cents, currency));
  return (
    <Card className="p-4 sm:p-6" data-testid="estimate-v3-draft-summary">
      <h2 className="text-base font-semibold text-foreground">
        {issued ? "Devis émis au moteur de calcul 3" : "Brouillon au moteur de calcul 3"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {issued
          ? "Montants figés à l’émission. Le document client s’imprime et se télécharge depuis cette fiche."
          : "Montants enregistrés du brouillon. Le document client se prépare depuis cette fiche (Imprimer, Préparer le PDF)."}
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">Désignation</th>
                <th scope="col" className="py-2 pr-3 font-medium">U</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">Qté</th>
                <th scope="col" className="py-2 pr-3 font-medium">Statut</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">TVA</th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">PU HT</th>
                <th scope="col" className="py-2 text-right font-medium">Net HT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-border/60">
                  <td className="py-2 pr-3">{line.title}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{formatEstimateV3UnitLabel(line.unit_code) || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{line.quantity === null ? "—" : QUANTITY_FORMAT.format(line.quantity)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{STATUS_LABELS.get(line.pricing_status ?? "priced") ?? line.pricing_status}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{line.tax_rate_bp === null ? "—" : `${formatEstimateV3TaxRate(line.tax_rate_bp)} %`}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(line.pu_ht_cents)}</td>
                  <td className="py-2 text-right tabular-nums">{money(line.line_total_ht_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <EstimateV3DraftTotals summary={summary} currency={currency} />
      </div>
    </Card>
  );
}
