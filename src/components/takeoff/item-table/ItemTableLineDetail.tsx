"use client";

import { ItemQuantityChoiceButtons } from "./ItemQuantityChoice";
import type { ItemQuantityChoice } from "@/lib/takeoff/item-table";
import Link from "next/link";
import useSWR from "swr";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { fetchMeasureReview } from "@/lib/takeoff/item-table-client";

import type { ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";
import {
  formatItemQuantity,
  ITEM_ANOMALY_LABELS,
  ITEM_SET_ASIDE_REASON_LABELS,
  ITEM_UNIT_STATE_LABELS,
} from "@/lib/takeoff/item-table-labels";
import { QUANTITY_ENTRY_CATEGORIES } from "@/lib/takeoff/quantity-entry";
import { takeoffReviewHref, takeoffItemDetailHref } from "@/lib/takeoff/review-href";
import { describeItemUncertainty } from "@/lib/takeoff/item-uncertainty";
import { Button } from "@/components/ui/button";
import { ItemTableHistory } from "./ItemTableHistory";
import { PARIS_DATE_TIME_FORMAT as dateFormat } from "@/lib/format/fr";

const OUTCOME_LABELS = { measured: "Mesuré", uncertain: "Incertain", not_found: "Non trouvé" } as const;
const pages = (list: number[]) => list.length ? list.join(", ") : "—";

type Entry = NonNullable<ItemTableResponseLine["entry"]>;

function EntryFacts({ entry, names }: { entry: Entry; names: Record<string, string> }) {
  const category = (QUANTITY_ENTRY_CATEGORIES as Record<string, string>)[entry.category] ?? "Saisie";
  return (
    <p className="text-sm">
      Saisi : {formatItemQuantity(entry.quantity, entry.unit)} · {category}{entry.note ? ` — ${entry.note}` : ""}
      {" · "}{names[entry.actorId] ?? "un membre"}, le {dateFormat.format(new Date(entry.at))}
      {entry.previous ? ` · valeur antérieure ${formatItemQuantity(entry.previous.quantity, entry.previous.unit)}` : ""}
      {entry.category === "hypothesis" && !entry.included ? " · hypothèse non incluse" : ""}
    </p>
  );
}

type Reading = ItemTableResponseLine["readings"][number];
type Answer = NonNullable<Reading["answer"]>;

function ContributionReviewLink({ projectId, viewerKey, itemId, planKey, answer, version, onRefused }: {
  projectId: string; viewerKey: string; itemId: string; planKey: string; answer: Answer;
  version: number; onRefused: (error: unknown) => boolean;
}) {
  const query = useSearchParams();
  const contributions = answer.observations.filter(row => row.role === "contribution" && row.takeoffItemId);
  const failed = answer.anomalies.includes("rule_failed");
  const multiple = failed && contributions.length > 1;
  const review = useSWR(multiple ? ["poste-justifications", projectId, viewerKey, answer.answerId, version] : null,
    () => fetchMeasureReview(projectId, answer.answerId), { shouldRetryOnError: false });
  useEffect(() => { if (review.error) onRefused(review.error); }, [review.error, onRefused]);
  const pending = review.data?.rows.filter(row => row.needs_justification && row.id);
  if (multiple && pending?.length !== 1) {
    const href = takeoffItemDetailHref({ projectId, itemId, planKey, jobId: answer.jobId, from: query.toString() });
    return <Link className="underline" prefetch={false} href={href}>Vérifier les contributions dans le détail du poste</Link>;
  }
  const line = multiple ? pending?.[0].id : failed ? contributions[0]?.takeoffItemId
    : answer.observations.find(row => row.takeoffItemId)?.takeoffItemId;
  const href = takeoffReviewHref({ projectId, jobId: answer.jobId, targeted: true, line: line ?? undefined });
  const context = failed && line ? "&" + new URLSearchParams({ reponse: answer.answerId, contribution: line }) : "";
  return <Link className="underline" prefetch={false} href={href + context}>Voir la preuve et corriger dans la revue ciblée</Link>;
}

/**
 * The detail of an item: each plan it was asked about, the answer of that plan (the model's raw result, kept as read),
 * its pages, sources and reasons, its positive rows as they are once reviewed, the decision taken and who took it, the
 * quantity entered, and the review's history (who accepted, set aside or reinstated it, and why). The targeted proof and
 * correction of the existing review stays one link away.
 */
export function ItemTableLineDetail({ line, projectId, viewerKey, names, canReview, busy, onIncludeEntry, onChooseQuantity, historyVersion, onRefused }: {
  line: ItemTableResponseLine;
  viewerKey: string;
  projectId: string;
  names: Record<string, string>;
  canReview: boolean;
  busy: boolean;
  onChooseQuantity: (choice: ItemQuantityChoice) => void;
  onIncludeEntry: (line: ItemTableResponseLine) => void;
  /** Moves with each read of the table: the history is read again with it. */
  historyVersion: number;
  /** A refused read of the affaire: the table withdraws itself, this detail with it. */
  onRefused: (caught: unknown) => boolean;
}) {
  return (
    <div className="space-y-3 py-2" data-testid={`poste-detail-${line.itemId}`}>
      {(line.entry?.scope === "affaire" || line.wholeEntry) && <p>Le total saisi pour toute l’affaire ne part avec aucun plan. Vous pouvez le rattacher à un plan ou retirer la saisie de l’affaire.</p>}
      {line.entry ? (
        <div className="space-y-1">
          <EntryFacts entry={line.entry} names={names} />
          {canReview && line.eligibility.include_entry.eligible ? (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => onIncludeEntry(line)}>
              Inclure l’hypothèse saisie
            </Button>
          ) : null}
        </div>
      ) : null}
      {line.readings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucun plan n’a encore été lu pour ce poste. Une nouvelle mesure le fera lire sur les plans de l’affaire.
        </p>
      ) : (
        <ul className="space-y-3">
          {line.readings.map((reading) => {
            const answer = reading.answer;
            const uncertainty = answer?.outcome === "uncertain" ? describeItemUncertainty(answer, line.expectedUnit, false) : null;
            return (
              <li key={reading.planKey} className="rounded-md border border-border p-3">
                <p className="text-sm font-medium">
                  {reading.planName}{reading.location ? ` · ${reading.location}` : ""} ·{" "}
                  {answer ? OUTCOME_LABELS[answer.outcome] : ITEM_UNIT_STATE_LABELS[reading.unit]}
                </p>
                {answer && reading.attempt ? (
                  <p className="mt-1 text-sm" data-testid={`poste-reading-attempt-${reading.planKey}`}>
                    {reading.attempt.unit === "queued" || reading.attempt.unit === "running"
                      ? "Nouvelle mesure en cours sur ce plan : la lecture ci-dessous reste celle retenue tant qu’elle n’a pas abouti."
                      : `La nouvelle mesure de ce plan n’a pas abouti${reading.attempt.reason ? ` : ${reading.attempt.reason}` : "."}`
                        + " La lecture précédente ci-dessous reste celle retenue."}
                  </p>
                ) : null}
                {answer ? (
                  <div className="mt-1 space-y-1 text-sm">
                    {uncertainty?.action !== "unavailable" ? <p>
                      Pages cherchées : {pages(answer.searchedPages)}
                      {answer.unreadablePages.length ? ` · pages illisibles : ${pages(answer.unreadablePages)}` : ""}
                    </p> : null}
                    {uncertainty ? <p>{uncertainty.reasons.length ? uncertainty.reasons.join(" · ") : uncertainty.obstacle}</p>
                      : answer.reasonText ? <p>Motif de la lecture : {answer.reasonText}</p> : null}
                    {uncertainty?.candidate ? <p>{uncertainty.candidate}</p> : null}
                    {answer.anomalies.length ? (
                      <p>À vérifier : {answer.anomalies.map((anomaly) => ITEM_ANOMALY_LABELS[anomaly]).join(" · ")}</p>
                    ) : null}
                    {answer.observations.length ? (
                      <ul className="list-disc space-y-0.5 pl-5">
                        {answer.observations.map((observation) => (
                          <li key={observation.observationId}>
                            {formatItemQuantity(observation.quantity, observation.unit)}
                            {observation.role === "alternative" ? " (autre lecture, non comptée)"
                              : observation.role === "candidate" ? " (indice, non compté)" : ""}
                            {observation.row && (observation.row.quantity !== observation.quantity || observation.row.unit !== observation.unit)
                              ? ` · ligne revue : ${formatItemQuantity(observation.row.quantity, observation.row.unit)}` : ""}
                            {observation.row?.isExcluded ? " · ligne exclue" : ""}
                            {observation.page ? ` · page ${observation.page}` : ""}
                            {observation.evidence ? ` · source : ${observation.evidence}` : ""}
                            {observation.confidence !== null ? ` · confiance ${Math.round(observation.confidence * 100)} %` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {reading.verifiedMarks?.verified ? <p>{reading.verifiedMarks.quantity === null ? "Repères vérifiés, sans quantité" :
                      `Comptage vérifié${reading.quantityDecision?.source === "verified_count" && reading.decision?.kind === "accepted" ? " retenu" : ""} · ${formatItemQuantity(reading.verifiedMarks.quantity, reading.verifiedMarks.unit)}`}</p> : null}
                    {canReview && line.quantityOptions ? <ItemQuantityChoiceButtons options={line.quantityOptions} disabled={busy}
                      onChoose={onChooseQuantity} /> : null}
                    {reading.decision ? (
                      <p>
                        {reading.decision.kind === "accepted" ? "Accepté"
                          : `Écarté (${ITEM_SET_ASIDE_REASON_LABELS[reading.decision.reason]}${reading.decision.note ? ` — ${reading.decision.note}` : ""})`}
                        {" par "}{names[reading.decision.actorId] ?? "un membre"}, le {dateFormat.format(new Date(reading.decision.at))}
                      </p>
                    ) : null}
                    {reading.entry ? <EntryFacts entry={reading.entry} names={names} /> : null}
                    {uncertainty?.action !== "unavailable" ? <ContributionReviewLink projectId={projectId} viewerKey={viewerKey}
                      itemId={line.itemId} planKey={reading.planKey} answer={answer} version={historyVersion} onRefused={onRefused} /> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <ItemTableHistory key={historyVersion} projectId={projectId} itemId={line.itemId} version={historyVersion} onRefused={onRefused}
        plans={Object.fromEntries(line.readings.map(({ planKey, planName }) => [planKey, planName]))} />
    </div>
  );
}
