"use client";

import { useState } from "react";

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
  ESTIMATE_OFFER_RESERVE_CODE_VALUES,
  ESTIMATE_OFFER_RESERVE_CODES,
  OFFER_RESERVE_WARNING,
  offerChoiceError,
  readEstimateOfferChoice,
  type EstimateOfferChoiceInput,
  type EstimateOfferReserveBasis,
  type EstimateOfferReserveCode,
} from "@/lib/estimates/offer-choice";
import { noteText } from "@/lib/takeoff/rules/acceptance-note";

type V3OfferReserveDialogProps = {
  /** The « Non chiffrée » line whose reserve is declared or read, or null when closed. */
  line: { title: string; choice: unknown } | null;
  /** Declaring and withdrawing are an administrator's; anyone else reads. */
  canDeclare: boolean;
  /** Writes the reserve (null withdraws it); rejects with a message the dialog shows. */
  onSave: (choice: EstimateOfferChoiceInput | null) => Promise<void>;
  onClose: () => void;
};

/**
 * TI-682, lot C, PR 4 (D10, D28, D29): the written reserve of a « Non chiffrée » line. The offer leaves with the line
 * unpriced, and its « Précisions et limites de prestation » text says so. The tool records the basis the administrator
 * declares; it cannot verify it (no contract type), hence the warning, shown when the choice is made.
 */
export function V3OfferReserveDialog({ line, canDeclare, onSave, onClose }: Readonly<V3OfferReserveDialogProps>) {
  return (
    <Dialog open={line !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {line ? <OfferReserveForm key={line.title} line={line} canDeclare={canDeclare} onSave={onSave} onClose={onClose} /> : null}
    </Dialog>
  );
}

function OfferReserveForm({
  line,
  canDeclare,
  onSave,
  onClose,
}: Readonly<Omit<V3OfferReserveDialogProps, "line"> & { line: NonNullable<V3OfferReserveDialogProps["line"]> }>) {
  const parsed = readEstimateOfferChoice(line.choice);
  const stored = parsed?.kind === "reserve" ? parsed : null;
  const [basis, setBasis] = useState<EstimateOfferReserveBasis | "">(stored?.basis ?? "");
  const [code, setCode] = useState<EstimateOfferReserveCode | "">(stored?.code ?? "");
  const [note, setNote] = useState(stored?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const disabled = !canDeclare || isSaving;

  const write = async (choice: EstimateOfferChoiceInput | null) => {
    setIsSaving(true);
    try {
      await onSave(choice);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La réserve n'a pas pu être enregistrée.");
    } finally {
      setIsSaving(false);
    }
  };
  const declare = () => {
    if (!basis || !code) {
      setError("Choisissez la base et le motif de la réserve.");
      return;
    }
    const message = offerChoiceError({ basis, code, note });
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    const trimmed = noteText(note);
    void write({ kind: "reserve", basis, code, note: trimmed === "" ? null : trimmed });
  };

  return (
    <DialogContent size="md" data-testid="estimate-v3-offer-reserve-dialog">
      <DialogHeader>
        <DialogTitle>Réserve écrite dans l&apos;offre</DialogTitle>
        <DialogDescription>
          « {line.title} » part « Non chiffrée » : le client lit ce statut sur la ligne, et l&apos;offre le dit dans ses
          précisions et limites de prestation, qui ne peuvent pas rester vides. La base et le motif restent internes.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="grid gap-3">
          <p role="note" className="rounded-lg border border-warning-border bg-warning-subtle px-3 py-2 text-sm text-warning">
            {OFFER_RESERVE_WARNING}
          </p>
          <fieldset className="grid gap-1 text-sm" disabled={disabled}>
            <legend className="mb-1 font-medium">Base de la réserve</legend>
            {ESTIMATE_OFFER_RESERVE_BASIS_VALUES.map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="offer-reserve-basis"
                  value={value}
                  checked={basis === value}
                  onChange={() => setBasis(value)}
                />
                <span>{ESTIMATE_OFFER_RESERVE_BASES[value]}</span>
              </label>
            ))}
          </fieldset>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">Motif</span>
            <select
              className="estimate-input h-9 w-full"
              value={code}
              disabled={disabled}
              onChange={(event) => setCode(event.target.value as EstimateOfferReserveCode | "")}
            >
              <option value="">Choisir un motif</option>
              {ESTIMATE_OFFER_RESERVE_CODE_VALUES.map((value) => (
                <option key={value} value={value}>{ESTIMATE_OFFER_RESERVE_CODES[value]}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">
              Précision {code === "other" || basis === "indicative_quantities" ? "(obligatoire)" : "(facultative)"}
            </span>
            <textarea
              className="estimate-input min-h-20 w-full"
              value={note}
              maxLength={2000}
              disabled={disabled}
              placeholder={basis === "indicative_quantities"
                ? "Référence de l'article du règlement de la consultation (10 à 500 caractères)"
                : "10 à 500 caractères"}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={isSaving}>
          {canDeclare ? "Annuler" : "Fermer"}
        </Button>
        {canDeclare && stored ? (
          <Button type="button" variant="danger" size="lg" onClick={() => void write(null)} disabled={isSaving}>
            Retirer la réserve
          </Button>
        ) : null}
        {canDeclare ? (
          <Button type="button" variant="primary" size="lg" onClick={declare} disabled={isSaving}>
            Déclarer la réserve
          </Button>
        ) : null}
      </DialogFooter>
    </DialogContent>
  );
}
