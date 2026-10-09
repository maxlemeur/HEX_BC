"use client";

import { useState } from "react";

import { ChevronDownIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui-legacy/Toast";

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
    <section
      aria-labelledby="prices-bulk-json-title"
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
    >
      <h2 id="prices-bulk-json-title" className="m-0">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:px-6"
          aria-expanded={showBulkJson}
          aria-controls="prices-bulk-json-panel"
          onClick={() => setShowBulkJson((previous) => !previous)}
        >
          <span className="min-w-0">
            <span className="block text-base font-semibold text-foreground">Mode avancé</span>
            <span className="mt-1 block text-sm font-normal text-muted-foreground">
              Collez un tableau JSON pour créer plusieurs prix en une seule fois.
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className={`size-5 shrink-0 text-subtle-foreground transition-transform motion-reduce:transition-none ${showBulkJson ? "rotate-180" : ""}`}
          />
        </button>
      </h2>

      {showBulkJson ? (
        <div id="prices-bulk-json-panel" className="border-t border-border px-4 py-4 sm:px-6">
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="prices-bulk-json">Prix au format JSON</FieldLabel>
            <Textarea
              id="prices-bulk-json"
              className="font-mono text-xs"
              value={bulkPayload}
              onChange={(event) => setBulkPayload(event.target.value)}
              spellCheck={false}
              rows={12}
            />
          </div>

          <div className="mt-4">
            <Button variant="accent" size="lg" onClick={() => void onBulkCreate()} loading={isBulkRunning}>
              Lancer la création en masse
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
