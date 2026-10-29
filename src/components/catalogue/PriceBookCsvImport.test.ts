import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const parseFileMock = vi.hoisted(() => vi.fn());
const fetchApiMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useFileParser", () => ({
  useFileParser: () => ({
    parseFile: parseFileMock,
  }),
}));

vi.mock("@/components/catalogue/api", () => ({
  fetchApi: fetchApiMock,
}));

import { PriceBookCsvImport } from "@/components/catalogue/PriceBookCsvImport";

const TEST_LOOKUPS = {
  suppliers: [{ id: "supplier-1", name: "CEDEO" }],
  products: [{ id: "product-1", reference: "TUBE-INOX-28", designation: "Tube inox 28" }],
};
const TEST_IMPORT_RESPONSE = {
  id: "import-1",
  filename: "mm.csv",
};

function renderImporter(onImported = vi.fn()) {
  return render(
    createElement(PriceBookCsvImport, {
      onImported,
      lookups: TEST_LOOKUPS,
    })
  );
}

function selectCsvFile(file: File) {
  const fileInput = document.getElementById("price-book-csv-input");
  expect(fileInput).toBeInstanceOf(HTMLInputElement);
  fireEvent.change(fileInput!, { target: { files: [file] } });
}

function analyzeSelectedFile() {
  fireEvent.click(screen.getByRole("button", { name: /Analyser/i }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PriceBookCsvImport", () => {
  beforeEach(() => {
    parseFileMock.mockReset();
    fetchApiMock.mockReset();
  });

  it("exports correction CSV with expected columns for rows to fix", async () => {
    fetchApiMock.mockResolvedValueOnce(TEST_IMPORT_RESPONSE);
    parseFileMock.mockResolvedValue({
      mode: "worker",
      parser: "csv",
      detectedEncoding: "utf-8",
      rows: [
        {
          fournisseur: "INCONNU",
          reference_produit: "TUBE-INOX-28",
          prix_unitaire: "10,00",
          devise: "EUR",
        },
      ],
      rowLineNumbers: [2],
    });

    const createObjectURLMock = vi.fn<(object: Blob | MediaSource) => string>(
      () => "blob:price-book-corrections"
    );
    const revokeObjectURLMock = vi.fn<(url: string) => void>();
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = revokeObjectURLMock;

    const nativeCreateElement = document.createElement.bind(document);
    const anchorClickMock = vi.fn();
    const createdAnchors: HTMLAnchorElement[] = [];

    vi.spyOn(document, "createElement").mockImplementation(
      ((tagName: string) => {
        const element = nativeCreateElement(tagName as keyof HTMLElementTagNameMap);
        if (tagName.toLowerCase() === "a") {
          const anchor = element as HTMLAnchorElement;
          createdAnchors.push(anchor);
          vi.spyOn(anchor, "click").mockImplementation(anchorClickMock);
        }
        return element;
      }) as unknown as typeof document.createElement
    );

    const { container } = renderImporter();
    selectCsvFile(new File(["header"], "unknown.csv", { type: "text/csv" }));
    analyzeSelectedFile();

    await waitFor(() => {
      expect(container.textContent).toContain("Total détecté");
      expect(container.textContent).toContain("Importables");
      expect(container.textContent).toContain("Ignorées (hors périmètre)");
      expect(container.textContent).toContain("À corriger");
    });

    fireEvent.click(
      screen.getByRole("button", { name: /Exporter les corrections CSV/i })
    );

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    const csvBlob = createObjectURLMock.mock.calls[0][0];
    expect(csvBlob).toBeInstanceOf(Blob);
    const csvContent = await (csvBlob as Blob).text();

    expect(csvContent).toContain(
      "line_number;error_code;error_message;raw_supplier;raw_product;raw_price;suggested_fix"
    );
    expect(csvContent).toContain("SUPPLIER_UNKNOWN");
    expect(csvContent).toContain("INCONNU");

    expect(createdAnchors).toHaveLength(1);
    expect(createdAnchors[0].download).toBe("prix_import_corrections.csv");
    expect(createdAnchors[0].href).toBe("blob:price-book-corrections");
    expect(anchorClickMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:price-book-corrections");
  });
});
