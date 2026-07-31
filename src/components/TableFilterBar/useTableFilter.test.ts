import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useTableFilter } from "./useTableFilter";
import type { FilterConfig, SortOption } from "./types";

type Row = {
  id: string;
  name: string;
  supplier: Array<{ name: string }> | null;
  status: "active" | "archived";
  kind: "material" | "labor";
  createdAt: string;
  amount: number | null;
  code: string;
};

const ROWS: Row[] = [
  {
    id: "row-1",
    name: "Électricité générale",
    supplier: [{ name: "Société Lumière" }],
    status: "active",
    kind: "material",
    createdAt: "2026-07-15T10:00:00.000Z",
    amount: 20,
    code: "B",
  },
  {
    id: "row-2",
    name: "Plomberie",
    supplier: [{ name: "Acme" }],
    status: "active",
    kind: "labor",
    createdAt: "2026-07-20T10:00:00.000Z",
    amount: null,
    code: "A",
  },
  {
    id: "row-3",
    name: "Ventilation",
    supplier: null,
    status: "archived",
    kind: "material",
    createdAt: "2026-06-30T10:00:00.000Z",
    amount: 10,
    code: "D",
  },
  {
    id: "row-4",
    name: "Chauffage",
    supplier: [{ name: "Thermique France" }],
    status: "active",
    kind: "material",
    createdAt: "2026-08-01T10:00:00.000Z",
    amount: 30,
    code: "C",
  },
];

const FILTERS: FilterConfig[] = [
  {
    type: "select",
    key: "status",
    label: "Statut",
    placeholder: "Tous",
    options: [
      { value: "active", label: "Actif" },
      { value: "archived", label: "Archivé" },
    ],
  },
  {
    type: "multi-select",
    key: "kind",
    label: "Type",
    placeholder: "Tous",
    options: [
      { value: "material", label: "Matériau" },
      { value: "labor", label: "Main-d'œuvre" },
    ],
  },
  {
    type: "date-range",
    key: "createdAt",
    label: "Création",
  },
];

const SORT_OPTIONS: SortOption[] = [
  { key: "amount", label: "Montant", defaultDirection: "asc" },
  { key: "code", label: "Code", defaultDirection: "asc" },
];


describe("useTableFilter", () => {
  it("combines accent-insensitive nested search with filters and resets them by type", async () => {
    const { result } = renderHook(() =>
      useTableFilter({
        data: ROWS,
        searchConfig: {
          placeholder: "Rechercher",
          fields: ["name", "supplier.name"],
        },
        filters: FILTERS,
      })
    );

    act(() => {
      result.current.setSearchValue("societe lumiere");
      result.current.setFilter("status", "active");
      result.current.setFilter("kind", ["material"]);
      result.current.setFilter("createdAt", {
        from: "2026-07-01",
        to: "2026-07-31",
      });
    });

    await waitFor(() => {
      expect(result.current.filteredData.map((row) => row.id)).toEqual([
        "row-1",
      ]);
    });
    expect(result.current.activeFilterCount).toBe(3);

    act(() => {
      result.current.clearFilter("kind");
    });
    expect(result.current.filterState.kind).toEqual([]);
    expect(result.current.activeFilterCount).toBe(2);

    act(() => {
      result.current.clearAllFilters();
    });

    await waitFor(() => {
      expect(result.current.filteredCount).toBe(ROWS.length);
    });
    expect(result.current.searchValue).toBe("");
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.filterState).toEqual({
      status: "",
      kind: [],
      createdAt: { from: "", to: "" },
    });
  });

  it("sorts numbers, nulls, and strings in both directions", () => {
    const { result } = renderHook(() =>
      useTableFilter({
        data: ROWS,
        sortOptions: SORT_OPTIONS,
      })
    );

    expect(result.current.filteredData.map((row) => row.id)).toEqual([
      "row-3",
      "row-1",
      "row-4",
      "row-2",
    ]);

    act(() => {
      result.current.setSort("amount", "desc");
    });
    expect(result.current.filteredData.map((row) => row.id)).toEqual([
      "row-2",
      "row-4",
      "row-1",
      "row-3",
    ]);

    act(() => {
      result.current.setSort("code", "asc");
    });
    expect(result.current.filteredData.map((row) => row.id)).toEqual([
      "row-2",
      "row-1",
      "row-4",
      "row-3",
    ]);

    act(() => {
      result.current.toggleSortDirection();
    });
    expect(result.current.filteredData.map((row) => row.id)).toEqual([
      "row-3",
      "row-4",
      "row-1",
      "row-2",
    ]);
  });

  it("does not notify onDataChange again for a new array with identical rows", async () => {
    const onDataChange = vi.fn();
    const { rerender } = renderHook(
      ({ data }: { data: Row[] }) =>
        useTableFilter({
          data,
          onDataChange,
        }),
      {
        initialProps: { data: ROWS },
      }
    );

    await waitFor(() => {
      expect(onDataChange).toHaveBeenCalledTimes(1);
    });
    expect(onDataChange).toHaveBeenLastCalledWith(ROWS);

    rerender({ data: ROWS.slice() });

    await waitFor(() => {
      expect(onDataChange).toHaveBeenCalledTimes(1);
    });
  });
});
