"use client";

import { formatEUR } from "@/lib/money";
import { formatOrderQuantity } from "@/lib/purchase-orders/quantities";
import {
  BusinessDocumentBrandHeader,
  BusinessDocumentFooter,
  BusinessDocumentFrame,
} from "@/components/documents/BusinessDocumentPrimitives";
import { normalizeDocumentIssuerDisplay } from "@/lib/documents/issuer-display";

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
  quantityInput?: string;
  unit: string | null;
  priceUnit: string | null;
  unitReadOnly?: boolean;
  validationError?: string | null;
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
  supplierReadOnly?: boolean;
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
  totalsPending?: boolean;
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
  supplierReadOnly = false,
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
  totalsPending = false,
}: PurchaseOrderDocumentProps) {
  const showDeliveryDetails =
    deliverySite &&
    !shouldHideDeliveryDetails(deliverySite) &&
    hasDeliveryDetails(deliverySite);
  const issuerDisplay = normalizeDocumentIssuerDisplay({
    issuerName,
    issuerRole,
    issuerEmail,
  });

  return (
    <BusinessDocumentFrame>
      {/* Header */}
      <div className="mb-6">
        {/* Ligne 1: Logo | espace | Établissement */}
        <BusinessDocumentBrandHeader />

        {/* Ligne 2: Émis par | Bon de Commande (centré) */}
        <div className="mt-5 grid grid-cols-[240px_minmax(0,1fr)_190px] items-start gap-x-5 print:mt-3 print:grid-cols-[220px_minmax(0,1fr)_160px] print:gap-x-3">
          {/* Émis par */}
          <div className="min-w-0 text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Émis par
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
                {reference ?? "AUTO-GÉNÉRÉE"}
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
            <h3 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
              Fournisseur
            </h3>
            {editable ? (
              <div className="flex flex-col gap-2">
                <select
                  aria-label="Fournisseur"
                  aria-describedby={supplierReadOnly ? "purchase-order-supplier-readonly" : undefined}
                  className="doc-select w-full text-2xl font-extrabold text-brand-blue"
                  value={supplierId ?? ""}
                  onChange={(e) => onSupplierChange?.(e.target.value)}
                  disabled={supplierReadOnly}
                  required
                >
                  <option value="">- Sélectionner -</option>
                  {supplierOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {supplierReadOnly ? (
                  <p id="purchase-order-supplier-readonly" className="text-xs text-muted-foreground">
                    Fournisseur conservé depuis la préparation du devis
                  </p>
                ) : null}
                {onSupplierCreate ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-primary hover:underline disabled:opacity-60 disabled:hover:no-underline"
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
          <h3 className="mb-4 text-center text-xs font-bold uppercase tracking-wide text-brand-orange print:mb-2">
            informations livraison
          </h3>
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
                    <span className="text-sm font-medium text-foreground-secondary">Date de livraison à déterminer</span>
                  </label>
                  {expectedDeliveryDate !== "TBD" && (
                    <input
                      type="date"
                      aria-label="Date de livraison"
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
                  aria-label="Chantier de livraison"
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
                      className="text-left text-sm font-semibold text-primary hover:underline disabled:opacity-60 disabled:hover:no-underline"
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
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-blue print:mb-1">
            Instructions complémentaires
          </h3>
          {editable ? (
            <textarea
              aria-label="Instructions complémentaires"
              className="doc-input min-h-[60px] w-full resize-none whitespace-pre-wrap text-sm leading-snug text-secondary-foreground print:min-h-[40px] print:text-xs"
              placeholder="Informations complémentaires, consignes de livraison…"
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
      <div className="mb-6 overflow-x-auto rounded-xl border border-border shadow-sm print:mb-4">
        <table className="w-full">
          <thead>
            <tr className="table-head bg-brand-blue text-left text-xs font-bold uppercase tracking-wide text-white print-color-adjust">
              <th className="px-6 py-4 align-middle whitespace-nowrap print:px-4 print:py-2">Désignation</th>
              <th className="w-24 px-3 py-4 text-center align-middle whitespace-nowrap print:px-2 print:py-2">Qté</th>
              <th className="w-24 px-3 py-4 text-center align-middle whitespace-nowrap print:px-2 print:py-2">Unité</th>
              <th className="w-28 px-3 py-4 text-right align-middle whitespace-nowrap print:px-2 print:py-2">P.U. HT</th>
              <th className="w-32 px-4 py-4 text-right align-middle whitespace-nowrap print:px-2 print:py-2">Total HT</th>
              {editable && <th className="w-12 px-4 py-4 align-middle"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-[15px] print:text-foreground">
            {items.map((item, index) => (
              <tr
                key={item.key}
                className={editable ? "doc-table-row-editable" : ""}
              >
                <td className="px-6 py-4 font-medium text-foreground break-words print:px-4 print:py-2 print:text-foreground">
                  {editable ? (
                    <input
                      type="text"
                      className="doc-input w-full"
                      aria-label={`Désignation, ligne ${index + 1}`}
                      placeholder="Désignation"
                      value={item.designation}
                      onChange={(e) =>
                        onItemChange?.(item.key, "designation", e.target.value)
                      }
                      required
                    />
                  ) : (
                    resolveItemDesignation(item)
                  )}
                  {item.reference?.trim() && item.designation?.trim() ? (
                    <p className="mt-1 text-xs font-normal text-muted-foreground">Réf. {item.reference}</p>
                  ) : null}
                  {editable && item.validationError ? (
                    <p id={`order-line-error-${item.key}`} className="mt-1 text-xs font-normal text-danger">
                      Ligne {index + 1} : {item.validationError}
                    </p>
                  ) : null}
                </td>
                <td className="w-24 px-3 py-4 text-center font-bold print:px-2 print:py-2">
                  {editable ? (
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label={`Quantité, ligne ${index + 1}`}
                      aria-describedby={item.validationError ? `order-line-error-${item.key}` : undefined}
                      className="doc-input w-full min-w-16 text-center tabular-nums"
                      value={item.quantityInput ?? formatOrderQuantity(item.quantity)}
                      onChange={(e) => onItemChange?.(item.key, "quantity", e.target.value)}
                      required
                    />
                  ) : (
                    formatOrderQuantity(item.quantity)
                  )}
                </td>
                <td className="w-24 px-3 py-4 text-center text-sm print:px-2 print:py-2">
                  {editable && !item.unitReadOnly ? (
                    <input
                      type="text"
                      aria-label={`Unité, ligne ${index + 1}`}
                      aria-describedby={item.validationError ? `order-line-error-${item.key}` : undefined}
                      className="doc-input w-full min-w-16 text-center"
                      placeholder="Unité à confirmer"
                      value={item.unit ?? ""}
                      onChange={(e) => onItemChange?.(item.key, "unit", e.target.value)}
                    />
                  ) : (
                    <span title={editable && item.unitReadOnly ? "Unité conservée depuis le devis validé" : undefined}>
                      {item.unit || "Unité à confirmer"}
                    </span>
                  )}
                </td>
                <td className="w-28 px-3 py-4 text-right print:px-2 print:py-2">
                  {editable ? (
                    <input
                      type="text"
                      className="doc-input w-20 text-right"
                      aria-label={`Prix unitaire HT, ligne ${index + 1}`}
                      inputMode="decimal"
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
                  <p className="mt-1 text-xs font-normal text-muted-foreground">
                    {item.priceUnit ? `par ${item.priceUnit}` : "Unité du prix à confirmer"}
                  </p>
                </td>
                <td className="w-32 px-4 py-4 text-right font-bold print:px-2 print:py-2">
                  {item.validationError ? "À vérifier" : formatEUR(item.lineTotalHtCents)}
                </td>
                {editable && (
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      className="doc-remove-btn text-danger hover:text-danger"
                      onClick={() => onItemRemove?.(item.key)}
                      aria-label={`Supprimer la ligne ${index + 1}`}
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
                {totalsPending ? "À vérifier" : formatEUR(totalHtCents)}
              </span>
            </div>
            {/* TVA */}
            <div className="flex justify-between items-center px-5 py-2 bg-surface-subtle border-b border-border">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                TVA
              </span>
              <span className="text-sm font-medium text-slate-600">
                {totalsPending ? "À vérifier" : formatEUR(totalTaxCents)}
              </span>
            </div>
            {/* Total TTC */}
            <div className="flex justify-between items-center px-5 py-2 bg-surface-subtle">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total TTC
              </span>
              <span className="text-sm font-semibold text-slate-600">
                {totalsPending ? "À vérifier" : formatEUR(totalTtcCents)}
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
      <BusinessDocumentFooter />
    </BusinessDocumentFrame>
  );
}
