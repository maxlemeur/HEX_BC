import Image from "next/image";

import { COMPANY_INFO } from "@/lib/company-info";
import { formatEUR } from "@/lib/money";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

export type EstimateDocumentProps = {
  projectName: string;
  projectClient?: string | null;
  projectReference?: string | null;
  versionNumber: number;
  dateDevis: string;
  validiteJours: number;
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
  items: EstimateItem[];
};

const ROOT_KEY = "root";

function getParentKey(value: string | null) {
  return value ?? ROOT_KEY;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatPercent(bp: number): string {
  const value = bp / 100;
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
}

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

function buildRows(items: EstimateItem[]) {
  const map = new Map<string, EstimateItem[]>();
  items.forEach((item) => {
    const key = getParentKey(item.parent_id);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  });
  map.forEach((list) => list.sort((a, b) => a.position - b.position));

  const rows: { item: EstimateItem; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const list = map.get(getParentKey(parentId)) ?? [];
    list.forEach((item) => {
      rows.push({ item, depth });
      if (item.item_type === "section") {
        walk(item.id, depth + 1);
      }
    });
  };
  walk(null, 0);
  return rows;
}

export function EstimateDocument({
  projectName,
  projectClient,
  projectReference,
  versionNumber,
  dateDevis,
  validiteJours,
  marginMultiplier,
  discountCents,
  taxRateBp,
  totalHtCents,
  totalTaxCents,
  totalTtcCents,
  items,
}: EstimateDocumentProps) {
  const rows = buildRows(items);
  const taxEnabled = taxRateBp > 0;
  const discountLabel =
    discountCents > 0 ? `-${formatEUR(discountCents)}` : formatEUR(0);
  const validiteLabel =
    validiteJours > 0 ? `${validiteJours} jours` : "-";
  const taxLabel = taxEnabled ? `${formatPercent(taxRateBp)} %` : "";

  return (
    <div className="document-page relative mx-auto my-5 flex flex-col overflow-hidden bg-white px-[50px] pb-[50px] pt-[40px] shadow-2xl print:m-0 print:px-8 print:pb-8 print:pt-6 print:shadow-none">
      <div className="sidebar-accent print-color-adjust" />

      <div className="mb-6">
        <div className="flex items-start justify-between">
          <Image
            src="/logo-hydro-express.jpg"
            alt="Hydro eXpress"
            width={250}
            height={100}
            className="h-[100px] w-auto object-contain print:h-[80px]"
            priority
          />
          <div className="max-w-[220px] rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right text-sm print:px-3 print:py-2 print:text-xs">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
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

        <div className="mt-4 flex items-start print:mt-3">
          <div className="w-[240px] shrink-0 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Projet
            </p>
            <p className="text-lg font-bold text-brand-blue">
              {projectName || "Projet"}
            </p>
            {projectClient ? (
              <p className="text-slate-500">{projectClient}</p>
            ) : null}
            {projectReference ? (
              <p className="mt-2 text-xs font-medium text-slate-500">
                Ref : {projectReference}
              </p>
            ) : null}
          </div>

          <div className="flex-1 text-center self-center">
            <h2 className="mb-2 whitespace-nowrap text-[30px] font-black uppercase tracking-tight text-slate-800 print:mb-1 print:text-[25px]">
              Devis
            </h2>
            <p className="inline-block rounded-lg border border-slate-200 bg-slate-50 px-4 py-1.5 font-mono text-xs uppercase tracking-wide text-slate-500">
              Version :{" "}
              <span className="font-bold text-brand-orange">
                V{versionNumber}
              </span>
            </p>
          </div>

          <div className="w-[220px] shrink-0"></div>
        </div>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-8 print:mb-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 print:p-4">
          <h4 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
            Informations devis
          </h4>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-4">
              <span>Date devis</span>
              <span className="font-semibold text-slate-700">
                {formatDate(dateDevis)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Validite</span>
              <span className="font-semibold text-slate-700">
                {validiteLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Version</span>
              <span className="font-semibold text-slate-700">
                V{versionNumber}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 print:p-4">
          <h4 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
            Conditions
          </h4>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="flex items-center justify-between gap-4">
              <span>Marge</span>
              <span className="font-semibold text-slate-700">
                x{marginMultiplier.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Remise</span>
              <span className="font-semibold text-slate-700">
                {discountLabel}
              </span>
            </div>
            {taxEnabled ? (
              <div className="flex items-center justify-between gap-4">
                <span>TVA</span>
                <span className="font-semibold text-slate-700">{taxLabel}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 shadow-sm print:mb-3">
        <table className="w-full">
          <thead>
            <tr className="table-head bg-brand-blue text-left text-xs font-bold uppercase tracking-wide text-white print-color-adjust">
              <th className="px-6 py-4 print:px-4 print:py-2">Designation</th>
              <th className="w-20 px-3 py-4 text-center print:px-2 print:py-2">
                Qte
              </th>
              <th className="w-16 px-3 py-4 text-center print:px-2 print:py-2">
                U
              </th>
              <th className="w-28 px-3 py-4 text-right print:px-2 print:py-2">
                P.U. HT
              </th>
              <th className="w-32 px-4 py-4 text-right print:px-2 print:py-2">
                Total HT
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm print:text-slate-900">
            {rows.map(({ item, depth }) =>
              item.item_type === "section" ? (
                <tr
                  key={item.id}
                  className="bg-[var(--slate-50)] text-xs uppercase tracking-wide text-[var(--slate-500)] print-color-adjust"
                >
                  <td colSpan={5} className="px-6 py-3 print:px-4 print:py-2">
                    <div style={{ paddingLeft: `${depth * 16}px` }}>
                      {resolveTitle(item)}
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={item.id}>
                  <td className="px-6 py-4 font-medium text-slate-800 print:px-4 print:py-2 print:text-slate-900">
                    <div style={{ paddingLeft: `${depth * 16}px` }}>
                      {resolveTitle(item)}
                    </div>
                  </td>
                  <td className="w-20 px-3 py-4 text-center font-semibold print:px-2 print:py-2">
                    {formatQuantity(item.quantity)}
                  </td>
                  <td className="w-16 px-3 py-4 text-center print:px-2 print:py-2">
                    {item.description?.trim() || "-"}
                  </td>
                  <td className="w-28 px-3 py-4 text-right print:px-2 print:py-2">
                    {formatEUR(item.pu_ht_cents ?? 0)}
                  </td>
                  <td className="w-32 px-4 py-4 text-right font-bold print:px-2 print:py-2">
                    {formatEUR(item.line_total_ht_cents ?? 0)}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>

      <div className="mb-8 flex justify-end print:mb-4">
        <div className="w-full max-w-[320px] space-y-2">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="flex items-center justify-between bg-brand-blue px-5 py-3 print-color-adjust">
              <span className="text-xs font-bold uppercase tracking-wide text-white/80">
                Total HT
              </span>
              <span className="text-xl font-bold text-white">
                {formatEUR(totalHtCents)}
              </span>
            </div>
            {taxEnabled ? (
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  TVA
                </span>
                <span className="text-sm font-medium text-slate-600">
                  {formatEUR(totalTaxCents)}
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between bg-slate-50 px-5 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total TTC
              </span>
              <span className="text-sm font-semibold text-slate-600">
                {formatEUR(totalTtcCents)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-auto border-t border-slate-200 pt-5 text-center text-xs font-semibold uppercase tracking-wide text-slate-500 print:pt-3">
        <p className="mb-1">Siege social : 17 rue Dupin 75006 Paris</p>
        <p>
          SIRET {COMPANY_INFO.legal.siret} - TVA {COMPANY_INFO.legal.vat}
        </p>
      </div>
    </div>
  );
}
