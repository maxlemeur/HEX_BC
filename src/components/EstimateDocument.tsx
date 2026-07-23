import {
  BusinessDocumentBrandHeader,
  BusinessDocumentFooter,
  BusinessDocumentFrame,
} from "@/components/documents/BusinessDocumentPrimitives";
import { EstimateDocumentTableRows } from "@/components/estimate-document/EstimateDocumentTableRows";
import {
  prepareEstimateDocumentData,
  type EstimateItem,
} from "@/components/estimate-document/prepare-estimate-document-data";
import { normalizeDocumentIssuerDisplay } from "@/lib/documents/issuer-display";
import { ESTIMATE_SERVICE_LIMITS_TITLE } from "@/lib/estimates/document-copy";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";
import {
  ESTIMATE_DRAFT_TERMS_NOTICE,
  parseEstimateTermsClauses,
  type EstimateTermsSnapshot,
} from "@/lib/estimates/pdf-terms";
import { formatEstimateReference } from "@/lib/estimates/reference";
import {
  formatCurrency,
  normalizeEstimateCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";

export type EstimateDocumentProps = {
  projectName: string;
  projectClient?: string | null;
  projectReference?: string | null;
  estimateReference?: string | null;
  portalUrl?: string | null;
  versionNumber: number;
  dateDevis: string;
  validiteJours: number;
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  currency?: string | null;
  isLaborSplitEnabled: boolean;
  laborRateById: Record<string, number>;
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
  items: EstimateItem[];
  exclusions?: string | null;
  issuerName?: string | null;
  issuerRole?: string | null;
  issuerPhone?: string | null;
  issuerEmail?: string | null;
  layout?: EstimatePdfLayoutOptions;
  terms?: EstimateTermsSnapshot | null;
  maxVisibleSectionLevel?: number | null;
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function EstimateConditionsBlock({
  text,
  showTitle = true,
}: Readonly<{ text: string; showTitle?: boolean }>) {
  return (
    <section className="note-container print-avoid-break-inside mb-6 rounded-r-xl p-5 print:mb-4 print:p-3">
      {showTitle ? (
        <h3 className="text-xs font-bold uppercase tracking-wide text-brand-blue">
          {ESTIMATE_SERVICE_LIMITS_TITLE}
        </h3>
      ) : null}
      <p
        className={`${showTitle ? "mt-3" : ""} whitespace-pre-wrap text-sm leading-6 text-slate-600 print:text-xs print:leading-5`}
      >
        {text}
      </p>
    </section>
  );
}

function EstimateContinuationHeader({
  title,
  versionNumber,
  documentLabel = "Document contractuel",
}: Readonly<{
  title: string;
  versionNumber: number;
  documentLabel?: string;
}>) {
  return (
    <div className="mb-8">
      <BusinessDocumentBrandHeader />
      <div className="mt-6 flex items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-orange">
            Devis V{versionNumber}
          </p>
          <h2 className="mt-1 text-2xl font-black uppercase tracking-tight text-foreground">
            {title}
          </h2>
        </div>
        <p className="text-xs font-medium text-muted-foreground">
          {documentLabel}
        </p>
      </div>
    </div>
  );
}

function EstimateTermsPage({
  terms,
  versionNumber,
}: Readonly<{ terms: EstimateTermsSnapshot; versionNumber: number }>) {
  const clauses = parseEstimateTermsClauses(terms.body);
  const reviewLabel =
    terms.isDraft || !terms.legalReviewedAt
      ? "Maquette CGV - version " +
        terms.version +
        " - à valider, non contractuelle."
      : "Version des conditions : " +
        terms.version +
        " - revue juridique du " +
        formatDate(terms.legalReviewedAt);

  return (
    <BusinessDocumentFrame className="print-page-break-before">
      <EstimateContinuationHeader
        title={terms.title}
        versionNumber={versionNumber}
        documentLabel={
          terms.isDraft ? "Projet non contractuel" : "Document contractuel"
        }
      />
      {terms.isDraft ? (
        <p
          className="mb-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[11px] font-semibold leading-4 text-amber-900 print:mb-3 print:px-3 print:py-2 print:text-[9px] print:leading-[1.35]"
          role="note"
        >
          {ESTIMATE_DRAFT_TERMS_NOTICE}
        </p>
      ) : null}
      <div className="columns-1 gap-6 text-slate-700 md:columns-2 print:columns-2 print:gap-5">
        {clauses.map((clause, index) => (
          <section
            key={[index, clause.heading].join("-")}
            className="print-avoid-break-inside mb-3 inline-block w-full align-top print:mb-2.5"
          >
            {clause.heading ? (
              <h3 className="text-[11px] font-bold uppercase leading-4 text-brand-blue print:text-[9.5px] print:leading-[1.35]">
                {clause.heading}
              </h3>
            ) : null}
            <p className="mt-1 text-[11px] leading-[1.45] print:text-[9.5px] print:leading-[1.4]">
              {clause.text}
            </p>
          </section>
        ))}
      </div>
      <p className="mt-5 text-[10px] text-muted-foreground print:mt-3 print:text-[8px]">
        {reviewLabel}
      </p>
      <BusinessDocumentFooter />
    </BusinessDocumentFrame>
  );
}

export function EstimateDocument({
  projectName,
  projectClient,
  projectReference,
  estimateReference,
  portalUrl,
  versionNumber,
  dateDevis,
  validiteJours,
  marginMultiplier,
  discountCents,
  taxRateBp,
  currency,
  isLaborSplitEnabled,
  laborRateById,
  totalHtCents,
  totalTaxCents,
  totalTtcCents,
  items,
  exclusions,
  issuerName,
  issuerRole,
  issuerPhone,
  issuerEmail,
  layout,
  terms,
  maxVisibleSectionLevel = null,
}: EstimateDocumentProps) {
  const resolvedCurrency: SupportedEstimateCurrency =
    normalizeEstimateCurrency(currency) ?? "EUR";

  const formattedEstimateReference = formatEstimateReference(
    estimateReference,
    versionNumber
  );
  const {
    rows,
    numberingById,
    sectionTotalsById,
    lineSplitsById,
    layout: resolvedLayout,
    taxEnabled,
    discountLabel,
    validiteLabel,
    taxLabel,
    qrLikeCells,
  } = prepareEstimateDocumentData({
    items,
    marginMultiplier,
    discountCents,
    taxRateBp,
    currency: resolvedCurrency,
    isLaborSplitEnabled,
    laborRateById,
    validiteJours,
    portalUrl,
    maxVisibleSectionLevel,
    layout,
  });
  const conditionsText = exclusions?.trim() ?? "";
  const conditionsOnNewPage =
    conditionsText.length > 0 &&
    resolvedLayout.conditionsPlacement === "new_page";
  const showTerms =
    resolvedLayout.includeTerms && terms !== null && terms !== undefined;
  const issuerDisplay = normalizeDocumentIssuerDisplay({
    issuerName,
    issuerRole,
    issuerEmail,
    fallbackName: "Hydro Express",
  });
  const tableMinWidth =
    resolvedLayout.priceMode === "fo_mo_and_total"
      ? "min-w-[48rem]"
      : "min-w-[40rem]";

  return (
    <>
      <BusinessDocumentFrame
        className={`estimate-document estimate-document--${resolvedLayout.density}`}
      >
        <div className="mb-6">
          <BusinessDocumentBrandHeader />

          <div className="mt-5 grid gap-5 sm:grid-cols-[240px_minmax(0,1fr)_190px] sm:items-start print:mt-3 print:grid-cols-[220px_minmax(0,1fr)_160px] print:gap-3">
            <div className="min-w-0 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Emis par
              </p>
              <p className="text-lg font-bold leading-tight text-brand-blue print:text-base">
                {issuerDisplay.displayName}
              </p>
              {issuerDisplay.displayRole ? (
                <p className="text-muted-foreground">
                  {issuerDisplay.displayRole}
                </p>
              ) : null}
              {issuerPhone?.trim() ? (
                <p className="text-muted-foreground">{issuerPhone}</p>
              ) : null}
              {issuerDisplay.displayEmail ? (
                <p className="text-muted-foreground [overflow-wrap:anywhere]">
                  {issuerDisplay.displayEmail}
                </p>
              ) : null}
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                Le {formatDate(dateDevis)}
              </p>
            </div>

            <div className="min-w-0 justify-self-center pt-3 text-center print:pt-2">
              <h2 className="mb-2 whitespace-nowrap text-[30px] font-black uppercase tracking-tight text-foreground print:mb-1 print:text-[25px]">
                Devis
              </h2>
              <p className="inline-block rounded-lg border border-border bg-surface-subtle px-4 py-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
                Version :{" "}
                <span className="font-bold text-brand-orange">
                  V{versionNumber}
                </span>
              </p>
            </div>

            <div className="hidden min-w-0 sm:block" />
          </div>
        </div>

        <div className="mb-8 grid gap-4 sm:grid-cols-2 sm:gap-8 print:mb-4 print:gap-7">
          <section className="purchase-order-party-card rounded-xl border border-border bg-surface-subtle p-4 sm:p-6 print:p-5">
            <h3 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
              Client
            </h3>
            <p className="text-2xl font-extrabold leading-tight text-foreground">
              {projectClient?.trim() || "Client a renseigner"}
            </p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Affaire
            </p>
            <p className="mt-1 text-[15px] font-semibold leading-snug text-secondary-foreground">
              {projectName || "Projet"}
            </p>
            {formattedEstimateReference ? (
              <p className="mt-2 text-sm font-semibold text-secondary-foreground">
                Reference devis : {formattedEstimateReference}
              </p>
            ) : null}
            {projectReference?.trim() ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Reference projet : {projectReference}
              </p>
            ) : null}
          </section>

          <section className="purchase-order-party-card rounded-xl border border-border bg-surface-subtle p-4 sm:p-6 print:p-5">
            <h3 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
              Informations devis
            </h3>
            <dl className="space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-4">
                <dt>Date du devis</dt>
                <dd className="font-semibold text-secondary-foreground">
                  {formatDate(dateDevis)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt>Validite</dt>
                <dd className="font-semibold text-secondary-foreground">
                  {validiteLabel}
                </dd>
              </div>
              {discountCents > 0 ? (
                <div className="flex items-center justify-between gap-4">
                  <dt>Remise</dt>
                  <dd className="font-semibold text-secondary-foreground">
                    {discountLabel}
                  </dd>
                </div>
              ) : null}
              {taxEnabled ? (
                <div className="flex items-center justify-between gap-4">
                  <dt>TVA</dt>
                  <dd className="font-semibold text-secondary-foreground">
                    {taxLabel}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        </div>

        <div className="mb-6 overflow-x-auto rounded-xl border border-border shadow-sm print:mb-4 print:overflow-visible">
          <table className={`w-full ${tableMinWidth} md:min-w-0`}>
            <thead>
              <tr className="table-head bg-brand-blue text-left text-xs font-bold uppercase tracking-wide text-white print-color-adjust">
                <th className="px-6 py-3 align-middle whitespace-nowrap print:px-4 print:py-2">
                  Designation
                </th>
                <th className="w-16 px-2 py-3 text-center align-middle whitespace-nowrap print:py-2">
                  Qte
                </th>
                <th className="w-14 px-2 py-3 text-center align-middle whitespace-nowrap print:py-2">
                  U
                </th>
                {resolvedLayout.priceMode === "unit_and_total" ? (
                  <th className="w-24 px-2 py-3 text-right align-middle whitespace-nowrap print:py-2">
                    P.U. HT
                  </th>
                ) : null}
                {resolvedLayout.priceMode === "fo_mo_and_total" ? (
                  <>
                    <th className="w-24 px-2 py-3 text-right align-middle whitespace-nowrap print:py-2">
                      FO HT
                    </th>
                    <th className="w-24 px-2 py-3 text-right align-middle whitespace-nowrap print:py-2">
                      MO HT
                    </th>
                  </>
                ) : null}
                <th className="w-28 px-3 py-3 text-right align-middle whitespace-nowrap print:py-2">
                  Total HT
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--slate-300)] text-[13px] print:text-foreground">
              <EstimateDocumentTableRows
                rows={rows}
                numberingById={numberingById}
                sectionTotalsById={sectionTotalsById}
                lineSplitsById={lineSplitsById}
                currency={resolvedCurrency}
                layout={resolvedLayout}
              />
            </tbody>
          </table>
        </div>

        <div className="mb-8 flex justify-end print:mb-4">
          <div className="w-full max-w-[320px] overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between bg-brand-blue px-5 py-3 print-color-adjust">
              <span className="text-xs font-bold uppercase tracking-wide text-white/80">
                Total HT
              </span>
              <span className="text-xl font-bold text-white">
                {formatCurrency(totalHtCents, resolvedCurrency)}
              </span>
            </div>
            {taxEnabled ? (
              <div className="flex items-center justify-between border-b border-border bg-surface-subtle px-5 py-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  TVA
                </span>
                <span className="text-sm font-medium text-slate-600">
                  {formatCurrency(totalTaxCents, resolvedCurrency)}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between bg-surface-subtle px-5 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total TTC
              </span>
              <span className="text-sm font-semibold text-slate-600">
                {formatCurrency(totalTtcCents, resolvedCurrency)}
              </span>
            </div>
          </div>
        </div>

        {conditionsText && !conditionsOnNewPage ? (
          <EstimateConditionsBlock text={conditionsText} />
        ) : null}

        {portalUrl ? (
          <div className="print-portal-block print-avoid-break-inside mb-4 mt-1 flex items-center gap-3">
            <div className="print-portal-qr" aria-hidden>
              {qrLikeCells.map((cell) => (
                <span
                  key={cell.id}
                  className={
                    cell.enabled
                      ? "print-portal-qr-cell print-portal-qr-cell--on"
                      : "print-portal-qr-cell"
                  }
                />
              ))}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Portail client du devis
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ouvrez ce lien pour consulter la version partagee.
              </p>
              <p className="print-portal-url mt-2 text-[11px] font-medium text-secondary-foreground">
                {portalUrl}
              </p>
            </div>
          </div>
        ) : null}

        <BusinessDocumentFooter />
      </BusinessDocumentFrame>

      {conditionsOnNewPage ? (
        <BusinessDocumentFrame className="print-page-break-before">
          <EstimateContinuationHeader
            title={ESTIMATE_SERVICE_LIMITS_TITLE}
            versionNumber={versionNumber}
          />
          <EstimateConditionsBlock text={conditionsText} showTitle={false} />
          <BusinessDocumentFooter />
        </BusinessDocumentFrame>
      ) : null}

      {showTerms ? (
        <EstimateTermsPage terms={terms} versionNumber={versionNumber} />
      ) : null}
    </>
  );
}
