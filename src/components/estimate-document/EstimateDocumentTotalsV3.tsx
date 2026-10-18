import { ESTIMATE_VAT_REVERSE_CHARGE_NOTICE } from "@/lib/estimates/document-copy";
import {
  buildEstimateV3FooterRows,
  formatEstimateV3FooterAmount,
  type EstimateV3DocumentFooter,
} from "@/lib/estimates/v3-document-presentation";
import type { SupportedEstimateCurrency } from "@/lib/money";

/**
 * Lot 2, sous-lot 2.7 - pied du document v3 à l'écran et à l'impression (conception D7, D8 ;
 * §14 « 2.7 ») : brut, « Remise commerciale », arrondi commercial, « Total HT net », TVA de
 * chaque taux sur sa base nette (récapitulatif figé, jamais recalculé), TTC ; mention
 * d'autoliquidation à la place de la TVA. Même mise en page que le pied v1/v2 d'EstimateDocument,
 * sans capitales forcées : le texte rendu (impression, lecture d'écran) garde les libellés exacts.
 */
export function EstimateDocumentTotalsV3({
  footer,
  currency,
}: Readonly<{ footer: EstimateV3DocumentFooter; currency: SupportedEstimateCurrency }>) {
  return (
    <div className="mb-8 flex justify-end print:mb-4">
      <dl className="w-full max-w-[360px] overflow-hidden rounded-xl border border-border" data-testid="estimate-v3-document-totals">
        {buildEstimateV3FooterRows(footer, currency).map((row) =>
          row.emphasis === "net" ? (
            <div key={row.key} className="flex items-center justify-between gap-4 bg-brand-blue px-5 py-3 print-color-adjust">
              <dt className="text-sm font-bold text-white/90">{row.label}</dt>
              <dd className="text-xl font-bold text-white">{formatEstimateV3FooterAmount(row, currency)}</dd>
            </div>
          ) : (
            <div key={row.key} className="flex items-center justify-between gap-4 border-b border-border bg-surface-subtle px-5 py-2 last:border-b-0">
              <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
              <dd className={`text-sm text-slate-600 ${row.emphasis === "payable" ? "font-semibold" : "font-medium"}`}>
                {formatEstimateV3FooterAmount(row, currency)}
              </dd>
            </div>
          )
        )}
        {footer.reverseCharge ? (
          <div className="bg-surface-subtle px-5 py-2 text-xs font-medium text-slate-600">
            <dt className="sr-only">TVA</dt>
            <dd>{ESTIMATE_VAT_REVERSE_CHARGE_NOTICE}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
