"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import { describeMarkCoverage } from "@/lib/takeoff/count-mark-schedule";
import { useCountMarks, type CountMarksContextValue, type CountMarksTarget } from "@/components/takeoff/count-marks/CountMarksScope";
import { CountMarksHistory } from "@/components/takeoff/count-marks/CountMarksHistory";
import { COUNT_MARKS_PANEL_ID } from "@/components/takeoff/count-marks/CountMarksTools";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  TAKEOFF_COUNT_MARK_REASON_LABELS,
  TAKEOFF_COUNT_MARK_REMOVAL_REASONS,
  takeoffCountMarkSummaryLabel,
  type TakeoffCountMarkRemovalReason,
} from "@/lib/takeoff/count-marks";
import {
  TAKEOFF_COUNT_MARKS_READ_CHANGING_MESSAGE,
  TAKEOFF_COUNT_MARKS_READ_ONLY_LABELS,
} from "@/lib/takeoff/count-marks-contracts";
import {
  COUNT_MARK_SHOWN_STATE_LABELS,
  COUNT_MARKS_LIST_KEYS_HELP,
  COUNT_MARKS_PLAN_KEYS_HELP,
  countMarkOriginLabel,
  countMarkPlace,
  countMarksListKey,
  draftCountPreview,
  draftEntryAsksWord,
  isDraftMarkId,
  type CountMarkDraftEntry,
  type CountMarkShown,
} from "@/lib/takeoff/count-marks-view";
import { isItemDetailFieldTarget } from "@/lib/takeoff/item-detail-keys";
import { cn } from "@/lib/utils";

/**
 * The marks of the answer shown, beside its plan (lot 5): the count as the server derives it (the number proposed, the
 * number reread, the quantity retained: three things), the same marks as the layer in a sheet of cells, each reachable
 * and operable without a pointer (selecting a row centres its mark on the plan, a mark clicked on the plan selects its
 * row), the removed marks on demand, the gestures not saved yet with what they would leave, and the history. Every
 * gesture has its key, listed under the list; the focus stays on the list through a reload.
 */

const LIST_PAGE = 50;
const NOTE_MAX = 500;
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;
const reasonLabel = (code: string | null) => code && Object.hasOwn(TAKEOFF_COUNT_MARK_REASON_LABELS, code)
  ? TAKEOFF_COUNT_MARK_REASON_LABELS[code as keyof typeof TAKEOFF_COUNT_MARK_REASON_LABELS] : null;

function entryLabel(entry: CountMarkDraftEntry, numbers: Record<string, number>) {
  const which = entry.markId && numbers[entry.markId] ? ` du repère ${numbers[entry.markId]}` : "";
  const { gesture } = entry;
  switch (gesture.op) {
    case "add": return `Ajout d’un repère, page ${entry.page}${gesture.object ? " (objet distinct)" : ""}`;
    case "move": return `Déplacement${which}, page ${entry.page}${gesture.object ? " (objet distinct)" : ""}`;
    case "remove": return `Retrait${which} : ${(reasonLabel(gesture.reason) ?? "").toLowerCase()}${gesture.note ? ` — ${gesture.note}` : ""}`;
    case "retain": return `${gesture.object === "same" ? "Même objet" : "Retenue"}${which}${gesture.object === "distinct" ? " (objet distinct)" : ""}`;
    case "restore": return `${gesture.object === "same" ? "Même objet" : "Rétablissement"}${which}${gesture.object === "distinct" ? " (objet distinct)" : ""}`;
    case "reattribute": return `Affectation${which} à un autre poste${gesture.object ? " (objet distinct)" : ""}`;
    case "verify": return `Page ${entry.page} déclarée vérifiée`;
  }
}

function CountSummary({ marks }: { marks: CountMarksContextValue }) {
  const summary = marks.summary;
  if (!summary) return null;
  const unit = summary.unit ?? "";
  const preview = marks.draft?.entries.length ? draftCountPreview(summary, marks.draft,
    new Map(marks.shown.flatMap((mark) => (mark.mark ? [[mark.markId, mark.mark.state] as const] : [])))) : null;
  return (
    <div className="flex flex-col gap-1 border-b border-border px-3 py-2 text-xs" data-testid="reperes-decompte">
      <dl className="grid grid-cols-3 gap-2">
        <div>
          <dt className="text-muted-foreground">Proposés</dt>
          <dd className="font-mono text-sm tabular-nums text-foreground" data-testid="reperes-proposes">
            {summary.proposed + summary.toAttribute}
            {summary.toAttribute ? <span className="ml-1 font-sans text-xs text-muted-foreground">dont {summary.toAttribute} à attribuer</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Relus</dt>
          <dd className="font-mono text-sm tabular-nums text-foreground" data-testid="reperes-relus">
            {summary.reread}
            <span className="ml-1 font-sans text-xs text-muted-foreground">
              {summary.verifiedPages} page{summary.verifiedPages > 1 ? "s" : ""} vérifiée{summary.verifiedPages > 1 ? "s" : ""} sur {summary.scopePages}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Quantité retenue</dt>
          <dd className="font-mono text-sm tabular-nums text-foreground" data-testid="reperes-quantite">
            {summary.quantity === null ? "—" : `${summary.quantity}${unit ? ` ${unit}` : ""}`}
          </dd>
        </div>
      </dl>
      <p className="font-medium text-foreground" data-testid="reperes-etat">
        {takeoffCountMarkSummaryLabel(summary)}
        {summary.retained === 0 && summary.removed > 0 && summary.state !== "no_mark_retained" ? " · Aucun repère retenu" : ""}
      </p>
      <p className="text-muted-foreground">
        Compté sur le plan, ce nombre n’est pas envoyé au devis : le tableau des postes et l’envoi gardent la quantité qu’ils retiennent.
      </p>
      {preview ? (
        <p className="text-foreground-secondary" data-testid="reperes-apres">
          Après enregistrement : {preview.retained ? plural(preview.retained, "repère retenu", "repères retenus") : "aucun repère retenu"}
          {preview.proposed ? `, ${plural(preview.proposed, "à décider", "à décider")}` : ""}.
        </p>
      ) : null}
    </div>
  );
}

function RemoveDialog({ mark, number, onClose, onConfirm }: { mark: CountMarkShown; number: number; onClose: () => void;
  onConfirm: (reason: TakeoffCountMarkRemovalReason, note: string | null) => void }) {
  const noteId = useId();
  const [reason, setReason] = useState<TakeoffCountMarkRemovalReason | null>(null);
  const [note, setNote] = useState("");
  const trimmed = note.trim();
  const complete = reason !== null && trimmed.length <= NOTE_MAX && (reason !== "other" || trimmed.length > 0);
  const confirm = () => { if (complete) onConfirm(reason!, trimmed || null); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Retirer le repère {number}</DialogTitle>
          <DialogDescription>
            {COUNT_MARK_SHOWN_STATE_LABELS[mark.state]} à {countMarkPlace(mark)} de la page. Le retrait est enregistré avec son motif ;
            le repère reste dans l’historique et peut être rétabli.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3" onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey || (event.target as HTMLElement).closest("button")) return;
          event.preventDefault();
          confirm();
        }}>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Motif du retrait</legend>
            {TAKEOFF_COUNT_MARK_REMOVAL_REASONS.map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input type="radio" name="repere-retrait-motif" value={value} checked={reason === value} onChange={() => setReason(value)} />
                {TAKEOFF_COUNT_MARK_REASON_LABELS[value]}
              </label>
            ))}
          </fieldset>
          <Field>
            <FieldLabel htmlFor={noteId}>{reason === "other" ? "Note (obligatoire)" : "Note (facultative)"}</FieldLabel>
            <Textarea id={noteId} rows={2} value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.target.value)} />
            <FieldDescription>{NOTE_MAX} caractères au plus.</FieldDescription>
          </Field>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button variant="danger" disabled={!complete} onClick={confirm}>Retirer le repère</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReattributeDialog({ number, targets, onClose, onConfirm }: { number: number; targets: CountMarksTarget[]; onClose: () => void;
  onConfirm: (target: CountMarksTarget) => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const target = targets.find(({ answerId }) => answerId === chosen) ?? null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Affecter le repère {number} à un autre poste</DialogTitle>
          <DialogDescription>
            Le repère est retiré de ce poste et retenu pour le poste choisi, dans la même lecture : les deux décomptes changent.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex max-h-64 flex-col gap-2 overflow-y-auto" onKeyDown={(event) => {
          if (event.key === "Enter" && target) {
            event.preventDefault();
            onConfirm(target);
          }
        }}>
          <legend className="mb-1 text-sm font-medium">Poste qui reçoit le repère</legend>
          {targets.map((option) => (
            <label key={option.answerId} className="flex items-center gap-2 text-sm">
              <input type="radio" name="repere-affectation" value={option.answerId} checked={chosen === option.answerId}
                onChange={() => setChosen(option.answerId)} />
              {option.label}
            </label>
          ))}
        </fieldset>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={!target} onClick={() => { if (target) onConfirm(target); }}>Affecter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuestionDialog({ marks, numbers }: { marks: CountMarksContextValue; numbers: Record<string, number> }) {
  const question = marks.question;
  if (!question) return null;
  const near = question.neighbours.map((neighbour) => numbers[neighbour.markId] ? `le repère ${numbers[neighbour.markId]}` : "un repère retenu");
  const who = near.join(", ");
  const pointing = question.kind === "add" || question.kind === "move";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) marks.answerQuestion("cancel"); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Même objet ou objet distinct ?</DialogTitle>
          <DialogDescription>
            {who.charAt(0).toUpperCase() + who.slice(1)} {near.length > 1 ? "sont retenus" : "est retenu"} pour ce poste à moins de 4 points.
            Dites s’il s’agit du même objet ou d’un objet distinct : l’écran ne le décide pas.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2" data-testid="reperes-question">
          {question.kind === "add" ? (
            <Button variant="outline" onClick={() => marks.answerQuestion({ object: "same", sameAs: question.neighbours[0]!.markId })}>
              Même objet : ne rien ajouter
            </Button>
          ) : null}
          {!pointing ? question.neighbours.map((neighbour) => (
            <Button key={neighbour.markId} variant="outline" onClick={() => marks.answerQuestion({ object: "same", sameAs: neighbour.markId })}>
              {isDraftMarkId(neighbour.markId) ? "Même objet que votre ajout non enregistré : retirer l’ajout"
                : `Même objet que ${numbers[neighbour.markId] ? `le repère ${numbers[neighbour.markId]}` : "le repère retenu"}`}
            </Button>
          )) : null}
          <Button onClick={() => marks.answerQuestion({ object: "distinct" })}>
            {question.kind === "add" ? "Objet distinct : ajouter" : question.kind === "move" ? "Objet distinct : déplacer" : "Objet distinct"}
          </Button>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Annuler</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefusedQuestionDialog({ marks, numbers }: { marks: CountMarksContextValue; numbers: Record<string, number> }) {
  const asked = marks.refusedQuestion;
  if (!asked) return null;
  const decides = asked.op === "retain" || asked.op === "restore";
  // Each mark by its number in the list and its place on the page, so that two neighbours are told apart; one not loaded
  // yet is being read (the scope reads the page's next lots for it).
  const loaded = (markId: string) => marks.shown.find((mark) => mark.markId === markId) ?? null;
  // A reattribution's target retains the marks named: read from its page, named by its item and their place.
  const targetLabel = marks.targets.find((target) => target.answerId === asked.answerId)?.label ?? "l’autre poste";
  // A neighbour read for the question (another answer's, or another page's than the one shown), else one of the page shown.
  const neighbour = (markId: string) => marks.refusedNeighbours[markId] ?? null;
  const onOtherPage = (markId: string) => {
    const other = neighbour(markId);
    return other && other.page !== marks.page ? `, page ${other.page}` : "";
  };
  const named = (markId: string) => {
    if (isDraftMarkId(markId)) return "votre ajout non enregistré";
    const other = neighbour(markId);
    if (other) {
      return asked.answerId !== marks.answer?.answerId
        ? `le repère retenu de « ${targetLabel} » (${countMarkPlace(other)})${onOtherPage(markId)}`
        : `le repère retenu (${countMarkPlace(other)})${onOtherPage(markId)}`;
    }
    const mark = loaded(markId);
    return mark && numbers[markId] ? `le repère ${numbers[markId]} (${countMarkPlace(mark)})` : "un repère retenu hors de la liste chargée";
  };
  // Choosing one brings it to the centre, its page's sheet shown first.
  const show = (markId: string) => {
    const other = neighbour(markId);
    if (other) marks.centreOn(other.page, other);
    else marks.select(markId, { announce: false });
  };
  const inspectable = (markId: string) => !isDraftMarkId(markId) && (neighbour(markId) !== null || loaded(markId) !== null);
  const asThat = (markId: string) => { const text = named(markId); return text.startsWith("un ") ? `qu’${text}` : `que ${text}`; };
  const sameLabel = (markId: string) => isDraftMarkId(markId) ? "Même objet que votre ajout non enregistré : retirer l’ajout"
    : decides ? `Même objet ${asThat(markId)}`
      : asked.op === "add" ? `Même objet ${asThat(markId)} : ne rien ajouter`
        : asked.op === "move" ? `Même objet ${asThat(markId)} : annuler le déplacement`
          : `Même objet ${asThat(markId)} : ne pas affecter`;
  const neighbours = [...asked.twins, ...asked.additions];
  return (
    <Dialog open onOpenChange={(open) => { if (!open) marks.answerRefused("cancel"); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Même objet ou objet distinct ?</DialogTitle>
          <DialogDescription>
            À moins de 4 points de ce geste, l’enregistrement a trouvé ce qui est déjà retenu pour ce poste :
            {" "}{neighbours.map(named).join(", ")}. Dites s’il s’agit du même objet ou d’un objet distinct : l’écran ne le décide pas.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2" data-testid="reperes-question-refus">
          {/* Every neighbour named can be inspected, whatever the answer offered below. */}
          <ul aria-label="Repères retenus nommés" className="flex flex-col gap-1">
            {neighbours.filter(inspectable).map((markId) => (
              <li key={markId}>
                <Button size="xs" variant="ghost" onClick={() => show(markId)}>Voir {named(markId)}</Button>
              </li>
            ))}
          </ul>
          {/* A non-decision gesture onto a known object is withdrawn once (whatever the neighbour). */}
          {(decides ? neighbours : neighbours.slice(0, 1)).map((markId) => (
            // Choosing one (by the keyboard or the pointer) centres it on the plan.
            <Button key={markId} variant="outline" onFocus={() => show(markId)}
              onClick={() => {
                show(markId);
                marks.answerRefused({ object: "same", sameAs: markId });
              }}>
              {sameLabel(markId)}
            </Button>
          ))}
          <Button onClick={() => marks.answerRefused({ object: "distinct" })}>Objet distinct</Button>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Annuler</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MarksList({ marks, numbers }: { marks: CountMarksContextValue; numbers: Record<string, number> }) {
  const grid = useRef<HTMLTableElement>(null);
  const listed = useMemo(() => marks.shown.filter((mark) => mark.state !== "removed" && mark.state !== "withdrawn"), [marks.shown]);
  const activeIndex = listed.findIndex((mark) => mark.markId === marks.activeId);
  const [chosenPage, setChosenPage] = useState(0);
  const listPage = activeIndex >= 0 ? Math.floor(activeIndex / LIST_PAGE) : Math.min(chosenPage, Math.max(0, Math.ceil(listed.length / LIST_PAGE) - 1));
  const rows = listed.slice(listPage * LIST_PAGE, (listPage + 1) * LIST_PAGE);
  const pages = Math.max(1, Math.ceil(listed.length / LIST_PAGE));
  const names = marks.loaded?.view.names ?? {};
  const viewerId = marks.loaded?.view.viewerId ?? null;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTableElement>) => {
    const action = countMarksListKey({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey,
      shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing },
    isItemDetailFieldTarget(event.target) && event.target !== event.currentTarget);
    if (!action) return;
    event.preventDefault();
    switch (action.kind) {
      case "step": marks.step(action.step); break;
      case "edge": marks.step(action.to); break;
      case "retain": marks.decide("retain"); break;
      case "restore": marks.decide("restore"); break;
      case "remove": marks.openDialog("remove"); break;
      case "reattribute": marks.openDialog("reattribute"); break;
      case "move": marks.startMove(); break;
      case "add": marks.startAdd(); break;
      case "verify": marks.verifyPage(); break;
    }
  };

  // The active row is kept in view inside the list (not the page): the list keeps the focus, a reload included.
  useEffect(() => {
    if (!marks.activeId) return;
    const row = grid.current?.querySelector<HTMLElement>(`[data-mark="${CSS.escape(marks.activeId)}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [marks.activeId]);

  return (
    <div className="flex flex-col">
      <div className="max-h-72 overflow-auto">
        <table ref={grid} role="grid" tabIndex={0} aria-label="Repères du poste sur la page" aria-rowcount={listed.length + 1}
          aria-activedescendant={marks.activeId && activeIndex >= 0 ? `repere-${marks.activeId}` : undefined}
          aria-keyshortcuts="ArrowUp ArrowDown Home End R Delete T D A N P" data-testid="reperes-liste"
          className="data-table w-full whitespace-nowrap text-xs focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&_td]:px-2 [&_th]:px-2"
          onKeyDown={onKeyDown}>
          <thead>
            <tr role="row">
              <th role="columnheader" scope="col">N°</th>
              <th role="columnheader" scope="col">État</th>
              <th role="columnheader" scope="col">Origine</th>
              <th role="columnheader" scope="col">Position</th>
              <th role="columnheader" scope="col">Décision</th>
              <th role="columnheader" scope="col">Autre poste</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((mark) => {
              const others = mark.mark?.others ?? [];
              const decision = mark.mark && mark.mark.decidedAt ? [reasonLabel(mark.mark.reasonCode), mark.mark.reasonText,
                mark.mark.decidedBy ? (mark.mark.decidedBy === viewerId ? "par vous" : `par ${names[mark.mark.decidedBy] ?? "un membre"}`) : null,
                dateFormat.format(new Date(mark.mark.decidedAt))].filter(Boolean).join(" · ") : "";
              return (
                <tr key={mark.markId} id={`repere-${mark.markId}`} role="row" data-mark={mark.markId} data-testid="repere-ligne"
                  aria-selected={mark.markId === marks.activeId} aria-rowindex={(numbers[mark.markId] ?? 0) + 1}
                  className={cn("cursor-pointer", mark.markId === marks.activeId && "bg-primary/10")}
                  onClick={() => { marks.select(mark.markId); grid.current?.focus({ preventScroll: true }); }}>
                  <td role="gridcell" className="font-mono tabular-nums">{numbers[mark.markId]}</td>
                  <td role="gridcell">
                    {COUNT_MARK_SHOWN_STATE_LABELS[mark.state]}
                    {mark.unsaved ? <span className="ml-1 text-primary">(non enregistré)</span> : null}
                    {mark.mark?.possibleDuplicates.length ? <span className="ml-1 font-medium text-foreground">· doublon possible</span> : null}
                  </td>
                  <td role="gridcell">{mark.mark ? countMarkOriginLabel(mark.mark, names, viewerId) : "Ajouté par vous"}</td>
                  <td role="gridcell" className="font-mono tabular-nums">{countMarkPlace(mark)}</td>
                  <td role="gridcell">{decision}</td>
                  <td role="gridcell">{others.map((other) => `${COUNT_MARK_SHOWN_STATE_LABELS[other.state]} pour « ${marks.itemLabels[other.itemId] ?? "un autre poste"} »`).join(" ; ")}</td>
                </tr>
              );
            }) : (
              <tr role="row"><td role="gridcell" colSpan={6} className="text-muted-foreground">Aucun repère sur cette page.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <nav aria-label="Pages de la liste des repères" className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
          <Button size="xs" variant="ghost" disabled={listPage === 0} onClick={() => { marks.select(null); setChosenPage(listPage - 1); }}>Précédents</Button>
          <span>Repères {listPage * LIST_PAGE + 1} à {Math.min(listed.length, (listPage + 1) * LIST_PAGE)} sur {listed.length}</span>
          <Button size="xs" variant="ghost" disabled={listPage >= pages - 1} onClick={() => { marks.select(null); setChosenPage(listPage + 1); }}>Suivants</Button>
        </nav>
      ) : null}
    </div>
  );
}

function RemovedList({ marks }: { marks: CountMarksContextValue }) {
  const removed = marks.removed;
  if (!removed) return <p className="px-3 py-1 text-xs text-muted-foreground"><Spinner aria-label="Chargement" className="mr-1 inline size-3" />Lecture des repères retirés…</p>;
  if (!removed.marks.length) return <p className="px-3 py-1 text-xs text-muted-foreground">Aucun repère retiré sur cette page.</p>;
  const restoring = new Set((marks.draft?.entries ?? []).filter((entry) => entry.gesture.op === "restore").map((entry) => entry.markId));
  return (
    <ul aria-label="Repères retirés" className="divide-y divide-border-subtle text-xs" data-testid="reperes-retires">
      {removed.marks.map((mark) => (
        <li key={mark.markId} className="flex items-center justify-between gap-2 px-3 py-1">
          <span>
            {countMarkPlace(mark)} · {reasonLabel(mark.reasonCode) ?? "Retiré"}{mark.reasonText ? ` — ${mark.reasonText}` : ""}
            {restoring.has(mark.markId) ? <span className="ml-1 text-primary">(rétabli, non enregistré)</span> : null}
          </span>
          {marks.canEdit && !restoring.has(mark.markId) ? (
            <Button size="xs" variant="outline" onClick={() => marks.decide("restore", mark.markId)}>Rétablir</Button>
          ) : null}
        </li>
      ))}
      {/* The next lot follows the cursor, never a count: a lot is read once, and the last removed mark stays reachable. */}
      {removed.nextAfter || removed.total > removed.marks.length ? (
        <li className="flex items-center gap-2 px-3 py-1 text-muted-foreground">
          {removed.total > removed.marks.length ? (removed.total - removed.marks.length > 1
            ? `${removed.total - removed.marks.length} autres repères retirés.` : "1 autre repère retiré.") : null}
          {removed.nextAfter ? <Button size="xs" variant="ghost" onClick={marks.loadMoreRemoved}>Afficher la suite</Button> : null}
        </li>
      ) : null}
    </ul>
  );
}

function DraftBar({ marks, numbers, bar, onSave }: { marks: CountMarksContextValue; numbers: Record<string, number>;
  bar: RefObject<HTMLDivElement | null>; onSave: () => void }) {
  const entries = marks.draft?.entries ?? [];
  if (!entries.length) return null;
  return (
    <div ref={bar} className="flex flex-col gap-1 border-t border-border bg-surface px-3 py-2 text-xs" data-testid="reperes-session">
      <p className="font-medium text-foreground">{plural(entries.length, "modification non enregistrée", "modifications non enregistrées")}</p>
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-2">
            <span>{entryLabel(entry, numbers)}</span>
            {marks.inFlight.has(entry.id) ? <span className="text-muted-foreground">en cours d’enregistrement</span> : null}
            {marks.staleEntries.has(entry.id) ? <span className="text-danger">à revoir : ce repère a changé</span> : null}
            {marks.askWords && draftEntryAsksWord(entry) ? (
              <Button size="xs" variant="outline" onClick={() => marks.giveDistinct(entry.id)}>Objet distinct</Button>
            ) : null}
            <Button size="xs" variant="ghost" disabled={marks.inFlight.has(entry.id)} onClick={() => marks.withoutEntry(entry.id)}>
              Annuler ce geste
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button size="xs" disabled={!marks.canEdit || marks.saving} onClick={onSave}>
          {marks.saving ? <Spinner aria-label="Enregistrement" className="mr-1 size-3" /> : null}Enregistrer ({entries.length})
        </Button>
        <Button size="xs" variant="outline" disabled={marks.saving} onClick={marks.discard}>Abandonner</Button>
      </div>
    </div>
  );
}

export function CountMarksPanel() {
  const marks = useCountMarks();
  const [tab, setTab] = useState<"list" | "history">("list");
  const [withRemoved, setWithRemoved] = useState(false);
  const refusal = useRef<HTMLParagraphElement>(null);
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // « Enregistrer » is disabled while its save runs (a browser takes the focus off it then) and goes with the session bar
  // once its gestures are saved. When the save ends — whichever came first, the focus dropped or the bar unmounted — a
  // keyboard left on the bar or on the document goes where the member continues: the list's current row (the grid holds
  // it), else the panel's heading. A focus the member moved elsewhere meanwhile stays where it is.
  const bar = useRef<HTMLDivElement>(null);
  const save = marks?.save;
  const saveFromBar = useCallback(() => {
    if (!save) return;
    void save().then(() => {
      const focused = document.activeElement;
      const lost = !focused || focused === document.body || !focused.isConnected || Boolean(bar.current?.contains(focused));
      if (!lost) return;
      const grid = panel.current?.querySelector<HTMLElement>("[data-testid='reperes-liste']");
      (grid ?? heading.current)?.focus({ preventScroll: true });
    });
  }, [save]);
  const status = marks?.status;
  useEffect(() => {
    if (status === "refused") refusal.current?.focus();
  }, [status]);
  const numbers = useMemo(() => Object.fromEntries((marks?.shown ?? []).map((mark, index) => [mark.markId, index + 1])), [marks?.shown]);
  if (!marks || marks.status === "none") return null;
  const dialogMark = marks.dialog ? marks.shown.find((mark) => mark.markId === marks.dialog!.markId) ?? null : null;
  const loaded = marks.loaded;

  return (
    <section ref={panel} id={COUNT_MARKS_PANEL_ID} aria-label="Repères du poste" hidden={!marks.panelOpen}
      className="flex max-h-[28rem] shrink-0 flex-col border-t border-border bg-surface" data-testid="reperes-panneau">
      <p role="status" aria-live="polite" className="sr-only" data-testid="reperes-annonce">{marks.announcement}</p>
      {marks.status === "refused" ? (
        <p ref={refusal} tabIndex={-1} className="px-3 py-2 text-sm text-danger" data-testid="reperes-refus">
          Les repères de ce poste ne vous sont pas accessibles.
        </p>
      ) : marks.status === "outside" ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          La page {marks.page} n’a pas été lue pour ce poste : elle n’a pas de repères.
          {marks.answer?.scopePages.length ? ` Pages lues : ${marks.answer.scopePages.join(", ")}.` : ""}
        </p>
      ) : marks.status === "error" ? (
        <div className="px-3 py-2"><Alert variant="danger">Les repères de ce poste n’ont pas pu être lus.</Alert></div>
      ) : marks.status === "changing" ? (
        <p className="flex items-center gap-2 px-3 py-2 text-xs text-foreground" data-testid="reperes-changent">
          {TAKEOFF_COUNT_MARKS_READ_CHANGING_MESSAGE}
          <Button size="xs" variant="outline" onClick={marks.retry}>Relire</Button>
        </p>
      ) : marks.status === "loading" || !loaded ? (
        <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Spinner aria-label="Chargement" />Chargement des repères…</p>
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
            <h2 ref={heading} tabIndex={-1} className="text-sm font-semibold text-foreground">Repères du poste</h2>
            <span className="text-xs text-muted-foreground" data-testid="reperes-charges">
              Page {marks.page} : {loaded.marks.length} chargé{loaded.marks.length > 1 ? "s" : ""} sur {loaded.view.total} au total
            </span>
            {loaded.nextAfter ? <Button size="xs" variant="ghost" onClick={marks.loadMore}>Charger la suite</Button> : null}
            {marks.reloading ? <Spinner aria-label="Rechargement des repères" className="size-3" /> : null}
            <div role="tablist" aria-label="Vue des repères" className="ml-auto flex gap-1">
              <Button size="xs" variant={tab === "list" ? "outline" : "ghost"} role="tab" aria-selected={tab === "list"} onClick={() => setTab("list")}>Liste</Button>
              <Button size="xs" variant={tab === "history" ? "outline" : "ghost"} role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}>Historique</Button>
            </div>
          </header>
          <CountSummary marks={marks} />
          {loaded.view.coverage && <p className="px-3 py-1.5 text-xs">{describeMarkCoverage(loaded.view.coverage)}</p>}
          {!marks.canEdit && loaded.view.edit.reason ? (
            <p className="border-b border-border bg-surface-subtle px-3 py-1.5 text-xs text-foreground-secondary" data-testid="reperes-lecture-seule">
              {TAKEOFF_COUNT_MARKS_READ_ONLY_LABELS[loaded.view.edit.reason]}
            </p>
          ) : null}
          {marks.pointingBlocked ? <p className="border-b border-border bg-warning-light px-3 py-1.5 text-xs">{marks.pointingBlocked}</p> : null}
          {marks.notice ? (
            <p className="flex items-start justify-between gap-2 border-b border-border bg-surface-subtle px-3 py-1.5 text-xs text-foreground" data-testid="reperes-avis">
              <span>{marks.notice}</span>
              <Button size="xs" variant="ghost" onClick={marks.dismissNotice}>Fermer</Button>
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "list" ? (
              <>
                <MarksList marks={marks} numbers={numbers} />
                <label className="flex items-center gap-2 px-3 py-1 text-xs text-muted-foreground">
                  <input type="checkbox" checked={withRemoved} onChange={(event) => {
                    setWithRemoved(event.target.checked);
                    marks.showRemoved(event.target.checked);
                  }} />
                  Afficher les repères retirés de la page ({marks.summary?.pages.find((page) => page.page === marks.page)?.removed ?? 0})
                </label>
                {withRemoved ? <RemovedList marks={marks} /> : null}
              </>
            ) : <CountMarksHistory markNumbers={numbers} />}
          </div>
          <DraftBar marks={marks} numbers={numbers} bar={bar} onSave={saveFromBar} />
          <p className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground" data-testid="reperes-touches">
            {marks.canEdit ? `${COUNT_MARKS_LIST_KEYS_HELP} · ${COUNT_MARKS_PLAN_KEYS_HELP}` : "↑ ↓ repère · Début Fin"}
          </p>
        </>
      )}
      {marks.dialog?.kind === "remove" && dialogMark ? (
        <RemoveDialog mark={dialogMark} number={numbers[dialogMark.markId] ?? 0} onClose={marks.closeDialog}
          onConfirm={(reason, note) => { marks.closeDialog(); marks.remove(dialogMark.markId, reason, note); }} />
      ) : null}
      {marks.dialog?.kind === "reattribute" && dialogMark ? (
        <ReattributeDialog number={numbers[dialogMark.markId] ?? 0} targets={marks.targets} onClose={marks.closeDialog}
          onConfirm={(target) => { marks.closeDialog(); void marks.reattribute(dialogMark.markId, target); }} />
      ) : null}
      <QuestionDialog marks={marks} numbers={numbers} />
      <RefusedQuestionDialog marks={marks} numbers={numbers} />
    </section>
  );
}
