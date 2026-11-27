"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import { entryDestination, entryPlans, groupEntryCommands, type EntryChoiceItem } from "@/lib/takeoff/item-entry-choice";
import type { ItemTableScope } from "@/lib/takeoff/item-table";
import { fetchFrozenItemSelection, itemReviewStaleLines, sendItemReviewCommand } from "@/lib/takeoff/item-table-client";
import type { ItemReviewResult, ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";
import { formatItemCount, formatEntryQuantity, ITEM_INELIGIBILITY_LABELS } from "@/lib/takeoff/item-table-labels";
import { noteText } from "@/lib/takeoff/rules/verification";
import { HYPOTHESIS_NOTE, QUANTITY_ENTRY_CATEGORIES, quantityEntryError, type QuantityEntryCategory } from "@/lib/takeoff/quantity-entry";
import { EntryBatchResult, type EntryBatch } from "./EntryBatchResult";
import { confirmOnEnter } from "./ItemTableGestureDialogs";
import { PARIS_DATE_TIME_FORMAT as date } from "@/lib/format/fr";

const CATEGORIES = Object.keys(QUANTITY_ENTRY_CATEGORIES) as QuantityEntryCategory[];
type Value = { line: ItemTableResponseLine; quantity: number; unit: string };

export function EntryDialog({ projectId, viewScope, values, resume, onClose, onRefused, onFinished }: {
  projectId: string; viewScope: ItemTableScope; values: Value[]; resume?: EntryBatch; onClose: () => void;
  onRefused: (error: unknown) => boolean;
  onFinished: (result: ItemReviewResult, batch: EntryBatch, failure?: unknown) => void;
}) {
  const [seen] = useState(() => values);
  const [initial] = useState(() => seen.map(({ line }) => ({ target: line.targets, plans: entryPlans(line),
    wholeEligible: line.eligibility.enter_quantity.eligible, wholeEntry: null })));
  const filtered = viewScope.kind === "plan" ? viewScope.planKey : null;
  // The filtered view omits the other scopes. A draft from another page may also lack the author's name.
  const needsRead = !resume && (!!filtered || seen.some(({ line }) => line.entry || line.targets.entryRevision ||
    line.targets.answers.some(answer => answer.entryRevision) || line.readings.some(reading => reading.entry)));
  const [items, setItems] = useState<EntryChoiceItem[]>(needsRead ? [] : initial);
  const [loadError, setLoadError] = useState("");
  const report = useEffectEvent(onRefused);
  useEffect(() => {
    if (!needsRead) return;
    let active = true;
    void fetchFrozenItemSelection(projectId, { kind: "affaire" }, { kind: "items", itemIds: seen.map(v => v.line.itemId) }, true)
      .then(result => {
        if (!active) return;
        const byId = new Map(result.items.map(item => [item.itemId, item]));
        setItems(seen.map(({ line }) => {
          const item = byId.get(line.itemId);
          if (!item?.entryPlans || item.wholeEntry === undefined) throw new Error("Poste absent");
          return { target: item.target, plans: item.entryPlans, wholeEligible: item.eligible.includes("enter_quantity"), wholeEntry: item.wholeEntry };
        }));
      }).catch(error => { if (active && !report(error)) setLoadError("Impossible de relire les portées. Rouvrez la saisie."); });
    return () => { active = false; };
  }, [needsRead, projectId, seen]);
  const plans = items[0]?.plans.filter(plan => plan.eligible && items.every(i => i.plans.some(p => p.key === plan.key && p.eligible))) ?? [];
  const canSplit = items.length > 1 && items.some(i => i.plans.some(p => p.eligible));
  const [choice, setChoice] = useState<string | null>(null);
  const sole = plans[0]?.key;
  const suggested = filtered ? plans.find(p => p.key === filtered)?.key : sole && items.every(i => i.plans.length === 1) ? sole : "";
  const selected = choice ?? suggested ?? "";
  const [perItem, setPerItem] = useState<Record<string, string>>({});
  const rows = items.map((item, index) => {
    const eligible = item.plans.filter(plan => plan.eligible);
    const key = selected === "individual" && canSplit ? perItem[item.target.itemId] ?? (eligible.length === 1 ? eligible[0].key : "")
      : selected === "affaire" || plans.some(plan => plan.key === selected) ? selected : "";
    const keepDraft = selected === "individual" && key === "draft" && !eligible.length && !item.wholeEligible;
    return { item, eligible, key, keepDraft, destination: entryDestination(item, key), value: seen[index] };
  });
  const scopeId = useId();
  const categoryId = useId();
  const noteId = useId();
  const [category, setCategory] = useState<QuantityEntryCategory | "">("");
  const [note, setNote] = useState("");
  const text = noteText(note);
  const entry = category ? { category, ...(text ? { note: text } : {}) } : null;
  const invalid = entry && quantityEntryError(entry);
  const complete = entry && !invalid && rows.some(r => r.destination) && rows.every(r => r.destination || r.keepDraft);
  const replacements = rows.filter(r => r.destination?.existing).length;
  const [pending, setPending] = useState<EntryBatch | null>(resume ?? null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const close = () => {
    if (running.current) return;
    if (pending) onFinished(pending.result, pending);
    else onClose();
  };
  async function confirm() {
    if (running.current || (!pending && (!complete || !entry))) return;
    running.current = true;
    setBusy(true);
    let batch: EntryBatch = pending ?? {
      rows: rows.map(({ item, key, value }) => ({ id: value.line.itemId, label: value.line.label, quantity: value.quantity, unit: value.unit,
        destination: key === "affaire" ? "Toute l’affaire" : item.plans.find(p => p.key === key)?.name ?? "Brouillon sans portée",
        state: "Non envoyé" })),
      remaining: groupEntryCommands(rows.flatMap(({ destination, value }) =>
        destination ? [{ destination, quantity: value.quantity, unit: value.unit }] : []), entry!),
      result: { outcome: "applied", applied: [], skipped: [] },
    };
    try {
      while (batch.remaining.length) {
        const [command, ...later] = batch.remaining;
        const next = await sendItemReviewCommand(projectId, command);
        if (!mounted.current) return;
        const stored = new Set(next.applied.map(row => row.itemId));
        const skipped = new Map(next.skipped.map(row => [row.itemId, ITEM_INELIGIBILITY_LABELS[row.reason]]));
        batch = { remaining: later, result: { outcome: next.outcome, applied: [...batch.result.applied, ...next.applied],
          skipped: [...batch.result.skipped, ...next.skipped] }, rows: batch.rows.map(row => stored.has(row.id)
          ? { ...row, state: "Enregistré", reason: undefined } : skipped.has(row.id)
            ? { ...row, state: "Refusé", reason: skipped.get(row.id) } : row) };
        if (next.skipped.length && later.length) { setPending(batch); return; }
      }
      onFinished(batch.result, batch);
    } catch (error) {
      if (!mounted.current || onRefused(error)) return;
      const refused = isTakeoffApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 408;
      const reason = refused ? itemReviewStaleLines(error) ? "Écran périmé" : error.message : undefined;
      const ids = new Set(batch.remaining[0].targets.map(target => target.itemId));
      batch = { ...batch, remaining: refused ? batch.remaining.slice(1) : batch.remaining,
        rows: batch.rows.map(row => ids.has(row.id) ? { ...row, state: refused ? "Refusé" : "État inconnu", reason } : row) };
      if (batch.remaining.length) setPending(batch);
      else onFinished(batch.result, batch, error);
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent size="md">
      <DialogHeader>
        <DialogTitle>Enregistrer les quantités saisies</DialogTitle>
        <DialogDescription>{formatItemCount(pending?.rows.length ?? seen.length, "valeur", "valeurs")}. Une saisie sur un plan peut être envoyée avec ce plan si l’aperçu la retient. Un total de toute l’affaire ne part avec aucun plan.</DialogDescription>
      </DialogHeader>
      {!pending && <fieldset disabled={busy} className="flex min-w-0 flex-col gap-3" onKeyDown={confirmOnEnter(() => { if (!replacements) void confirm(); })}>
        <Field>
          <FieldLabel htmlFor={scopeId}>Portée de la saisie</FieldLabel>
          <NativeSelect id={scopeId} value={selected} onChange={event => setChoice(event.target.value)}>
            <option value="">Choisir une portée…</option>
            {plans.map(plan => <option key={plan.key} value={plan.key}>{plan.name}</option>)}
            {canSplit && <option value="individual">Chaque valeur sur son plan</option>}
            <option value="affaire" disabled={!items.length || !items.every(i => i.wholeEligible)}>Total de toute l’affaire</option>
          </NativeSelect>
          {selected === "individual" && <FieldDescription>Les valeurs sont enregistrées plan par plan.</FieldDescription>}
          {loadError && <FieldDescription role="alert">{loadError}</FieldDescription>}
        </Field>
        <ul className="max-h-52 space-y-2 overflow-y-auto text-sm">
          {seen.map((value, index) => {
            const row = rows[index];
            const existing = row?.destination?.existing;
            const id = value.line.itemId;
            return <li key={id}>
              <p>{value.line.label} : {formatEntryQuantity(value.quantity, value.unit)}</p>
              {selected === "individual" && row && <Field>
                <FieldLabel htmlFor={scopeId + id}>Plan pour {value.line.label}</FieldLabel>
                <NativeSelect id={scopeId + id} value={row.key} onChange={e => setPerItem({ ...perItem, [id]: e.target.value })}>
                  <option value="">Choisir…</option>
                  {row.eligible.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
                  {!row.eligible.length && (row.item.wholeEligible ? <option value="affaire">Total de toute l’affaire</option>
                    : <option value="draft">Garder cette valeur en brouillon</option>)}
                </NativeSelect>
                {!row.eligible.length && !row.item.wholeEligible && <FieldDescription>Aucune portée admissible pour ce poste.</FieldDescription>}
              </Field>}
              {row?.item.plans.filter(p => !p.eligible).map(p => <p key={p.key}>{p.name} · {p.reason ?? "Plan non admissible"}</p>)}
              {existing && <p>La saisie en place sera remplacée, avec sa catégorie et sa note : {formatEntryQuantity(existing.quantity, existing.unit)} · {QUANTITY_ENTRY_CATEGORIES[existing.category]} · {existing.author}, le {date.format(new Date(existing.at))}{existing.note && ` · ${existing.note}`}</p>}
              {row?.destination && row.key !== "affaire" && row.item.wholeEntry && <p>Le total de l’affaire garde la priorité. Ce poste ne part avec aucun plan tant que ce total n’est pas rattaché à un plan ou retiré.</p>}
            </li>;
          })}
        </ul>
        <Field>
          <FieldLabel htmlFor={categoryId}>Ce qui fonde ces quantités</FieldLabel>
          <NativeSelect id={categoryId} value={category} onChange={event => setCategory(event.target.value as QuantityEntryCategory | "")}>
            <option value="">Choisir…</option>
            {CATEGORIES.map(key => <option key={key} value={key}>{QUANTITY_ENTRY_CATEGORIES[key]}</option>)}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={noteId}>{category === "hypothesis" ? "Ce qui est supposé (obligatoire)" : "Note (facultative)"}</FieldLabel>
          <Textarea id={noteId} rows={2} value={note} maxLength={2000} onChange={e => setNote(e.target.value)} />
          <FieldDescription>{category === "hypothesis" ? `${HYPOTHESIS_NOTE.min} à ${HYPOTHESIS_NOTE.max} caractères. Une hypothèse saisie ne compte qu’une fois incluse, poste par poste.` :
            "La même note est écrite sur chaque poste : ne la donnez que si elle vaut pour chacun."}</FieldDescription>
          {invalid && <p role="alert">{invalid}</p>}
        </Field>
      </fieldset>}
      {pending && <div role="status"><EntryBatchResult rows={pending.rows} />
        {pending.rows.some(r => r.state === "État inconnu") && <p>Réessayez la même saisie ou fermez pour relire les postes concernés.</p>}
      </div>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={close}>Annuler</Button>
        <Button disabled={(!pending && !complete) || busy} variant={replacements ? "danger" : "primary"} onClick={() => void confirm()}>
          {pending ? pending.rows.some(r => r.state === "État inconnu") ? "Réessayer la même saisie" : "Envoyer les valeurs non envoyées" : replacements === 1 ? "Remplacer la saisie" : replacements ? `Remplacer les ${replacements} saisies` : "Enregistrer"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
