"use client";

import { useId, useState } from "react";

import { MATERIAL_REQUEST_QUOTE_MAX_CENTS } from "@/lib/material-requests/quote-contracts";
import { parseAmountCents } from "@/lib/numeric-input/parsers";
import { cn } from "@/lib/utils";

import { CellMessages, usePendingWrites } from "./cells";
import type { SaveResult } from "./useMaterialRequestEditor";

/* The amount fields of a quote (TI-691): one draft per field, saved on leaving it. */

const CONTROL =
  "h-9 w-full min-w-0 rounded-control border border-input bg-surface px-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/15";

const AMOUNT_UNREADABLE = "Montant illisible : en euros, avec une virgule et deux décimales au plus (12,50).";

function readCents(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const cents = parseAmountCents(trimmed);
  return cents !== null && cents >= 0 && cents <= MATERIAL_REQUEST_QUOTE_MAX_CENTS ? cents : undefined;
}

function centsText(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * What an amount field holds: the text typed (null when it shows the saved amount), the reason a save was refused,
 * and the saving of what it shows. Shared by the field and, for a price, by the choice of the lot it is for.
 */
export function useCentsDraft(value: number | null, onAbandon?: () => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const writes = usePendingWrites<number | null>(value);
  const unreadable = draft !== null && readCents(draft) === undefined;

  /**
   * Saves the amount shown with `send`. Nothing is sent when nothing was typed or the text cannot be read. `force`:
   * sent even when it is the amount expected, because what goes with it changed (the lot of a price).
   */
  const commit = async (
    send: (next: number | null) => Promise<SaveResult>,
    force = false,
  ): Promise<SaveResult | null> => {
    if (draft === null) return null;
    const next = readCents(draft);
    if (next === undefined) return null;
    if (!force && next === writes.expected()) {
      if (writes.idle()) {
        if (error) onAbandon?.();
        setDraft(null);
        setError(null);
      }
      return null;
    }
    const result = await writes.send(next, () => send(next));
    if (result === null) return null;
    if (result.ok) {
      setError(null);
      setDraft((current) => (current !== null && readCents(current) === next ? null : current));
    } else {
      setError(result.message);
    }
    return result;
  };

  /**
   * Escape: the saved amount is shown again, and what could not be saved is dropped, with what waited for it (the lot
   * of a price chosen while the text could not be read).
   */
  const abandon = () => {
    if (error || draft !== null) onAbandon?.();
    setDraft(null);
    setError(null);
  };

  return { draft, setDraft, error, unreadable, shownError: unreadable ? AMOUNT_UNREADABLE : error, commit, abandon };
}

type CentsDraft = ReturnType<typeof useCentsDraft>;

/**
 * An amount in euros, typed with the house grammar (« 12,50 », « 1 250 »), saved on leaving the field or Enter;
 * Escape gives back the saved amount. A refused save keeps what was typed, with the reason under it.
 */
export function CentsField({
  id,
  label,
  value,
  field,
  onCommit,
}: Readonly<{
  /** Given when a visible <label> points at the field; `label` stays its accessible name. */
  id?: string;
  label: string;
  value: number | null;
  field: CentsDraft;
  onCommit: () => void;
}>) {
  const messagesId = useId();
  const { shownError } = field;
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={Boolean(shownError) || undefined}
        aria-describedby={shownError ? messagesId : undefined}
        className={cn(CONTROL, "text-right tabular-nums", shownError && "border-danger")}
        value={field.draft ?? centsText(value)}
        onChange={(event) => field.setDraft(event.currentTarget.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          } else if (event.key === "Escape" && (field.draft !== null || field.error)) {
            event.preventDefault();
            field.abandon();
          }
        }}
      />
      <CellMessages id={messagesId} error={shownError} />
    </>
  );
}

export function CentsInput({
  id,
  label,
  value,
  onCommit,
  onAbandon,
}: Readonly<{
  id?: string;
  label: string;
  value: number | null;
  onCommit: (next: number | null) => Promise<SaveResult>;
  onAbandon?: () => void;
}>) {
  const field = useCentsDraft(value, onAbandon);
  return <CentsField id={id} label={label} value={value} field={field} onCommit={() => void field.commit(onCommit)} />;
}
