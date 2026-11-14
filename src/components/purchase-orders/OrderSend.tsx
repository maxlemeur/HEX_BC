"use client";

import { MailIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import { refusalMessage } from "@/lib/purchase-orders/lifecycle";
import {
  describeSend,
  PURCHASE_ORDER_SEND_MESSAGE_MAX,
  PURCHASE_ORDER_SEND_SUBJECT_MAX,
  type PurchaseOrderSendRecord,
  type PurchaseOrderSendRouting,
} from "@/lib/purchase-orders/send";

/**
 * Sending a draft purchase order to its supplier by e-mail, the order attached as a PDF: the user reads and corrects
 * the recipient, the subject and the message, then sends. The order becomes « envoyée » only when the e-mail provider
 * accepted the message; any refusal says what to fix and leaves the draft as it is. Sending is optional.
 */

export type OrderSendProps = {
  orderId: string;
  reference: string;
  editRevision: number;
  supplierName: string | null;
  /** The address of the supplier's record, proposed as the recipient. */
  supplierEmail: string | null;
  defaultSubject: string;
  defaultMessage: string;
  attachmentFilename: string;
  /** Where the server's e-mails go, said before sending. */
  routing: PurchaseOrderSendRouting;
  /** The step of the moment on an order of an affaire (TI-691): the send is then its main action. */
  primary?: boolean;
};

const FALLBACK = "Le bon n’a pas pu être envoyé. Il reste en brouillon : réessayez.";

export function OrderSendButton(props: OrderSendProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={props.primary ? "primary" : "outline"} size="lg" type="button" onClick={() => setOpen(true)}>
        <MailIcon aria-hidden="true" />
        Envoyer au fournisseur…
      </Button>
      {open ? <OrderSendDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function OrderSendDialog({
  orderId, reference, editRevision, supplierName, supplierEmail, defaultSubject, defaultMessage, attachmentFilename, routing, onClose,
}: OrderSendProps & { onClose: () => void }) {
  const router = useRouter();
  const fieldId = useId();
  const [recipient, setRecipient] = useState(supplierEmail ?? "");
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultMessage);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // One key per send asked: a request whose answer never came is asked again with the same key, and never sends twice.
  const key = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) return;
    setError(null);
    if (!recipient.trim()) {
      setError(supplierName
        ? `${supplierName} n’a pas d’adresse e-mail : saisissez le destinataire, ou renseignez l’adresse sur la fiche du fournisseur.`
        : "Saisissez l’adresse e-mail du destinataire.");
      return;
    }
    if (!subject.trim()) {
      setError("Saisissez l’objet du message.");
      return;
    }
    inFlight.current = true;
    setSending(true);
    key.current ??= crypto.randomUUID();
    try {
      let response: Response;
      try {
        response = await fetch(`/api/purchase-orders/${orderId}/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_revision: editRevision, idempotency_key: key.current, recipient: recipient.trim(), subject: subject.trim(), message,
          }),
        });
      } catch {
        setError("La réponse du serveur n’est pas arrivée. Vérifiez votre connexion puis renvoyez : le message ne partira pas deux fois.");
        return;
      }
      // An answer, even a refusal, settles this request: the next click is a new one.
      key.current = null;
      if (response.ok) onClose();
      else setError(await refusalMessage(response, FALLBACK));
      // The order's status, its revision and its sends as they now stand.
      router.refresh();
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !sending) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Envoyer le bon {reference} au fournisseur</DialogTitle>
          <DialogDescription>
            Le bon part par e-mail, en pièce jointe PDF ({attachmentFilename}). Il passe « Envoyée » dès que le service
            d’e-mail a accepté le message.
          </DialogDescription>
        </DialogHeader>
        {routing === "redirect" ? (
          <Alert variant="info">
            Mode test : les e-mails sont redirigés vers la boîte de test. Le fournisseur ne recevra rien ; son adresse
            apparaîtra dans l’objet du message reçu par la boîte de test.
          </Alert>
        ) : null}
        {routing === "unconfigured" ? (
          <Alert variant="warning">
            L’envoi d’e-mails n’est pas configuré sur ce serveur : l’envoi sera refusé et le bon restera en brouillon.
          </Alert>
        ) : null}
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-recipient`}>Destinataire</Label>
          <Input id={`${fieldId}-recipient`} type="email" autoComplete="off" maxLength={320} value={recipient}
            placeholder="adresse@fournisseur.fr" onChange={(event) => setRecipient(event.target.value)} />
          {supplierEmail ? null : (
            <p className="text-xs text-muted-foreground">
              {supplierName ?? "Ce fournisseur"} n’a pas d’adresse e-mail sur sa fiche.{" "}
              <Link href="/dashboard/suppliers" className="font-medium text-primary underline underline-offset-2">
                Ouvrir les fournisseurs
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-subject`}>Objet</Label>
          <Input id={`${fieldId}-subject`} maxLength={PURCHASE_ORDER_SEND_SUBJECT_MAX} value={subject}
            onChange={(event) => setSubject(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${fieldId}-message`}>Message</Label>
          <Textarea id={`${fieldId}-message`} rows={9} maxLength={PURCHASE_ORDER_SEND_MESSAGE_MAX} value={message}
            onChange={(event) => setMessage(event.target.value)} />
        </div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="lg" type="button" disabled={sending} />}>Annuler</DialogClose>
          <Button variant="primary" size="lg" type="button" loading={sending} onClick={() => void submit()}>
            Envoyer le bon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The sends of an order, the latest first: who, when, to whom, and whether the supplier really received it. */
export function OrderSendHistory({ sends }: Readonly<{ sends: PurchaseOrderSendRecord[] }>) {
  if (sends.length === 0) return null;
  return (
    <ul aria-label="Envois au fournisseur" className="flex flex-col gap-1 text-sm text-muted-foreground">
      {sends.map((send) => (
        <li key={send.id} data-send-status={send.status}
          className={send.status === "unconfirmed" || send.status === "failed" ? "text-warning" : undefined}>
          {describeSend(send)}
        </li>
      ))}
    </ul>
  );
}
