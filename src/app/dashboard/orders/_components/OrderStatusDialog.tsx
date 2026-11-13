"use client";

import { PurchaseOrderStatusUpdater } from "@/components/PurchaseOrderStatusUpdater";
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
import { Label } from "@/components/ui/label";
import { affaireDirectStatuses } from "@/lib/purchase-orders/lifecycle";

import type { PurchaseOrderListRow } from "./orders-model";

type OrderStatusDialogProps = {
  /** `affaire`: an order made from a material request, confirmed and received from its own page (TI-691). */
  order: (Pick<PurchaseOrderListRow, "id" | "reference" | "status"> & { affaire?: boolean }) | null;
  onClose: () => void;
  onSaved: () => void;
};

/** Status change of a listed order, kept out of the row menu so the menu only holds actions. */
export function OrderStatusDialog({ order, onClose, onSaved }: OrderStatusDialogProps) {
  const selectId = order ? `order-status-${order.id}` : undefined;
  const statuses = order?.affaire ? affaireDirectStatuses(order.status) : undefined;

  return (
    <Dialog
      open={order !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent size="sm">
        {order ? (
          <>
            <DialogHeader>
              <DialogTitle>Changer le statut</DialogTitle>
              <DialogDescription>
                Bon de commande <span className="font-mono font-semibold text-foreground">{order.reference}</span>
              </DialogDescription>
            </DialogHeader>
            {statuses && statuses.length < 2 ? (
              <p className="text-sm text-muted-foreground">
                Ce bon d’affaire est commandé : son statut ne change plus que par sa réception, depuis sa page.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <Label htmlFor={selectId}>Statut</Label>
                <PurchaseOrderStatusUpdater
                  key={order.id}
                  orderId={order.id}
                  status={order.status}
                  selectId={selectId}
                  statuses={statuses}
                  onSaved={onSaved}
                />
                {statuses ? (
                  <p className="text-xs text-muted-foreground">
                    Un bon d’affaire se confirme depuis sa page, avec ses prix réels et la confirmation du fournisseur.
                  </p>
                ) : null}
              </div>
            )}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" size="lg" />}>Fermer</DialogClose>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
