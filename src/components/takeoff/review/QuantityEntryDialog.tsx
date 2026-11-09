"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  HYPOTHESIS_NOTE,
  QUANTITY_ENTRY_CATEGORIES,
  QUANTITY_ENTRY_NOTE_MAX,
  quantityEntryError,
  quantityEntrySchema,
  type QuantityEntry,
} from "@/lib/takeoff/quantity-entry";
import { noteLength, noteText } from "@/lib/takeoff/rules/verification";

// What a quantity the plan cannot show rests on (TI-686 D12), asked when it is entered in the targeted review (Enter
// after F2 or a direct entry, or a guided reduction of such a line): one category, and a note an hypothesis requires.
// Enter saves a complete entry, Escape cancels it: nothing is saved without its category.

const SELECT_CLASS = "rounded-md border border-border bg-surface p-2 text-sm";
const quantityText = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(value);

export function QuantityEntryDialog({ quantity, unit, busy, onClose, onConfirm }: Readonly<{
  quantity: number; unit: string; busy: boolean; onClose: () => void; onConfirm: (entry: QuantityEntry) => void;
}>) {
  const categoryId = useId();
  const noteId = useId();
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  // The note as it is stored (without the blanks at its ends), absent when nothing is left.
  const text = noteText(note);
  const parsed = quantityEntrySchema.safeParse({ category, ...(text ? { note: text } : {}) });
  const entry = parsed.success ? parsed.data : null;
  const complete = entry !== null && quantityEntryError(entry) === null;
  const hypothesis = category === "hypothesis";
  const length = noteLength(note);
  const noteValid = hypothesis ? length >= HYPOTHESIS_NOTE.min && length <= HYPOTHESIS_NOTE.max : length <= QUANTITY_ENTRY_NOTE_MAX;
  const confirm = () => { if (entry && complete && !busy) onConfirm(entry); };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Justifier la quantité saisie</DialogTitle>
          <DialogDescription>
            Le plan ne montre pas cette quantité. La quantité saisie, {quantityText(quantity)} {unit}, sera enregistrée avec ce
            qui la fonde. La décision reste dans le journal.
          </DialogDescription>
        </DialogHeader>
        {/* Enter saves from the list or the note (a select never submits by itself), never from a button. */}
        <div className="flex flex-col gap-3" onKeyDown={(event) => {
          if (event.key !== "Enter" || (event.target as HTMLElement).closest("button")) return;
          event.preventDefault();
          confirm();
        }}>
          <Field>
            <FieldLabel htmlFor={categoryId}>Justification</FieldLabel>
            <select id={categoryId} className={SELECT_CLASS} value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Choisir une justification</option>
              {Object.entries(QUANTITY_ENTRY_CATEGORIES).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor={noteId}>Ce qui fonde la quantité</FieldLabel>
            <Input id={noteId} size="sm" value={note} onChange={(event) => setNote(event.target.value)} required={hypothesis}
              aria-describedby={`${noteId}-hint`} aria-invalid={note !== "" && !noteValid} />
            <FieldDescription id={`${noteId}-hint`} className={noteValid || (note === "" && !hypothesis) ? undefined : "text-danger"}>
              {hypothesis
                ? `Obligatoire pour une hypothèse : dites ce qui est supposé et ce qui reste à confirmer (${length} / ${HYPOTHESIS_NOTE.max} caractères, au moins ${HYPOTHESIS_NOTE.min}).`
                : `Facultatif : la fiche, le plan ou le calcul qui la fonde (${length} / ${QUANTITY_ENTRY_NOTE_MAX} caractères).`}
            </FieldDescription>
          </Field>
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Annuler</DialogClose>
          <Button type="button" disabled={busy || !complete} onClick={confirm} aria-keyshortcuts="Enter">Enregistrer la quantité</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
