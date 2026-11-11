"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { foCostDetail } from "@/lib/estimates/fo-cost-detail";
import {
  readFoPriceOrigin,
  readSiteCostSource,
  siteCostSourceText,
  siteFoPriceOrigin,
  SITE_COST_DOCUMENT_MAX,
  SITE_COST_REFERENCE_MAX,
  SITE_COST_SUPPLIER_MAX,
} from "@/lib/estimates/fo-price-origin";
import { parseAmountCents } from "@/lib/numeric-input/parsers";
import type { EstimateItem, ItemPatch } from "@/components/estimates/components/estimate-editor-row/shared";

type PatchItem = (itemId: string, patch: ItemPatch, options?: { persist?: boolean }) => void;
/** Today on the user's calendar, not in UTC: an offer typed after midnight in Paris is dated that day. */
const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
const euros = (cents: number | null | undefined) => (Number(cents ?? 0) / 100).toFixed(2).replace(".", ",");

/** « Coût chantier : fournisseur · offre · date · pièce » of a line that holds one, else null. */
export function siteCostLabelOf(item: Pick<EstimateItem, "fo_price_origin">): string | null {
  const source = siteCostSourceText(item.fo_price_origin);
  return source ? `Coût chantier : ${source}` : null;
}

/**
 * TI-541. Supply cost of a v3 line, read factor by factor, with the source of a « coût chantier » when one is saved.
 * Shown in the line « … » menu; the form itself opens in `V3SiteCostDialog`, which the row renders outside the menu.
 * A POSE SEULE line (TI-539) may hold a small supply needed for the fitting, so it reads and takes a site cost too.
 */
export function V3SiteCostControl({ item, saleCoefficientFo, isReadOnly, onEditSiteCost }: {
  item: EstimateItem;
  saleCoefficientFo: string | number | null | undefined;
  isReadOnly: boolean;
  onEditSiteCost: () => void;
}) {
  const saved = readSiteCostSource(item.fo_price_origin);
  const detail = foCostDetail(item, { saleCoefficientFo });
  const lineLabel = item.title || "sans titre";
  const action = saved ? "Modifier le coût chantier" : "Saisir un coût chantier";
  return (
    <div role="group" aria-label={`Coût de fourniture de ${lineLabel}`} className="flex max-w-md flex-col gap-1 text-xs text-[var(--slate-700)]" data-testid="estimate-line-fo-cost">
      <p data-testid="estimate-line-fo-cost-detail">{detail.text}</p>
      {saved ? <p data-testid="estimate-line-site-cost-source">Source du coût chantier : {detail.source}</p> : null}
      {!isReadOnly ? (
        <button type="button" className="self-start font-medium text-[var(--brand-blue)] underline underline-offset-2"
          aria-label={`${action} pour ${lineLabel}`} onClick={onEditSiteCost}>
          {action}
        </button>
      ) : null}
    </div>
  );
}

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

/**
 * TI-541. The « coût chantier » of one line: a cost typed for this quote with its source. Saving writes the line
 * only; the catalogue, its offers and its reference price are never touched. A dialog, not the line menu: the menu
 * hangs under its line and a six-field form left its save button outside the window. Events are stopped at the
 * wrapper because a portal bubbles through the row that renders it, which would read them as grid gestures.
 */
export function V3SiteCostDialog({ item, open, isReadOnly, onClose, onPatchItem }: {
  item: EstimateItem;
  open: boolean;
  isReadOnly: boolean;
  onClose: () => void;
  onPatchItem: PatchItem;
}) {
  // A quote that turns read-only while the form is open closes it for good, instead of bringing it back empty later.
  useEffect(() => { if (open && isReadOnly) onClose(); }, [open, isReadOnly, onClose]);
  if (!open || isReadOnly) return null;
  return (
    <span hidden onClick={stop} onDoubleClick={stop} onMouseDown={stop} onPointerDown={stop} onContextMenu={stop}
      onKeyDown={(event) => { if (event.key !== "Escape") event.stopPropagation(); }}>
      <SiteCostForm item={item} onClose={onClose} onPatchItem={onPatchItem} />
    </span>
  );
}

function SiteCostForm({ item, onClose, onPatchItem }: { item: EstimateItem; onClose: () => void; onPatchItem: PatchItem }) {
  const formId = useId();
  const saved = readSiteCostSource(item.fo_price_origin);
  const savedTransport = readFoPriceOrigin(item.fo_price_origin)?.transport_mode ?? null;
  const [cost, setCost] = useState(saved ? euros(item.unit_price_ht_cents) : "");
  const [supplier, setSupplier] = useState(saved?.supplier ?? "");
  const [reference, setReference] = useState(saved?.offer_reference ?? "");
  const [date, setDate] = useState(saved?.offer_date ?? today());
  const [document, setDocument] = useState(saved?.document ?? "");
  const [transport, setTransport] = useState<"" | "included" | "excluded">(saved ? (savedTransport ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const lineLabel = item.title || "sans titre";

  const save = () => {
    const cents = parseAmountCents(cost);
    if (cents === null || cents <= 0) return setError("Saisissez le coût unitaire HT de l’offre.");
    const origin = siteFoPriceOrigin({ supplier, offerReference: reference, offerDate: date, document,
      transportIncluded: transport === "" ? null : transport === "included" });
    if (!origin) return setError("Indiquez le fournisseur et la date de l’offre.");
    onPatchItem(item.id, { unit_price_ht_cents: cents, selected_supplier_price_id: null, fo_price_origin: origin }, { persist: true });
    onClose();
  };
  const field = "flex flex-col gap-1 text-sm font-medium text-foreground";

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Coût chantier</DialogTitle>
          <DialogDescription>
            {lineLabel}. Ce coût vaut pour ce devis seulement. Le catalogue et son prix de référence ne changent pas.
          </DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-col gap-4" aria-label={`Coût chantier pour ${lineLabel}`} noValidate
          onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); save(); }}>
          <DialogBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={field} htmlFor={`${formId}-cost`}>Coût unitaire HT (€)
              <input id={`${formId}-cost`} className="estimate-input h-9 w-full font-normal" inputMode="decimal" required value={cost}
                onChange={(event) => setCost(event.target.value)} />
            </label>
            <label className={field} htmlFor={`${formId}-supplier`}>Fournisseur
              <input id={`${formId}-supplier`} className="estimate-input h-9 w-full font-normal" required maxLength={SITE_COST_SUPPLIER_MAX} value={supplier}
                onChange={(event) => setSupplier(event.target.value)} />
            </label>
            <label className={field} htmlFor={`${formId}-reference`}>Référence de l’offre
              <input id={`${formId}-reference`} className="estimate-input h-9 w-full font-normal" maxLength={SITE_COST_REFERENCE_MAX} value={reference}
                onChange={(event) => setReference(event.target.value)} />
            </label>
            <label className={field} htmlFor={`${formId}-date`}>Date de l’offre
              <input id={`${formId}-date`} className="estimate-input h-9 w-full font-normal" type="date" required value={date}
                onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className={field} htmlFor={`${formId}-document`}>Pièce (facultatif)
              <input id={`${formId}-document`} className="estimate-input h-9 w-full font-normal" maxLength={SITE_COST_DOCUMENT_MAX} value={document}
                onChange={(event) => setDocument(event.target.value)} />
            </label>
            <label className={field} htmlFor={`${formId}-transport`}>Transport
              <select id={`${formId}-transport`} className="estimate-input h-9 w-full py-0 font-normal" value={transport}
                onChange={(event) => setTransport(event.target.value as "" | "included" | "excluded")}>
                <option value="">Non précisé</option>
                <option value="included">Inclus dans l’offre</option>
                <option value="excluded">Hors transport</option>
              </select>
            </label>
            {error ? <p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" size="lg" onClick={onClose}>Annuler</Button>
            <Button type="submit" variant="primary" size="lg">Enregistrer le coût chantier</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
