"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

import { useTakeoffRequestActivity } from "@/components/takeoff/useTakeoffRequestActivity";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const TakeoffItemSendDialog = dynamic(
  () => import("@/components/takeoff/item-send/TakeoffItemSendDialog").then((module) => module.TakeoffItemSendDialog),
  { ssr: false },
);

/**
 * Lot 4, PR 5c: in the review of one analysis, whether it read its plan against the affaire's list of items, from the
 * activity of its own request (the read the plans' navigation above the review makes, under the same key). Such an
 * analysis is sent item by item: the review offers « Envoyer ce plan au devis » (this screen) instead of today's send,
 * which refuses it. `itemList` is false while the activity is unknown, so a review of today's formats is unchanged.
 */
export function useItemListSend(input: { projectId: string; jobId: string; viewerKey: string; onSent?: () => void }) {
  const { data } = useTakeoffRequestActivity({ viewerKey: input.viewerKey, projectId: input.projectId, view: "job",
    target: input.jobId, poll: false, ownRequestOnly: true });
  const request = data?.current ?? null;
  const unit = request?.units?.units.find((candidate) => candidate.jobId === input.jobId) ?? null;
  const itemList = request?.order === "item_list" && unit !== null;
  const job = itemList ? request?.jobs.find((candidate) => candidate.jobId === input.jobId) ?? null : null;
  const [open, setOpen] = useState(false);
  const canSend = job?.canSendItems === true;
  const openSend = useCallback(() => { if (canSend) setOpen(true); }, [canSend]);
  const element = itemList && unit ? (
    <>
      <Alert variant="info" className="mb-4" data-testid="item-send-review-notice">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0">
            {job?.applied ? "Ce plan a été lu contre la liste des postes ; ses postes retenus sont envoyés au devis."
              : "Ce plan a été lu contre la liste des postes : il s’envoie au devis poste par poste, depuis cet écran ou le tableau des postes."}
          </p>
          {canSend ? (
            <Button type="button" size="sm" onClick={openSend}>Envoyer ce plan au devis</Button>
          ) : null}
        </div>
      </Alert>
      {/* Withdrawn as soon as a fresh read no longer lets this member send this plan. */}
      {open && canSend ? (
        <TakeoffItemSendDialog open jobId={input.jobId} planName={unit.name} viewerKey={input.viewerKey}
          onOpenChange={(next) => { if (!next) setOpen(false); }} onSent={input.onSent} />
      ) : null}
    </>
  ) : null;
  return { itemList, open: openSend, element };
}
