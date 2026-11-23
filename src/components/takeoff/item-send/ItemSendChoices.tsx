"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { ItemSendPreviewResponse } from "@/lib/takeoff/item-send-contracts";
import { ITEM_SEND_KEEP_BOTH_REASONS, type ItemSendChoice } from "@/lib/takeoff/item-send-plan";
import { ITEM_SEND_KEEP_BOTH_NOTE_MIN, type ItemSendPendingPageDecision } from "@/lib/takeoff/item-send-screen";
import { TAKEOFF_PAGE_KEEP_BOTH_REASON_LABELS } from "@/lib/takeoff/page-replacement-contracts";

import { formatItemSendQuantity } from "./ItemSendPreviewSections";

// Lot 4, PR 5c: the choices the preview of the send of one plan asks for, each explicit, each with its consequence, and
// none preselected: a line among those shown, « conserver la saisie » or the plan's measure for a line typed by hand,
// leaving an item out, and the decision of a page another analysis already brought into the estimate (« Remplacer »,
// « Garder les deux » with its reason, or leaving its parts out). Each choice computes the preview again.

type Point = ItemSendPreviewResponse["to_resolve"][number];
type Option = Point["options"][number];
type KeepBothReason = (typeof ITEM_SEND_KEEP_BOTH_REASONS)[number];

const sameChoice = (option: Option, choice: ItemSendChoice | null) => !!choice && option.kind === choice.kind
  && (option.kind !== "line" || (choice.kind === "line" && option.estimate_item_id.toLowerCase() === choice.estimateItemId.toLowerCase()));
const toChoice = (option: Option): ItemSendChoice => (option.kind === "line"
  ? { kind: "line", estimateItemId: option.estimate_item_id } : { kind: option.kind });

function optionText(option: Option, point: Point): { label: string; consequence: string } {
  const unit = "";
  switch (option.kind) {
    case "line": return { label: `Alimenter « ${option.title ?? "Sans titre"} »`,
      consequence: "Cette ligne reçoit la mesure du plan ; son prix ne change pas." };
    case "new_line": return { label: "Créer une nouvelle ligne",
      consequence: "Une ligne sans prix est créée dans la section du poste ; ce qu’un envoi précédent apportait à la ligne supprimée en sort." };
    case "keep_entry": return { label: `Conserver la saisie${point.facts?.entered !== null && point.facts?.entered !== undefined
      ? ` (${formatItemSendQuantity(point.facts.entered, unit)})` : ""}`,
    consequence: "La ligne garde la quantité saisie ; la mesure du plan et l’écart sont enregistrés avec l’envoi." };
    case "use_retained": return { label: `Retenir le métré${point.facts ? ` (${formatItemSendQuantity(point.facts.retained, unit)})` : ""}`,
      consequence: point.facts && point.facts.entered !== null
        ? `La quantité de la ligne passe de ${formatItemSendQuantity(point.facts.entered)} à ${formatItemSendQuantity(point.facts.retained)}.`
        : "La ligne prend la quantité que retient le métré." };
    case "leave_out": if (point.kind === "verified_total_indivisible") return {
      label: "Conserver le total précédent", consequence: "La quantité de ce poste reste celle du devis.",
    };
    return { label: "Laisser ce poste de côté",
      consequence: "Rien n’est écrit pour ce poste ; il reste dans le tableau des postes." };
  }
}

/** One point to resolve: its reason, its facts, and the options it offers, none checked until the member chooses. */
export function ItemSendPoint({ point, choice, disabled, onChoose }: {
  point: Point; choice: ItemSendChoice | null; disabled: boolean; onChoose: (choice: ItemSendChoice) => void;
}) {
  const name = useId();
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3" data-testid={`item-send-point-${point.kind}`}>
      <legend className="px-1 text-sm font-medium text-foreground">{point.label ?? "Point à trancher"}</legend>
      <p className="text-sm text-foreground-secondary">{point.message}</p>
      {/* The line the question is about: the choice is bound to it, and asked again if another line stands there. */}
      {point.kind === "entered_quantity" && point.earlier_lines.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Ligne du devis : {point.earlier_lines.map((line) => `« ${line.title ?? "Sans titre"} »`).join(", ")}
        </p>
      ) : null}
      {point.facts ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {[point.facts.reference !== null ? `DPGF ${formatItemSendQuantity(point.facts.reference)}` : null,
            point.facts.entered !== null ? `saisi ${formatItemSendQuantity(point.facts.entered)}` : null,
            `mesuré ${formatItemSendQuantity(point.facts.measured)}`, `retenu ${formatItemSendQuantity(point.facts.retained)}`]
            .filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <div className="space-y-1.5">
        {point.options.map((option) => {
          const text = optionText(option, point);
          return (
            <label key={option.kind === "line" ? option.estimate_item_id : option.kind} className="flex items-start gap-2 text-sm">
              <input type="radio" className="mt-1" name={name} checked={sameChoice(option, choice)} disabled={disabled}
                onChange={() => onChoose(toChoice(option))} />
              <span>
                <span className="font-medium">{text.label}</span>
                <span className="block text-xs text-muted-foreground">{text.consequence}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

type PageChoice = "replace" | "keep_both" | "leave_out" | null;

/**
 * A page another analysis already brought into the estimate: what holds it, and its decision. « Garder les deux » is
 * asked with its reason (a complementary scope with its note): until it is complete, the page's parts wait.
 */
type KeepBoth = Extract<ItemSendPendingPageDecision, { decision: "keep_both" }>;

export function ItemSendPageDecision({ point, decision, leftOut, invalid, labels, disabled, onDecide, onLeaveOut, onNoteTyping,
  onFlushNote }: {
  point: Point;
  decision: ItemSendPendingPageDecision | null;
  leftOut: boolean;
  invalid: string[];
  labels: ReadonlyMap<string, string>;
  disabled: boolean;
  onDecide: (decision: ItemSendPendingPageDecision | null) => void;
  onLeaveOut: (leave: boolean) => void;
  /** Whether a note typed here has not reached the preview yet: the confirmation waits for it. */
  onNoteTyping?: (page: number | null, typing: boolean) => void;
  /**
   * A note typed for a « garder les deux », written only onto that same decision if it is still the page's (never over a
   * « Remplacer » chosen since, nor back onto a decision cleared meanwhile).
   */
  onFlushNote: (decidedOn: KeepBoth, note: string) => void;
}) {
  const name = useId();
  const noteId = useId();
  const chosen: PageChoice = leftOut ? "leave_out" : decision?.decision ?? null;
  const keepBoth = decision?.decision === "keep_both" ? decision : null;
  // The note is committed once typing pauses: the preview is not computed again on every key.
  const [note, setNote] = useState(keepBoth?.note ?? "");
  const noteTyped = keepBoth !== null && (keepBoth.note ?? "") !== note;
  // A note typed and not committed yet when this card goes (another gesture reads the preview again): committed then.
  const unsaved = useRef<{ keepBoth: typeof keepBoth; note: string; flush: typeof onFlushNote }>({ keepBoth, note, flush: onFlushNote });
  useEffect(() => {
    unsaved.current = { keepBoth, note, flush: onFlushNote };
  });
  useEffect(() => () => {
    const { keepBoth: decided, note: typed, flush } = unsaved.current;
    if (decided && (decided.note ?? "") !== typed) flush(decided, typed);
  }, []);
  const page = point.page;
  useEffect(() => {
    onNoteTyping?.(page, noteTyped);
  }, [page, noteTyped, onNoteTyping]);
  useEffect(() => () => onNoteTyping?.(page, false), [page, onNoteTyping]);
  useEffect(() => {
    if (!keepBoth || (keepBoth.note ?? "") === note) return;
    const timer = setTimeout(() => onFlushNote(keepBoth, note), 500);
    return () => clearTimeout(timer);
  }, [note, keepBoth, onFlushNote]);
  const pageName = point.page === null ? "Toutes les pages" : `Page ${point.page}`;
  const choose = (next: PageChoice) => {
    if (next === "leave_out") { onDecide(null); onLeaveOut(true); return; }
    if (leftOut) onLeaveOut(false);
    onDecide(next === "replace" ? { page: point.page, decision: "replace" }
      : next === "keep_both" ? { page: point.page, decision: "keep_both", reasonCode: keepBoth?.reasonCode ?? null, note: note || null } : null);
  };
  const radio = (value: Exclude<PageChoice, null>, label: string, consequence: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="radio" className="mt-1" name={name} checked={chosen === value} disabled={disabled} onChange={() => choose(value)} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{consequence}</span>
      </span>
    </label>
  );
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3" data-testid={`item-send-page-${point.page ?? "all"}`}>
      <legend className="px-1 text-sm font-medium text-foreground">{pageName} : déjà au devis par une autre analyse</legend>
      <p className="text-sm text-foreground-secondary">
        Une page n’entre qu’une fois au devis. Décidez de ce que ce plan y apporte.
      </p>
      {point.earlier_lines.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Lignes du devis qui la tiennent : {point.earlier_lines.map((line) =>
            `« ${line.title ?? "Sans titre"} » (${formatItemSendQuantity(line.quantity)})`).join(", ")}.
        </p>
      ) : null}
      {point.held_item_ids.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Postes de ce plan sur cette page : {point.held_item_ids.map((id) => `« ${labels.get(id) ?? "Poste"} »`).join(", ")}.
        </p>
      ) : null}
      <div className="space-y-1.5">
        {radio("replace", "Remplacer", "L’apport précédent de ces postes sur cette page sort de sa ligne et la lecture de ce plan le remplace ; "
          + "les apports des autres postes restent.")}
        {radio("keep_both", "Garder les deux", "Les deux lectures sont comptées : réservé à des apports distincts, avec leur raison.")}
        {radio("leave_out", "Laisser ces apports de côté", "Rien de cette page n’est envoyé par ce plan ; la ligne du devis ne change pas.")}
      </div>
      {keepBoth ? (
        <div className="space-y-2 border-l-2 border-border pl-3">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Raison de garder les deux (obligatoire)</legend>
            {ITEM_SEND_KEEP_BOTH_REASONS.map((reason: KeepBothReason) => (
              <label key={reason} className="flex items-center gap-2 text-sm">
                <input type="radio" name={`${name}-reason`} checked={keepBoth.reasonCode === reason} disabled={disabled}
                  onChange={() => onDecide({ ...keepBoth, reasonCode: reason, note: note || null })} />
                {TAKEOFF_PAGE_KEEP_BOTH_REASON_LABELS[reason]}
              </label>
            ))}
          </fieldset>
          {keepBoth.reasonCode === "complementary_scope" ? (
            <Field>
              <FieldLabel htmlFor={noteId}>Ce que ce plan ajoute (obligatoire)</FieldLabel>
              <Textarea id={noteId} rows={2} maxLength={500} value={note} disabled={disabled} onChange={(event) => setNote(event.target.value)} />
              <FieldDescription>{ITEM_SEND_KEEP_BOTH_NOTE_MIN} à 500 caractères.</FieldDescription>
            </Field>
          ) : null}
          {!keepBoth.reasonCode ? (
            <p className="text-xs text-warning" data-testid="item-send-keep-both-reason-missing">
              Choisissez la raison : sans elle, les apports de cette page attendent.
            </p>
          ) : null}
        </div>
      ) : null}
      {invalid.map((message) => <Alert key={message} variant="danger">{message}</Alert>)}
    </fieldset>
  );
}
