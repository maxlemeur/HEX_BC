"use client";

import { useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import { useToast } from "@/components/ui/Toast";

type BulkJsonPanelProps = {
  onCompleted: () => Promise<void> | void;
};

const DEFAULT_BULK_PAYLOAD = JSON.stringify(
  [
    {
      supplier_id: "",
      product_id: "",
      unit_price_cents: 0,
      currency: "EUR",
      valid_from: null,
      valid_to: null,
      source: null,
      notes: null,
    },
  ],
  null,
  2
);

export function BulkJsonPanel({ onCompleted }: Readonly<BulkJsonPanelProps>) {
  const toast = useToast();
  const [showBulkJson, setShowBulkJson] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkPayload, setBulkPayload] = useState(DEFAULT_BULK_PAYLOAD);

  async function onBulkCreate() {
    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(bulkPayload);
    } catch {
      toast.error({ title: "Le JSON saisi est invalide." });
      return;
    }

    setIsBulkRunning(true);

    try {
      const result = await fetchApi<{ created_count: number; mode: string }>("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk-create", items: parsedPayload }),
      });

      toast.success({
        title: `Création en masse terminée : ${result.created_count} ligne(s) créée(s).`,
      });
      await onCompleted();
    } catch (bulkError) {
      toast.error({
        title: "Erreur",
        description:
          bulkError instanceof Error
            ? bulkError.message
            : "Impossible d'exécuter la création en masse.",
      });
    } finally {
      setIsBulkRunning(false);
    }
  }

  return (
    <section className="dashboard-card p-6">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setShowBulkJson((previous) => !previous)}
      >
        <div>
          <h2 className="text-lg font-semibold text-[var(--slate-900)]">Mode avancé</h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Collez un tableau JSON pour créer plusieurs prix en une seule fois.
          </p>
        </div>
        <span className="text-[var(--slate-400)] text-lg">{showBulkJson ? "\u25B2" : "\u25BC"}</span>
      </button>

      {showBulkJson ? (
        <>
          <textarea
            className="form-input form-textarea mt-4 font-mono text-xs"
            value={bulkPayload}
            onChange={(event) => setBulkPayload(event.target.value)}
            spellCheck={false}
            rows={12}
          />

          <div className="mt-4">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => void onBulkCreate()}
              disabled={isBulkRunning}
            >
              {isBulkRunning ? "Traitement..." : "Lancer la création en masse"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
