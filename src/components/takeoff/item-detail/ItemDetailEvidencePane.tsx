"use client";

import { forwardRef } from "react";

import type { ItemDetailDocumentState } from "@/components/takeoff/item-detail/ItemDetailPlanPane";
import { ItemTableHistory } from "@/components/takeoff/item-table/ItemTableHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import type {
  ItemDetailEntry,
  ItemDetailGestureOffer,
  ItemDetailLine,
  ItemDetailObservation,
  ItemDetailOfferedGesture,
  ItemDetailPlanChoice,
} from "@/lib/takeoff/item-detail";
import {
  ITEM_DETAIL_GESTURE_LABELS,
  ITEM_DETAIL_OUTCOME_LABELS,
  formatItemDetailDate,
  formatItemDetailPages,
  itemDetailCategoryLabel,
  itemDetailIneligibilityLabel,
} from "@/lib/takeoff/item-detail-labels";
import {
  ITEM_ANOMALY_LABELS,
  ITEM_DECISION_LABELS,
  ITEM_SET_ASIDE_REASON_LABELS,
  ITEM_STATE_LABELS,
  ITEM_UNIT_STATE_LABELS,
  formatItemQuantity,
  itemReasonLabel,
} from "@/lib/takeoff/item-table-labels";

/**
 * The right of the detail of an item: what its plan's reading says of it (the observations and their pages, or the
 * pages searched without a clue, never a point), its state on the affaire, the source of what is shown, the decisions
 * and entries with who took them, the table's journal of the item, and the item's other plans with their coverage.
 * An earlier reading (an old bookmark) shows nothing of the current one: neither its evidence, nor its decisions, nor
 * what was entered or journaled since.
 */

type Props = {
  projectId: string;
  line: ItemDetailLine;
  choice: ItemDetailPlanChoice;
  plan: ItemDetailPlanView | null;
  /** Whether the plan's bytes were served (and, for a reading, their digest checked by the route) or not. */
  documentState: ItemDetailDocumentState;
  names: Record<string, string>;
  planNames: Record<string, string>;
  outsideFilter: boolean;
  /** Moves with each change of the item the detail made: the journal is read again with it. */
  historyVersion: number;
  onRefused: (caught: unknown) => boolean;
  onObservation: (observation: ItemDetailObservation) => void;
  onPlan: (planKey: string, jobId: string | null) => void;
  /**
   * What is offered on what is shown (the detail's one rule, the keys' too): an operator of the affaire's takeoff is
   * offered the gestures the line admits on its current state, a reader none. The page confirms and sends them by the
   * table's command.
   */
  decide: { offer: (gesture: ItemDetailOfferedGesture) => ItemDetailGestureOffer; onGesture: (gesture: ItemDetailOfferedGesture) => void };
  /**
   * For an earlier reading: whether the server proved that this analysis answered the item on this plan (`proven`), is
   * checking it (`pending`) or could not (`unproven`). Nothing calls it an earlier reading of the item before it is proven.
   */
  proof?: "pending" | "proven" | "unproven" | null;
};

/** The gestures offered as buttons, in the order of the list's keys (V, E, F2, I). */
const PANE_GESTURES = ["accept_measured", "set_aside", "enter_quantity", "include_entry"] as const satisfies readonly ItemDetailOfferedGesture[];

function DecisionButtons({ line, decide }: { line: ItemDetailLine; decide: Props["decide"] }) {
  const offers = PANE_GESTURES.map((gesture) => ({ gesture, offer: decide.offer(gesture) }));
  if (offers.some(({ offer }) => !offer.offered && offer.reason === "reader")) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="poste-detail-read-only">
        Lecture seule : un opérateur du métré de l’affaire décide de ce poste.
      </p>
    );
  }
  const open = offers.filter(({ offer }) => offer.offered).map(({ gesture }) => gesture);
  if (!open.length) {
    const reason = line.eligibility.accept_measured.reason ?? line.eligibility.set_aside.reason;
    return <p className="text-xs text-muted-foreground">Aucune décision ne s’applique à ce poste : {itemDetailIneligibilityLabel(reason)}.</p>;
  }
  return (
    <div role="group" aria-label="Décider du poste" className="flex flex-wrap gap-1.5 pt-1">
      {open.map((gesture) => (
        <Button key={gesture} size="xs" variant={gesture === "accept_measured" ? "primary" : "outline"} onClick={() => decide.onGesture(gesture)}>
          {ITEM_DETAIL_GESTURE_LABELS[gesture]}
        </Button>
      ))}
    </div>
  );
}

const who = (names: Record<string, string>, actorId: string) => names[actorId] ?? "un membre";
const ROLE_LABELS = { contribution: "Comptée", candidate: "Indice, non compté", alternative: "Autre lecture, non comptée" } as const;

const READING_STATUS: Record<string, string> = {
  pending: "lecture en attente", processing: "lecture en cours", completed: "lecture terminée", applied: "lecture terminée",
  failed: "lecture en échec", canceled: "lecture arrêtée",
};
const readCompleted = (status: string) => status === "completed" || status === "applied";

/**
 * What is known of the bytes shown: « verified » only once the attested route served them (it checks their digest), and
 * « read by this analysis » only for a reading that ran; the rest is said as it is.
 */
function sourceText(plan: ItemDetailPlanView, state: ItemDetailDocumentState) {
  const reading = plan.reading;
  const status = reading ? READING_STATUS[reading.status] ?? "lecture dans un état inconnu" : null;
  const pages = plan.plan.pagesRead.length ? ` Pages demandées : ${formatItemDetailPages(plan.plan.pagesRead)}.` : "";
  const finished = reading?.finishedAt && readCompleted(reading.status) ? ` Lecture terminée le ${formatItemDetailDate(reading.finishedAt)}.` : "";
  switch (plan.document.kind) {
    case "attested": {
      const what = reading && readCompleted(reading.status) ? "Octets lus par cette analyse" : `Copie scellée pour cette analyse (${status})`;
      const served = state === "served" ? `${what}, servis et vérifiés (empreinte conforme).`
        : state === "failed" ? "La copie scellée n’a pas pu être servie." : `${what} : ouverture en cours.`;
      return `${served}${finished}${pages}`;
    }
    case "dossier":
      return state === "failed" ? "La copie actuelle du dossier n’a pas pu être ouverte."
        : "Copie actuelle du dossier au moment de l’ouverture, signée pour vous.";
    default:
      return `Plan non affichable.${reading ? ` Analyse : ${status}.` : ""}`;
  }
}

function EntryText({ entry, names }: { entry: ItemDetailEntry; names: Record<string, string> }) {
  return (
    <>
      {formatItemQuantity(entry.quantity, entry.unit)} · {itemDetailCategoryLabel(entry.category)}
      {entry.note ? ` — ${entry.note}` : ""} · {who(names, entry.actorId)}, le {formatItemDetailDate(entry.at)}
      {entry.previous ? ` · valeur antérieure ${formatItemQuantity(entry.previous.quantity, entry.previous.unit)}` : ""}
      {entry.category === "hypothesis" && !entry.included ? " · hypothèse non incluse" : ""}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5 border-b border-border-subtle px-3 py-2.5 text-sm">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export const ItemDetailEvidencePane = forwardRef<HTMLHeadingElement, Props>(function ItemDetailEvidencePane(
  { projectId, line, choice, plan, documentState, names, planNames, outsideFilter, historyVersion, onRefused, onObservation, onPlan,
    decide, proof = null }, heading) {
  // An earlier reading (an old bookmark) shows nothing of the current one: its answer, decision and entry are not its own.
  const earlier = choice.kind === "reading" && !choice.current;
  const reading = !earlier && (choice.kind === "reading" || choice.kind === "dossier") ? choice.reading : null;
  const answer = choice.kind === "reading" && choice.current ? reading?.answer ?? null : null;
  const selectedObservation = choice.kind === "reading" ? choice.observationId : null;
  const unread = line.remeasurePlans.filter((key) => !line.readings.some((entry) => entry.planKey === key));
  const shownPlan = choice.kind === "reading" || choice.kind === "dossier" ? choice.planKey
    : choice.kind === "source" ? choice.documentId : null;

  return (
    <aside aria-label="Preuve et décisions du poste" className="flex min-h-0 w-full flex-col overflow-y-auto bg-surface">
      <div className="space-y-1 border-b border-border px-3 py-2.5">
        <h2 ref={heading} tabIndex={-1} className="text-base font-semibold text-foreground focus:outline-none">{line.label}</h2>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge size="sm" variant={line.state === "measured" ? "success" : line.state === "to_measure" ? "neutral" : "warning"}>
            {ITEM_STATE_LABELS[line.state]}
          </Badge>
          {line.decision === "none" ? null : <span>{ITEM_DECISION_LABELS[line.decision]}</span>}
          {line.expectedUnit ? <span>· unité {line.expectedUnit}</span> : null}
          {line.family ? <span>· {line.family}</span> : null}
          {outsideFilter ? <Badge size="sm" variant="outline">Hors du filtre</Badge> : null}
        </p>
      </div>

      {reading?.sent ? (
        <p role="status" className="border-b border-border bg-surface-subtle px-3 py-2 text-xs" data-testid="poste-detail-sent">
          Ce plan est envoyé au devis : sa lecture se consulte ici, aucune décision ne s’y prend plus.
        </p>
      ) : null}

      <Section title="Preuve">
        {earlier && proof === "pending" ? (
          <p className="text-muted-foreground" role="status">Vérification de cette lecture pour ce poste…</p>
        ) : earlier && proof !== "proven" ? (
          <p className="text-muted-foreground">Cette lecture n’a pas pu être vérifiée pour ce poste.</p>
        ) : earlier ? (
          <p>Lecture antérieure du poste sur ce plan : sa preuve n’est pas celle de la lecture actuelle, qui est montrée
            depuis les autres plans du poste.</p>
        ) : choice.kind === "dossier" || choice.kind === "source" ? (
          <p>À mesurer : aucune analyse n’a encore lu ce poste sur ce plan. Le plan affiché est celui du dossier.</p>
        ) : choice.kind === "none" || choice.kind === "mismatch" ? (
          <p>Aucun plan n’est associé à ce poste pour le moment.</p>
        ) : !answer ? (
          <p>{reading ? ITEM_UNIT_STATE_LABELS[reading.unit] : "Pas de lecture"} : aucune réponse de ce plan pour ce poste.</p>
        ) : answer.outcome === "not_found" ? (
          <p data-testid="poste-detail-not-found">
            Non trouvé sur les pages cherchées : {formatItemDetailPages(answer.searchedPages)}. Aucun repère n’est proposé.
          </p>
        ) : (
          <>
            <p>{ITEM_DETAIL_OUTCOME_LABELS[answer.outcome]}{answer.quantity ? ` · ${formatItemQuantity(answer.quantity.quantity,
              answer.quantity.unit)}` : ""}{answer.reasonText ? ` — ${answer.reasonText}` : ""}</p>
            {answer.candidate ? (
              <p>Valeur candidate (non mesurée) : {formatItemQuantity(answer.candidate.quantity, answer.candidate.unit)}</p>
            ) : null}
            {answer.observations.length ? (
              <div className="-mx-3 overflow-x-auto">
                <table aria-label="Observations" className="sheet-table w-full border-collapse border-y border-border text-left text-xs
                  [&_tbody_tr]:border-t [&_tbody_tr]:border-border [&_td]:px-3 [&_td]:py-1 [&_th]:px-3 [&_th]:py-1">
                  <thead>
                    <tr>
                      <th scope="col">Quantité</th>
                      <th scope="col">Page</th>
                      <th scope="col">Rôle</th>
                      <th scope="col">Source</th>
                      <th scope="col">Confiance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {answer.observations.map((observation) => (
                      <tr key={observation.observationId} aria-current={observation.observationId === selectedObservation ? "true" : undefined}
                        className={observation.observationId === selectedObservation ? "bg-primary/10" : undefined}>
                        <td className="whitespace-nowrap tabular-nums">
                          {formatItemQuantity(observation.quantity, observation.unit)}
                          {observation.row && (observation.row.quantity !== observation.quantity || observation.row.unit !== observation.unit)
                            ? <span className="block text-muted-foreground">revue : {formatItemQuantity(observation.row.quantity, observation.row.unit)}</span>
                            : null}
                        </td>
                        <td>
                          {observation.page === null ? "—" : (
                            <Button variant="link" size="xs" className="h-auto p-0" aria-pressed={observation.observationId === selectedObservation}
                              aria-label={`Page ${observation.page} : ${observation.evidence ?? "observation"}`} onClick={() => onObservation(observation)}>
                              {observation.page}
                            </Button>
                          )}
                        </td>
                        <td>{ROLE_LABELS[observation.role]}{observation.row?.isExcluded ? " · ligne exclue" : ""}</td>
                        <td className="whitespace-normal">{observation.evidence ?? "—"}</td>
                        <td className="tabular-nums">{observation.confidence === null ? "—" : `${Math.round(observation.confidence * 100)} %`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
        {answer && answer.outcome !== "not_found" ? <p className="text-xs text-muted-foreground">Pages cherchées : {formatItemDetailPages(answer.searchedPages)}</p> : null}
        {answer?.unreadablePages.length ? <p className="text-xs text-warning">Pages illisibles : {formatItemDetailPages(answer.unreadablePages)}</p> : null}
        {answer?.anomalies.length ? <p className="text-xs">À vérifier : {answer.anomalies.map((anomaly) => ITEM_ANOMALY_LABELS[anomaly]).join(" · ")}</p> : null}
      </Section>

      <Section title="État">
        <p>{line.coverage.expected === 0 ? "Aucun plan lu" : `${line.coverage.answered} plan${line.coverage.answered > 1 ? "s" : ""} sur ${line.coverage.expected} ont répondu`}
          {line.coverage.inFlight ? ` · ${line.coverage.inFlight} en lecture` : ""}</p>
        <p>Observé : {line.observed ? `${formatItemQuantity(line.observed.quantity, line.observed.unit)}${line.observed.partial ? " (partiel)" : ""}` : "—"}</p>
        <p>Retenu : {line.retained ? `${formatItemQuantity(line.retained.quantity, line.retained.unit)}${line.retained.partial ? " (partiel)" : ""}` : "—"}</p>
        {line.reasons.length ? <p className="text-xs">{[...new Set(line.reasons.map(itemReasonLabel))].join(" · ")}</p> : null}
      </Section>

      <Section title="Source">
        {plan ? (
          <>
            <p>{plan.plan.name}{plan.plan.generation ? ` · génération ${plan.plan.generation}` : ""}</p>
            <p className="text-xs text-muted-foreground">{sourceText(plan, documentState)}</p>
          </>
        ) : <p className="text-muted-foreground">—</p>}
      </Section>

      <Section title="Décisions">
        {earlier ? <p className="text-muted-foreground">Les décisions portent sur la lecture actuelle de ce plan.</p> : (
          <>
            {reading?.decision ? (
              <p>{reading.decision.kind === "accepted" ? "Accepté"
                : `Écarté (${ITEM_SET_ASIDE_REASON_LABELS[reading.decision.reason]}${reading.decision.note ? ` — ${reading.decision.note}` : ""})`}
              {" "}par {who(names, reading.decision.actorId)}, le {formatItemDetailDate(reading.decision.at)}</p>
            ) : <p className="text-muted-foreground">Aucune décision sur ce plan.</p>}
            {reading?.entry ? <p>Saisi sur ce plan : <EntryText entry={reading.entry} names={names} /></p> : null}
            {line.entry ? <p>Saisi pour le poste : <EntryText entry={line.entry} names={names} /></p> : null}
            <DecisionButtons line={line} decide={decide} />
          </>
        )}
      </Section>

      <Section title="Historique">
        {earlier ? <p className="text-xs text-muted-foreground">L’historique porte sur la lecture actuelle du poste.</p> : (
          <ItemTableHistory key={`${line.itemId}:${historyVersion}`} projectId={projectId} itemId={line.itemId} version={historyVersion}
            onRefused={onRefused}
            plans={Object.fromEntries(line.readings.map(({ planKey, planName }) => [planKey, planName]))} />
        )}
      </Section>

      <Section title="Plans du poste">
        <ul aria-label="Plans du poste" className="space-y-1">
          {line.readings.map((entry) => {
            // The reading shown, not only its plan: from an earlier reading, its plan's current reading opens.
            const shown = shownPlan === entry.planKey && !earlier;
            return (
              <li key={entry.planKey}>
                <Button variant={shown ? "secondary" : "ghost"} size="xs" aria-current={shown ? "true" : undefined}
                  className="h-auto w-full justify-between whitespace-normal py-1 text-left"
                  onClick={() => { if (!shown) onPlan(entry.planKey, entry.answer?.jobId ?? null); }}>
                  <span>{entry.planName}{entry.location ? ` · ${entry.location}` : ""}{entry.sent ? " · envoyé" : ""}</span>
                  <span className="text-muted-foreground">
                    {entry.answer ? ITEM_DETAIL_OUTCOME_LABELS[entry.answer.outcome] : ITEM_UNIT_STATE_LABELS[entry.unit]}
                  </span>
                </Button>
              </li>
            );
          })}
          {unread.map((key) => {
            const shown = shownPlan === key;
            return (
              <li key={key}>
                <Button variant={shown ? "secondary" : "ghost"} size="xs" aria-current={shown ? "true" : undefined}
                  className="h-auto w-full justify-between py-1 text-left" onClick={() => { if (!shown) onPlan(key, null); }}>
                  <span>{planNames[key] ?? (shown && plan ? plan.plan.name : "Plan du dossier")}</span>
                  <span className="text-muted-foreground">À mesurer</span>
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Couverture : {line.coverage.answered}/{line.coverage.expected} plan{line.coverage.expected > 1 ? "s" : ""}
        </p>
      </Section>
    </aside>
  );
});
