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

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-zinc-400"
        value={value}
        onChange={(event) => setValue(event.target.value as PurchaseOrderStatus)}
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={saving}
        onClick={onSave}
        type="button"
      >
        {saving ? "Enregistrement..." : "Mettre a jour"}
      </button>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
