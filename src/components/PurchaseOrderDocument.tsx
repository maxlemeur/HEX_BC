"use client";

import Image from "next/image";

import { COMPANY_INFO } from "@/lib/company-info";
import { formatEUR } from "@/lib/money";

// Types
export type SupplierData = {
  id?: string;
  name: string;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type DeliverySiteData = {
  id?: string;
  name: string;
  project_code?: string | null;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
};

export type OrderItemData = {
  key: string;
  designation: string;
  reference?: string | null;
  quantity: number;
  unitPriceInput?: string;
  unitPriceHtCents: number;
  lineTotalHtCents: number;
};

export type SupplierOption = { id: string; name: string };
export type SiteOption = { id: string; name: string; project_code?: string | null };

type PurchaseOrderDocumentProps = {
  // Mode
  editable?: boolean;

  // Header
  issuerName: string;
  issuerRole: string;
  issuerPhone?: string;
  issuerEmail?: string;
  orderDate: string;

  // Reference
  reference?: string;

  // Fournisseur
  supplier: SupplierData | null;
  supplierId?: string;
  onSupplierChange?: (id: string) => void;
  supplierOptions?: SupplierOption[];
  onSupplierCreate?: () => void;
  isSupplierCreateDisabled?: boolean;

  // Site de livraison
  deliverySite: DeliverySiteData | null;
  deliverySiteId?: string;
  onDeliverySiteChange?: (id: string) => void;
  siteOptions?: SiteOption[];
  onDeliverySiteCreate?: () => void;
  isDeliverySiteCreateDisabled?: boolean;

  // Date livraison
  expectedDeliveryDate?: string | null;
  onExpectedDeliveryDateChange?: (date: string) => void;

  // Notes
  notes?: string | null;
  onNotesChange?: (notes: string) => void;

  // Items
  items: OrderItemData[];
  onItemChange?: (key: string, field: string, value: string | number) => void;
  onItemRemove?: (key: string) => void;
  onItemAdd?: () => void;

  // Totaux
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const BLANK_DELIVERY_SITE_NAMES = new Set([
  "non applicable",
  "retrait comptoir",
]);

function shouldHideDeliveryDetails(site: DeliverySiteData | null): boolean {
  if (!site) return true;
  const normalizedName = site.name.trim().toLowerCase();
  return BLANK_DELIVERY_SITE_NAMES.has(normalizedName);
}

function hasDeliveryDetails(site: DeliverySiteData): boolean {
  return Boolean(
    site.address ||
      site.postal_code ||
      site.city ||
      site.contact_name ||
      site.contact_phone
  );
}

function isEmailLike(value: string | null | undefined): boolean {
  return Boolean(value?.trim().match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/));
}

function nameFromEmail(email: string): string {
  const localPart = email.split("@")[0]?.trim() ?? "";
  const parts = localPart.split(/[._-]+/).filter(Boolean);

  if (parts.length === 0) return "Utilisateur";

  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      return index === 0
        ? lower.charAt(0).toUpperCase() + lower.slice(1)
        : lower.toUpperCase();
    })
    .join(" ");
}

function normalizeIssuerDisplay({
  issuerName,
  issuerRole,
  issuerEmail,
}: {
  issuerName: string;
  issuerRole: string;
  issuerEmail?: string;
}) {
  const rawName = issuerName.trim();
  const rawRole = issuerRole.trim();
  const rawEmail = issuerEmail?.trim() ?? "";
  const nameIsEmail = isEmailLike(rawName);
  const displayEmail = rawEmail || (nameIsEmail ? rawName : "");
  const displayName = nameIsEmail ? nameFromEmail(rawName) : rawName || "Utilisateur";
  const displayRole =
    rawRole &&
    !isEmailLike(rawRole) &&
    rawRole !== rawName &&
    rawRole !== displayEmail
      ? rawRole
      : "";

  return {
    displayEmail,
    displayName,
    displayRole,
  };
}

function resolveItemDesignation(item: OrderItemData): string {
  const designation = item.designation?.trim();
  if (designation) return designation;
  const reference = item.reference?.trim();
  return reference || "-";
}

const MAX_NOTES_LINES = 3;

function clampLines(value: string, maxLines: number): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length <= maxLines) return normalized;
  return lines.slice(0, maxLines).join("\n");
}

export function PurchaseOrderDocument({
  editable = false,
  issuerName,
  issuerRole,
  issuerPhone,
  issuerEmail,
  orderDate,
  reference,
  supplier,
  supplierId,
  onSupplierChange,
  supplierOptions = [],
  onSupplierCreate,
  isSupplierCreateDisabled = false,
  deliverySite,
  deliverySiteId,
  onDeliverySiteChange,
  siteOptions = [],
  onDeliverySiteCreate,
  isDeliverySiteCreateDisabled = false,
  expectedDeliveryDate,
  onExpectedDeliveryDateChange,
  notes,
  onNotesChange,
  items,
  onItemChange,
  onItemRemove,
  onItemAdd,
  totalHtCents,
  totalTaxCents,
  totalTtcCents,
}: PurchaseOrderDocumentProps) {
  const showDeliveryDetails =
    deliverySite &&
    !shouldHideDeliveryDetails(deliverySite) &&
    hasDeliveryDetails(deliverySite);
  const issuerDisplay = normalizeIssuerDisplay({
    issuerName,
    issuerRole,
    issuerEmail,
  });

  return (
    <div className="document-page relative mx-auto my-5 flex flex-col overflow-hidden bg-white px-[50px] pb-[50px] pt-[40px] shadow-2xl print:m-0 print:shadow-none">
      {/* Sidebar accent bar */}
      <div className="sidebar-accent print-color-adjust" />

      {/* Header */}
      <div className="mb-6">
        {/* Ligne 1: Logo | espace | Établissement */}
        <div className="flex items-start justify-between">
          <Image
            src="/logo-hydro-express.jpg"
            alt="Hydro eXpress"
            width={250}
            height={100}
            className="h-[100px] w-auto object-contain print:h-[80px]"
            priority
          />
          <div className="max-w-[220px] rounded-lg border border-border bg-surface-subtle px-4 py-3 text-right text-sm print:px-3 print:py-2 print:text-xs">
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

        {/* Ligne 2: Émis par | Bon de Commande (centré) */}
        <div className="mt-5 grid grid-cols-[240px_minmax(0,1fr)_190px] items-start gap-x-5 print:mt-3 print:grid-cols-[220px_minmax(0,1fr)_160px] print:gap-x-3">
          {/* Émis par */}
          <div className="min-w-0 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Emis par
            </p>
            <p className="text-lg font-bold leading-tight text-brand-blue print:text-base">
              {issuerDisplay.displayName}
            </p>
            {issuerDisplay.displayRole && (
              <p className="text-muted-foreground">{issuerDisplay.displayRole}</p>
            )}
            {issuerPhone && <p className="text-muted-foreground">{issuerPhone}</p>}
            {issuerDisplay.displayEmail && (
              <p className="text-muted-foreground [overflow-wrap:anywhere]">
                {issuerDisplay.displayEmail}
              </p>
            )}
            <p className="mt-2 text-xs font-medium text-muted-foreground">
              Le {formatDate(orderDate)}
            </p>
          </div>

          {/* Titre - centré */}
          <div className="min-w-0 justify-self-center pt-3 text-center print:pt-2">
            <h2 className="mb-2 whitespace-nowrap text-[30px] font-black uppercase tracking-tight text-foreground print:mb-1 print:text-[25px]">
              Bon de Commande
            </h2>
            <p className="inline-block rounded-lg border border-border bg-surface-subtle px-4 py-1.5 font-mono text-xs uppercase tracking-wide text-muted-foreground">
              REF :{" "}
              <span className="font-bold text-brand-orange">
                {reference ?? "AUTO-GENEREE"}
              </span>
            </p>
          </div>

          {/* Espace pour équilibrer */}
          <div className="min-w-0" />
        </div>
      </div>

      {/* Info Grid: Supplier + Delivery */}
      <div className="mb-8 grid grid-cols-2 gap-8 print:mb-4 print:gap-7">
        {/* Supplier Box */}
        <div className="purchase-order-party-card flex flex-col justify-between rounded-xl border border-border bg-surface-subtle p-6 print:p-5">
          <div>
            <h4 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
              Fournisseur
            </h4>
            {editable ? (
              <div className="flex flex-col gap-2">
                <select
                  className="doc-select w-full text-2xl font-extrabold text-brand-blue"
                  value={supplierId ?? ""}
                  onChange={(e) => onSupplierChange?.(e.target.value)}
                  required
                >
                  <option value="">- Selectionner -</option>
                  {supplierOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {onSupplierCreate ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-brand-orange hover:underline disabled:opacity-60 disabled:hover:no-underline"
                    onClick={onSupplierCreate}
                    disabled={isSupplierCreateDisabled}
                  >
                    + Ajouter un fournisseur
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="mb-2 text-2xl font-extrabold leading-tight text-foreground">
                {supplier?.name ?? "-"}
              </p>
            )}
            {supplier && (
              <>
                {supplier.address && (
                  <p className="text-[15px] font-semibold leading-snug text-secondary-foreground">{supplier.address}</p>
                )}
                <p className="text-[15px] font-semibold leading-snug text-secondary-foreground">
                  {supplier.postal_code} {supplier.city}
                </p>
                {supplier.contact_name && (
                  <p className="mt-4 text-[15px] font-semibold leading-snug text-secondary-foreground">
                    Contact {supplier.contact_name}
                  </p>
                )}
                {supplier.phone && (
                  <p className="text-[15px] font-semibold leading-snug text-secondary-foreground">{supplier.phone}</p>
                )}
                {supplier.email && (
                  <p className="text-[15px] font-semibold leading-snug text-secondary-foreground">{supplier.email}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Delivery & Project Box */}
        <div className="purchase-order-party-card rounded-xl border border-border bg-surface-subtle p-6 print:p-5">
          <h4 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
            informations livraison
          </h4>
          <div className="space-y-4 print:space-y-2">
            <div>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Livraison le
                </p>
                {!editable &&
                  (expectedDeliveryDate === "TBD" ? (
                    <div className="delivery-badge-orange print-color-adjust">
                      <span className="text-base font-semibold uppercase tracking-wide">
                        À déterminer
                      </span>
                    </div>
                  ) : expectedDeliveryDate ? (
                    <div className="delivery-badge-orange print-color-adjust">
                      <span className="text-base font-semibold uppercase tracking-wide">
                        {formatDate(expectedDeliveryDate)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Non définie</p>
                  ))}
              </div>
              {editable ? (
                <div className="mt-2 flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-brand-orange focus:ring-brand-orange"
                      checked={expectedDeliveryDate === "TBD"}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onExpectedDeliveryDateChange?.("TBD");
                        } else {
                          onExpectedDeliveryDateChange?.("");
                        }
                      }}
                    />
                    <span className="text-sm font-medium text-slate-600">À déterminer</span>
                  </label>
                  {expectedDeliveryDate !== "TBD" && (
                    <input
                      type="date"
                      className="doc-input w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-semibold text-brand-blue"
                      value={expectedDeliveryDate ?? ""}
                      onChange={(e) => onExpectedDeliveryDateChange?.(e.target.value)}
                    />
                  )}
                </div>
              ) : null}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                adresse
              </p>
              {editable ? (
                <div className="mb-2 flex flex-col gap-2">
                <select
                  className="doc-select w-full text-base font-bold text-brand-blue"
                  value={deliverySiteId ?? ""}
                  onChange={(e) => onDeliverySiteChange?.(e.target.value)}
                  required
                >
                  <option value="">- Sélectionner -</option>
                  {siteOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.project_code ? `${s.project_code} - ` : ""}
                      {s.name}
                    </option>
                  ))}
                </select>
                  {onDeliverySiteCreate ? (
                    <button
                      type="button"
                      className="text-left text-sm font-semibold text-brand-orange hover:underline disabled:opacity-60 disabled:hover:no-underline"
                      onClick={onDeliverySiteCreate}
                      disabled={isDeliverySiteCreateDisabled}
                    >
                      + Ajouter un chantier
                    </button>
                  ) : null}
                </div>
              ) : null}
              {showDeliveryDetails && (
                <div className="text-[15px] font-medium leading-snug text-secondary-foreground">
                  {deliverySite.address && (
                    <p className="whitespace-pre-line">{deliverySite.address}</p>
                  )}
                  {(deliverySite.postal_code || deliverySite.city) && (
                    <p>
                      {deliverySite.postal_code} {deliverySite.city}
                    </p>
                  )}
                  <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    contact sur site
                  </p>
                  {deliverySite.contact_name || deliverySite.contact_phone ? (
                    <p>
                      {deliverySite.contact_name ?? deliverySite.contact_phone}
                      {deliverySite.contact_name && deliverySite.contact_phone
                        ? ` : ${deliverySite.contact_phone}`
                        : ""}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">-</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Notes / Instructions */}
      <div className="mb-6 rounded-xl border border-border bg-surface p-5 print:mb-4 print:p-3">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-blue print:mb-1">
            Instructions complémentaires
          </h4>
          {editable ? (
            <textarea
              className="doc-input min-h-[60px] w-full resize-none whitespace-pre-wrap text-sm leading-snug text-secondary-foreground print:min-h-[40px] print:text-xs"
              placeholder="Informations complémentaires, consignes de livraison..."
              rows={MAX_NOTES_LINES}
              value={notes ?? ""}
              onChange={(e) => {
                const nextValue = clampLines(e.target.value, MAX_NOTES_LINES);
                onNotesChange?.(nextValue);
              }}
            />
          ) : (
            <p className="min-h-[40px] whitespace-pre-wrap text-sm leading-snug text-secondary-foreground print:min-h-[32px] print:text-xs">
              {notes ?? ""}
            </p>
          )}
      </div>

      {/* Items Table */}
      <div className="mb-6 overflow-hidden rounded-xl border border-border shadow-sm print:mb-4">
        <table className="w-full">
          <thead>
            <tr className="table-head bg-brand-blue text-left text-xs font-bold uppercase tracking-wide text-white print-color-adjust">
              <th className="px-6 py-4 align-middle whitespace-nowrap print:px-4 print:py-2">Designation</th>
              <th className="w-20 px-3 py-4 text-center align-middle whitespace-nowrap print:px-2 print:py-2">Qte</th>
              <th className="w-28 px-3 py-4 text-right align-middle whitespace-nowrap print:px-2 print:py-2">P.U. HT</th>
              <th className="w-32 px-4 py-4 text-right align-middle whitespace-nowrap print:px-2 print:py-2">Total HT</th>
              {editable && <th className="w-12 px-4 py-4 align-middle"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-[15px] print:text-foreground">
            {items.map((item) => (
              <tr
                key={item.key}
                className={editable ? "doc-table-row-editable" : ""}
              >
                <td className="px-6 py-4 font-medium text-foreground break-words print:px-4 print:py-2 print:text-foreground">
                  {editable ? (
                    <input
                      type="text"
                      className="doc-input w-full"
                      placeholder="Designation"
                      value={item.designation}
                      onChange={(e) =>
                        onItemChange?.(item.key, "designation", e.target.value)
                      }
                      required
                    />
                  ) : (
                    resolveItemDesignation(item)
                  )}
                </td>
                <td className="w-20 px-3 py-4 text-center font-bold print:px-2 print:py-2">
                  {editable ? (
                    <input
                      type="number"
                      className="doc-input w-14 text-center"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        onItemChange?.(
                          item.key,
                          "quantity",
                          parseInt(e.target.value, 10) || 1
                        )
                      }
                    />
                  ) : (
                    item.quantity
                  )}
                </td>
                <td className="w-28 px-3 py-4 text-right print:px-2 print:py-2">
                  {editable ? (
                    <input
                      type="text"
                      className="doc-input w-20 text-right"
                      placeholder="0,00"
                      value={
                        item.unitPriceInput ??
                        (item.unitPriceHtCents
                          ? (item.unitPriceHtCents / 100)
                              .toFixed(2)
                              .replace(".", ",")
                          : "")
                      }
                      onChange={(e) =>
                        onItemChange?.(item.key, "unitPriceEuros", e.target.value)
                      }
                    />
                  ) : (
                    formatEUR(item.unitPriceHtCents)
                  )}
                </td>
                <td className="w-32 px-4 py-4 text-right font-bold print:px-2 print:py-2">
                  {formatEUR(item.lineTotalHtCents)}
                </td>
                {editable && (
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      className="doc-remove-btn text-danger hover:text-danger"
                      onClick={() => onItemRemove?.(item.key)}
                      title="Supprimer"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {editable && (
          <div className="border-t border-border bg-surface-subtle px-6 py-3">
            <button
              type="button"
              className="text-sm font-medium text-brand-orange hover:underline"
              onClick={onItemAdd}
            >
              + Ajouter une ligne
            </button>
          </div>
        )}
      </div>

      {/* Financial Summary */}
      <div className="mb-8 flex justify-end print:mb-4">
        <div className="w-full max-w-[320px] space-y-2">
          {/* Totals Table */}
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Total HT - Highlighted for B2B */}
            <div className="flex justify-between items-center px-5 py-3 bg-brand-blue print-color-adjust">
              <span className="text-xs font-bold uppercase tracking-wide text-white/80">
                Total HT
              </span>
              <span className="text-xl font-bold text-white">
                {formatEUR(totalHtCents)}
              </span>
            </div>
            {/* TVA */}
            <div className="flex justify-between items-center px-5 py-2 bg-surface-subtle border-b border-border">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                TVA
              </span>
              <span className="text-sm font-medium text-slate-600">
                {formatEUR(totalTaxCents)}
              </span>
            </div>
            {/* Total TTC */}
            <div className="flex justify-between items-center px-5 py-2 bg-surface-subtle">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total TTC
              </span>
              <span className="text-sm font-semibold text-slate-600">
                {formatEUR(totalTtcCents)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Note */}
      <div className="note-container mb-12 rounded-r-xl p-5 print-color-adjust print:mb-4 print:p-3">
        <div className="flex items-center gap-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-orange/15 text-brand-orange">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
          <p className="text-sm font-medium leading-relaxed text-slate-600">
            Merci de confirmer la bonne prise en compte de ce bon de commande et
            de valider les dates de livraison le cas échéant.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="purchase-order-footer mt-auto border-t border-border pt-5 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground print:pt-3">
        <p className="mb-1">Siège social : 17 rue Dupin 75006 Paris</p>
        <p>
          SIRET {COMPANY_INFO.legal.siret} - TVA {COMPANY_INFO.legal.vat}
        </p>
      </div>
    </div>
  );
}
