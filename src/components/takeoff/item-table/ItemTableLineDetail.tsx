"use client";

import Link from "next/link";

import type { ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";
import {
  formatItemQuantity,
  ITEM_ANOMALY_LABELS,
  ITEM_SET_ASIDE_REASON_LABELS,
  ITEM_UNIT_STATE_LABELS,
} from "@/lib/takeoff/item-table-labels";
import { QUANTITY_ENTRY_CATEGORIES } from "@/lib/takeoff/quantity-entry";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { Button } from "@/components/ui/button";

const OUTCOME_LABELS = { measured: "Mesuré", uncertain: "Incertain", not_found: "Non trouvé" } as const;
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });
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

/**
 * The detail of an item: each plan it was asked about, the answer of that plan (the model's raw result, kept as read),
 * its pages, sources and reasons, the decision taken and who took it, and the quantity entered. The targeted proof and
 * correction of the existing review stays one link away.
 */
export function ItemTableLineDetail({ line, projectId, names, canReview, busy, onIncludeEntry }: {
  line: ItemTableResponseLine;
  projectId: string;
  names: Record<string, string>;
  canReview: boolean;
  busy: boolean;
  onIncludeEntry: (line: ItemTableResponseLine) => void;
}) {
  return (
    <div className="space-y-3 py-2" data-testid={`poste-detail-${line.itemId}`}>
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
            return (
              <li key={reading.planKey} className="rounded-md border border-border p-3">
                <p className="text-sm font-medium">
                  {reading.planName}{reading.location ? ` · ${reading.location}` : ""} ·{" "}
                  {answer ? OUTCOME_LABELS[answer.outcome] : ITEM_UNIT_STATE_LABELS[reading.unit]}
                </p>
                {answer ? (
                  <div className="mt-1 space-y-1 text-sm">
                    <p>
                      Pages cherchées : {pages(answer.searchedPages)}
                      {answer.unreadablePages.length ? ` · pages illisibles : ${pages(answer.unreadablePages)}` : ""}
                    </p>
                    {answer.reasonText ? <p>Motif de la lecture : {answer.reasonText}</p> : null}
                    {answer.candidate ? (
                      <p>Valeur candidate (non mesurée) : {formatItemQuantity(answer.candidate.quantity, answer.candidate.unit)}</p>
                    ) : null}
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
                            {observation.page ? ` · page ${observation.page}` : ""}
                            {observation.evidence ? ` · source : ${observation.evidence}` : ""}
                            {observation.confidence !== null ? ` · confiance ${Math.round(observation.confidence * 100)} %` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {reading.decision ? (
                      <p>
                        {reading.decision.kind === "accepted" ? "Accepté"
                          : `Écarté (${ITEM_SET_ASIDE_REASON_LABELS[reading.decision.reason]}${reading.decision.note ? ` — ${reading.decision.note}` : ""})`}
                        {" par "}{names[reading.decision.actorId] ?? "un membre"}, le {dateFormat.format(new Date(reading.decision.at))}
                      </p>
                    ) : null}
                    {reading.entry ? <EntryFacts entry={reading.entry} names={names} /> : null}
                    <Link className="underline" prefetch={false}
                      href={takeoffReviewHref({ projectId, jobId: answer.jobId, targeted: true,
                        line: answer.observations.find(({ takeoffItemId }) => takeoffItemId)?.takeoffItemId ?? undefined })}>
                      Voir la preuve et corriger dans la revue ciblée
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
