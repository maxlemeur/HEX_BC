"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import type { CostingWorkbookColumnInspection } from "@/lib/catalogue/costing-workbook";
import { workbookCellAddress, workbookCellText } from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import { foldText } from "@/lib/text/fold";

const STANDARD_COLUMNS = [
  { id: "reference", label: "Référence", field: "ID" },
  { id: "designation", label: "Désignation", field: null },
  { id: "material", label: "Matière", field: "Matériau" },
  { id: "unit", label: "Unité", field: "Unité" },
  { id: "price", label: "Prix", field: "PR. FO" },
  { id: "supplyType", label: "Type de fourniture", field: null },
  { id: "findings", label: "À vérifier", field: null },
] as const;

type SourceColumn = { id: string; label: string; address: string; index: number };
type Sort = { columnId: string; direction: "ascending" | "descending" };
const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });

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

export function useWorkbookPreviewColumns(rows: CostingWorkbookRows, inspection: CostingWorkbookColumnInspection) {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [search, setSearch] = useState<ReadonlyMap<string, string>>(new Map());
  const [sort, setSort] = useState<Sort | null>(null);
  const { headerRow, found } = inspection;

  const options = useMemo(() => {
    const standard = STANDARD_COLUMNS.map(({ id, label, field }) => {
      const index = found.find(({ column }) => column === field)?.index;
      const address = headerRow !== null && index !== undefined ? workbookCellAddress(headerRow, index).replace(/\d+$/, "") : null;
      return { id, label, address };
    });
    if (headerRow === null) return { standard, source: [] };
    const represented = new Set(found.filter(({ column }) => STANDARD_COLUMNS.some(({ field }) => field === column)).map(({ index }) => index));
    const source = (rows[headerRow - 1] ?? []).flatMap((_, index): SourceColumn[] => {
      const label = workbookCellText(rows, headerRow, index);
      if (!label || represented.has(index)) return [];
      return [{ id: `excel:${index}:${label}`, label, index, address: workbookCellAddress(headerRow, index).replace(/\d+$/, "") }];
    });
    return { standard, source };
  }, [rows, headerRow, found]);

  const visibleStandard = new Set(options.standard.filter(({ id }) => overrides.get(id) ?? true).map(({ id }) => id));
  const visibleSource = options.source.filter(({ id }) => overrides.get(id) === true);

  function toggle(id: string, visible: boolean) {
    setOverrides((previous) => new Map(previous).set(id, visible));
    if (!visible) {
      setSearch((previous) => {
        const next = new Map(previous);
        next.delete(id);
        return next;
      });
      if (sort?.columnId === id) setSort(null);
    }
  }

  function reset() {
    setOverrides(new Map());
    setSearch(new Map());
    setSort(null);
  }

  function applyView<Row extends { row: number }>(articles: readonly Row[]) {
    const filters = visibleSource.flatMap(({ id, index }) => {
      const query = foldText(search.get(id)?.trim() ?? "");
      return query ? [{ index, query }] : [];
    });
    const filtered = filters.length ? articles.filter(({ row }) =>
      filters.every(({ index, query }) => foldText(workbookCellText(rows, row, index)).includes(query))) : articles;
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
    options, visibleStandard, visibleSource, toggle, reset, applyView, search, sort,
    clearFilters: () => setSearch(new Map()),
    setValue: (id: string, value: string) => setSearch((previous) => new Map(previous).set(id, value)),
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
  const visibleIds = new Set<string>([...view.visibleStandard, ...view.visibleSource.map(({ id }) => id)]);
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>Colonnes à afficher</PopoverTrigger>
      <PopoverContent align="start" className="border border-border">
        <div className="flex items-center justify-between gap-2">
          <PopoverTitle>Colonnes affichées</PopoverTitle>
          <Button size="xs" variant="ghost" onClick={() => { view.reset(); onChange(); }}>Rétablir</Button>
        </div>
        <fieldset className="max-h-[min(55dvh,24rem)] space-y-1 overflow-y-auto overscroll-contain">
          <legend className="sr-only">Colonnes de l’aperçu</legend>
          {[...view.options.standard, ...view.options.source].map(({ id, address, label }) => {
            const checked = visibleIds.has(id);
            return (
              <label key={id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-subtle">
                <input type="checkbox" aria-label={address ? `${label} · ${address}` : label}
                  className="size-4 shrink-0 accent-primary" checked={checked}
                  disabled={checked && visibleIds.size === 1}
                  onChange={(event) => { view.toggle(id, event.currentTarget.checked); onChange(id); }} />
                <span className="min-w-0 wrap-anywhere">
                  {label}
                  {address ? <span className="ml-1 font-mono text-xs text-muted-foreground">{address}</span> : null}
                </span>
              </label>
            );
          })}
        </fieldset>
      </PopoverContent>
    </Popover>
  );
}

export function WorkbookPreviewSourceHeaders({ view, disabled, onChange }: Readonly<{
  view: ColumnView;
  disabled: boolean;
  onChange: () => void;
}>) {
  return view.visibleSource.map(({ id, label, address }) => {
    const order = view.sort?.columnId === id ? view.sort.direction : undefined;
    const Icon = order === "ascending" ? ArrowUp : order === "descending" ? ArrowDown : ArrowUpDown;
    const value = view.search.get(id) ?? "";
    return (
      <th key={id} scope="col" aria-sort={order} className="min-w-36 px-3 py-2">
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger render={<Button variant="ghost" size="xs" disabled={disabled}
              className={`h-auto whitespace-normal px-1.5 text-left ${value ? "bg-primary/10 text-primary" : ""}`}
              aria-label={`${label} · ${address} · filtrer`} />}>
              {label}<ListFilterIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="start" className="border border-border">
              <PopoverTitle>{label} · {address}</PopoverTitle>
              <Input type="search" size="sm" aria-label={`Filtre ${label} · ${address}`} value={value}
                onChange={(event) => { view.setValue(id, event.currentTarget.value); onChange(); }} />
            </PopoverContent>
          </Popover>
          <Button variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Trier par ${label} · ${address}`}
            onClick={() => { view.toggleSort(id); onChange(); }}><Icon aria-hidden="true" /></Button>
        </div>
      </th>
    );
  });
}

export function WorkbookPreviewSourceCells({ view, rows, row }: Readonly<{ view: ColumnView; rows: CostingWorkbookRows; row: number }>) {
  return view.visibleSource.map(({ id, index }) => {
    const text = workbookCellText(rows, row, index);
    return <td key={id} className="max-w-64"><span className="line-clamp-2 wrap-anywhere" title={text || undefined}>{text || "—"}</span></td>;
  });
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
