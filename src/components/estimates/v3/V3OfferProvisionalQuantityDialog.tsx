"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ESTIMATE_OFFER_RESERVE_BASES,
  ESTIMATE_OFFER_RESERVE_BASIS_VALUES,
  OFFER_PROVISIONAL_QUANTITY_WARNING,
  offerChoiceError,
  provisionalQuantityTextsError,
  readEstimateOfferChoice,
  type EstimateOfferChoiceInput,
  type EstimateOfferReserveBasis,
} from "@/lib/estimates/offer-choice";
import {
  composeProvisionalQuantityMention,
  normalizeProvisionalText,
  PROVISIONAL_QUANTITY_TEXT,
  type ProvisionalQuantityLine,
} from "@/lib/estimates/provisional-quantity";
import { noteText } from "@/lib/takeoff/rules/acceptance-note";

type V3OfferProvisionalQuantityDialogProps = {
  /** The priced line resting on a takeoff hypothesis whose provisional quantity is declared or read, or null when closed. */
  line: (ProvisionalQuantityLine & { title: string; choice: unknown }) | null;
  /** Declaring and withdrawing are an administrator's; anyone else reads. */
  canDeclare: boolean;
  /** What the quantity is established on, from the takeoff line's note when it has one (null otherwise). */
  suggestEstablishedOn?: () => Promise<string | null>;
  /** Writes the choice (null withdraws it); rejects with a message the dialog shows. */
  onSave: (choice: EstimateOfferChoiceInput | null) => Promise<void>;
  onClose: () => void;
};

/**
 * TI-682, lot C, PR 5: the provisional quantity of a priced line whose quantity rests on a takeoff hypothesis. The line
 * leaves priced; the offer says, in its « Précisions et limites de prestation » text, that its quantity is provisional,
 * what it is established on and what will confirm it. The sentence shown here is the one the send gate looks for.
 */
export function V3OfferProvisionalQuantityDialog({
  line,
  canDeclare,
  suggestEstablishedOn,
  onSave,
  onClose,
}: Readonly<V3OfferProvisionalQuantityDialogProps>) {
  return (
    <Dialog open={line !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {line ? (
        <ProvisionalQuantityForm
          key={line.title}
          line={line}
          canDeclare={canDeclare}
          suggestEstablishedOn={suggestEstablishedOn}
          onSave={onSave}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function ProvisionalQuantityForm({
  line,
  canDeclare,
  suggestEstablishedOn,
  onSave,
  onClose,
}: Readonly<Omit<V3OfferProvisionalQuantityDialogProps, "line"> & {
  line: NonNullable<V3OfferProvisionalQuantityDialogProps["line"]>;
}>) {
  const parsed = readEstimateOfferChoice(line.choice);
  const stored = parsed?.kind === "provisional_quantity" ? parsed : null;
  const [basis, setBasis] = useState<EstimateOfferReserveBasis | "">(stored?.basis ?? "");
  const [establishedOn, setEstablishedOn] = useState(stored?.established_on ?? "");
  const [toConfirmBy, setToConfirmBy] = useState(stored?.to_confirm_by ?? "");
  const [note, setNote] = useState(stored?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const disabled = !canDeclare || isSaving;

  // « Établie sur » starts from the takeoff line's note, once, when nothing is declared yet; it stays editable.
  const suggestionRequested = useRef(false);
  const hasStored = stored !== null;
  useEffect(() => {
    if (suggestionRequested.current || hasStored || !canDeclare || !suggestEstablishedOn) return;
    suggestionRequested.current = true;
    // Requested once even under a double effect run; a late answer only fills a field still empty.
    suggestEstablishedOn().then((suggestion) => {
      if (suggestion) setEstablishedOn((current) => (current === "" ? suggestion : current));
    }).catch(() => undefined);
  }, [canDeclare, hasStored, suggestEstablishedOn]);

  const mention = composeProvisionalQuantityMention(line, { established_on: establishedOn, to_confirm_by: toConfirmBy });

  const write = async (choice: EstimateOfferChoiceInput | null) => {
    setIsSaving(true);
    try {
      await onSave(choice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La quantité provisionnelle n'a pas pu être enregistrée.");
    } finally {
      setIsSaving(false);
    }
  };
  const declare = () => {
    if (!basis) {
      setError("Choisissez la base de la quantité provisionnelle.");
      return;
    }
    const textError = provisionalQuantityTextsError({ established_on: establishedOn, to_confirm_by: toConfirmBy });
    const message = textError?.message ?? offerChoiceError({ basis, note });
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    const trimmed = noteText(note);
    void write({
      kind: "provisional_quantity",
      basis,
      note: trimmed === "" ? null : trimmed,
      established_on: normalizeProvisionalText(establishedOn),
      to_confirm_by: normalizeProvisionalText(toConfirmBy),
    });
  };

  return (
    <DialogContent size="md" data-testid="estimate-v3-offer-provisional-dialog">
      <DialogHeader>
        <DialogTitle>Quantité provisionnelle dans l&apos;offre</DialogTitle>
        <DialogDescription>
          La quantité de « {line.title} » repose sur une hypothèse du métré. La ligne part chiffrée, et l&apos;offre dit
          dans ses précisions et limites de prestation que sa quantité est provisionnelle. La base et la note restent
          internes.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="grid gap-3">
          <p role="note" className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-sm text-warning">
            {OFFER_PROVISIONAL_QUANTITY_WARNING}
          </p>
          <fieldset className="grid gap-1 text-sm" disabled={disabled}>
            <legend className="mb-1 font-medium">Base de la quantité provisionnelle</legend>
            {ESTIMATE_OFFER_RESERVE_BASIS_VALUES.map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="offer-provisional-basis"
                  value={value}
                  checked={basis === value}
                  onChange={() => setBasis(value)}
                />
                <span>{ESTIMATE_OFFER_RESERVE_BASES[value]}</span>
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Établie sur</span>
            <input
              className="estimate-input h-9 w-full"
              value={establishedOn}
              maxLength={PROVISIONAL_QUANTITY_TEXT.max * 2}
              disabled={disabled}
              placeholder="Ex. : le plan CVC indice B, niveau R+1"
              onChange={(event) => setEstablishedOn(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">À confirmer selon</span>
            <input
              className="estimate-input h-9 w-full"
              value={toConfirmBy}
              maxLength={PROVISIONAL_QUANTITY_TEXT.max * 2}
              disabled={disabled}
              placeholder="Ex. : le relevé contradictoire sur site"
              onChange={(event) => setToConfirmBy(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">
              Précision interne {basis === "indicative_quantities" ? "(obligatoire)" : "(facultative)"}
            </span>
            <textarea
              className="estimate-input min-h-16 w-full"
              value={note}
              maxLength={2000}
              disabled={disabled}
              placeholder={basis === "indicative_quantities"
                ? "Référence de l'article du règlement de la consultation (10 à 500 caractères)"
                : "10 à 500 caractères"}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="grid gap-1 text-sm">
            <span className="font-medium">Phrase lue par le client</span>
            <p className="rounded-lg border border-border bg-surface-subtle px-3 py-2" data-testid="estimate-v3-offer-provisional-mention">
              {mention ?? "La ligne n'a pas de quantité : la phrase ne peut pas être écrite."}
            </p>
            <span className="text-xs text-muted-foreground">
              Elle est insérée dans les précisions depuis les réglages du devis. Si la quantité, le titre ou l&apos;unité
              changent, la phrase change et l&apos;envoi attend la nouvelle.
            </span>
          </div>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={isSaving}>
          {canDeclare ? "Annuler" : "Fermer"}
        </Button>
        {canDeclare && stored ? (
          <Button type="button" variant="danger" size="lg" onClick={() => void write(null)} disabled={isSaving}>
            Retirer la mention
          </Button>
        ) : null}
        {canDeclare ? (
          <Button type="button" variant="primary" size="lg" onClick={declare} disabled={isSaving}>
            Déclarer la quantité provisionnelle
          </Button>
        ) : null}
      </DialogFooter>
    </DialogContent>
  );
}
