"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Info, TriangleAlert } from "lucide-react";

import { DecimalDraftInput } from "@/components/estimates/components/estimate-editor-row/DecimalDraftInput";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { MaterialRequestLineAlert } from "@/lib/material-requests/alerts";
import { parseQuantity } from "@/lib/numeric-input/parsers";
import { cn } from "@/lib/utils";

import type { SaveResult } from "./useMaterialRequestEditor";

export type CellAlerts = readonly MaterialRequestLineAlert[];

const NO_ALERTS: CellAlerts = [];
const QUANTITY_MAX = 1_000_000;
const QUANTITY_UNREADABLE = "Quantité illisible : un nombre au-dessus de zéro, trois décimales au plus.";

type CellTone = "blocking" | "notice" | null;

function cellTone(alerts: CellAlerts): CellTone {
  if (alerts.some((alert) => alert.blocking)) return "blocking";
  return alerts.length > 0 ? "notice" : null;
}

/** Background of a table cell named by an alert: full yellow when it blocks, pale when it is a remark. */
export function alertCellClass(alerts: CellAlerts): string {
  const tone = cellTone(alerts);
  if (tone === "blocking") return "bg-warning-light";
  return tone === "notice" ? "bg-warning-subtle" : "";
}

const CELL_CONTROL =
  "h-9 w-full min-w-0 rounded-control border border-input bg-surface px-2 text-sm text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground hover:border-border-strong focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/15";

function controlClass(alerts: CellAlerts, failed: boolean): string {
  const tone = cellTone(alerts);
  return cn(
    CELL_CONTROL,
    tone === "blocking" && "border-warning-border",
    tone === "notice" && "border-dashed border-warning-border",
    failed && "border-danger",
  );
}

/**
 * The words behind a highlighted cell: the alert is read, not only seen. A blocking alert and a remark
 * differ by their icon and their wording as well as by their colour.
 */
export function CellMessages({
  id,
  alerts = NO_ALERTS,
  error,
}: Readonly<{ id: string; alerts?: CellAlerts; error?: string | null }>) {
  if (alerts.length === 0 && !error) return null;
  return (
    <div id={id} className="mt-1 space-y-0.5 text-xs leading-snug">
      {alerts.map((alert) => (
        <p key={alert.code} className="flex items-start gap-1 font-medium text-warning">
          {alert.blocking ? (
            <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          ) : (
            <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          )}
          <span>{alert.blocking ? alert.message : `À noter : ${alert.message}`}</span>
        </p>
      ))}
      {error ? (
        <p role="alert" className="font-medium text-danger">
          Non enregistré : {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, alerts: CellAlerts, error: string | null | undefined): string | undefined {
  return alerts.length > 0 || error ? id : undefined;
}

/**
 * A text column edited in place. Leaving the cell or Enter saves it, Escape gives back the saved value.
 * When the save fails, the typing stays in the cell with the reason under it; leaving the cell again retries.
 */
export function TextCell({
  id,
  label,
  value,
  onCommit,
  alerts = NO_ALERTS,
  placeholder,
  list,
  maxLength,
  disabled = false,
  hintId,
}: Readonly<{
  /** Id of a text shown beside the field that the field should be described by. */
  hintId?: string;
  /** Given when a visible <label> names the field; otherwise `label` is the accessible name. */
  id?: string;
  label?: string;
  value: string | null;
  onCommit: (next: string | null) => Promise<SaveResult>;
  alerts?: CellAlerts;
  placeholder?: string;
  list?: string;
  maxLength?: number;
  disabled?: boolean;
}>) {
  const messagesId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const stored = (value ?? "").trim();

  const commit = async (raw: string | null) => {
    if (raw === null) return;
    const next = raw.trim();
    if (next === stored) {
      setDraft(null);
      setError(null);
      return;
    }
    if (inFlight.current === next) return;
    inFlight.current = next;
    const result = await onCommit(next.length > 0 ? next : null);
    inFlight.current = null;
    if (result.ok) {
      setError(null);
      setDraft((current) => (current !== null && current.trim() === next ? null : current));
    } else {
      setError(result.message);
    }
  };

  return (
    <>
      <input
        id={id}
        type="text"
        className={controlClass(alerts, Boolean(error))}
        aria-label={id ? undefined : label}
        aria-invalid={cellTone(alerts) === "blocking" || Boolean(error) || undefined}
        aria-describedby={[describedBy(messagesId, alerts, error), hintId].filter(Boolean).join(" ") || undefined}
        value={draft ?? value ?? ""}
        placeholder={placeholder}
        list={list}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => void commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void commit(draft);
          } else if (event.key === "Escape" && (draft !== null || error)) {
            event.preventDefault();
            setDraft(null);
            setError(null);
          }
        }}
      />
      <CellMessages id={messagesId} alerts={alerts} error={error} />
    </>
  );
}

function readQuantityDraft(raw: string): number | null {
  const quantity = parseQuantity(raw);
  return quantity !== null && quantity > 0 && quantity <= QUANTITY_MAX ? quantity : null;
}

/**
 * The quantity, typed with the house decimal grammar (« 12,5 »). An emptied cell means « not known yet »,
 * which the alerts then ask for; a figure the grammar refuses stays visible and is not sent.
 */
export function QuantityCell({
  label,
  value,
  onCommit,
  alerts = NO_ALERTS,
}: Readonly<{
  label: string;
  value: number | null;
  onCommit: (next: number | null) => Promise<SaveResult>;
  alerts?: CellAlerts;
}>) {
  const messagesId = useId();
  const [failed, setFailed] = useState<{ value: number | null; message: string } | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [mountKey, setMountKey] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const sent = useRef<{ value: number | null } | null>(null);
  const cancelled = useRef(false);
  const error = unreadable ? QUANTITY_UNREADABLE : (failed?.message ?? null);

  useEffect(() => {
    if (!cancelled.current) return;
    input.current?.focus();
    cancelled.current = false;
  }, [mountKey]);

  const commit = async (next: number | null) => {
    if (cancelled.current) return;
    if (sent.current?.value === next) return;
    if (next === value) {
      setFailed(null);
      return;
    }
    sent.current = { value: next };
    const result = await onCommit(next);
    sent.current = null;
    setFailed(result.ok ? null : { value: next, message: result.message });
  };

  return (
    <>
      <DecimalDraftInput
        key={mountKey}
        ref={input}
        className={cn(controlClass(alerts, Boolean(error)), "text-right tabular-nums")}
        aria-label={label}
        aria-invalid={cellTone(alerts) === "blocking" || Boolean(error) || undefined}
        aria-describedby={describedBy(messagesId, alerts, error)}
        autoComplete="off"
        value={failed ? failed.value : value}
        emptyValue={0}
        parseValue={readQuantityDraft}
        onValueChange={() => undefined}
        onValueCommit={(next) => void commit(next === 0 ? null : next)}
        onInput={(event) => {
          const raw = event.currentTarget.value;
          setUnreadable(raw.trim() !== "" && readQuantityDraft(raw) === null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            const raw = event.currentTarget.value;
            if (raw.trim() === "") void commit(null);
            else if (readQuantityDraft(raw) !== null) void commit(readQuantityDraft(raw));
          } else if (event.key === "Escape") {
            // The house input keeps its own draft: a fresh one shows the saved value again.
            event.preventDefault();
            cancelled.current = true;
            setFailed(null);
            setUnreadable(false);
            setMountKey((current) => current + 1);
          }
        }}
      />
      <CellMessages id={messagesId} alerts={alerts} error={error} />
    </>
  );
}

export type ChoiceOption = { value: string; label: string };

/** A choice saved as soon as it is made. A refused choice stays shown, with the reason under it. */
export function ChoiceCell({
  id,
  label,
  value,
  options,
  emptyLabel,
  unknownLabel,
  onCommit,
  disabled = false,
}: Readonly<{
  id?: string;
  label?: string;
  value: string | null;
  options: readonly ChoiceOption[];
  /** Label of the « nothing chosen » option; without it, a value is always chosen. */
  emptyLabel?: string;
  /** Shown for a saved value that is no longer among the options. */
  unknownLabel?: string;
  onCommit: (next: string | null) => Promise<SaveResult>;
  disabled?: boolean;
}>) {
  const messagesId = useId();
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ value: string; message: string } | null>(null);
  const shown = pending ?? failed?.value ?? value ?? "";
  const known = shown === "" || options.some((option) => option.value === shown);

  return (
    <>
      <NativeSelect
        id={id}
        size="sm"
        className="px-2 pr-8"
        aria-label={id ? undefined : label}
        aria-invalid={failed ? true : undefined}
        aria-describedby={failed ? messagesId : undefined}
        value={shown}
        disabled={disabled}
        onChange={async (event) => {
          const next = event.currentTarget.value;
          setPending(next);
          setFailed(null);
          const result = await onCommit(next === "" ? null : next);
          setPending(null);
          if (!result.ok) setFailed({ value: next, message: result.message });
        }}
      >
        {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
        {known ? null : <option value={shown}>{unknownLabel ?? shown}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      <CellMessages id={messagesId} error={failed?.message} />
    </>
  );
}

/**
 * A removal in two presses, without a dialog: the first arms the button, the second removes.
 * Leaving the button or Escape disarms it.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  confirmText,
  onConfirm,
  children,
  variant = "ghost",
  size = "sm",
}: Readonly<{
  label: string;
  confirmLabel: string;
  confirmText: string;
  onConfirm: () => Promise<unknown>;
  children: ReactNode;
  variant?: "ghost" | "outline";
  size?: "sm" | "icon-sm";
}>) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={armed ? "danger" : variant}
        size={armed ? "sm" : size}
        aria-label={armed ? confirmLabel : label}
        loading={busy}
        onBlur={() => setArmed(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setArmed(false);
        }}
        onClick={async () => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setBusy(true);
          await onConfirm();
          setBusy(false);
          setArmed(false);
        }}
      >
        {armed ? confirmText : children}
      </Button>
      <span role="status" className="sr-only">
        {armed ? "Appuyez de nouveau pour confirmer." : ""}
      </span>
    </>
  );
}
