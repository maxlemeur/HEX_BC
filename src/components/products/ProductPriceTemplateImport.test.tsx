import { cleanup,render,screen,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const mocks = vi.hoisted(() => ({
  parseWorkbook: vi.fn(),
  onImported: vi.fn(),
}));

vi.mock("@/lib/catalogue/product-price-template", () => ({
  parseProductPriceTemplateWorkbook: mocks.parseWorkbook,
}));

import { ProductPriceTemplateImport } from "./ProductPriceTemplateImport";

type ParsedResult = {
  version: string | null;
  products: Array<{
    reference: string;
    designation: string;
    category: string | null;
    product_type: string | null;
    material: string | null;
    grade: string | null;
    dimensions: string | null;
    standard: string | null;
    unit: string;
    unit_price_cents: number;
    is_active: true;
  }>;
  prices: Array<{
    product_reference: string;
    supplier_name: string;
    supplier_sku: string | null;
    unit_price_cents: number;
    unit: string;
    currency: string;
    valid_from: string;
    min_quantity: number;
    source_url: string | null;
    comment: string | null;
  }>;
  issues: Array<{
    sheet: string;
    row: number;
    column: string | null;
    code: string;
    message: string;
    blocking: boolean;
  }>;
  hasBlockingIssues: boolean;
};

function buildResult(overrides: Partial<ParsedResult> = {}): ParsedResult {
  return {
    version: "1.0",
    products: [
      {
        reference: "TUBE-001",
        designation: "Tube inox 15 mm",
        category: "Tuyauterie",
        product_type: "Tube",
        material: "Inox",
        grade: "316L",
        dimensions: "15 mm",
        standard: "EN 10217",
        unit: "ml",
        unit_price_cents: 1250,
        is_active: true,
      },
    ],
    prices: [
      {
        product_reference: "TUBE-001",
        supplier_name: "CEDEO",
        supplier_sku: "CED-15",
        unit_price_cents: 1190,
        unit: "ml",
        currency: "EUR",
        valid_from: "2026-07-10",
        min_quantity: 1,
        source_url: "https://example.com/tube",
        comment: null,
      },
    ],
    issues: [],
    hasBlockingIssues: false,
    ...overrides,
  };
}

function xlsxFile(name = "catalogue.xlsx") {
  const file = new File(["workbook"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  });
  return file;
}

describe("ProductPriceTemplateImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseWorkbook.mockResolvedValue(buildResult());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: {
            created_products: 1,
            updated_products: 0,
            created_prices: 1,
            skipped_prices: 0,
          },
        }),
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("affiche la feuille, la ligne et le message puis bloque les erreurs bloquantes", async () => {
    const user = userEvent.setup();
    mocks.parseWorkbook.mockResolvedValue(
      buildResult({
        issues: [
          {
            sheet: "Produits",
            row: 4,
            column: "reference",
            code: "DUPLICATE_REFERENCE",
            message: "La référence TUBE-001 est présente deux fois.",
            blocking: true,
          },
        ],
        hasBlockingIssues: true,
      })
    );

    render(<ProductPriceTemplateImport open onClose={vi.fn()} onImported={mocks.onImported} />);
    await user.upload(screen.getByLabelText("2. Sélectionner le fichier XLSX"), xlsxFile());

    const issuesTable = await screen.findByRole("table", { name: "Anomalies détectées" });
    expect(within(issuesTable).getByText("Produits")).toBeInTheDocument();
    expect(within(issuesTable).getByText("4")).toBeInTheDocument();
    expect(within(issuesTable).getByText("La référence TUBE-001 est présente deux fois.")).toBeInTheDocument();
    expect(within(issuesTable).getByText("Bloquante")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer l'import" })).toBeDisabled();
  });
});
