import { createElement, useEffect } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

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
  supabaseRangeMock,
} = vi.hoisted(() => {
  const range = vi.fn().mockResolvedValue({ data: [], error: null });
  const order = vi.fn(() => ({ range }));
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));

  return {
    createSupabaseBrowserClientMock: vi.fn(() => ({ from })),
    supabaseFromMock: from,
    supabaseRangeMock: range,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

const swrMock = vi.hoisted(() => vi.fn());

vi.mock("swr", () => ({
  default: swrMock,
}));

vi.mock("@/components/TableFilterBar", () => ({
  TableFilterBar: (props: { data: unknown[]; onDataChange: (items: unknown[]) => void }) => {
    const { data, onDataChange } = props;
    useEffect(() => {
      onDataChange(data);
    }, [data, onDataChange]);
    return createElement("div", { "data-testid": "table-filter-bar" });
  },
}));

vi.mock("@/components/catalogue/PriceBookCsvImport", () => ({
  PriceBookCsvImport: () => createElement("div", { "data-testid": "csv-import" }),
}));

vi.mock("@/components/ui/SearchableSelect", () => ({
  SearchableSelect: (props: Record<string, unknown>) =>
    createElement("select", { id: props.id, value: props.value }),
}));

import { PricesManager } from "@/components/catalogue/PricesManager";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Recursively extract text from a ReactTestInstance
function extractText(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  if (!node.children) return "";
  return node.children.map((c) => extractText(c as ReactTestInstance | string)).join("");
}

// Find buttons matching a text needle
function findButtonsByText(root: ReactTestInstance, needle: string) {
  return root.findAllByType("button").filter((b) => extractText(b).includes(needle));
}

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

function setupSWR(items = MOCK_ITEMS) {
  swrMock.mockReturnValue({
    data: items,
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  });
}

function setupSWRLoading() {
  swrMock.mockReturnValue({
    data: [],
    error: undefined,
    isLoading: true,
    isValidating: true,
    mutate: vi.fn(),
  });
}

function setupSWRError() {
  swrMock.mockReturnValue({
    data: [],
    error: new Error("Network error"),
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  });
}

function setupSWREmpty() {
  swrMock.mockReturnValue({
    data: [],
    error: undefined,
    isLoading: false,
    isValidating: false,
    mutate: vi.fn(),
  });
}

async function renderManager(setup: () => void = () => setupSWR()) {
  setup();
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(PricesManager));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return renderer!;
}

function getTreeStr(renderer: ReactTestRenderer) {
  return JSON.stringify(renderer.toJSON());
}

describe("PricesManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchApiMock.mockResolvedValue({ items: [] });
  });

  it("renders page header with title and add button", async () => {
    const renderer = await renderManager();
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("Prix fournisseurs");
    expect(treeStr).toContain("page-description");
    expect(treeStr).toContain("Ajouter un prix");
  });

  it("renders CSV import section collapsed by default", async () => {
    const renderer = await renderManager();

    const csvImports = renderer.root.findAllByProps({ "data-testid": "csv-import" });
    expect(csvImports).toHaveLength(0);

    const treeStr = getTreeStr(renderer);
    expect(treeStr).toContain("Importer un fichier de prix");
  });

  it("expands CSV import section on toggle click", async () => {
    const renderer = await renderManager();

    const csvButtons = findButtonsByText(renderer.root, "Importer un fichier de prix");
    expect(csvButtons.length).toBeGreaterThan(0);

    await act(async () => {
      csvButtons[0].props.onClick();
    });

    const csvImports = renderer.root.findAllByProps({ "data-testid": "csv-import" });
    expect(csvImports).toHaveLength(1);
  });

  it("renders stats cards with correct labels", async () => {
    const renderer = await renderManager();
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("Total prix");
    expect(treeStr).toContain("À jour");
    expect(treeStr).toContain("Anciens");
    expect(treeStr).toContain("Fournisseurs couverts");
  });

  it("renders empty state when no data exists", async () => {
    const renderer = await renderManager(() => setupSWREmpty());
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("Aucun prix fournisseur");
    expect(treeStr).toContain("Ajoutez un prix manuellement");
  });

  it("renders loading state", async () => {
    const renderer = await renderManager(() => setupSWRLoading());
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("Chargement...");
  });

  it("renders error state", async () => {
    const renderer = await renderManager(() => setupSWRError());
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("Network error");
  });

  it("opens create modal when add button is clicked", async () => {
    const renderer = await renderManager();

    const addButtons = findButtonsByText(renderer.root, "Ajouter un prix");
    expect(addButtons.length).toBeGreaterThan(0);

    // Click the first "Ajouter un prix" button (header)
    await act(async () => {
      addButtons[0].props.onClick();
    });

    const treeStr = getTreeStr(renderer);
    expect(treeStr).toContain("Ajouter un prix fournisseur");
    expect(treeStr).toContain("Renseignez les informations du nouveau prix");
  });

  it("opens edit modal when Modifier button is clicked", async () => {
    const renderer = await renderManager();

    const editButtons = findButtonsByText(renderer.root, "Modifier");
    expect(editButtons.length).toBeGreaterThan(0);

    await act(async () => {
      editButtons[0].props.onClick();
    });

    const treeStr = getTreeStr(renderer);
    expect(treeStr).toContain("Modifier un prix fournisseur");
    expect(treeStr).toContain("Mettre à jour");
  });

  it("opens delete confirmation modal when Supprimer is clicked", async () => {
    const renderer = await renderManager();

    const deleteButtons = findButtonsByText(renderer.root, "Supprimer").filter(
      (b) => b.props.className?.includes("btn-danger")
    );
    expect(deleteButtons.length).toBeGreaterThan(0);

    await act(async () => {
      deleteButtons[0].props.onClick();
    });

    const treeStr = getTreeStr(renderer);
    expect(treeStr).toContain("Confirmer la suppression");
    expect(treeStr).toContain("irréversible");
    expect(treeStr).toContain("Voulez-vous supprimer");
  });

  it("renders TableFilterBar", async () => {
    const renderer = await renderManager();

    const filterBar = renderer.root.findAllByProps({ "data-testid": "table-filter-bar" });
    expect(filterBar).toHaveLength(1);
  });

  it("renders refresh button with Actualiser label", async () => {
    const renderer = await renderManager();
    const refreshButtons = findButtonsByText(renderer.root, "Actualiser");
    expect(refreshButtons.length).toBeGreaterThan(0);
  });

  it("shows limit warning when 400 results reached", async () => {
    const manyItems = Array.from({ length: 400 }, (_, i) => ({
      id: `price-${i}`,
      supplier_id: "supplier-1",
      product_id: `product-${i}`,
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

    const renderer = await renderManager(() => setupSWR(manyItems));
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("Limite de 400");
  });

  it("hides stats cards when loading", async () => {
    const renderer = await renderManager(() => setupSWRLoading());
    const treeStr = getTreeStr(renderer);

    expect(treeStr).not.toContain("Total prix");
  });

  it("configures SWR with refresh interval and revalidation", async () => {
    await renderManager();

    expect(swrMock).toHaveBeenCalledWith(
      "supplier-prices",
      expect.any(Function),
      expect.objectContaining({
        refreshInterval: 30000,
        revalidateOnFocus: true,
        revalidateOnReconnect: true,
      })
    );
  });

  it("fetches supplier and product lookups on mount", async () => {
    await renderManager();

    expect(supabaseFromMock).toHaveBeenCalledWith("suppliers");
    expect(supabaseFromMock).toHaveBeenCalledWith("products");
  });

  it("uses paginated ranges when fetching lookups", async () => {
    await renderManager();

    expect(supabaseRangeMock).toHaveBeenCalledWith(0, 999);
    expect(supabaseRangeMock).toHaveBeenCalledTimes(2);
  });

  it("requests lookup second pages when the first page reaches the API cap", async () => {
    const fullSupplierPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `supplier-${index}`,
      name: `Supplier ${index}`,
    }));
    const fullProductPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `product-${index}`,
      designation: `Product ${index}`,
      reference: `REF-${index}`,
    }));

    supabaseRangeMock
      .mockResolvedValueOnce({ data: fullSupplierPage, error: null })
      .mockResolvedValueOnce({ data: fullProductPage, error: null })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    await renderManager();

    const secondPageCalls = supabaseRangeMock.mock.calls.filter(
      ([from, to]) => from === 1000 && to === 1999
    );
    expect(secondPageCalls).toHaveLength(2);
  });

  it("renders correct French labels with accents", async () => {
    const renderer = await renderManager();
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("Gérez les tarifs");
    expect(treeStr).toContain("Mis à jour le");
    expect(treeStr).toContain("Fraîcheur");
    expect(treeStr).not.toContain("Fraicheur");
  });

  it("renders freshness badges for table rows", async () => {
    const renderer = await renderManager();
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("À jour");
    expect(treeStr).toContain("Ancien");
  });

  it("renders table headers correctly", async () => {
    const renderer = await renderManager();
    const treeStr = getTreeStr(renderer);

    expect(treeStr).toContain("Fournisseur");
    expect(treeStr).toContain("Produit");
    expect(treeStr).toContain("Prix HT");
  });
});
