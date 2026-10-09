"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
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
};

export function PurchaseOrderStatusUpdater({
  orderId,
  status,
  onSaved,
  selectId,
  className,
}: PurchaseOrderStatusUpdaterProps) {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [value, setValue] = useState<PurchaseOrderStatus>(status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setError(null);
    setSaving(true);

    const { error: updateError } = await supabase
      .from("purchase_orders")
      .update({ status: value })
      .eq("id", orderId);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.refresh();
    onSaved?.();
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
        {STATUS_OPTIONS.map((option) => (
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
