"use client";

import { useMemo, useState } from "react";

import type {
  TakeoffDiffChangedEntry,
  TakeoffDiffEntry,
  TakeoffDiffField,
  TakeoffDiffUnchangedEntry,
  TakeoffJobCompareResponse,
  TakeoffJobItem,
} from "@/lib/takeoff/types";
import { buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Card } from "@/components/ui/card";

type TakeoffDiffViewProps = {
  compare: TakeoffJobCompareResponse;
  onApplySelection: (selectedBaseItemIds: string[]) => void | Promise<void>;
  isApplyingSelection?: boolean;
  applySelectionError?: string | null;
};

type DiffMode = "inline" | "side-by-side";
type DiffFilter = "all" | "added" | "removed" | "changed" | "unchanged";

type UnifiedDiffEntry = {
  key: string;
  changeType: DiffEntryChangeType;
  baseItem: TakeoffJobItem | null;
  otherItem: TakeoffJobItem | null;
  delta: TakeoffDiffField[];
  matchScore: number | null;
  matchStrategy: string | null;
};

type DiffEntryChangeType = TakeoffDiffEntry["change_type"];

const FILTER_OPTIONS: Array<{ value: DiffFilter; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "added", label: "Ajoutes" },
  { value: "removed", label: "Supprimes" },
  { value: "changed", label: "Modifies" },
  { value: "unchanged", label: "Inchanges" },
];

const CHANGE_TYPE_LABELS: Record<DiffEntryChangeType, string> = {
  added: "Ajout",
  removed: "Suppression",
  changed: "Modification",
  unchanged: "Inchange",
};

const CHANGE_TYPE_CARD_CSS: Record<DiffEntryChangeType, string> = {
  added: "border-success-border bg-success-subtle",
  removed: "border-danger-border bg-danger-subtle",
  changed: "border-warning-border bg-warning-subtle",
  unchanged: "border-border bg-surface",
};

const CHANGE_TYPE_BADGE_CSS: Record<DiffEntryChangeType, string> = {
  added: "border border-success-border bg-success-subtle text-success",
  removed: "border border-danger-border bg-danger-subtle text-danger",
  changed: "border border-warning-border bg-warning-light text-warning",
  unchanged: "border border-border bg-muted text-foreground-secondary",
};

function formatMatchScore(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return value.toFixed(3);
}

function formatTextValue(value: string | number | null) {
  if (value === null) return "-";
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(value)
      : "-";
  }
  return value;
}

function formatItemTitle(item: TakeoffJobItem | null) {
  if (!item) return "-";
  const designation = item.designation.trim();
  return designation.length > 0 ? designation : "(sans designation)";
}

function formatItemMeta(item: TakeoffJobItem | null) {
  if (!item) return "-";

  const quantity = Number.isFinite(item.quantity)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(item.quantity)
    : "-";
  const unit = item.unit?.trim().length ? item.unit.trim() : "-";
  const page = item.source_page ?? "-";
  return `Qte ${quantity} ${unit} | Page ${page}`;
}

function isSelectableEntry(entry: UnifiedDiffEntry) {
  if (!entry.baseItem) return false;
  return (
    entry.changeType === "removed" ||
    entry.changeType === "changed" ||
    entry.changeType === "unchanged"
  );
}

function toUnifiedEntries(compare: TakeoffJobCompareResponse): UnifiedDiffEntry[] {
  const added = compare.added.map((entry) => ({
    key: entry.key,
    changeType: entry.change_type,
    baseItem: null,
    otherItem: entry.other_item,
    delta: [],
    matchScore: null,
    matchStrategy: null,
  }));

  const removed = compare.removed.map((entry) => ({
    key: entry.key,
    changeType: entry.change_type,
    baseItem: entry.base_item,
    otherItem: null,
    delta: [],
    matchScore: null,
    matchStrategy: null,
  }));

  const changed = compare.changed.map((entry: TakeoffDiffChangedEntry) => ({
    key: entry.key,
    changeType: entry.change_type,
    baseItem: entry.base_item,
    otherItem: entry.other_item,
    delta: entry.delta,
    matchScore: entry.match_score,
    matchStrategy: entry.match_strategy,
  }));

  const unchanged = compare.unchanged.map((entry: TakeoffDiffUnchangedEntry) => ({
    key: entry.key,
    changeType: entry.change_type,
    baseItem: entry.base_item,
    otherItem: entry.other_item,
    delta: [],
    matchScore: entry.match_score,
    matchStrategy: entry.match_strategy,
  }));

  return [...changed, ...added, ...removed, ...unchanged];
}

function InlineDiffEntry({
  entry,
  selected,
  onSelectionChange,
}: {
  entry: UnifiedDiffEntry;
  selected: boolean;
  onSelectionChange: (selected: boolean) => void;
}) {
  const selectable = isSelectableEntry(entry);

  return (
    <article className={`rounded-xl border p-4 ${CHANGE_TYPE_CARD_CSS[entry.changeType]}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${CHANGE_TYPE_BADGE_CSS[entry.changeType]}`}
            >
              {CHANGE_TYPE_LABELS[entry.changeType]}
            </span>
            <span className="text-xs text-muted-foreground">
              Score: {formatMatchScore(entry.matchScore)}
            </span>
            <span className="text-xs text-muted-foreground">
              Match: {entry.matchStrategy ?? "-"}
            </span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">
            {formatItemTitle(entry.baseItem ?? entry.otherItem)}
          </h3>
        </div>

        {selectable ? (
          <label className="flex items-center gap-2 text-xs text-foreground-secondary">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelectionChange(event.target.checked)}
            />
            Sélection
          </label>
        ) : null}
      </header>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Extraction actuelle
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {formatItemTitle(entry.baseItem)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{formatItemMeta(entry.baseItem)}</p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Extraction de comparaison
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {formatItemTitle(entry.otherItem)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{formatItemMeta(entry.otherItem)}</p>
        </section>
      </div>

      {entry.delta.length > 0 ? (
        <div className="mt-4 space-y-2">
          {entry.delta.map((deltaEntry) => (
            <div
              key={`${entry.key}:${deltaEntry.field}`}
              className="grid gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm md:grid-cols-[180px_1fr_auto_1fr]"
            >
              <span className="font-medium text-foreground-secondary">{deltaEntry.label}</span>
              <span className="text-muted-foreground line-through">
                {formatTextValue(deltaEntry.before_value)}
              </span>
              <span className="text-center text-subtle-foreground">-&gt;</span>
              <span className="font-semibold text-foreground">
                {formatTextValue(deltaEntry.after_value)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SideBySideDiffEntry({
  entry,
  selected,
  onSelectionChange,
}: {
  entry: UnifiedDiffEntry;
  selected: boolean;
  onSelectionChange: (selected: boolean) => void;
}) {
  const selectable = isSelectableEntry(entry);

  return (
    <article className={`rounded-xl border p-4 ${CHANGE_TYPE_CARD_CSS[entry.changeType]}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${CHANGE_TYPE_BADGE_CSS[entry.changeType]}`}
            >
              {CHANGE_TYPE_LABELS[entry.changeType]}
            </span>
            <span className="text-xs text-muted-foreground">
              Score: {formatMatchScore(entry.matchScore)}
            </span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-foreground">
            {formatItemTitle(entry.baseItem ?? entry.otherItem)}
          </h3>
        </div>

        {selectable ? (
          <label className="flex items-center gap-2 text-xs text-foreground-secondary">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelectionChange(event.target.checked)}
            />
            Sélection
          </label>
        ) : null}
      </header>

      <div
        className="relative mt-4 overflow-x-auto rounded-lg border border-border bg-surface"
        role="region"
        aria-label="Détail des champs comparés"
        tabIndex={0}
      >
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>Champ</th>
              <th>Extraction actuelle</th>
              <th>Extraction de comparaison</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="font-medium">Désignation</td>
              <td>{formatItemTitle(entry.baseItem)}</td>
              <td>{formatItemTitle(entry.otherItem)}</td>
            </tr>
            <tr>
              <td className="font-medium">Meta</td>
              <td>{formatItemMeta(entry.baseItem)}</td>
              <td>{formatItemMeta(entry.otherItem)}</td>
            </tr>
            {entry.delta.map((deltaEntry) => (
              <tr key={`${entry.key}:${deltaEntry.field}`}>
                <td className="font-medium">{deltaEntry.label}</td>
                <td className="text-muted-foreground">
                  {formatTextValue(deltaEntry.before_value)}
                </td>
                <td className="font-semibold text-foreground">
                  {formatTextValue(deltaEntry.after_value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export default function TakeoffDiffView({
  compare,
  onApplySelection,
  isApplyingSelection = false,
  applySelectionError = null,
}: TakeoffDiffViewProps) {
  const [filter, setFilter] = useState<DiffFilter>("all");
  const [mode, setMode] = useState<DiffMode>("inline");

  const entries = useMemo(() => toUnifiedEntries(compare), [compare]);

  const selectableIds = useMemo(
    () =>
      entries
        .filter((entry) => isSelectableEntry(entry))
        .map((entry) => entry.baseItem?.id)
        .filter((value): value is string => Boolean(value)),
    [entries]
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(selectableIds));

  const filteredEntries = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((entry) => entry.changeType === filter);
  }, [entries, filter]);

  const visibleSelectableIds = useMemo(
    () =>
      filteredEntries
        .filter((entry) => isSelectableEntry(entry))
        .map((entry) => entry.baseItem?.id)
        .filter((value): value is string => Boolean(value)),
    [filteredEntries]
  );

  const selectedVisibleCount = visibleSelectableIds.filter((id) => selectedIds.has(id)).length;
  const allVisibleSelected =
    visibleSelectableIds.length > 0 && selectedVisibleCount === visibleSelectableIds.length;

  function toggleItemSelection(itemId: string, nextSelected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (nextSelected) {
        next.add(itemId);
      } else {
        next.delete(itemId);
      }
      return next;
    });
  }

  function toggleVisibleSelection(nextSelected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleSelectableIds.forEach((itemId) => {
        if (nextSelected) {
          next.add(itemId);
        } else {
          next.delete(itemId);
        }
      });
      return next;
    });
  }

  const selectedIdsArray = useMemo(
    () => Array.from(selectedIds).filter((id) => selectableIds.includes(id)),
    [selectedIds, selectableIds]
  );

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground">Résumé des changements</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Ajouts</p>
            <p className="text-lg font-semibold text-success">{compare.summary.added}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Suppressions</p>
            <p className="text-lg font-semibold text-danger">{compare.summary.removed}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Modifications</p>
            <p className="text-lg font-semibold text-warning">{compare.summary.changed}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Inchanges</p>
            <p className="text-lg font-semibold text-foreground-secondary">
              {compare.summary.unchanged}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Total extraction actuelle</p>
            <p className="text-lg font-semibold text-foreground">
              {compare.summary.total_base}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-xs text-muted-foreground">Total extraction de comparaison</p>
            <p className="text-lg font-semibold text-foreground">
              {compare.summary.total_other}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-muted-foreground" htmlFor="takeoff-diff-filter">
            Filtre
          </label>
          <NativeSelect
            id="takeoff-diff-filter"
            size="sm" className="w-[180px]"
            value={filter}
            onChange={(event) => setFilter(event.target.value as DiffFilter)}
          >
            {FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>

          <div className="ml-2 inline-flex overflow-hidden rounded-lg border border-border bg-surface">
            <button
              type="button"
              className={`px-3 py-1.5 text-xs font-semibold ${
                mode === "inline"
                  ? "bg-info text-white"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              onClick={() => setMode("inline")}
            >
              Vue unifiee
            </button>
            <button
              type="button"
              className={`border-l border-border px-3 py-1.5 text-xs font-semibold ${
                mode === "side-by-side"
                  ? "bg-info text-white"
                  : "text-muted-foreground hover:bg-muted"
              }`}
              onClick={() => setMode("side-by-side")}
            >
              Cote à côté
            </button>
          </div>

          <label className="ml-auto flex items-center gap-2 text-xs text-foreground-secondary">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={(event) => toggleVisibleSelection(event.target.checked)}
              disabled={visibleSelectableIds.length === 0}
            />
            Tout sélectionner (visible)
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Sélection cherry-pick: {selectedIdsArray.length} item(s)
          </span>
          <button
            type="button"
            className={buttonVariants({ variant: "primary" })}
            onClick={() => {
              void onApplySelection(selectedIdsArray);
            }}
            disabled={isApplyingSelection || selectableIds.length === 0}
          >
            {isApplyingSelection ? "Application…" : "Appliquer la sélection"}
          </button>
        </div>

        {applySelectionError ? (
          <p className="mt-2 text-sm text-danger">{applySelectionError}</p>
        ) : null}
      </Card>

      <section className="space-y-3">
        {filteredEntries.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">
            Aucun changement pour ce filtre.
          </Card>
        ) : (
          filteredEntries.map((entry) => {
            const selectableId = entry.baseItem?.id ?? "";
            const selected = selectableId.length > 0 && selectedIds.has(selectableId);

            if (mode === "inline") {
              return (
                <InlineDiffEntry
                  key={entry.key}
                  entry={entry}
                  selected={selected}
                  onSelectionChange={(nextSelected) => {
                    if (!selectableId) return;
                    toggleItemSelection(selectableId, nextSelected);
                  }}
                />
              );
            }

            return (
              <SideBySideDiffEntry
                key={entry.key}
                entry={entry}
                selected={selected}
                onSelectionChange={(nextSelected) => {
                  if (!selectableId) return;
                  toggleItemSelection(selectableId, nextSelected);
                }}
              />
            );
          })
        )}
      </section>
    </div>
  );
}
