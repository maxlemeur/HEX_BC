"use client";

import { useId, useState, type KeyboardEvent } from "react";

import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { CHATGPT_REASONING_EFFORT_LABELS } from "@/lib/ai/chatgpt-model-preferences";
import { TAKEOFF_NANO_USD_PER_CENT } from "@/lib/takeoff/payment-choice";
import { TakeoffPaymentFields } from "../TakeoffPaymentFields";
import type { TakeoffPaymentSettings } from "../useTakeoffPaymentSettings";
import { ITEM_SET_ASIDE_REASONS, type ItemSetAsideReason } from "@/lib/takeoff/item-table";
import { ITEM_SET_ASIDE_NOTE, type ItemRemeasurePreview } from "@/lib/takeoff/item-table-contracts";
import {
  formatItemCount,
  ITEM_INELIGIBILITY_LABELS,
  ITEM_SET_ASIDE_REASON_LABELS,
} from "@/lib/takeoff/item-table-labels";
import { noteLength, noteText } from "@/lib/takeoff/rules/verification";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

/**
 * The confirmations of the table's gestures. Each one says its scope and how many items it writes on before anything is
 * sent; Enter confirms a complete form, Escape cancels. None of them forces anything.
 */

type Base = { scopeLabel: string; busy: boolean; onClose: () => void };

/** Enter confirms from a field or a choice (never from a button, which confirms by itself). */
export function confirmOnEnter(confirm: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" || event.shiftKey || (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    confirm();
  };
}

export function AcceptMeasuredDialog({ scopeLabel, busy, onClose, total, eligible, onConfirm }: Base & {
  total: number; eligible: number; onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Accepter les postes mesurés sans anomalie</DialogTitle>
          <DialogDescription>
            {scopeLabel} · {formatItemCount(eligible, "poste accepté", "postes acceptés")} sur{" "}
            {formatItemCount(total, "poste sélectionné", "postes sélectionnés")}. Les postes incertains, non trouvés, à
            vérifier ligne à ligne ou avec une hypothèse restent à vérifier. Rien n’est envoyé au devis.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose disabled={busy} render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={busy || eligible === 0} onClick={onConfirm}>
            Accepter {formatItemCount(eligible, "poste", "postes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SetAsideDialog({ scopeLabel, busy, onClose, total, eligible, answers, onConfirm }: Base & {
  total: number; eligible: number; answers: number; onConfirm: (reason: ItemSetAsideReason, note: string | null) => void;
}) {
  const noteId = useId();
  const [reason, setReason] = useState<ItemSetAsideReason | null>(null);
  const [note, setNote] = useState("");
  const length = noteLength(note);
  const complete = reason !== null && eligible > 0 && length <= ITEM_SET_ASIDE_NOTE.max
    && (reason !== "other" || length >= ITEM_SET_ASIDE_NOTE.min);
  const confirm = () => { if (complete && !busy) onConfirm(reason!, noteText(note) || null); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Écarter la sélection</DialogTitle>
          <DialogDescription>
            {scopeLabel} · {formatItemCount(eligible, "poste", "postes")} et {formatItemCount(answers, "lecture", "lectures")} écartés
            sur {formatItemCount(total, "poste sélectionné", "postes sélectionnés")}. Le motif est écrit sur chacun ; une
            réintégration reste possible et garde la trace. Une ligne déjà au devis n’est pas modifiée.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3" onKeyDown={confirmOnEnter(confirm)}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Motif, choisi une fois pour la sélection</legend>
            {ITEM_SET_ASIDE_REASONS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="poste-set-aside-reason" value={value} checked={reason === value}
                  onChange={() => setReason(value)} />
                {ITEM_SET_ASIDE_REASON_LABELS[value]}
              </label>
            ))}
          </fieldset>
          <Field>
            <FieldLabel htmlFor={noteId}>{reason === "other" ? "Note (obligatoire)" : "Note (facultative)"}</FieldLabel>
            <Textarea id={noteId} rows={2} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
            <FieldDescription>
              {reason === "other" ? `${ITEM_SET_ASIDE_NOTE.min} à ${ITEM_SET_ASIDE_NOTE.max} caractères.` : `${ITEM_SET_ASIDE_NOTE.max} caractères au plus.`}
            </FieldDescription>
          </Field>
        </div>
        <DialogFooter>
          <DialogClose disabled={busy} render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button variant="danger" disabled={!complete || busy} onClick={confirm}>
            Écarter {formatItemCount(eligible, "poste", "postes")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReinstateDialog({ scopeLabel, busy, onClose, eligible, onConfirm }: Base & { eligible: number; onConfirm: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Réintégrer les postes écartés</DialogTitle>
          <DialogDescription>
            {scopeLabel} · {formatItemCount(eligible, "poste réintégré", "postes réintégrés")}. Leur mise à l’écart reste dans
            l’historique ; ils redeviennent à vérifier.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose disabled={busy} render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={busy || eligible === 0} onClick={onConfirm}>Réintégrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemeasureDialog({ scopeLabel, busy, onClose, preview, loadError, onConfirm, payment, paymentStale, onReloadPayment }: Base & {
  preview: ItemRemeasurePreview | null;
  loadError: string | null;
  onConfirm: () => void;
  payment: TakeoffPaymentSettings;
  paymentStale?: boolean;
  onReloadPayment: () => void;
}) {
  const ready = preview?.subscription.state === "ready" ? preview.subscription : null;
  const reading = preview?.reading.state === "ready" ? preview.reading : null;
  const viaKey = payment.value.source === "personal_api_key";
  // The ceiling the server planned the request with, else the one the settings showed.
  const keyCeilingCents = viaKey ? preview?.payment?.maxCostCents ?? payment.data?.maxCostCents : undefined;
  const canConfirm = Boolean(payment.ready && !paymentStale && ready && reading && preview && !preview.running && preview.items.length > 0 && preview.plans.length > 0 && !busy);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Demander à l’IA de mesurer de nouveau la sélection</DialogTitle>
          <DialogDescription>
            {scopeLabel}. Une nouvelle demande d’analyse, à votre nom et {viaKey ? "avec votre clé API OpenAI" : "sur votre forfait ChatGPT"}, lit seulement ces postes
            sur ces plans. Les résultats précédents restent consultables ; leur acceptation ne passe pas à la nouvelle mesure.
          </DialogDescription>
        </DialogHeader>
        <TakeoffPaymentFields settings={payment} disabled={busy} stale={paymentStale} onReload={onReloadPayment} />
        {loadError ? <p className="text-sm text-danger" role="alert">{loadError}</p> : null}
        {!preview && !loadError ? <p className="text-sm text-muted-foreground" role="status">Préparation de la demande…</p> : null}
        {preview ? (
          <div className="space-y-3 text-sm" data-testid="poste-remeasure-preview">
            <p>
              {viaKey ? `Clé API utilisée : ${preview.payer.name ? `celle de ${preview.payer.name}` : "la vôtre"}`
                : `Forfait utilisé : ${preview.payer.name ? `celui de ${preview.payer.name}` : "le vôtre"}`} (vous confirmez la demande).
            </p>
            {ready && !payment.choice ? (
              <p>
                Réglage de Mon profil : {ready.model} · effort{" "}
                {ready.reasoningEffort ? CHATGPT_REASONING_EFFORT_LABELS[ready.reasoningEffort].toLocaleLowerCase("fr") : "par défaut"}.
                {/* The Mac reads a request with its payer's profile as it is: no effort is offered for one request alone. */}
                {" "}La demande l’utilise tel quel.
              </p>
            ) : !ready ? (
              <p className="text-danger" role="alert">{preview.subscription.state === "unavailable" ? preview.subscription.reason : null}</p>
            ) : null}
            <div>
              <p className="font-medium">{formatItemCount(preview.plans.length, "plan lu", "plans lus")}</p>
              <ul className="list-disc pl-5">{preview.plans.map((plan) => <li key={plan.key}>{plan.name}</li>)}</ul>
            </div>
            <div>
              <p className="font-medium">{formatItemCount(preview.items.length, "poste mesuré", "postes mesurés")}</p>
              <ul className="max-h-32 list-disc overflow-y-auto pl-5">{preview.items.map((item) => <li key={item.itemId}>{item.label}</li>)}</ul>
            </div>
            {reading ? (
              <p data-testid="poste-remeasure-reading">
                {/* A key's request is bounded by its dollar ceiling alone: no token budget is announced for it. */}
                {reading.summary} {keyCeilingCents ? `Plafond de cette demande : ${formatUsdCeiling(keyCeilingCents * TAKEOFF_NANO_USD_PER_CENT)}`
                  : viaKey ? "Plafond de cette demande : celui de votre clé API OpenAI"
                  : `Budget réservé sur votre forfait : ${formatItemCount(reading.budgetTokens, "jeton", "jetons")} au plus`}
                {" "}({formatItemCount(reading.calls, "appel payant", "appels payants")}).
              </p>
            ) : preview.reading.state === "refused" ? (
              <p className="text-danger" role="alert">{preview.reading.reason}</p>
            ) : null}
            {preview.skipped.length ? (
              <p>
                Non repris : {preview.skipped.map((item) => `${item.label} (${ITEM_INELIGIBILITY_LABELS[item.reason]})`).join(", ")}.
              </p>
            ) : null}
            {preview.running ? (
              <p role="status">Une analyse de l’affaire est en cours : la sélection reste prête, confirmez quand elle sera terminée.</p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose disabled={busy} render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={!canConfirm} onClick={onConfirm}>
            {viaKey ? "Confirmer la demande avec ma clé API" : "Confirmer la demande sur mon forfait"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
