"use client";

import { useId, useMemo, useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ArrowUpDown, GripVerticalIcon, ListFilterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { CostingWorkbookColumn, CostingWorkbookColumnInspection } from "@/lib/catalogue/costing-workbook";
import { workbookCellAddress, workbookCellText, workbookCellValue } from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import { compileWorkbookColumnFilter, type WorkbookColumnFilter } from "@/lib/catalogue/workbook-preview-filter";
import { foldText } from "@/lib/text/fold";

import { WorkbookPreviewFilterControls } from "./WorkbookPreviewFilterControls";

const STANDARD_COLUMNS = [
  { id: "reference", label: "Référence", field: "ID" },
  { id: "designation", label: "Désignation", field: null },
  { id: "material", label: "Matière", field: "Matériau" },
  { id: "unit", label: "Unité", field: "Unité" },
  { id: "price", label: "Prix", field: "PR. FO" },
  { id: "supplyType", label: "Type de fourniture", field: null },
  { id: "findings", label: "À vérifier", field: null },
] as const;

export type WorkbookStandardColumnId = (typeof STANDARD_COLUMNS)[number]["id"];
type StandardColumn = { kind: "standard"; id: WorkbookStandardColumnId; label: string; address: string | null };
type SourceColumn = { kind: "source"; id: string; label: string; address: string; index: number; field?: CostingWorkbookColumn };
export type WorkbookPreviewColumn = StandardColumn | SourceColumn;
export type WorkbookColumnPreferences = { visibility: ReadonlyMap<string, boolean>; order: readonly string[] };
type ChangePreferences = (preferences: WorkbookColumnPreferences) => void;
type Sort = { columnId: string; direction: "ascending" | "descending" };
const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
const preferencesKey = "mergeone:workbook-preview-columns:v1";
const defaultPreferences: WorkbookColumnPreferences = { visibility: new Map(), order: [] };

function readColumnPreferences(key: string): WorkbookColumnPreferences {
  if (typeof window === "undefined") return defaultPreferences;
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (Array.isArray(saved?.visibility) && Array.isArray(saved?.order)) {
      return {
        visibility: new Map(saved.visibility.filter((entry: unknown) =>
          Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "boolean")),
        order: [...new Set<string>(saved.order.filter((id: unknown) => typeof id === "string"))],
      };
    }
  } catch {
    // The preview remains usable when browser storage is unavailable.
  }
  return defaultPreferences;
}

export type WorkbookCategory = "material" | "unit" | "supplyType";

export function workbookFilterOptions(values: readonly (string | null | undefined)[]) {
  const options = new Map<string, string>();
  for (const value of values) {
    const label = value?.trim();
    if (label) options.set(foldText(label), label);
  }
  return [...options.values()].sort(collator.compare);
}

export function workbookFilterMatches(value: string | null | undefined, selected: string | undefined) {
  return !selected || foldText(value?.trim() ?? "") === foldText(selected);
}

export function useWorkbookColumnPreferences(profileId: string | undefined) {
  const key = `${preferencesKey}:${profileId ?? "guest"}`;
  const saved = useMemo(() => readColumnPreferences(key), [key]);
  const [session, setSession] = useState<{ key: string; preferences: WorkbookColumnPreferences } | null>(null);
  const preferences = session?.key === key ? session.preferences : saved;
  function update(next: WorkbookColumnPreferences) {
    setSession({ key, preferences: next });
    try {
      window.localStorage.setItem(key, JSON.stringify({
        visibility: [...next.visibility],
        order: next.order,
      }));
    } catch {
      // The current view remains available in this preview.
    }
  }
  return [preferences, update] as const;
}

function useWorkbookColumnLayout(
  rows: CostingWorkbookRows,
  { headerRow, found }: CostingWorkbookColumnInspection,
  preferences: WorkbookColumnPreferences,
  changePreferences: ChangePreferences,
) {
  const options = useMemo<WorkbookPreviewColumn[]>(() => {
    const standard = STANDARD_COLUMNS.map(({ id, label, field }): StandardColumn => {
      const index = found.find(({ column }) => column === field)?.index;
      const address = headerRow !== null && index !== undefined ? workbookCellAddress(headerRow, index).replace(/\d+$/, "") : null;
      return { kind: "standard", id, label, address };
    });
    if (headerRow === null) return standard;
    const represented = new Set(found.filter(({ column }) => STANDARD_COLUMNS.some(({ field }) => field === column)).map(({ index }) => index));
    const fields = new Map(found.map(({ index, column }) => [index, column]));
    const occurrences = new Map<string, number>();
    const source = (rows[headerRow - 1] ?? []).flatMap((_, index): SourceColumn[] => {
      const label = workbookCellText(rows, headerRow, index);
      if (!label) return [];
      const occurrence = (occurrences.get(label) ?? 0) + 1;
      occurrences.set(label, occurrence);
      if (represented.has(index)) return [];
      return [{ kind: "source", id: `excel:${occurrence}:${label}`, label, index, field: fields.get(index), address: workbookCellAddress(headerRow, index).replace(/\d+$/, "") }];
    });
    return [...standard, ...source];
  }, [rows, headerRow, found]);

  const order = [...new Set([...preferences.order, ...options.map(({ id }) => id)])];
  const optionsById = new Map(options.map((column) => [column.id, column]));
  const visibleColumns = order.flatMap((id) => {
    const column = optionsById.get(id);
    return column && (preferences.visibility.get(id) ?? column.kind === "standard") ? [column] : [];
  });
  function toggle(id: string, visible: boolean) {
    changePreferences({ ...preferences, visibility: new Map(preferences.visibility).set(id, visible) });
  }

  function selectAll(visible: boolean) {
    const visibility = new Map(preferences.visibility);
    for (const { id } of options) visibility.set(id, visible);
    changePreferences({ ...preferences, visibility });
  }

  function move(id: string, targetId: string) {
    const ids = visibleColumns.map((column) => column.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1 || from === to) return;
    const reordered = arrayMove(ids, from, to);
    const visibleIds = new Set(ids);
    let index = 0;
    changePreferences({
      ...preferences,
      order: order.map((current) => visibleIds.has(current) ? reordered[index++] : current),
    });
  }

  return { options, visibleColumns, toggle, selectAll, move, reset: () => changePreferences(defaultPreferences) };
}

export function useWorkbookPreviewColumns(
  rows: CostingWorkbookRows,
  inspection: CostingWorkbookColumnInspection,
  preferences: WorkbookColumnPreferences,
  changePreferences: ChangePreferences,
) {
  const layout = useWorkbookColumnLayout(rows, inspection, preferences, changePreferences);
  const [filters, setFilters] = useState<ReadonlyMap<string, WorkbookColumnFilter>>(new Map());
  const [sort, setSort] = useState<Sort | null>(null);
  const visibleSource = layout.visibleColumns.filter((column): column is SourceColumn => column.kind === "source");
  const activeFilters = visibleSource.flatMap(({ id, index }) => {
    const filter = filters.get(id);
    const matches = filter ? compileWorkbookColumnFilter(filter) : null;
    return matches ? [{ id, index, matches }] : [];
  });

  function toggle(id: string, visible: boolean) {
    layout.toggle(id, visible);
    if (!visible) {
      setFilters((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
      if (sort?.columnId === id) setSort(null);
    }
  }

  function reset() {
    layout.reset();
    setFilters(new Map());
    setSort(null);
  }

  function applyView<Row extends { row: number }>(articles: readonly Row[]) {
    const filtered = activeFilters.length ? articles.filter(({ row }) =>
      activeFilters.every(({ index, matches }) => matches(workbookCellValue(rows, row, index)))) : articles;
    const sortedColumn = sort && visibleSource.find(({ id }) => id === sort.columnId);
    if (!sort || !sortedColumn) return filtered;
    const { index } = sortedColumn;
    const direction = sort.direction === "ascending" ? 1 : -1;
    return filtered.map((article) => ({
      article, text: workbookCellText(rows, article.row, index), raw: rows[article.row - 1]?.[index],
    })).sort((a, b) => {
      if (!a.text || !b.text) return Number(!a.text) - Number(!b.text);
      if (typeof a.raw === "number" && typeof b.raw === "number") return direction * (a.raw - b.raw);
      if (typeof a.raw === "number" || typeof b.raw === "number") return Number(typeof a.raw !== "number") - Number(typeof b.raw !== "number");
      return direction * collator.compare(a.text, b.text);
    }).map(({ article }) => article);
  }

  return {
    ...layout, toggle, reset, applyView, filters, sort,
    activeFilterIds: new Set(activeFilters.map(({ id }) => id)),
    clearFilters: () => setFilters(new Map()),
    setFilter: (id: string, filter: WorkbookColumnFilter) => setFilters((previous) => new Map(previous).set(id, filter)),
    toggleSort: (id: string) => setSort((previous) => {
      if (previous?.columnId !== id) return { columnId: id, direction: "ascending" };
      return previous.direction === "ascending" ? { columnId: id, direction: "descending" } : null;
    }),
  };
}

type ColumnView = ReturnType<typeof useWorkbookPreviewColumns>;

export function WorkbookPreviewColumnPicker({ view, disabled, onChange }: Readonly<{
  view: ColumnView;
  disabled: boolean;
  onChange: (id?: string) => void;
}>) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>Colonnes à afficher</PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] border border-border">
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle>Colonnes affichées</PopoverTitle>
          <Button size="xs" variant="ghost" onClick={() => { view.reset(); onChange(); }}>Rétablir</Button>
        </div>
        <WorkbookColumnChoices view={view} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

function WorkbookColumnChoice({ column, checked, locked, canMoveUp, canMoveDown, onToggle, onMove }: Readonly<{
  column: WorkbookPreviewColumn;
  checked: boolean;
  locked: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: (checked: boolean) => void;
  onMove: (step: -1 | 1) => void;
}>) {
  const { id, address, label } = column;
  const name = address ? `${label} · ${address}` : label;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !checked });

  return (
    <div ref={checked ? setNodeRef : undefined} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex min-h-9 items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-subtle ${isDragging ? "z-10 bg-surface shadow-sm" : ""}`}>
      {checked ? (
        <Button ref={setActivatorNodeRef} {...attributes} {...listeners} size="icon-xs" variant="ghost"
          className="shrink-0 touch-none cursor-grab active:cursor-grabbing"
          aria-label={`Glisser ${name}`} aria-describedby={undefined} tabIndex={-1} title={`Glisser ${name}`}>
          <GripVerticalIcon aria-hidden="true" />
        </Button>
      ) : <span aria-hidden="true" className="size-6 shrink-0" />}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
        <input type="checkbox" aria-label={name} className="size-4 shrink-0 accent-primary"
          checked={checked} disabled={locked} onChange={(event) => onToggle(event.currentTarget.checked)} />
        <span className="min-w-0 wrap-anywhere">
          {label}
          {address ? <span className="ml-1 font-mono text-xs text-muted-foreground">{address}</span> : null}
        </span>
      </label>
      {checked ? (
        <div className="flex shrink-0">
          <Button size="icon-xs" variant="ghost" aria-label={`Monter ${name}`} title={`Monter ${name}`}
            disabled={!canMoveUp} onClick={() => onMove(-1)}>
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label={`Descendre ${name}`} title={`Descendre ${name}`}
            disabled={!canMoveDown} onClick={() => onMove(1)}>
            <ArrowDown aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function WorkbookColumnChoices({ view, allowEmpty = false, onChange }: Readonly<{
  view: ReturnType<typeof useWorkbookColumnLayout>;
  allowEmpty?: boolean;
  onChange?: (id?: string) => void;
}>) {
  const dndId = useId();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const sortableIds = view.visibleColumns.map(({ id }) => id);
  const visibleIds = new Set(sortableIds);
  const pickerColumns = [...view.visibleColumns, ...view.options.filter(({ id }) => !visibleIds.has(id))];

  function move(id: string, targetId: string | undefined) {
    if (!targetId || id === targetId) return;
    view.move(id, targetId);
    onChange?.();
  }

  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => move(String(active.id), over ? String(over.id) : undefined)}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <fieldset className="max-h-[min(55dvh,24rem)] space-y-1 overflow-y-auto overscroll-contain">
          <legend className="sr-only">Colonnes de l’aperçu</legend>
          {pickerColumns.map((column, index) => {
            const checked = visibleIds.has(column.id);
            return <WorkbookColumnChoice key={column.id} column={column} checked={checked}
              locked={!allowEmpty && checked && visibleIds.size === 1}
              canMoveUp={index > 0} canMoveDown={index < sortableIds.length - 1}
              onToggle={(visible) => { view.toggle(column.id, visible); onChange?.(column.id); }}
              onMove={(step) => move(column.id, sortableIds[index + step])} />;
          })}
        </fieldset>
      </SortableContext>
    </DndContext>
  );
}

export function WorkbookPreviewColumnDialog({ fileName, rows, inspection, preferences, onCancel, onConfirm }: Readonly<{
  fileName: string;
  rows: CostingWorkbookRows;
  inspection: CostingWorkbookColumnInspection;
  preferences: WorkbookColumnPreferences;
  onCancel: () => void;
  onConfirm: ChangePreferences;
}>) {
  const [draft, setDraft] = useState(preferences);
  const view = useWorkbookColumnLayout(rows, inspection, draft, setDraft);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Colonnes à afficher</DialogTitle>
          <DialogDescription>
            Choisissez les colonnes et leur ordre dans l’aperçu des articles.
            <span className="mt-1 block wrap-anywhere font-medium">{fileName}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="outline" disabled={view.visibleColumns.length === view.options.length}
            onClick={() => view.selectAll(true)}>Tout sélectionner</Button>
          <Button size="xs" variant="outline" disabled={view.visibleColumns.length === 0}
            onClick={() => view.selectAll(false)}>Tout désélectionner</Button>
        </div>
        <WorkbookColumnChoices view={view} allowEmpty />
        <DialogFooter>
          <Button variant="ghost" className="sm:mr-auto" onClick={view.reset}>Rétablir</Button>
          <Button variant="outline" onClick={onCancel}>Annuler</Button>
          <Button disabled={view.visibleColumns.length === 0} onClick={() => onConfirm(draft)}>Afficher l’aperçu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkbookPreviewSourceHeader({ source, view, rows, articles, disabled, onChange }: Readonly<{
  source: SourceColumn;
  view: ColumnView;
  rows: CostingWorkbookRows;
  articles: readonly { row: number }[];
  disabled: boolean;
  onChange: () => void;
}>) {
  const { id, label, address, index, field } = source;
  const order = view.sort?.columnId === id ? view.sort.direction : undefined;
  const Icon = order === "ascending" ? ArrowUp : order === "descending" ? ArrowDown : ArrowUpDown;
  const active = view.activeFilterIds.has(id);
  return (
    <th key={id} scope="col" aria-sort={order} className="min-w-36 px-3 py-2">
      <div className="flex items-center gap-1">
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="xs" disabled={disabled}
            className={`h-auto whitespace-normal px-1.5 text-left ${active ? "bg-primary/10 text-primary" : ""}`}
            aria-label={`${label} · ${address} · filtrer`} />}>
            {label}<ListFilterIcon aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent align="start" className="border border-border">
            <PopoverTitle>{label} · {address}</PopoverTitle>
            <WorkbookPreviewFilterControls rows={rows} articles={articles} index={index} field={field}
              label={`${label} · ${address}`} disabled={disabled} filter={view.filters.get(id)}
              onChange={(filter) => { view.setFilter(id, filter); onChange(); }} />
          </PopoverContent>
        </Popover>
        <Button variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Trier par ${label} · ${address}`}
          onClick={() => { view.toggleSort(id); onChange(); }}><Icon aria-hidden="true" /></Button>
      </div>
    </th>
  );
}

export function WorkbookPreviewSourceCell({ source, rows, row }: Readonly<{ source: SourceColumn; rows: CostingWorkbookRows; row: number }>) {
  const text = workbookCellText(rows, row, source.index);
  return <td className="max-w-64"><span className="line-clamp-2 wrap-anywhere" title={text || undefined}>{text || "—"}</span></td>;
}

export function WorkbookPreviewDropdownHeader({ label, options, value, disabled, onChange }: Readonly<{
  label: string;
  options: readonly string[];
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}>) {
  return (
    <th scope="col" aria-label={label}>
      <Popover>
        <PopoverTrigger render={<Button variant="ghost" size="xs" disabled={disabled}
          className={`h-auto whitespace-normal px-1.5 text-left ${value ? "bg-primary/10 text-primary" : ""}`}
          aria-label={`${label} · filtrer`} />}>
          {label}<ListFilterIcon aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="start" className="border border-border">
          <PopoverTitle>{label}</PopoverTitle>
          <NativeSelect size="sm" aria-label={`Filtre ${label}`} value={value} disabled={disabled}
            onChange={(event) => onChange(event.currentTarget.value)}>
            <option value="">Toutes les lignes</option>
            {options.map((option) => <option key={option} value={option}>{option}</option>)}
          </NativeSelect>
        </PopoverContent>
      </Popover>
    </th>
  );
}
