"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetchFrozenItemSelection, previewItemRemeasure, sendItemRemeasure } from "@/lib/takeoff/item-table-client";
import { ITEM_REVIEW_COMMAND_VERSION } from "@/lib/takeoff/item-table-contracts";
import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import { TAKEOFF_PAYMENT_SETTINGS_CHANGED } from "@/lib/takeoff/payment-choice";
import { useTakeoffPaymentSettings } from "../useTakeoffPaymentSettings";
import { RemeasureDialog } from "./ItemTableGestureDialogs";

export type FindMeasureSelection = { plan: string; name: string; items: string[]; revisionId: string; intent: string };

export function FindMeasureDialog({ projectId, selection, onClose, onSent }: {
  projectId: string; selection: FindMeasureSelection; onClose: () => void; onSent: () => void;
}) {
  const [sending,setSending] = useState(false);
  const [failure,setFailure] = useState("");
  const [paymentStale, setPaymentStale] = useState(false);
  const payment = useTakeoffPaymentSettings(projectId, selection.intent);
  const scope = { kind: "plan" as const, planKey: selection.plan };
  const {data,error,mutate} = useSWR(payment.ready && !paymentStale ? ["measure-added-finds",projectId,selection.intent,payment.choice] : null, async () => {
    const frozen = await fetchFrozenItemSelection(projectId,scope,{ kind: "items", itemIds: selection.items });
    const targets = new Map(frozen.items.map(i => [i.itemId,i.target]));
    // A new item has no reading on this plan yet. The preview and admission compare these empty targets to the database.
    const seen = { list_revision_id: selection.revisionId, targets: selection.items.map(itemId => targets.get(itemId)
      ?? { itemId, entryRevision: 0, answers: [] }) };
    const choice = payment.choice;
    const preview = choice ? await previewItemRemeasure(projectId,scope,selection.items,seen,undefined,true,choice)
      : await previewItemRemeasure(projectId,scope,selection.items,seen,undefined,true);
    return { preview,seen,choice };
  },{ revalidateOnFocus: false, shouldRetryOnError: false });
  async function confirm() {
    if (!data || sending || !payment.ready || paymentStale) return;
    setSending(true);
    try {
      const result = await sendItemRemeasure(projectId,{ command_version: ITEM_REVIEW_COMMAND_VERSION, scope, from_finds: true,
        item_ids: selection.items, plan_keys: [selection.plan], seen: data.seen, intent_key: selection.intent,
        preview_digest: data.preview.previewDigest, setting: null, ...(data.choice && { payment_choice: data.choice }) });
      if (result.outcome === "already_running") setFailure("Une analyse est déjà en cours. Réessayez après sa fin.");
      else onSent();
    } catch (cause) {
      setPaymentStale(isTakeoffApiError(cause) && cause.code === TAKEOFF_PAYMENT_SETTINGS_CHANGED);
      setFailure(cause instanceof Error ? cause.message : "Impossible de demander la mesure.");
    }
    finally { setSending(false); }
  }
  return <RemeasureDialog scopeLabel={selection.name} busy={sending} preview={data?.preview ?? null}
    loadError={failure || error?.message || null} onClose={onClose} onConfirm={() => void confirm()}
    payment={payment} paymentStale={paymentStale || (isTakeoffApiError(error) && error.code === TAKEOFF_PAYMENT_SETTINGS_CHANGED)}
    onReloadPayment={() => { setFailure(""); setPaymentStale(false); void mutate(undefined, { revalidate: false }); payment.reload({ live: true }); }} />;
}
