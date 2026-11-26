"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { CostingWorkbookColumn } from "@/lib/catalogue/costing-workbook";
import { workbookCellAddress, workbookCellText } from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import { parseAmountCents, parseQuantity } from "@/lib/numeric-input/parsers";
import { foldText } from "@/lib/text/fold";

import { boundedPage, DECISIONS_PER_PAGE, formatCount, plural, ReviewPager } from "./shared";

const collator = new Intl.Collator("fr", { numeric: true, sensitivity: "base" });
type Column = { header: string; field?: CostingWorkbookColumn; index: number; label: string };
type Sort = { index: number; direction: "ascending" | "descending" };

export function WorkbookColumnDataPreview({ rows, headerRow, columns }: Readonly<{
  rows: CostingWorkbookRows;
  headerRow: number;
  columns: readonly Column[];
}>) {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [filterColumn, setFilterColumn] = useState("");
  const [sort, setSort] = useState<Sort | null>(null);
  const activeFilter = columns.some(({ index }) => String(index) === filterColumn) ? filterColumn : "";
  const visibleRows = useMemo(() => {
    const query = foldText(search.trim());
    const searchIndexes = columns.filter(({ index }) => activeFilter === "" || String(index) === activeFilter)
      .map(({ index }) => index);
    const matches = rows.flatMap((cells, index) => {
      const row = index + 1;
      if (row <= headerRow || !cells.some((cell) => String(cell ?? "").trim())) return [];
      if (query && !searchIndexes.some((column) => foldText(workbookCellText(rows, row, column)).includes(query))) return [];
      return [row];
    });
    const sortedColumn = columns.find(({ index }) => index === sort?.index);
    if (!sort || !sortedColumn) return matches;
    const direction = sort.direction === "ascending" ? 1 : -1;
    return matches.map((row) => {
      const text = workbookCellText(rows, row, sort.index);
      const raw = rows[row - 1]?.[sort.index];
      const number = sortedColumn.field === "PR. FO"
        ? (typeof raw === "number" ? Math.round(raw * 100) : parseAmountCents(raw))
        : sortedColumn.field === "Fiabilité (/10)" ? parseQuantity(raw) : typeof raw === "number" ? raw : null;
      return { row, text, number };
    }).sort((a, b) => {
      if (!a.text || !b.text) return Number(!a.text) - Number(!b.text);
      if (a.number !== null && b.number !== null) return direction * (a.number - b.number);
      if (a.number !== b.number) return Number(a.number === null) - Number(b.number === null);
      return direction * collator.compare(a.text, b.text);
    }).map(({ row }) => row);
  }, [rows, headerRow, columns, activeFilter, search, sort]);

  const currentPage = boundedPage(page, visibleRows.length);
  const first = currentPage * DECISIONS_PER_PAGE;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-0 gap-1 text-xs font-medium">
          Rechercher dans
          <NativeSelect size="sm" value={activeFilter} onChange={(event) => {
            setFilterColumn(event.currentTarget.value);
            setPage(0);
          }}>
            <option value="">Toutes les colonnes</option>
            {columns.map(({ index, label }) => <option key={index} value={index}>{label}</option>)}
          </NativeSelect>
        </label>
        <label className="grid min-w-0 flex-1 gap-1 text-xs font-medium sm:max-w-72">
          Valeur à rechercher
          <Input size="sm" type="search" value={search} onChange={(event) => {
            setSearch(event.currentTarget.value);
            setPage(0);
          }} />
        </label>
        <p className="pb-1 text-xs text-muted-foreground" role="status">
          {formatCount(visibleRows.length)} {plural(visibleRows.length, "ligne affichée", "lignes affichées")}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Cliquez sur un en-tête pour trier. Faites défiler le tableau pour voir les autres colonnes.
      </p>
      <div role="region" aria-label="Défilement des valeurs du classeur" tabIndex={0}
        className="max-h-[min(50dvh,28rem)] overflow-auto rounded-md border border-border focus-visible:outline-2 focus-visible:outline-ring">
        <table aria-label="Valeurs du classeur" className="w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-20 bg-surface-subtle">
            <tr>
              <th scope="col" className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-border bg-surface-subtle px-3 py-2">
                Ligne Excel
              </th>
              {columns.map(({ header, index, label }) => {
                const order = sort?.index === index ? sort.direction : undefined;
                const SortIcon = order === "ascending" ? ArrowUp : order === "descending" ? ArrowDown : ArrowUpDown;
                const letter = workbookCellAddress(headerRow, index).replace(/\d+$/, "");
                return (
                  <th key={index} scope="col" aria-sort={order} className="min-w-36 border-b border-border align-top">
                    <Button variant="ghost" size="sm" aria-label={`Trier par ${label}`}
                      className="h-auto w-full justify-between gap-2 whitespace-normal px-3 py-2 text-left"
                      onClick={() => {
                        setSort(order === "descending" ? null : { index, direction: order === "ascending" ? "descending" : "ascending" });
                        setPage(0);
                      }}>
                      <span>
                        {label}
                        <span className="block font-mono text-xs font-normal text-muted-foreground">
                          {letter} · {header}
                        </span>
                      </span>
                      <SortIcon aria-hidden="true" />
                    </Button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visibleRows.slice(first, first + DECISIONS_PER_PAGE).map((row) => (
              <tr key={row}>
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-surface-subtle px-3 py-2 font-normal tabular-nums">
                  {row}
                </th>
                {columns.map(({ index }) => {
                  const text = workbookCellText(rows, row, index);
                  return (
                    <td key={index} className="max-w-60 border-b border-border px-3 py-2 align-top">
                      <span className="line-clamp-2 wrap-anywhere" title={text || undefined}>{text || "—"}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
            {visibleRows.length === 0 ? <tr><td colSpan={columns.length + 1} className="px-3 py-4 text-muted-foreground">Aucune ligne à afficher.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <ReviewPager page={currentPage} total={visibleRows.length} onSelect={setPage} />
    </div>
  );
}
