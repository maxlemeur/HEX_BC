"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type PurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "received"
  | "canceled";

type StatusOption = { value: PurchaseOrderStatus; label: string };

const STATUS_OPTIONS: StatusOption[] = [
  { value: "draft", label: "Brouillon" },
  { value: "sent", label: "Envoyee" },
  { value: "confirmed", label: "Confirmee" },
  { value: "received", label: "Recue" },
  { value: "canceled", label: "Annulee" },
];

type PurchaseOrderStatusUpdaterProps = {
  orderId: string;
  status: PurchaseOrderStatus;
};

export function PurchaseOrderStatusUpdater({
  orderId,
  status,
}: PurchaseOrderStatusUpdaterProps) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
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
  }

  const hasChanged = value !== status;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="form-input form-select h-11 w-auto min-w-[140px] text-sm"
        name="order-status"
        aria-label="Statut de la commande"
        value={value}
        onChange={(event) => setValue(event.target.value as PurchaseOrderStatus)}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hasChanged && (
        <button
          className="btn btn-primary btn-sm"
          disabled={saving}
          onClick={onSave}
          type="button"
        >
          {saving ? (
            <>
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
              Enregistrement...
            </>
          ) : (
            "Mettre a jour"
          )}
        </button>
      )}
      {error ? (
        <span className="text-sm text-[var(--error)]">{error}</span>
      ) : null}
    </div>
  );
}
