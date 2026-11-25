"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchFrozenItemSelection, previewItemRemeasure, sendItemRemeasure } from "@/lib/takeoff/item-table-client";
import { ITEM_REVIEW_COMMAND_VERSION } from "@/lib/takeoff/item-table-contracts";
import { RemeasureDialog } from "./ItemTableGestureDialogs";

export type FindMeasureSelection = { plan: string; name: string; items: string[]; revisionId: string; intent: string };

export function FindMeasureDialog({ projectId, selection, onClose, onSent }: {
  projectId: string; selection: FindMeasureSelection; onClose: () => void; onSent: () => void;
}) {
  const [sending,setSending] = useState(false);
  const [failure,setFailure] = useState("");
  const scope = { kind: "plan" as const, planKey: selection.plan };
  const {data,error} = useSWR(["measure-added-finds",projectId,selection.intent], async () => {
    const frozen = await fetchFrozenItemSelection(projectId,scope,{ kind: "items", itemIds: selection.items });
    const targets = new Map(frozen.items.map(i => [i.itemId,i.target]));
    // A new item has no reading on this plan yet. The preview and admission compare these empty targets to the database.
    const seen = { list_revision_id: selection.revisionId, targets: selection.items.map(itemId => targets.get(itemId)
      ?? { itemId, entryRevision: 0, answers: [] }) };
    const preview = await previewItemRemeasure(projectId,scope,selection.items,seen,undefined,true);
    return { preview,seen };
  },{ revalidateOnFocus: false, shouldRetryOnError: false });
  async function confirm() {
    if (!data || sending) return;
    setSending(true);
    try {
      const result = await sendItemRemeasure(projectId,{ command_version: ITEM_REVIEW_COMMAND_VERSION, scope, from_finds: true,
        item_ids: selection.items, plan_keys: [selection.plan], seen: data.seen, intent_key: selection.intent,
        preview_digest: data.preview.previewDigest, setting: null });
      if (result.outcome === "already_running") setFailure("Une analyse est déjà en cours. Réessayez après sa fin.");
      else onSent();
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : "Impossible de demander la mesure."); }
    finally { setSending(false); }
  }
  return <RemeasureDialog scopeLabel={selection.name} busy={sending} preview={data?.preview ?? null}
    loadError={failure || error?.message || null} onClose={onClose} onConfirm={() => void confirm()} />;
}
