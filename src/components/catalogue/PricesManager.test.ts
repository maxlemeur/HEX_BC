import { createElement, useEffect } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: toastErrorMock,
  }),
}));

const fetchApiMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/catalogue/api", () => ({
  fetchApi: fetchApiMock,
}));

const {
  createSupabaseBrowserClientMock,
  supabaseFromMock,
  supplierRangeMock,
  productRangeMock,
} = vi.hoisted(() => {
  const supplierRange = vi.fn().mockResolvedValue({ data: [], error: null });
  const productRange = vi.fn().mockResolvedValue({ data: [], error: null });
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      order: vi.fn(() => ({
        range: table === "suppliers" ? supplierRange : productRange,
      })),
    })),
  }));

  return {
    createSupabaseBrowserClientMock: vi.fn(() => ({ from })),
    supabaseFromMock: from,
    supplierRangeMock: supplierRange,
    productRangeMock: productRange,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

const swrMock = vi.hoisted(() => vi.fn());

vi.mock("swr", () => ({
  default: swrMock,
}));

const tableFilterBarTransformMock = vi.hoisted(() => vi.fn((data: unknown[]) => data));

vi.mock("@/components/TableFilterBar", () => ({
  TableFilterBar: (props: { data: unknown[]; onDataChange: (items: unknown[]) => void }) => {
    const { data, onDataChange } = props;

    useEffect(() => {
      onDataChange(tableFilterBarTransformMock(data));
    }, [data, onDataChange]);

    return createElement("div", { "data-testid": "table-filter-bar" });
  },
}));

vi.mock("@/components/catalogue/PriceBookCsvImport", () => ({
  PriceBookCsvImport: () => createElement("div", { "data-testid": "csv-import" }),
}));

vi.mock("@/components/ui/SearchableSelect", () => ({
  SearchableSelect: (props: Record<string, unknown>) =>
    createElement("input", {
      id: props.id,
      value: props.value,
      readOnly: true,
      "data-testid": props.id,
    }),
}));

import { PricesManager } from "@/components/catalogue/PricesManager";

const MOCK_ITEMS = [
  {
    id: "price-1",
    supplier_id: "supplier-1",
    product_id: "product-1",
    catalogue_item_id: null,
    unit_price_cents: 1250,
    currency: "EUR",
    valid_from: "2025-10-01",
    valid_to: null,
    source: "Devis",
    notes: null,
    created_at: "2025-10-01T10:00:00.000Z",
    updated_at: "2026-02-20T10:00:00.000Z",
  },
  {
    id: "price-2",
    supplier_id: "supplier-2",
    product_id: "product-2",
    catalogue_item_id: null,
    unit_price_cents: 7500,
    currency: "EUR",
    valid_from: null,
    valid_to: null,
    source: null,
    notes: null,
    created_at: "2025-12-01T10:00:00.000Z",
    updated_at: "2025-12-20T10:00:00.000Z",
  },
  {
    id: "price-3",
    supplier_id: "supplier-1",
    product_id: "product-3",
    catalogue_item_id: null,
    unit_price_cents: 300,
    currency: "USD",
    valid_from: null,
    valid_to: null,
    source: null,
    notes: null,
    created_at: "2025-06-01T10:00:00.000Z",
    updated_at: "2025-06-01T10:00:00.000Z",
  },
];

function setupSWR(items = MOCK_ITEMS, overrides: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  swrMock.mockReturnValue({
    data: items,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate,
    ...overrides,
  });
  return mutate;
}

function renderManager(props?: { embedded?: boolean }) {
  return render(createElement(PricesManager, props));
}

describe("PricesManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSWR();
    fetchApiMock.mockResolvedValue({ items: [] });
    tableFilterBarTransformMock.mockImplementation((data: unknown[]) => data);
    supplierRangeMock.mockResolvedValue({ data: [], error: null });
    productRangeMock.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the default page chrome and filter bar", async () => {
    renderManager();

    expect(screen.getByRole("heading", { name: "Prix fournisseurs" })).toBeInTheDocument();
    expect(screen.getByText(/Gérez les tarifs de vos fournisseurs/i)).toBeInTheDocument();
    expect(screen.getByTestId("table-filter-bar")).toBeInTheDocument();

    await waitFor(() => {
      expect(supabaseFromMock).toHaveBeenCalledWith("suppliers");
      expect(supabaseFromMock).toHaveBeenCalledWith("products");
    });
  });

  it("starts with CSV import open in embedded mode and hides the standalone header", () => {
    renderManager({ embedded: true });

    expect(screen.getByTestId("csv-import")).toBeInTheDocument();
    expect(screen.queryByText(/Gérez les tarifs de vos fournisseurs/i)).not.toBeInTheDocument();
  });

  it("toggles the CSV import section", async () => {
    const user = userEvent.setup();
    renderManager();

    expect(screen.queryByTestId("csv-import")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Importer un fichier de prix/i }));

    expect(screen.getByTestId("csv-import")).toBeInTheDocument();
  });

  it("renders stats cards when supplier prices exist", () => {
    renderManager();

    expect(screen.getByText("Total prix")).toBeInTheDocument();
    expect(screen.getAllByText("À jour").length).toBeGreaterThan(0);
    expect(screen.getByText(/Anciens/)).toBeInTheDocument();
    expect(screen.getByText("Fournisseurs couverts")).toBeInTheDocument();
  });

  it("renders the empty state when there are no prices", () => {
    setupSWR([]);
    renderManager();

    expect(screen.getByText("Aucun prix fournisseur")).toBeInTheDocument();
    expect(screen.getByText(/Ajoutez un prix manuellement/i)).toBeInTheDocument();
  });

  it("renders the no-results state when filters hide all rows", async () => {
    tableFilterBarTransformMock.mockImplementation(() => []);
    renderManager();

    expect(await screen.findByText("Aucun résultat")).toBeInTheDocument();
    expect(screen.getByText(/Modifiez vos filtres/i)).toBeInTheDocument();
  });

  it("renders loading and error states", () => {
    setupSWR([], { isLoading: true, isValidating: true });
    const { rerender } = renderManager();

    expect(screen.getAllByText("Chargement...").length).toBeGreaterThan(0);

    setupSWR([], { error: new Error("Network error") });
    rerender(createElement(PricesManager));

    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("opens the create modal from the add button", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getAllByRole("button", { name: /Ajouter un prix/i })[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Ajouter un prix fournisseur")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
  });

  it("opens the edit modal from a table row", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Modifier un prix fournisseur")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("12,50")).toBeInTheDocument();
  });

  it("opens the delete confirmation modal from a table row", async () => {
    const user = userEvent.setup();
    renderManager();

    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Confirmer la suppression")).toBeInTheDocument();
    expect(within(dialog).getByText(/Cette action est irréversible/i)).toBeInTheDocument();
  });

  it("refreshes the SWR list when Actualiser is clicked", async () => {
    const user = userEvent.setup();
    const mutate = setupSWR();
    renderManager();

    await user.click(screen.getByRole("button", { name: "Actualiser" }));

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows the 400 items warning when the API limit is reached", () => {
    const manyItems = Array.from({ length: 400 }, (_, index) => ({
      id: `price-${index}`,
      supplier_id: "supplier-1",
      product_id: `product-${index}`,
      catalogue_item_id: null,
      unit_price_cents: 100,
      currency: "EUR",
      valid_from: null,
      valid_to: null,
      source: null,
      notes: null,
      created_at: "2026-02-20T10:00:00.000Z",
      updated_at: "2026-02-20T10:00:00.000Z",
    }));

    setupSWR(manyItems);
    renderManager();

    expect(screen.getByText(/Limite de 400 résultats atteinte/i)).toBeInTheDocument();
  });
});
