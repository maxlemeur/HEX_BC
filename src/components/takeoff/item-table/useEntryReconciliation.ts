"use client";

import { useState } from "react";
import { fetchItemLine, fetchItemTable } from "@/lib/takeoff/item-table-client";
import type { ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";
import type { ItemTableAddress } from "@/lib/takeoff/item-table-query";
import { formatEntryQuantity } from "@/lib/takeoff/item-table-labels";
import { useCompletions } from "@/components/takeoff/item-detail/useCompletions";

type Target = { id: string; label: string };
type Read = Target & { state: "reading" | "failed" | "read" | "absent"; facts?: string };

export function useEntryReconciliation(projectId: string, screen: string, address: ItemTableAddress,
  onRefused: (error: unknown) => boolean, onRead: (id: string, line: ItemTableResponseLine | null, canReview: boolean) => Promise<void>) {
  const [reads, setReads] = useState<Record<string, Read>>({});
  const [previous, setPrevious] = useState(screen);
  if (previous !== screen) { setPrevious(screen); setReads({}); }
  const begin = useCompletions({ screen, item: null });
  function update(read: Read) { setReads(current => ({ ...current, [read.id]: read })); }
  async function reconcile(targets: Target[]) {
    const completion = begin({ screen, item: null });
    setReads(current => ({ ...current, ...Object.fromEntries(targets.map(target => [target.id, { ...target, state: "reading" as const }])) }));
    for (const target of targets) {
      if (!completion.ownScreen()) return;
      try {
        const full = await fetchItemLine(projectId, target.id);
        const scoped = address.scope.kind === "plan"
          ? await fetchItemTable(projectId, { ...address, filter: {}, offset: 0, focusItemId: target.id }) : null;
        if (!completion.ownScreen()) return;
        const line = scoped ? scoped.page.lines.find(l => l.itemId === target.id) ?? null : full.line;
        await onRead(target.id, line, scoped?.canReview ?? full.canReview);
        if (!completion.ownScreen()) return;
        if (!line) { update({ ...target, state: "absent" }); continue; }
        const entries = [ ...(full.line.entry ? [`Toute l’affaire · ${formatEntryQuantity(full.line.entry.quantity, full.line.entry.unit)}`] : []),
          ...full.line.readings.flatMap(r => r.entry ? [`${r.planName} · ${formatEntryQuantity(r.entry.quantity, r.entry.unit)}`] : []) ];
        update({ ...target, state: "read", facts: entries.join(" / ") || "Aucune saisie" });
      } catch (error) {
        if (!completion.ownScreen() || onRefused(error)) return;
        update({ ...target, state: "failed" });
      }
    }
  }
  function clear(ids: string[]) {
    setReads(current => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.includes(id))));
  }
  return { reads, reconcile, clear, blocked: (id: string) => !!reads[id] && reads[id].state !== "read" };
}
