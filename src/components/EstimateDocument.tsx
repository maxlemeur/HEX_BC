import Image from "next/image";

import { EstimateDocumentTableRows } from "@/components/estimate-document/EstimateDocumentTableRows";
import {
  prepareEstimateDocumentData,
  type EstimateItem,
} from "@/components/estimate-document/prepare-estimate-document-data";
import { COMPANY_INFO } from "@/lib/company-info";
import {
  formatCurrency,
  normalizeEstimateCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";

export type EstimateDocumentProps = {
  projectName: string;
  projectClient?: string | null;
  projectReference?: string | null;
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

export function EstimateDocument({
  projectName,
  projectClient,
  projectReference,
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
  maxVisibleSectionLevel = null,
}: EstimateDocumentProps) {
  const resolvedCurrency: SupportedEstimateCurrency =
    normalizeEstimateCurrency(currency) ?? "EUR";

  const {
    rows,
    numberingById,
    sectionTotalsById,
    taxEnabled,
    discountLabel,
    validiteLabel,
    taxLabel,
    footerAddress,
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
  });

  return (
    <div className="document-page relative mx-auto my-5 flex w-full max-w-full flex-col overflow-hidden bg-white px-4 pb-6 pt-6 shadow-2xl sm:px-6 sm:pb-8 sm:pt-8 md:px-[50px] md:pb-[50px] md:pt-[40px] print:m-0 print:px-8 print:pb-8 print:pt-6 print:shadow-none">
      <div className="sidebar-accent print-color-adjust" />

      <div className="mb-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <Image
            src="/logo-hydro-express.jpg"
            alt="Hydro eXpress"
            width={250}
            height={100}
            className="h-16 w-auto object-contain sm:h-[100px] print:h-[80px]"
            priority
          />
          <div className="w-full max-w-none rounded-lg border border-border bg-surface-subtle px-4 py-3 text-left text-sm sm:max-w-[220px] sm:text-right print:px-3 print:py-2 print:text-xs">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Etablissement principal :
            </p>
            <p className="text-slate-600">{COMPANY_INFO.address.street}</p>
            <p className="text-slate-600">
              {COMPANY_INFO.address.postalCode} {COMPANY_INFO.address.city}
            </p>
            <div className="mt-1 text-slate-600">
              <p>{COMPANY_INFO.phone.landline}</p>
              <p>{COMPANY_INFO.phone.mobile}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-4 print:mt-3 sm:flex-row sm:items-start">
          <div className="w-full text-sm sm:w-[240px] sm:shrink-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Projet
            </p>
            <p className="text-lg font-bold text-brand-blue">
              {projectName || "Projet"}
            </p>
            {projectClient ? (
              <p className="text-muted-foreground">{projectClient}</p>
            ) : null}
            {projectReference ? (
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                Ref : {projectReference}
              </p>
            ) : null}
          </div>

          <div className="self-start text-left sm:flex-1 sm:self-center sm:text-center">
            <h2 className="mb-2 text-[26px] font-black uppercase tracking-tight text-foreground sm:whitespace-nowrap sm:text-[30px] print:mb-1 print:text-[25px]">
              Devis
            </h2>
            <p className="inline-block rounded-lg border border-border bg-surface-subtle px-4 py-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              Version :{" "}
              <span className="font-bold text-brand-orange">
                V{versionNumber}
              </span>
            </p>
          </div>

          <div className="hidden w-[220px] shrink-0 sm:block"></div>
        </div>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 sm:gap-8 print:mb-3">
        <div className="rounded-xl border border-border bg-surface-subtle p-4 sm:p-6 print:p-4">
          <h4 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
            Informations devis
          </h4>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-4">
              <span>Date devis</span>
              <span className="font-semibold text-secondary-foreground">
                {formatDate(dateDevis)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Validite</span>
              <span className="font-semibold text-secondary-foreground">
                {validiteLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Version</span>
              <span className="font-semibold text-secondary-foreground">
                V{versionNumber}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-subtle p-4 sm:p-6 print:p-4">
          <h4 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
            Conditions
          </h4>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-4">
              <span>Remise</span>
              <span className="font-semibold text-secondary-foreground">
                {discountLabel}
              </span>
            </div>
            {taxEnabled ? (
              <div className="flex items-center justify-between gap-4">
                <span>TVA</span>
                <span className="font-semibold text-secondary-foreground">{taxLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-6 overflow-x-auto rounded-xl border border-border shadow-sm print:mb-3 print:overflow-visible">
        <table className="w-full min-w-[40rem] md:min-w-0">
          <thead>
            <tr className="table-head bg-brand-blue text-left text-xs font-bold uppercase tracking-wide text-white print-color-adjust">
              <th className="px-6 py-4 align-middle whitespace-nowrap print:px-4 print:py-2">Designation</th>
              <th className="w-20 px-3 py-4 text-center align-middle whitespace-nowrap print:px-2 print:py-2">
                Qte
              </th>
              <th className="w-16 px-3 py-4 text-center align-middle whitespace-nowrap print:px-2 print:py-2">
                U
              </th>
              <th className="w-28 px-3 py-4 text-right align-middle whitespace-nowrap print:px-2 print:py-2">
                P.U. HT
              </th>
              <th className="w-32 px-4 py-4 text-right align-middle whitespace-nowrap print:px-2 print:py-2">
                Total HT
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--slate-300)] text-sm print:text-foreground">
            <EstimateDocumentTableRows
              rows={rows}
              numberingById={numberingById}
              sectionTotalsById={sectionTotalsById}
              currency={resolvedCurrency}
            />
          </tbody>
        </table>
      </div>

      <div className="mb-8 flex justify-end print:mb-4">
        <div className="w-full max-w-[320px] space-y-2">
          <div className="overflow-hidden rounded-xl border border-border">
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
      </div>

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

      <div className="mt-auto border-t border-border pt-5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground print:pt-3">
        <p className="mb-1">Siege social : {footerAddress}</p>
        <p>
          SIRET {COMPANY_INFO.legal.siret} - TVA {COMPANY_INFO.legal.vat}
        </p>
      </div>
    </div>
  );
}
