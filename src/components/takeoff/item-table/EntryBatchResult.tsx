import type { groupEntryCommands } from "@/lib/takeoff/item-entry-choice";
import type { ItemReviewResult } from "@/lib/takeoff/item-table-contracts";
import { formatEntryQuantity } from "@/lib/takeoff/item-table-labels";

export type EntryBatchRow = {
  id: string; label: string; quantity: number; unit: string; destination: string;
  state: "Enregistré" | "Refusé" | "Non envoyé" | "État inconnu"; reason?: string;
};

export type EntryBatch = {
  rows: EntryBatchRow[];
  remaining: ReturnType<typeof groupEntryCommands>;
  result: ItemReviewResult;
};

export function EntryBatchResult({ rows }: { rows: EntryBatchRow[] }) {
  return <ul aria-label="Résultat des saisies" className="max-h-60 space-y-1 overflow-y-auto text-sm">
    {rows.map(row => <li key={row.id}>{row.label} · {formatEntryQuantity(row.quantity, row.unit)} · {row.destination}
      {" · "}<strong>{row.state}</strong>{row.reason && ` · ${row.reason}`}</li>)}
  </ul>;
}
