"use client";

import { AlertTriangle } from "lucide-react";

import type { TakeoffReviewContext } from "@/lib/takeoff/review-context-contracts";
import { plural } from "@/lib/text/plural";
import { cn } from "@/lib/utils";

type SendContext = NonNullable<TakeoffReviewContext["send_context"]>;

/** The mark of a line sent whose plan's comparison changed since the send (lot 3, migration C). */
export const SEND_CONTEXT_CHANGED_LABEL = "Contexte modifié depuis l’envoi : à revoir";

// One wording per reason: « relu » only when a reading of that plan happened (fix round 3, point 5).
const CHANGE_LABELS: Record<SendContext["changes"][number]["reason"], (plan: string) => string> = {
  peer_changed: (plan) => `les lignes de ${plan}, avec lesquelles ce plan a été comparé, ont changé`,
  peer_read_again: (plan) => `${plan}, avec lequel ce plan a été comparé, a été relu depuis`,
  peer_removed: (plan) => `la lecture de ${plan} avec laquelle ce plan a été comparé n’existe plus`,
  peer_appeared: (plan) => `${plan} a été lu pendant l’envoi de ce plan, sans lui être comparé`,
  location_changed: (plan) => `la localisation de ${plan} a été corrigée`,
  copy_changed: (plan) => `la copie de ${plan} dans le dossier a changé (remplacée, écartée ou réservée pour suppression)`,
};

/** The sent lines of this plan that the change concerns, by their identifiers (the receipt's parts). */
export function sendContextChangedItemIds(context: SendContext | null | undefined): ReadonlySet<string> {
  return new Set(context?.changed ? context.item_ids : []);
}

/**
 * Lot 3: what the send of this plan compared that changed since — a plan read beside it whose lines changed, that was read
 * again or whose reading no longer exists, a plan read during the send without being compared, a location corrected, a
 * plan copy replaced. The send did not see it (it committed after the send read its context, or later): the lines sent
 * stay as they are, and are to be reviewed.
 */
export function TakeoffSendContextNotice({ context, items, className }: Readonly<{ context: SendContext | null | undefined;
  /** The takeoff's lines: those sent are named in the notice. */
  items?: ReadonlyArray<{ id: string; designation: string; quantity: number; unit: string }>;
  className?: string;
}>) {
  if (!context?.changed) return null;
  const sent = new Set(context.item_ids);
  const lines = (items ?? []).filter((item) => sent.has(item.id));
  return (
    <section aria-label={SEND_CONTEXT_CHANGED_LABEL}
      className={cn("flex items-start gap-3 rounded-lg border border-warning-border bg-warning-subtle px-4 py-3 text-sm", className)}>
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <h2 className="font-semibold text-foreground">{SEND_CONTEXT_CHANGED_LABEL}</h2>
        <p className="text-foreground-secondary">
          Depuis l’envoi de ce plan au tableau de chiffrage, ce que ses contrôles entre plans ont comparé a changé : {plural(
            context.item_ids.length, "ligne envoyée est concernée", "lignes envoyées sont concernées")}.{" "}
          {context.item_ids.length > 1 ? "Elles restent telles qu’envoyées." : "Elle reste telle qu’envoyée."}
        </p>
        <ul aria-label="Changements depuis l’envoi" className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {context.changes.map((change) => (
            <li key={`${change.reason}-${change.plan_name ?? ""}`}>
              {CHANGE_LABELS[change.reason](change.plan_name ? `« ${change.plan_name} »` : "un plan sans nom")}
            </li>
          ))}
        </ul>
        {lines.length > 0 ? (
          <ul aria-label="Lignes envoyées à revoir" className="list-disc space-y-0.5 pl-5 text-foreground-secondary">
            {lines.map((line) => <li key={line.id}>« {line.designation} » ({line.quantity} {line.unit})</li>)}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
