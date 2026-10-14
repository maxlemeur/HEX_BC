"use client";

import { useState } from "react";
import useSWR from "swr";

import { Alert } from "@/components/ui/alert";
import { LoadingState } from "@/components/layout/loading-state";
import { formatEUR } from "@/lib/money";
import { formatOrderQuantity } from "@/lib/purchase-orders/quantities";

type LineSnapshot = {
  designation?: unknown;
  quantity?: unknown;
  unit?: unknown;
  price_unit?: unknown;
  unit_price_ht_cents?: unknown;
};

type HistoryEvent = {
  id: string;
  occurred_at: string;
  actor_name?: string | null;
  operation: "insert" | "update" | "delete";
  before: LineSnapshot | null;
  after: LineSnapshot | null;
};

async function fetchHistory(url: string): Promise<HistoryEvent[]> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok || payload?.ok !== true || !Array.isArray(payload.data?.events)) {
    throw new Error("Impossible de charger l’historique des lignes.");
  }
  return payload.data.events;
}

function SnapshotRow({ label, snapshot }: { label: string; snapshot: LineSnapshot }) {
  return (
    <tr>
      <th scope="row" className="px-3 py-2 text-left font-medium">{label}</th>
      <td className="px-3 py-2 text-right tabular-nums">
        {typeof snapshot.quantity === "number" ? formatOrderQuantity(snapshot.quantity) : "—"}
      </td>
      <td className="px-3 py-2">
        {typeof snapshot.unit === "string" && snapshot.unit.trim() ? snapshot.unit : "Unité à confirmer"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {typeof snapshot.unit_price_ht_cents === "number" ? formatEUR(snapshot.unit_price_ht_cents) : "—"}
        <p className="mt-1 text-xs text-muted-foreground">
          {typeof snapshot.price_unit === "string" && snapshot.price_unit.trim() ? `par ${snapshot.price_unit}` : "Unité du prix à confirmer"}
        </p>
      </td>
    </tr>
  );
}

const operationLabels = {
  insert: "Ligne ajoutée",
  update: "Ligne modifiée",
  delete: "Ligne supprimée",
};

export function OrderLineHistory({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const { data: events, error, isLoading, mutate } = useSWR<HistoryEvent[]>(
    open ? `/api/purchase-orders/${orderId}/history` : null,
    fetchHistory
  );

  return (
    <details
      className="no-print mt-6 rounded-lg border border-border bg-surface p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-semibold">Historique des lignes</summary>
      {open ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Les corrections de quantité et de prix conservent l’origine des lignes. Elles ne modifient pas le reçu de préparation initial.
          </p>
          {isLoading ? <LoadingState label="Chargement de l’historique…" /> : null}
          {error ? (
            <Alert variant="danger">
              Impossible de charger l’historique des lignes.{" "}
              <button type="button" className="font-medium underline" onClick={() => void mutate()}>
                Réessayer
              </button>
            </Alert>
          ) : null}
          {events?.length === 0 ? <p className="text-sm text-muted-foreground">Aucune modification de ligne enregistrée.</p> : null}
          {events?.map((event) => {
            const current = event.after ?? event.before;
            const designation = typeof current?.designation === "string" ? current.designation : "Article";
            return (
              <article key={event.id} className="rounded-lg border border-border-subtle p-3">
                <h3 className="text-sm font-semibold">{operationLabels[event.operation]} — {designation}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.actor_name?.trim() || "Utilisateur non renseigné"}{" · "}
                  <time dateTime={event.occurred_at}>
                    {new Date(event.occurred_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  </time>
                </p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Valeurs de la ligne {designation}</caption>
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left">État</th>
                        <th scope="col" className="px-3 py-2 text-right">Quantité</th>
                        <th scope="col" className="px-3 py-2 text-left">Unité</th>
                        <th scope="col" className="px-3 py-2 text-right">P.U. HT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {event.before ? <SnapshotRow label="Avant" snapshot={event.before} /> : null}
                      {event.after ? <SnapshotRow label="Après" snapshot={event.after} /> : null}
                    </tbody>
                  </table>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </details>
  );
}
