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
  reference?: string | null;
  designation: string;
  quantity: number;
  unitPriceHtCents: number;
  lineTotalHtCents: number;
};

export type SupplierOption = { id: string; name: string };
export type SiteOption = { id: string; name: string; project_code?: string | null };
export type ProductOption = {
  id: string;
  designation: string;
  reference?: string | null;
  unit_price_cents: number;
  tax_rate_bp: number;
};

type PurchaseOrderDocumentProps = {
  // Mode
  editable?: boolean;

  // Header
  issuerName: string;
  issuerRole: string;
  orderDate: string;

  // Reference
  reference?: string;

  // Fournisseur
  supplier: SupplierData | null;
  supplierId?: string;
  onSupplierChange?: (id: string) => void;
  supplierOptions?: SupplierOption[];

  // Site de livraison
  deliverySite: DeliverySiteData | null;
  deliverySiteId?: string;
  onDeliverySiteChange?: (id: string) => void;
  siteOptions?: SiteOption[];

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
  productOptions?: ProductOption[];
  onProductSelect?: (itemKey: string, productId: string) => void;

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

export function PurchaseOrderDocument({
  editable = false,
  issuerName,
  issuerRole,
  orderDate,
  reference,
  supplier,
  supplierId,
  onSupplierChange,
  supplierOptions = [],
  deliverySite,
  deliverySiteId,
  onDeliverySiteChange,
  siteOptions = [],
  expectedDeliveryDate,
  onExpectedDeliveryDateChange,
  notes,
  onNotesChange,
  items,
  onItemChange,
  onItemRemove,
  onItemAdd,
  productOptions = [],
  onProductSelect,
  totalHtCents,
  totalTaxCents,
  totalTtcCents,
}: PurchaseOrderDocumentProps) {
  return (
    <div className="document-page relative mx-auto my-5 overflow-hidden bg-white p-[50px] shadow-2xl print:m-0 print:p-10 print:shadow-none">
      {/* Sidebar accent bar */}
      <div className="sidebar-accent print-color-adjust" />

      {/* Header */}
      <div className="mb-12 flex items-start justify-between">
        {/* Left: Logo and issuer info */}
        <div className="flex flex-col">
          <div className="mb-4">
            <Image
              src="/logo-hydro-express.jpg"
              alt="Hydro eXpress"
              width={200}
              height={80}
              className="h-20 w-auto"
              priority
            />
          </div>

          <div className="mt-6 text-sm">
            <p className="mb-2 font-bold italic text-gray-800 underline underline-offset-4">
              Emis par :
            </p>
            <p className="text-lg font-bold text-brand-blue">{issuerName}</p>
            <p className="text-sm italic text-slate-500">{issuerRole}</p>
            <p className="mt-3 text-xs font-semibold italic text-gray-400">
              Le {formatDate(orderDate)}
            </p>
          </div>
        </div>

        {/* Right: Company info box */}
        <div className="min-w-[280px] rounded-xl border border-slate-200 bg-brand-bg p-5 text-right">
          <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wider text-brand-blue">
            {COMPANY_INFO.name}
          </h3>
          <p className="text-sm font-medium italic tracking-tight text-slate-600">
            {COMPANY_INFO.address.street}
          </p>
          <p className="text-sm font-medium italic tracking-tight text-slate-600">
            {COMPANY_INFO.address.postalCode} {COMPANY_INFO.address.city}
          </p>
          <div className="mt-2">
            <p className="text-sm font-medium italic tracking-tight text-slate-600">
              {COMPANY_INFO.phone.landline}
            </p>
            <p className="text-sm font-medium italic tracking-tight text-slate-600">
              {COMPANY_INFO.phone.mobile}
            </p>
          </div>
        </div>
      </div>

      {/* Document Title & Reference */}
      <div className="mb-10 text-center">
        <h2 className="mb-4 text-4xl font-black uppercase tracking-tight text-slate-800">
          Bon de Commande
        </h2>
        <p className="inline-block rounded-full border border-slate-100 bg-slate-50 px-8 py-2 font-mono text-sm uppercase tracking-widest text-slate-400">
          REF :{" "}
          <span className="font-bold text-brand-orange">
            {reference ?? "AUTO-GENEREE"}
          </span>
        </p>
      </div>

      {/* Info Grid: Supplier + Delivery */}
      <div className="mb-8 grid grid-cols-2 gap-8">
        {/* Supplier Box */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-100 bg-brand-bg p-6">
          <div>
            <h4 className="mb-4 text-[10px] font-black italic uppercase tracking-widest text-brand-orange">
              Fournisseur
            </h4>
            {editable ? (
              <select
                className="doc-select mb-2 w-full text-2xl font-extrabold text-brand-blue"
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
            ) : (
              <p className="mb-1 text-2xl font-extrabold text-brand-blue">
                {supplier?.name ?? "-"}
              </p>
            )}
            {supplier && (
              <>
                {supplier.address && (
                  <p className="font-medium text-slate-500">{supplier.address}</p>
                )}
                <p className="font-medium text-slate-500">
                  {supplier.postal_code} {supplier.city}
                </p>
                {supplier.contact_name && (
                  <p className="mt-2 font-medium text-slate-500">
                    Contact: {supplier.contact_name}
                  </p>
                )}
                {supplier.phone && (
                  <p className="font-medium text-slate-500">{supplier.phone}</p>
                )}
                {supplier.email && (
                  <p className="font-medium text-slate-500">{supplier.email}</p>
                )}
              </>
            )}
          </div>
        </div>

        {/* Delivery & Project Box */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h4 className="mb-4 text-[10px] font-black italic uppercase tracking-widest text-slate-400">
            Livraison & Projet
          </h4>
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase text-slate-400">
                Date souhaitee :
              </p>
              {editable ? (
                <input
                  type="date"
                  className="doc-input delivery-badge-orange w-full text-lg font-black uppercase tracking-tight print-color-adjust"
                  value={expectedDeliveryDate ?? ""}
                  onChange={(e) => onExpectedDeliveryDateChange?.(e.target.value)}
                />
              ) : expectedDeliveryDate ? (
                <div className="delivery-badge-orange print-color-adjust">
                  <span className="text-lg font-black uppercase tracking-tight">
                    Le {formatDate(expectedDeliveryDate)}
                  </span>
                </div>
              ) : (
                <p className="text-sm italic text-slate-400">Non definie</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-[10px] font-bold italic uppercase tracking-wide text-slate-400">
                Chantier & Contacts :
              </p>
              {editable ? (
                <select
                  className="doc-select mb-2 w-full text-lg font-extrabold uppercase italic text-brand-blue"
                  value={deliverySiteId ?? ""}
                  onChange={(e) => onDeliverySiteChange?.(e.target.value)}
                  required
                >
                  <option value="">- Selectionner -</option>
                  {siteOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.project_code ? `${s.project_code} - ` : ""}
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="mb-2 text-lg font-extrabold uppercase italic leading-tight text-brand-blue">
                  {deliverySite?.name ?? "-"}
                </p>
              )}
              {deliverySite && (
                <div className="text-sm font-medium italic leading-relaxed tracking-tight text-slate-600">
                  {deliverySite.address && <p>{deliverySite.address}</p>}
                  <p>
                    {deliverySite.postal_code} {deliverySite.city}
                  </p>
                  {deliverySite.contact_name && (
                    <p className="mt-1">
                      {deliverySite.contact_name}
                      {deliverySite.contact_phone &&
                        ` : ${deliverySite.contact_phone}`}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Notes / Instructions */}
      {(editable || notes) && (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
          <h4 className="mb-2 text-[10px] font-black uppercase tracking-widest text-brand-blue">
            Note / Instructions complementaires
          </h4>
          {editable ? (
            <textarea
              className="doc-input min-h-[60px] w-full whitespace-pre-wrap text-sm italic text-slate-700"
              placeholder="Informations complementaires, consignes de livraison..."
              value={notes ?? ""}
              onChange={(e) => onNotesChange?.(e.target.value)}
            />
          ) : (
            <p className="min-h-[40px] whitespace-pre-wrap text-sm italic text-slate-700">
              {notes}
            </p>
          )}
        </div>
      )}

      {/* Items Table */}
      <div className="mb-6 overflow-hidden rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="table-head bg-brand-blue text-left text-[10px] font-bold uppercase tracking-widest text-white print-color-adjust">
              {editable && <th className="px-4 py-4 w-48">Produit</th>}
              <th className="px-6 py-4">Reference</th>
              <th className="px-6 py-4">Designation</th>
              <th className="px-6 py-4 text-center">Qte</th>
              <th className="px-6 py-4 text-right">P.U. HT</th>
              <th className="px-6 py-4 text-right">Total HT</th>
              {editable && <th className="px-4 py-4 w-12"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {items.map((item) => (
              <tr
                key={item.key}
                className={editable ? "doc-table-row-editable" : ""}
              >
                {editable && (
                  <td className="px-4 py-3">
                    <select
                      className="doc-select w-full text-xs"
                      onChange={(e) => onProductSelect?.(item.key, e.target.value)}
                      defaultValue=""
                    >
                      <option value="">-</option>
                      {productOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.reference ? `${p.reference} - ` : ""}
                          {p.designation}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td className="px-6 py-4 font-mono text-xs text-slate-400">
                  {editable ? (
                    <input
                      type="text"
                      className="doc-input w-24"
                      placeholder="REF"
                      value={item.reference ?? ""}
                      onChange={(e) =>
                        onItemChange?.(item.key, "reference", e.target.value)
                      }
                    />
                  ) : (
                    item.reference ?? "-"
                  )}
                </td>
                <td className="px-6 py-4 font-medium text-slate-800">
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
                    item.designation
                  )}
                </td>
                <td className="px-6 py-4 text-center font-bold">
                  {editable ? (
                    <input
                      type="number"
                      className="doc-input w-16 text-center"
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
                <td className="px-6 py-4 text-right">
                  {editable ? (
                    <input
                      type="text"
                      className="doc-input w-24 text-right"
                      placeholder="0,00"
                      value={
                        item.unitPriceHtCents
                          ? (item.unitPriceHtCents / 100)
                              .toFixed(2)
                              .replace(".", ",")
                          : ""
                      }
                      onChange={(e) =>
                        onItemChange?.(item.key, "unitPriceEuros", e.target.value)
                      }
                    />
                  ) : (
                    formatEUR(item.unitPriceHtCents)
                  )}
                </td>
                <td className="px-6 py-4 text-right font-bold">
                  {formatEUR(item.lineTotalHtCents)}
                </td>
                {editable && (
                  <td className="px-4 py-4">
                    <button
                      type="button"
                      className="doc-remove-btn text-red-500 hover:text-red-700"
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
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-3">
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
      <div className="mb-8 flex justify-end">
        <div className="w-full max-w-[340px] space-y-3">
          {/* Total HT Badge */}
          <div className="delivery-badge-orange flex w-full items-center justify-between px-8 py-4 print-color-adjust">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">
              Total Net HT
            </span>
            <span className="text-3xl font-black">
              {formatEUR(totalHtCents)}
            </span>
          </div>

          {/* TVA & TTC */}
          <div className="flex flex-col gap-1.5 rounded-xl border border-slate-100 bg-slate-50 px-6 py-3">
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <span>TVA</span>
              <span className="text-slate-600">{formatEUR(totalTaxCents)}</span>
            </div>
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <span>Total TTC</span>
              <span className="text-slate-600">{formatEUR(totalTtcCents)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Note */}
      <div className="note-container mb-12 rounded-r-2xl p-6 print-color-adjust">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-orange/10 text-brand-orange">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </div>
          <p className="text-lg font-bold italic leading-snug text-slate-700">
            Merci de confirmer la bonne prise en compte de ce bon de commande et
            de valider les dates de livraison le cas echeant.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-10 left-16 right-16 border-t border-slate-100 pt-6 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <p className="mb-1">{COMPANY_INFO.name}</p>
        <p>SIRET {COMPANY_INFO.legal.siret}</p>
      </div>
    </div>
  );
}
