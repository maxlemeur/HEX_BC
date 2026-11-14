"use client";

import { Check } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { usePurchaseOrderStatusUpdate } from "@/components/PurchaseOrderStatusUpdater";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { OrderStatus } from "@/lib/purchase-orders/lifecycle";
import { ORDER_STEP_KEYS, type OrderNextStep as OrderNextStepModel } from "@/lib/purchase-orders/next-step";
import { cn } from "@/lib/utils";

/**
 * The head of an order of an affaire (TI-691): what to do now in one sentence, the three steps of its purchase, and the
 * action of the moment. The same language as the head of a material request.
 */
export function OrderNextStep({
  model,
  actions,
  children,
}: Readonly<{ model: OrderNextStepModel; actions?: ReactNode; children?: ReactNode }>) {
  const headingId = useId();
  const current = model.steps.findIndex((step) => step.state === "current");
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-mono text-micro font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span aria-hidden="true" className={cn("size-2 rotate-45", model.done ? "bg-success" : "bg-brand-orange")} />
            {model.done ? "Bon de commande" : "Prochaine étape"}
          </p>
          {current >= 0 ? (
            <Badge variant="info">{`Étape ${current + 1} sur ${ORDER_STEP_KEYS.length} · ${model.steps[current].label}`}</Badge>
          ) : null}
        </div>
        <h2 id={headingId} className="mt-2 font-display text-xl font-semibold tracking-tight text-foreground text-balance">
          {model.title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{model.detail}</p>
        {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
        {children ? <div className="mt-3 flex flex-col gap-2">{children}</div> : null}
      </div>
      <ol aria-label="Étapes du bon" className="mt-4 grid grid-cols-3 gap-1.5 border-t border-border bg-surface-subtle px-2 py-2 sm:gap-2 sm:px-4">
        {model.steps.map((step, index) => (
          <li
            key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
              step.state === "current" ? "bg-surface font-semibold text-foreground shadow-sm" : "text-foreground-secondary",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-micro font-semibold",
                step.state === "done" ? "bg-success-light text-success"
                  : step.state === "current" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground-secondary",
              )}
            >
              {step.state === "done" ? <Check className="size-3" strokeWidth={3} /> : index + 1}
            </span>
            <span>
              {step.label}
              <span className="sr-only">{step.state === "done" ? " : fait" : step.state === "current" ? " : en cours" : " : à venir"}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The status changes an order of an affaire may take without proof — canceled, back to draft, reopened — as named
 * actions apart from the step's own action (TI-691: a status selector beside « Confirmer la commande… » read as a way to
 * order without proof). The same direct write as before; the database still refuses anything else.
 */
export function OrderStatusShortcuts({ orderId, reference, status }: Readonly<{ orderId: string; reference: string; status: OrderStatus }>) {
  const { update, saving, error } = usePurchaseOrderStatusUpdate(orderId);
  const [canceling, setCanceling] = useState(false);
  // A refusal shown in the cancel dialog is not shown again under the buttons once the dialog is closed.
  const [cancelTried, setCancelTried] = useState(false);
  const canCancel = status === "draft" || status === "sent";
  const toDraft = status === "sent" ? "Remettre en brouillon" : status === "canceled" ? "Rouvrir en brouillon" : null;
  if (!canCancel && !toDraft) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {toDraft ? (
        <Button variant="outline" size="sm" type="button" loading={saving && !canceling}
          onClick={() => { setCancelTried(false); void update("draft"); }}>
          {toDraft}
        </Button>
      ) : null}
      {canCancel ? (
        <Button variant="ghost" size="sm" type="button" className="text-danger hover:text-danger" disabled={saving}
          onClick={() => setCanceling(true)}>
          Annuler le bon…
        </Button>
      ) : null}
      {error && !canceling && !cancelTried ? <p role="alert" className="w-full text-sm text-danger">{error}</p> : null}
      {canceling ? (
        <Dialog open onOpenChange={(open) => { if (!open) setCanceling(false); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{`Annuler le bon ${reference}`}</DialogTitle>
              <DialogDescription>
                Le bon reste lisible, annulé : il n’est plus à envoyer ni à confirmer. Vous pourrez le rouvrir en brouillon.
              </DialogDescription>
            </DialogHeader>
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" size="lg" type="button" />}>Garder le bon</DialogClose>
              <Button
                variant="danger-solid"
                size="lg"
                type="button"
                loading={saving}
                onClick={() => {
                  setCancelTried(true);
                  void update("canceled").then((saved) => { if (saved) setCanceling(false); });
                }}
              >
                Annuler le bon
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
