"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { PurchaseOrderStatusUpdater } from "@/components/PurchaseOrderStatusUpdater";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCentsInput, formatEUR, parseEuroToCents } from "@/lib/money";
import { computeLineTotals } from "@/lib/order-calculations";
import {
  affaireDirectStatuses,
  formatOrderDay,
  formatPriceLot,
  refusalMessage,
  type OrderStatus,
} from "@/lib/purchase-orders/lifecycle";

/**
 * Ordering and receiving an order of an affaire (TI-691, lot 2 « l'achat », delivery 3b-1). A draft is confirmed once
 * passed, at its real prices, with the supplier's confirmation as proof; a confirmed order is received whole, dated,
 * with a note for what is still to come. Once ordered, its status no longer changes directly.
 */

const PRICE_LOTS = [1, 10, 100, 1000] as const;
const PROOF_MISSING = "Joignez la confirmation du fournisseur (bon, e-mail ou capture) pour confirmer la commande.";
const PROOF_NAME = "Confirmation de commande";
/** What the devis bucket keeps (003_create_devis_storage.sql): PDF and three image types, 10 MB at most. */
const PROOF_TYPES = "application/pdf,image/png,image/jpeg,image/webp";
const PROOF_REFUSED =
  "La confirmation du fournisseur n’a pas pu être jointe : envoyez un PDF ou une image PNG, JPEG ou WebP de 10 Mo au plus.";
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type UploadedProof = { file: File; id: string };

export type OrderLifecycleLine = {
  id: string;
  position: number;
  designation: string;
  quantity: number;
  unit: string | null;
  unitPriceHtCents: number;
  pricePer: number;
  taxRateBp: number;
  kind: "article" | "shipping" | "discount";
  /** The line comes from a material request: its price is the retained quote's. */
  fromRequest?: boolean;
};

export type OrderLifecycleProps = {
  orderId: string;
  reference: string;
  status: OrderStatus;
  editRevision: number;
  orderDate: string;
  expectedDeliveryDate: string | null;
  lines: OrderLifecycleLine[];
  /** The documents joined to the order, any of which may be named as the proof. */
  documents: Array<{ id: string; name: string }>;
  confirmation: { documentId: string; documentName: string; supplierReference: string | null } | null;
  reception: { receivedOn: string; note: string | null } | null;
  /** Today in Paris, AAAA-MM-JJ (from the server, so the page and the database agree on the day). */
  today: string;
};

export function OrderLifecycle(props: OrderLifecycleProps) {
  const { status, confirmation, reception, orderDate } = props;
  const [confirming, setConfirming] = useState(false);
  const [receiving, setReceiving] = useState(false);
  // The proof once sent, kept while the page lives: a retry, even after closing the dialog, names it again.
  const [uploadedProof, setUploadedProof] = useState<UploadedProof | null>(null);
  const direct = affaireDirectStatuses(status);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {direct.length > 1 ? <PurchaseOrderStatusUpdater orderId={props.orderId} status={status} statuses={direct} /> : null}
        {status === "draft" ? (
          <Button variant="primary" size="lg" type="button" onClick={() => setConfirming(true)}>
            Confirmer la commande…
          </Button>
        ) : null}
        {status === "confirmed" ? (
          <Button variant="primary" size="lg" type="button" onClick={() => setReceiving(true)}>
            Enregistrer la réception…
          </Button>
        ) : null}
      </div>
      {confirmation && (status === "confirmed" || status === "received") ? (
        <p className="text-sm text-muted-foreground">
          {[
            `Commandée le ${formatOrderDay(orderDate)}`,
            confirmation.supplierReference ? `référence du fournisseur ${confirmation.supplierReference}` : null,
            `preuve : ${confirmation.documentName}`,
          ].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {reception && status === "received" ? (
        <p className="text-sm text-muted-foreground">
          {[`Reçue le ${formatOrderDay(reception.receivedOn)}`, reception.note ? `reste à venir : ${reception.note}` : null]
            .filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {confirming ? (
        <ConfirmationDialog {...props} uploadedProof={uploadedProof} onUploaded={setUploadedProof}
          onClose={() => setConfirming(false)} />
      ) : null}
      {receiving ? <ReceptionDialog {...props} onClose={() => setReceiving(false)} /> : null}
    </div>
  );
}

type LineDraft = { price: string; pricePer: number };

type ConfirmationDialogProps = OrderLifecycleProps & {
  uploadedProof: UploadedProof | null;
  onUploaded: (proof: UploadedProof) => void;
  onClose: () => void;
};

function ConfirmationDialog({
  orderId, reference, editRevision, expectedDeliveryDate, lines, documents, today, uploadedProof, onUploaded, onClose,
}: ConfirmationDialogProps) {
  const router = useRouter();
  const fileId = useId();
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() => Object.fromEntries(
    lines.map((line) => [line.id, { price: formatCentsInput(line.unitPriceHtCents), pricePer: line.pricePer }]),
  ));
  const [orderedOn, setOrderedOn] = useState(today);
  // A delivery « À déterminer » (TBD) shows no date; left empty, it stays as it is.
  const deliveryIsDay = ISO_DAY.test(expectedDeliveryDate ?? "");
  const [deliveryOn, setDeliveryOn] = useState(deliveryIsDay ? expectedDeliveryDate ?? "" : "");
  const [supplierReference, setSupplierReference] = useState("");
  const [documentId, setDocumentId] = useState(uploadedProof?.id ?? "");
  const [newFile, setNewFile] = useState<File | null>(null);
  const proofChoices = uploadedProof && !documents.some((document) => document.id === uploadedProof.id)
    ? [...documents, { id: uploadedProof.id, name: PROOF_NAME }]
    : documents;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const priced = useMemo(() => lines.map((line) => {
    const draft = drafts[line.id];
    const cents = parseEuroToCents(draft.price);
    const valid = cents !== null && Number.isInteger(cents) && cents >= 0;
    let totalHt: number | null = null;
    let tooLarge = false;
    if (valid) {
      try {
        totalHt = computeLineTotals({
          quantity: line.quantity, unitPriceHtCents: cents, taxRateBp: line.taxRateBp, pricePer: draft.pricePer, kind: line.kind,
        }).lineTotalHtCents;
      } catch {
        // Beyond what an order holds (a price or a line amount over 21 474 836,47 €).
        tooLarge = true;
      }
    }
    return { line, cents: valid ? cents : null, pricePer: draft.pricePer, totalHt, tooLarge };
  }), [drafts, lines]);
  const totalHt = priced.every((entry) => entry.totalHt !== null)
    ? priced.reduce((sum, entry) => sum + (entry.totalHt ?? 0), 0)
    : null;

  async function proofId(): Promise<string | null> {
    if (!newFile) return documentId || null;
    if (uploadedProof?.file === newFile) return uploadedProof.id;
    const form = new FormData();
    form.set("file", newFile);
    form.set("name", PROOF_NAME);
    const response = await fetch(`/api/purchase-orders/${orderId}/devis`, { method: "POST", body: form });
    // The route answers storage's own words (in English): the screen says what it accepts instead.
    if (!response.ok) throw new Error(PROOF_REFUSED);
    const body = (await response.json().catch(() => null)) as { item?: { id?: unknown } } | null;
    if (typeof body?.item?.id !== "string") throw new Error(PROOF_REFUSED);
    onUploaded({ file: newFile, id: body.item.id });
    return body.item.id;
  }

  async function submit() {
    setError(null);
    const invalid = priced.find((entry) => entry.cents === null);
    if (invalid) {
      setError(`Ligne ${invalid.line.position} : saisissez un prix HT, par exemple 12,34.`);
      return;
    }
    const tooLarge = priced.find((entry) => entry.tooLarge);
    if (tooLarge) {
      setError(`Ligne ${tooLarge.line.position} : le montant dépasse la capacité d’une commande.`);
      return;
    }
    if (!newFile && !documentId) {
      setError(PROOF_MISSING);
      return;
    }
    setSaving(true);
    try {
      const proof = await proofId();
      if (!proof) throw new Error(PROOF_MISSING);
      const response = await fetch(`/api/purchase-orders/${orderId}/confirmation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_revision: editRevision,
          ordered_on: orderedOn,
          // A day given; a day cleared; nothing when the delivery was still to be determined and stays so.
          ...(deliveryOn ? { expected_delivery_date: deliveryOn } : deliveryIsDay ? { expected_delivery_date: null } : {}),
          supplier_reference: supplierReference.trim() || null,
          document_id: proof,
          lines: priced.map((entry) => ({ id: entry.line.id, unit_price_ht_cents: entry.cents, price_per: entry.pricePer })),
        }),
      });
      if (!response.ok) throw new Error(await refusalMessage(response, "La commande n’a pas pu être confirmée. Réessayez."));
      onClose();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La commande n’a pas pu être confirmée. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Confirmer la commande {reference}</DialogTitle>
          <DialogDescription>
            Saisissez les prix que le fournisseur a confirmés et joignez sa confirmation (PDF ou image PNG, JPEG ou WebP).
            Une fois confirmé, le bon ne change plus.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fileId}-ordered`}>Date de commande</Label>
            <Input id={`${fileId}-ordered`} type="date" max={today} value={orderedOn} onChange={(event) => setOrderedOn(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fileId}-delivery`}>Livraison prévue</Label>
            <Input id={`${fileId}-delivery`} type="date" min={orderedOn} value={deliveryOn} onChange={(event) => setDeliveryOn(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fileId}-reference`}>Référence du fournisseur</Label>
            <Input id={`${fileId}-reference`} maxLength={120} value={supplierReference}
              onChange={(event) => setSupplierReference(event.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fileId}-proof`}>Preuve de commande</Label>
            <NativeSelect id={`${fileId}-proof`} value={documentId} disabled={newFile !== null}
              onChange={(event) => setDocumentId(event.target.value)}>
              <option value="">{newFile ? `Nouveau fichier : ${newFile.name}` : "Choisir un document joint…"}</option>
              {proofChoices.map((document) => <option key={document.id} value={document.id}>{document.name}</option>)}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${fileId}-file`}>Ajouter la confirmation du fournisseur</Label>
            <Input id={`${fileId}-file`} type="file" accept={PROOF_TYPES}
              onChange={(event) => setNewFile(event.target.files?.[0] ?? null)} />
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1 font-medium">Ligne</th>
              <th className="py-1 font-medium">Quantité</th>
              <th className="py-1 font-medium">Prix réel HT</th>
              <th className="py-1 font-medium">Lot</th>
              <th className="py-1 text-right font-medium">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {priced.map(({ line, totalHt: lineTotal, pricePer }) => (
              <tr key={line.id} className="border-t border-border align-top">
                <td className="py-2 pr-2">
                  <span className="font-medium">{line.position}. {line.designation}</span>
                  <span className="block text-xs text-muted-foreground">
                    {line.fromRequest ? "Prix du devis" : "Prix du brouillon"} : {formatEUR(line.unitPriceHtCents)}
                    {line.pricePer === 1 ? "" : ` ${formatPriceLot(line.pricePer)}`}
                  </span>
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">{line.quantity.toLocaleString("fr-FR")} {line.unit ?? ""}</td>
                <td className="py-2 pr-2">
                  <Input aria-label={`Prix réel HT, ligne ${line.position}`} inputMode="decimal" size="sm"
                    aria-invalid={parseEuroToCents(drafts[line.id].price) === null || undefined}
                    value={drafts[line.id].price}
                    onChange={(event) => {
                      const price = event.target.value;
                      setDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], price } }));
                    }} />
                </td>
                <td className="py-2 pr-2">
                  <NativeSelect aria-label={`Lot, ligne ${line.position}`} size="sm" value={String(pricePer)}
                    disabled={line.kind !== "article"}
                    onChange={(event) => {
                      const per = Number(event.target.value);
                      setDrafts((current) => ({ ...current, [line.id]: { ...current[line.id], pricePer: per } }));
                    }}>
                    {PRICE_LOTS.map((per) => <option key={per} value={per}>{per === 1 ? "pour 1" : formatPriceLot(per)}</option>)}
                  </NativeSelect>
                </td>
                <td className="py-2 text-right whitespace-nowrap" data-testid={`confirmation-line-total-${line.id}`}>
                  {lineTotal === null ? "—" : formatEUR(lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="flex justify-end gap-3 text-sm">
          <dt className="text-muted-foreground">Total HT au prix réel</dt>
          <dd className="font-semibold">{totalHt === null ? "—" : formatEUR(totalHt)}</dd>
        </dl>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="lg" type="button" />}>Annuler</DialogClose>
          <Button variant="primary" size="lg" type="button" loading={saving} onClick={() => void submit()}>
            Confirmer la commande
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceptionDialog({ orderId, reference, editRevision, orderDate, today, onClose }: OrderLifecycleProps & { onClose: () => void }) {
  const router = useRouter();
  const fieldId = useId();
  const [receivedOn, setReceivedOn] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/purchase-orders/${orderId}/reception`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_revision: editRevision, received_on: receivedOn, note: note.trim() || null }),
      });
      if (!response.ok) throw new Error(await refusalMessage(response, "La réception n’a pas pu être enregistrée. Réessayez."));
      onClose();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La réception n’a pas pu être enregistrée. Réessayez.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Réception de {reference}</DialogTitle>
          <DialogDescription>Le bon est reçu en entier. Notez ce qui reste à venir, s’il manque quelque chose.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-day`}>Date de réception</Label>
          <Input id={`${fieldId}-day`} type="date" min={orderDate} max={today} value={receivedOn}
            onChange={(event) => setReceivedOn(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-note`}>Reste à venir (facultatif)</Label>
          <Textarea id={`${fieldId}-note`} maxLength={2000} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="lg" type="button" />}>Annuler</DialogClose>
          <Button variant="primary" size="lg" type="button" loading={saving} onClick={() => void submit()}>
            Enregistrer la réception
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
