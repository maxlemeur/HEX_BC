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

import type { PurchaseOrderListRow } from "./orders-model";

type OrderStatusDialogProps = {
  order: Pick<PurchaseOrderListRow, "id" | "reference" | "status"> | null;
  onClose: () => void;
  onSaved: () => void;
};

/** Status change of a listed order, kept out of the row menu so the menu only holds actions. */
export function OrderStatusDialog({ order, onClose, onSaved }: OrderStatusDialogProps) {
  const selectId = order ? `order-status-${order.id}` : undefined;

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
            <div className="flex flex-col gap-2">
              <Label htmlFor={selectId}>Statut</Label>
              <PurchaseOrderStatusUpdater
                key={order.id}
                orderId={order.id}
                status={order.status}
                selectId={selectId}
                onSaved={onSaved}
              />
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" size="lg" />}>Fermer</DialogClose>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
