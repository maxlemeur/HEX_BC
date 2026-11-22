"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useCountMarks } from "@/components/takeoff/count-marks/CountMarksScope";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { COUNT_MARKS_HISTORY_LIMIT, type CountMarkHistoryEvent } from "@/lib/takeoff/count-marks-contracts";
import { countMarkEventActor, countMarkEventLabel } from "@/lib/takeoff/count-marks-view";

/**
 * The journal of the answer's marks (lot 5): who (the analysis or a member), when, what, the page, before and after, the
 * reason, and what supported a retained mark as the journal kept it, in order, page after page. Read again after each
 * save; a refused read withdraws the marks, this history with them. No gesture here.
 */

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

type Read = { events: CountMarkHistoryEvent[]; next: { revision: number; ordinal: number } | null; names: Record<string, string>;
  viewerId: string | null };

export function CountMarksHistory({ markNumbers }: { markNumbers: Record<string, number> }) {
  const marks = useCountMarks();
  const reader = marks?.reader;
  const answerId = marks?.answer?.answerId ?? null;
  const version = marks?.historyVersion ?? 0;
  const refuse = marks?.refuse;
  const start = marks?.start;
  const screen = marks?.screen ?? "";
  const readAgain = marks?.readAgain;
  // The journal as the page shown was read: to its revision (read again with the page).
  const revision = marks?.loaded?.view.revision ?? null;
  const [read, setRead] = useState<Read | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const reading = useRef<string | null>(null);

  const load = useCallback(async (after: Read["next"], previous: Read | null) => {
    if (!reader || !answerId || !start || revision === null) return;
    // One read per position; its answer is this answer's, shown only while it is.
    const position = `${answerId}:${revision}:${after ? `${after.revision}.${after.ordinal}` : "start"}`;
    if (reading.current === position) return;
    reading.current = position;
    const done = start({ screen, item: answerId });
    setLoading(true);
    try {
      const page = await reader.readHistory({ answerId, after, limit: COUNT_MARKS_HISTORY_LIMIT.default });
      if (!done.current()) return;
      // An event after the page's revision: the screen is read again (the gestures kept, the member told), the journal
      // with it; until then it shows the events of the page's revision only.
      const later = page.events.some((event) => event.revision > revision);
      if (later) readAgain?.();
      setRead({ events: [...(previous?.events ?? []), ...page.events.filter((event) => event.revision <= revision)],
        next: later ? null : page.next, names: { ...(previous?.names ?? {}), ...page.names }, viewerId: page.viewerId });
      setFailed(false);
    } catch (error) {
      if (!done.current()) return;
      if (!refuse?.(error)) setFailed(true);
    } finally {
      if (reading.current === position) reading.current = null;
      if (done.current()) setLoading(false);
    }
  }, [answerId, readAgain, reader, refuse, revision, screen, start]);

  useEffect(() => {
    setRead(null);
    void load(null, null);
  }, [load, version]);

  if (!marks || !answerId) return null;
  if (failed) return <p className="px-3 py-2 text-xs text-danger">L’historique des repères n’a pas pu être lu.</p>;
  if (!read) return <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Spinner aria-label="Chargement" />Chargement de l’historique…</p>;
  if (!read.events.length) return <p className="px-3 py-2 text-xs text-muted-foreground">Aucun événement sur les repères de ce poste.</p>;
  return (
    <div className="flex flex-col">
      <ol aria-label="Historique des repères" className="divide-y divide-border-subtle" data-testid="reperes-historique">
        {read.events.map((event) => (
          <li key={event.eventId} className="px-3 py-1.5 text-xs">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-foreground">{countMarkEventLabel(event)}</span>
              <span className="text-muted-foreground">
                {event.markId && markNumbers[event.markId] ? `repère ${markNumbers[event.markId]} · ` : ""}page {event.page}
              </span>
            </span>
            <span className="block text-muted-foreground">
              {countMarkEventActor(event, read.names, read.viewerId)} · {dateFormat.format(new Date(event.occurredAt))} · révision {event.revision}
            </span>
            {event.evidence.length ? (
              <span className="block text-muted-foreground">
                Preuve gardée : {event.evidence.map((proof) => [proof.method, proof.observation?.evidence].filter(Boolean).join(" — "))
                  .filter(Boolean).join(" ; ") || `${event.evidence.length} proposition${event.evidence.length > 1 ? "s" : ""}`}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {read.next ? (
        <Button size="xs" variant="ghost" className="self-start" disabled={loading} onClick={() => void load(read.next, read)}>
          {loading ? <Spinner aria-label="Chargement" className="mr-1 size-3" /> : null}Afficher la suite
        </Button>
      ) : null}
    </div>
  );
}
