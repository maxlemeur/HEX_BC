"use client";

import { useEffect, useState } from "react";
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
function itemHistoryLabel(event: ItemHistoryEvent): string {
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
      const action = after.scope_action;
      const label = action === "attach" ? "Saisie rattachée au plan" : action === "withdraw" ? "Saisie de l’affaire retirée"
        : action === "replace" ? "Saisie du plan remplacée" : "Quantité saisie";
      const value = action === "withdraw" ? event.before : after;
      const quantity = number(value?.quantity);
      return quantity === null ? label : `${label} : ${formatItemQuantity(quantity, text(value?.unit))}`;
    }
    case "entry_included": return "Hypothèse saisie incluse";
    case "row_verified": return "Ligne de l’analyse vérifiée";
    case "row_excluded": return "Ligne de l’analyse exclue";
    case "row_restored": return "Ligne de l’analyse rétablie";
  }
}

/**
 * The review history of a line, newest first: who accepted, set aside, reinstated, entered or included it, why and when,
 * read from the journal by pages (the affaire's read rule; no gesture is offered here). It is read again with the table
 * (its version), from its first page; a refused read withdraws the table, this history with it.
 *
 * Shown in the table (no `scope`), a refused first page goes to the handler of whoever shows that history now, as it always
 * did: a request shared by a table shown again reaches it. Shown in the detail of an item (`scope`: the member and the
 * scope that read, in the request's key, so that another reader never shares it), the refusal goes from the request
 * itself to the handler of the screen that started it, even once this history is gone (the member moved to another
 * item): that handler decides whether it still concerns what is shown (lot 5 follow-ups).
 */
export function ItemTableHistory({ projectId, itemId, plans, version, onRefused, scope = null }: {
  projectId: string;
  itemId: string;
  /** The names of the line's plans, by their key. */
  plans: Record<string, string>;
  /** Moves with each read of the table. */
  version: number;
  onRefused: (caught: unknown) => boolean;
  /** The member and the scope that read the journal: a new reader of the same item reads its own. */
  scope?: string | null;
}) {
  const first = useSWR(["item-history", projectId, itemId, version, scope], async () => {
    try {
      return await fetchItemHistory(projectId, itemId, { offset: 0, limit: ITEM_HISTORY_LIMIT.default });
    } catch (caught) {
      // In the detail: the handler of the render that asked, whatever is mounted when the answer comes.
      if (scope !== null) onRefused(caught);
      throw caught;
    }
  }, { revalidateOnFocus: false, shouldRetryOnError: false });
  // In the table: whoever shows this history now hears of its refusal, a request shared with a table shown before included.
  useEffect(() => {
    if (scope === null && first.error) onRefused(first.error);
  }, [first.error, onRefused, scope]);
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
      if (onRefused(caught)) return;
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
