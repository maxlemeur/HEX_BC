"use client";

import { useEffect, useEffectEvent, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { entryPlans, planEntryTarget, type EntryChoiceItem } from "@/lib/takeoff/item-entry-choice";
import type { ItemReviewTarget, ItemTableScope } from "@/lib/takeoff/item-table";
import { fetchFrozenItemSelection } from "@/lib/takeoff/item-table-client";
import type { ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";
import { formatItemCount, formatItemQuantity } from "@/lib/takeoff/item-table-labels";
import { noteText } from "@/lib/takeoff/rules/verification";
import { confirmOnEnter } from "./ItemTableGestureDialogs";
import {
  HYPOTHESIS_NOTE,
  QUANTITY_ENTRY_CATEGORIES,
  quantityEntryError,
  type QuantityEntry,
  type QuantityEntryCategory,
} from "@/lib/takeoff/quantity-entry";

const CATEGORIES = Object.keys(QUANTITY_ENTRY_CATEGORIES) as QuantityEntryCategory[];

type Value = { line: ItemTableResponseLine; quantity: number; unit: string };

export function EntryDialog({ projectId, viewScope, values, busy, onClose, onConfirm, onRefused }: {
  projectId: string; viewScope: ItemTableScope; values: Value[]; busy: boolean; onClose: () => void;
  onRefused: (error: unknown) => boolean;
  onConfirm: (entry: QuantityEntry, scope: ItemTableScope, targets: ItemReviewTarget[], values: Value[]) => void;
}) {
  const [seen] = useState(() => values);
  const [initial] = useState(() => seen.map(({ line }) => ({ target: line.targets, plans: entryPlans(line),
    wholeEligible: line.eligibility.enter_quantity.eligible })));
  const filtered = viewScope.kind === "plan" ? viewScope.planKey : null;
  const [all, setAll] = useState<EntryChoiceItem[] | null>(filtered ? null : initial);
  const [loadError, setLoadError] = useState("");
  const report = useEffectEvent(onRefused);
  useEffect(() => {
    if (!filtered) return;
    let active = true;
    void fetchFrozenItemSelection(projectId, { kind: "affaire" }, { kind: "items", itemIds: seen.map(v => v.line.itemId) }, true)
      .then(result => {
        if (!active) return;
        if (result.missing.length) throw new Error("Un poste a changé. Rouvrez la saisie.");
        setAll(result.items.map(item => ({ target: item.target, plans: item.entryPlans ?? [],
          wholeEligible: item.eligible.includes("enter_quantity") })));
      }).catch(error => { if (active && !report(error)) setLoadError("Impossible de relire les autres portées."); });
    return () => { active = false; };
  }, [filtered, projectId, seen]);
  const [selected, setSelected] = useState(() => {
    if (filtered) return filtered;
    const sole = initial[0]?.plans[0]?.key;
    return sole && initial.every(item => item.plans.length === 1 && item.plans[0].key === sole) ? sole : "";
  });
  const choices = all ?? initial;
  const plans = choices[0]?.plans.filter(plan => choices.every(item => item.plans.some(p => p.key === plan.key))) ?? [];
  const scope: ItemTableScope = selected === "affaire" ? { kind: "affaire" } : { kind: "plan", planKey: selected };
  const targets = selected === filtered ? initial.map(i => i.target)
    : selected === "affaire" ? all?.filter(i => i.wholeEligible).map(i => i.target) : all?.flatMap(i => planEntryTarget(i, selected) ?? []);
  const scopeId = useId();
  const categoryId = useId();
  const noteId = useId();
  const [category, setCategory] = useState<QuantityEntryCategory | "">("");
  const [note, setNote] = useState("");
  const text = noteText(note);
  const entry: QuantityEntry | null = category ? { category, ...(text ? { note: text } : {}) } : null;
  const error = entry ? quantityEntryError(entry) : null;
  const complete = entry !== null && error === null && seen.length > 0 && targets?.length === seen.length;
  const confirm = () => { if (complete && !busy) onConfirm(entry!, scope, targets!, seen); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Enregistrer les quantités saisies</DialogTitle>
          <DialogDescription>
            {formatItemCount(seen.length, "valeur", "valeurs")}. La saisie d’un plan part avec ce plan au devis ;
            un total de toute l’affaire ne part avec aucun plan.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm">
          {seen.map((value) => <li key={value.line.itemId}>{value.line.label} : {formatItemQuantity(value.quantity, value.unit)}</li>)}
        </ul>
        <div className="flex flex-col gap-3" onKeyDown={confirmOnEnter(confirm)}>
          <Field>
            <FieldLabel htmlFor={scopeId}>Portée de la saisie</FieldLabel>
            <NativeSelect id={scopeId} value={selected} onChange={event => setSelected(event.target.value)}>
              <option value="">Choisir une portée…</option>
              {plans.map(plan => <option key={plan.key} value={plan.key}
                disabled={!choices.every(i => i.plans.some(p => p.key === plan.key && p.eligible))}>{plan.name}</option>)}
              <option value="affaire" disabled={!all?.every(i => i.wholeEligible)}>Total de toute l’affaire</option>
            </NativeSelect>
            {loadError && <FieldDescription role="alert">{loadError}</FieldDescription>}
          </Field>
          <Field>
            <FieldLabel htmlFor={categoryId}>Ce qui fonde ces quantités</FieldLabel>
            <NativeSelect id={categoryId} value={category} onChange={(event) => setCategory(event.target.value as QuantityEntryCategory | "")}>
              <option value="">Choisir…</option>
              {CATEGORIES.map((value) => <option key={value} value={value}>{QUANTITY_ENTRY_CATEGORIES[value]}</option>)}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor={noteId}>{category === "hypothesis" ? "Ce qui est supposé (obligatoire)" : "Note (facultative)"}</FieldLabel>
            <Textarea id={noteId} rows={2} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
            <FieldDescription>
              {category === "hypothesis"
                ? `${HYPOTHESIS_NOTE.min} à ${HYPOTHESIS_NOTE.max} caractères. Une hypothèse saisie ne compte qu’une fois incluse, poste par poste.`
                : "La même note est écrite sur chaque poste : ne la donnez que si elle vaut pour chacun."}
            </FieldDescription>
            {entry && error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          </Field>
        </div>
        <DialogFooter>
          <DialogClose disabled={busy} render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={!complete || busy} onClick={confirm}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
