"use client";

import { forwardRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import type { ItemDetailEntry, ItemDetailLine, ItemDetailObservation, ItemDetailPlanChoice } from "@/lib/takeoff/item-detail";
import {
  ITEM_DETAIL_DECISION_LABELS,
  ITEM_DETAIL_OUTCOME_LABELS,
  ITEM_DETAIL_STATE_LABELS,
  ITEM_DETAIL_UNIT_STATE_LABELS,
  formatItemDetailDate,
  formatItemDetailPages,
  formatItemDetailQuantity,
  itemDetailAnomalyLabel,
  itemDetailCategoryLabel,
  itemDetailReasonLabel,
  itemDetailSetAsideLabel,
} from "@/lib/takeoff/item-detail-labels";

/**
 * The right of the detail of an item: what its plan's reading says of it (the observations and their pages, or the
 * pages searched without a clue, never a point), its state on the affaire, the source of what is shown, the decisions
 * and entries with who took them, their history, and the item's other plans with their coverage.
 */

type Props = {
  line: ItemDetailLine;
  choice: ItemDetailPlanChoice;
  plan: ItemDetailPlanView | null;
  names: Record<string, string>;
  planNames: Record<string, string>;
  page: number;
  outsideFilter: boolean;
  onObservation: (observation: ItemDetailObservation) => void;
  onPlan: (planKey: string, jobId: string | null) => void;
};

const who = (names: Record<string, string>, actorId: string) => names[actorId] ?? "un membre";

function EntryText({ entry, names }: { entry: ItemDetailEntry; names: Record<string, string> }) {
  return (
    <>
      {formatItemDetailQuantity(entry.quantity, entry.unit)} · {itemDetailCategoryLabel(entry.category)}
      {entry.note ? ` — ${entry.note}` : ""} · {who(names, entry.actorId)}, le {formatItemDetailDate(entry.at)}
      {entry.previous ? ` · valeur antérieure ${formatItemDetailQuantity(entry.previous.quantity, entry.previous.unit)}` : ""}
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
  { line, choice, plan, names, planNames, page, outsideFilter, onObservation, onPlan }, heading) {
  // An earlier reading (an old bookmark) shows nothing of the current one: its answer, decision and entry are not its own.
  const earlier = choice.kind === "reading" && !choice.current;
  const reading = !earlier && (choice.kind === "reading" || choice.kind === "dossier") ? choice.reading : null;
  const answer = choice.kind === "reading" && choice.current ? reading?.answer ?? null : null;
  const history = [
    ...(answer ? [{ at: answer.readAt, text: `Lu sur ${reading?.planName ?? "le plan"} : ${ITEM_DETAIL_OUTCOME_LABELS[answer.outcome]}` }] : []),
    ...(reading?.decision ? [{ at: reading.decision.at, text: `${reading.decision.kind === "accepted" ? "Accepté" : "Écarté"} par ${who(names, reading.decision.actorId)}` }] : []),
    ...(reading?.entry ? [{ at: reading.entry.at, text: `Quantité saisie par ${who(names, reading.entry.actorId)}` }] : []),
    ...(line.entry ? [{ at: line.entry.at, text: `Quantité du poste saisie par ${who(names, line.entry.actorId)}` }] : []),
  ].sort((left, right) => left.at.localeCompare(right.at));
  const unread = line.remeasurePlans.filter((key) => !line.readings.some((entry) => entry.planKey === key));

  return (
    <aside aria-label="Preuve et décisions du poste" className="flex min-h-0 w-full flex-col overflow-y-auto bg-surface">
      <div className="space-y-1 border-b border-border px-3 py-2.5">
        <h2 ref={heading} tabIndex={-1} className="text-base font-semibold text-foreground focus:outline-none">{line.label}</h2>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge size="sm" variant={line.state === "measured" ? "success" : line.state === "to_measure" ? "neutral" : "warning"}>
            {ITEM_DETAIL_STATE_LABELS[line.state]}
          </Badge>
          <span>{ITEM_DETAIL_DECISION_LABELS[line.decision]}</span>
          {line.expectedUnit ? <span>· unité {line.expectedUnit}</span> : null}
          {line.family ? <span>· {line.family}</span> : null}
          {outsideFilter ? <Badge size="sm" variant="outline">Hors du filtre</Badge> : null}
        </p>
      </div>

      <Section title="Preuve">
        {earlier ? (
          <p>Lecture antérieure du poste sur ce plan : sa preuve n’est pas celle de la lecture actuelle, qui est montrée
            depuis les autres plans du poste.</p>
        ) : choice.kind === "dossier" || choice.kind === "source" ? (
          <p>À mesurer : aucune analyse n’a encore lu ce poste sur ce plan. Le plan affiché est celui du dossier.</p>
        ) : choice.kind === "none" ? (
          <p>Aucun plan n’est associé à ce poste pour le moment.</p>
        ) : !answer ? (
          <p>{reading ? ITEM_DETAIL_UNIT_STATE_LABELS[reading.unit] : "Pas de lecture"} : aucune réponse de ce plan pour ce poste.</p>
        ) : answer.outcome === "not_found" ? (
          <p data-testid="poste-detail-not-found">
            Non trouvé sur les pages cherchées : {formatItemDetailPages(answer.searchedPages)}. Aucun repère n’est proposé.
          </p>
        ) : (
          <>
            <p>{ITEM_DETAIL_OUTCOME_LABELS[answer.outcome]}{answer.reasonText ? ` — ${answer.reasonText}` : ""}</p>
            {answer.candidate ? (
              <p>Valeur candidate (non mesurée) : {formatItemDetailQuantity(answer.candidate.quantity, answer.candidate.unit)}</p>
            ) : null}
            {answer.observations.length ? (
              <ul aria-label="Observations" className="space-y-1">
                {answer.observations.map((observation) => (
                  <li key={observation.observationId}>
                    <Button variant={observation.page === page ? "secondary" : "ghost"} size="xs" className="h-auto w-full justify-start whitespace-normal py-1 text-left"
                      disabled={observation.page === null} onClick={() => onObservation(observation)}>
                      <span>
                        <span className="font-medium tabular-nums">{formatItemDetailQuantity(observation.quantity, observation.unit)}</span>
                        {observation.page !== null ? ` · page ${observation.page}` : " · page inconnue"}
                        {observation.evidence ? ` · ${observation.evidence}` : ""}
                        {observation.confidence !== null ? ` · confiance ${Math.round(observation.confidence * 100)} %` : ""}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        {answer && answer.outcome !== "not_found" ? <p className="text-xs text-muted-foreground">Pages cherchées : {formatItemDetailPages(answer.searchedPages)}</p> : null}
        {answer?.unreadablePages.length ? <p className="text-xs text-warning">Pages illisibles : {formatItemDetailPages(answer.unreadablePages)}</p> : null}
        {answer?.anomalies.length ? <p className="text-xs">À vérifier : {answer.anomalies.map(itemDetailAnomalyLabel).join(" · ")}</p> : null}
      </Section>

      <Section title="État">
        <p>{line.coverage.expected === 0 ? "Aucun plan lu" : `${line.coverage.answered} plan${line.coverage.answered > 1 ? "s" : ""} sur ${line.coverage.expected} ont répondu`}
          {line.coverage.inFlight ? ` · ${line.coverage.inFlight} en lecture` : ""}</p>
        <p>Observé : {line.observed ? `${formatItemDetailQuantity(line.observed.quantity, line.observed.unit)}${line.observed.partial ? " (partiel)" : ""}` : "—"}</p>
        <p>Retenu : {line.retained ? `${formatItemDetailQuantity(line.retained.quantity, line.retained.unit)}${line.retained.partial ? " (partiel)" : ""}` : "—"}</p>
        {line.reasons.length ? <p className="text-xs">{[...new Set(line.reasons.map(itemDetailReasonLabel))].join(" · ")}</p> : null}
      </Section>

      <Section title="Source">
        {plan ? (
          <>
            <p>{plan.plan.name}{plan.plan.generation ? ` · génération ${plan.plan.generation}` : ""}</p>
            <p className="text-xs text-muted-foreground">
              {plan.document.kind === "attested" ? "Octets lus par cette analyse, vérifiés à l’affichage."
                : plan.document.kind === "dossier" ? "Copie actuelle du dossier." : "Plan non affichable."}
              {plan.reading?.finishedAt ? ` Lecture terminée le ${formatItemDetailDate(plan.reading.finishedAt)}.` : ""}
              {plan.plan.pagesRead.length ? ` Pages lues : ${formatItemDetailPages(plan.plan.pagesRead)}.` : ""}
            </p>
          </>
        ) : <p className="text-muted-foreground">—</p>}
      </Section>

      <Section title="Décisions">
        {reading?.decision ? (
          <p>{reading.decision.kind === "accepted" ? "Accepté"
            : `Écarté (${itemDetailSetAsideLabel(reading.decision.reason)}${reading.decision.note ? ` — ${reading.decision.note}` : ""})`}
          {" "}par {who(names, reading.decision.actorId)}, le {formatItemDetailDate(reading.decision.at)}</p>
        ) : <p className="text-muted-foreground">{earlier ? "Les décisions portent sur la lecture actuelle de ce plan." : "Aucune décision sur ce plan."}</p>}
        {reading?.entry ? <p>Saisi sur ce plan : <EntryText entry={reading.entry} names={names} /></p> : null}
        {line.entry ? <p>Saisi pour le poste : <EntryText entry={line.entry} names={names} /></p> : null}
      </Section>

      <Section title="Historique">
        {history.length ? (
          <ol aria-label="Historique" className="space-y-0.5 text-xs">
            {history.map((event) => <li key={`${event.at}:${event.text}`}>{formatItemDetailDate(event.at)} · {event.text}</li>)}
          </ol>
        ) : <p className="text-xs text-muted-foreground">Rien d’enregistré pour le moment.</p>}
      </Section>

      <Section title="Plans du poste">
        <ul aria-label="Plans du poste" className="space-y-1">
          {line.readings.map((entry) => {
            const shown = choice.kind !== "none" && choice.kind !== "source" && choice.planKey === entry.planKey;
            return (
              <li key={entry.planKey}>
                <Button variant={shown ? "secondary" : "ghost"} size="xs" aria-current={shown ? "true" : undefined}
                  className="h-auto w-full justify-between whitespace-normal py-1 text-left"
                  onClick={() => onPlan(entry.planKey, entry.answer?.jobId ?? null)}>
                  <span>{entry.planName}{entry.location ? ` · ${entry.location}` : ""}</span>
                  <span className="text-muted-foreground">
                    {entry.answer ? ITEM_DETAIL_OUTCOME_LABELS[entry.answer.outcome] : ITEM_DETAIL_UNIT_STATE_LABELS[entry.unit]}
                  </span>
                </Button>
              </li>
            );
          })}
          {unread.map((key) => {
            const shown = choice.kind === "dossier" && choice.planKey === key;
            return (
              <li key={key}>
                <Button variant={shown ? "secondary" : "ghost"} size="xs" aria-current={shown ? "true" : undefined}
                  className="h-auto w-full justify-between py-1 text-left" onClick={() => onPlan(key, null)}>
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
