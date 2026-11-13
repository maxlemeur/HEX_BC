"use client";

import { useEffect, useState } from "react";
import { parseQuantityInput } from "@/components/estimates/components/estimate-editor-row/shared";

type Props = { itemId: string; title: string; quantity: number; disabled: boolean; onCommit?: (id: string, quantity: number) => Promise<void> };
export function OuvrageQuantityInput({ itemId, title, quantity, disabled, onCommit }: Props) {
  const [draft, setDraft] = useState(String(quantity));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(String(quantity)); setError(null); }, [quantity]);
  const commit = async () => {
    const value = parseQuantityInput(draft);
    if (value === null) { setError("Saisissez une quantité positive ou nulle, avec trois décimales au maximum."); return; }
    setError(null);
    if (!onCommit || value === quantity) return;
    setPending(true);
    try { await onCommit(itemId, value); }
    catch (failure) { setDraft(String(quantity)); setError(failure instanceof Error ? failure.message : "Quantité non enregistrée."); }
    finally { setPending(false); }
  };
  return <div className="estimate-cell estimate-cell--number" role="gridcell" data-estimate-column="quantity">
    <input className="estimate-input" type="text" inputMode="decimal" value={draft}
      aria-label={`Quantité de l’ouvrage ${title}`} disabled={disabled || pending} aria-invalid={Boolean(error)}
      aria-describedby={error ? `ouvrage-quantity-error-${itemId}` : undefined}
      onChange={event => setDraft(event.target.value)} onBlur={() => void commit()}
      onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(String(quantity)); setError(null); } }} />
    {error ? <span id={`ouvrage-quantity-error-${itemId}`} role="alert" className="text-xs text-red-700">{error}</span> : null}
  </div>;
}
