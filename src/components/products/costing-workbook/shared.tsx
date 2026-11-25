"use client";

import { createContext, useContext, useEffect, useId, useState } from "react";

import { CheckIcon, CopyIcon, PencilIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  workbookCellAddress,
  workbookCellText,
  type WorkbookEdit,
} from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";

/** Pieces the two previews of the costing workbook import share (TI-711). */

export const DECISIONS_PER_PAGE = 30;

export const formatCount = (value: number) => value.toLocaleString("fr-FR");

export function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

export type WorkbookReview = { page: number; view: string; search: string; filter?: string };
export type ReviewChoice = { id: string; label: string; count: number; tone?: "warning" };

/**
 * What a preview may do to the sheet the screen holds: read a cell, correct cells (the preview is then computed
 * again), nothing while a request runs. The Excel file itself is never written.
 */
export type WorkbookEditor = {
  rows: CostingWorkbookRows;
  busy: boolean;
  revision: number;
  isCurrentRevision: (revision: number) => boolean;
  setEditorDirty: (id: string, dirty: boolean) => void;
  applyEdits: (edits: WorkbookEdit[]) => void;
};

const WorkbookEditorContext = createContext<WorkbookEditor | null>(null);
export const WorkbookEditorProvider = WorkbookEditorContext.Provider;

export function useWorkbookEditor(): WorkbookEditor {
  const editor = useContext(WorkbookEditorContext);
  if (!editor) throw new Error("useWorkbookEditor must be used inside the costing workbook import.");
  return editor;
}

export function WorkbookReviewLayout({ groups, active, onSelect, children }: Readonly<{
  groups: ReviewChoice[][];
  active: string;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}>) {
  const menuId = useId();
  const visibleGroups = groups.filter((group) => group.length > 0);
  return (
    <div className={visibleGroups.length ? "grid min-w-0 items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]" : "min-w-0"}>
      {visibleGroups.length > 0 ? (
        <aside aria-label="Vues de l’aperçu" className="min-w-0 space-y-2 rounded-lg border border-border bg-surface-subtle p-2">
          {visibleGroups.map((group, index) => (
            <div key={group[0].id} className={index > 0 ? "grid gap-1 border-t border-border pt-2" : "grid gap-1"}>
              {group.map(({ id, label, count, tone }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={id === active}
                  aria-describedby={`${menuId}-${id}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary/10 aria-pressed:font-semibold aria-pressed:text-primary"
                  onClick={() => onSelect(id)}
                >
                  <span>{label}</span>
                  <span
                    id={`${menuId}-${id}`}
                    aria-hidden="true"
                    className={`shrink-0 text-xs tabular-nums ${tone === "warning" && count > 0 ? "font-semibold text-warning" : "text-muted-foreground"}`}
                  >
                    {formatCount(count)}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </aside>
      ) : null}
      <div className="min-w-0 space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5">
        {children}
      </div>
    </div>
  );
}

export function ReviewPager({ page, total, onSelect, suffix = "" }: Readonly<{
  page: number;
  total: number;
  onSelect: (page: number) => void;
  suffix?: string;
}>) {
  if (total <= DECISIONS_PER_PAGE) return null;
  const start = page * DECISIONS_PER_PAGE;
  const end = Math.min(start + DECISIONS_PER_PAGE, total);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">
        {`${formatCount(start + 1)}–${formatCount(end)} sur ${formatCount(total)}${suffix}`}
      </span>
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onSelect(page - 1)}>Précédente</Button>
      <Button variant="outline" size="sm" disabled={end >= total} onClick={() => onSelect(page + 1)}>Suivante</Button>
    </div>
  );
}

/** The page within bounds: a search or a correction may leave fewer pages than the one shown. */
export function boundedPage(page: number, total: number) {
  return Math.min(page, Math.max(0, Math.ceil(total / DECISIONS_PER_PAGE) - 1));
}

/** Where a value sits in Excel: its row and column name, and its address to copy into Excel's name box. */
export function WorkbookCell({ row, slot, column, field = `F${slot}_ref` }: Readonly<{
  row: number;
  slot?: number;
  column?: number;
  field?: string;
}>) {
  const [feedback, setFeedback] = useState("");
  const address = column === undefined ? null : workbookCellAddress(row, column);

  async function copyCell() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setFeedback(`${address} copiée.`);
    } catch {
      setFeedback("Sélectionnez l’adresse pour la copier.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      <span>{`Ligne ${row} · ${field}`}</span>
      {address ? (
        <button type="button" aria-label={`Copier la cellule Excel ${address}`} title={`Copier ${address}`} onClick={() => void copyCell()}
          className="inline-flex items-center gap-1 rounded font-mono text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {address}<CopyIcon className="size-3" aria-hidden="true" />
        </button>
      ) : null}
      <span aria-live="polite" className="basis-full empty:hidden">{feedback}</span>
    </div>
  );
}

/**
 * A value of the sheet the office may correct in place. The correction is applied to the rows the screen holds
 * and the preview is computed again; the Excel file is not written. Without a column (a header absent from the
 * workbook), the value is only shown.
 */
export function EditableValue({ row, column, empty = "—", className, mono = false, display }: Readonly<{
  row: number;
  column?: number;
  empty?: string;
  className?: string;
  mono?: boolean;
  /** What to show instead of the cell's own text (a formatted price); the correction still edits the cell. */
  display?: React.ReactNode;
}>) {
  const { rows, busy, applyEdits, setEditorDirty } = useWorkbookEditor();
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const value = column === undefined ? "" : workbookCellText(rows, row, column);
  const dirty = draft !== null && draft.trim() !== value;
  useEffect(() => {
    if (!dirty) return;
    setEditorDirty(inputId, true);
    return () => setEditorDirty(inputId, false);
  }, [dirty, inputId, setEditorDirty]);
  if (column === undefined) return <span className={className}>{display ?? empty}</span>;
  const address = workbookCellAddress(row, column);

  function submit() {
    if (draft === null || busy) return;
    const next = draft.trim();
    setDraft(null);
    if (next !== value) applyEdits([{ row, column: column!, value: next || null }]);
  }

  if (draft !== null) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <label htmlFor={inputId} className="sr-only">{`Nouvelle valeur de la cellule ${address}`}</label>
        <Input
          id={inputId}
          size="sm"
          autoFocus
          autoComplete="off"
          className={`h-8 min-w-24 px-2 ${mono ? "font-mono text-xs" : ""}`}
          value={draft}
          disabled={busy}
          maxLength={4000}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraft(null);
            }
          }}
        />
        <Button variant="outline" size="icon-xs" aria-label={`Appliquer la correction de ${address}`} disabled={busy} onClick={submit}>
          <CheckIcon aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={`Annuler la correction de ${address}`} onClick={() => setDraft(null)}>
          <XIcon aria-hidden="true" />
        </Button>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 max-w-full items-start gap-1">
      <span className={`min-w-0 ${mono ? "font-mono text-xs" : ""} ${value || display ? "" : "text-muted-foreground"} ${className ?? ""}`}>{display ?? (value || empty)}</span>
      <button
        type="button"
        disabled={busy}
        aria-label={`Corriger la cellule ${address}`}
        title={`Corriger ${address} dans l’aperçu`}
        className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        onClick={() => setDraft(value)}
      >
        <PencilIcon className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}
