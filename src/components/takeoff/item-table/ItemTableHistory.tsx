"use client";

import { useState } from "react";
import useSWR from "swr";

import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import { fetchItemHistory } from "@/lib/takeoff/item-table-client";
import { ITEM_HISTORY_LIMIT, type ItemHistoryEvent, type ItemHistoryResponse } from "@/lib/takeoff/item-table-contracts";
import { formatItemQuantity, ITEM_SET_ASIDE_REASON_LABELS } from "@/lib/takeoff/item-table-labels";
import type { ItemSetAsideReason } from "@/lib/takeoff/item-table";
import { Button } from "@/components/ui/button";

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value
  : typeof value === "string" && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);

/** What an event of the journal did to the line, in French. */
export function itemHistoryLabel(event: ItemHistoryEvent): string {
  const after = event.after ?? {};
  switch (event.event) {
    case "accepted": return "Accepté";
    case "set_aside": {
      const reason = ITEM_SET_ASIDE_REASON_LABELS[after.reason as ItemSetAsideReason] ?? "Écarté";
      const note = text(after.note);
      return `Écarté : ${reason.toLowerCase()}${note ? ` — ${note}` : ""}`;
    }
    case "reinstated":
      return after.restored === "changed" ? "Réintégré : une ligne avait changé entre-temps, à décider de nouveau"
        : after.kind === "accepted" ? "Réintégré tel qu’il était, accepté" : "Réintégré, à décider";
    case "entered": {
      const quantity = number(after.quantity);
      return quantity === null ? "Quantité saisie" : `Quantité saisie : ${formatItemQuantity(quantity, text(after.unit))}`;
    }
    case "entry_included": return "Hypothèse saisie incluse";
    case "row_verified": return "Ligne de l’analyse vérifiée";
    case "row_excluded": return "Ligne de l’analyse exclue";
    case "row_restored": return "Ligne de l’analyse rétablie";
  }
}

/**
 * The review history of a line, newest first: who accepted, set aside, reinstated, entered or included it, why and when,
 * read from the journal by pages (the affaire's read rule; no gesture is offered here).
 */
export function ItemTableHistory({ projectId, itemId, plans }: {
  projectId: string;
  itemId: string;
  /** The names of the line's plans, by their key. */
  plans: Record<string, string>;
}) {
  const first = useSWR(["item-history", projectId, itemId], () => fetchItemHistory(projectId, itemId,
    { offset: 0, limit: ITEM_HISTORY_LIMIT.default }), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [older, setOlder] = useState<ItemHistoryResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pages = first.data ? [first.data, ...older] : [];
  const events = pages.flatMap((page) => page.events);
  const names = Object.assign({}, ...pages.map((page) => page.names)) as Record<string, string>;
  const last = pages.at(-1);

  const loadOlder = async () => {
    if (!last) return;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchItemHistory(projectId, itemId, { offset: last.offset + last.limit, limit: ITEM_HISTORY_LIMIT.default });
      setOlder((current) => [...current, page]);
    } catch (caught) {
      setError(isTakeoffApiError(caught) ? caught.message : "Impossible de lire l’historique du poste.");
    } finally {
      setLoading(false);
    }
  };

  if (first.error) {
    return <p className="text-sm text-danger">{isTakeoffApiError(first.error) ? first.error.message : "Impossible de lire l’historique du poste."}</p>;
  }
  if (!first.data) return <p className="text-sm text-muted-foreground">Chargement de l’historique…</p>;
  return (
    <div className="space-y-1" data-testid={`poste-historique-${itemId}`}>
      <p className="text-sm font-medium">Historique de la revue</p>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune décision n’a encore été prise sur ce poste.</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              {itemHistoryLabel(event)}
              {event.planKey && plans[event.planKey] ? ` · ${plans[event.planKey]}` : ""}
              {" · "}{names[event.actorId] ?? "un membre"}, le {dateFormat.format(new Date(event.at))}
            </li>
          ))}
        </ul>
      )}
      {last?.hasMore ? (
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadOlder()}>Événements plus anciens</Button>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}
