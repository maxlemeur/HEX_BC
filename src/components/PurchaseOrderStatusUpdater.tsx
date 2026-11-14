"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { purchaseOrderStatusErrorMessage } from "@/lib/purchase-orders/status-errors";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "received"
  | "canceled";

type StatusOption = { value: PurchaseOrderStatus; label: string };

const STATUS_OPTIONS: StatusOption[] = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyée" },
  { value: "confirmed", label: "Confirmée" },
  { value: "received", label: "Reçue" },
  { value: "canceled", label: "Annulée" },
];

type PurchaseOrderStatusUpdaterProps = {
  orderId: string;
  status: PurchaseOrderStatus;
  onSaved?: () => void;
  /** Lets a visible label (e.g. a dialog field) name the select instead of the default aria-label. */
  selectId?: string;
  className?: string;
  /** TI-691: the statuses offered, in this order (an order of an affaire is only canceled or reopened here). */
  statuses?: readonly PurchaseOrderStatus[];
};

/**
 * Writes an order's status as the order pages always have: a direct update the database guards (RLS, the lifecycle of
 * an affaire's order), its refusal named. Shared by the status selector and the explicit actions of an affaire's order.
 */
export function usePurchaseOrderStatusUpdate(orderId: string, onSaved?: () => void) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function update(next: PurchaseOrderStatus): Promise<boolean> {
    setError(null);
    setSaving(true);
    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({ status: next })
      .eq("id", orderId);
    setSaving(false);
    if (updateError) {
      setError(purchaseOrderStatusErrorMessage(updateError.message));
      return false;
    }
    router.refresh();
    onSaved?.();
    return true;
  }

  return { update, saving, error };
}

export function PurchaseOrderStatusUpdater({
  orderId,
  status,
  onSaved,
  selectId,
  className,
  statuses,
}: PurchaseOrderStatusUpdaterProps) {
  const [value, setValue] = useState<PurchaseOrderStatus>(status);
  const { update, saving, error } = usePurchaseOrderStatusUpdate(orderId, onSaved);

  async function onSave() {
    await update(value);
  }

  const hasChanged = value !== status;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <NativeSelect
        id={selectId}
        name="order-status"
        aria-label={selectId ? undefined : "Statut de la commande"}
        wrapperClassName="w-auto min-w-40"
        value={value}
        onChange={(event) => setValue(event.target.value as PurchaseOrderStatus)}
      >
        {(statuses ? STATUS_OPTIONS.filter((option) => statuses.includes(option.value)) : STATUS_OPTIONS).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {hasChanged ? (
        <Button variant="primary" size="lg" loading={saving} onClick={onSave} type="button">
          Mettre à jour
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
