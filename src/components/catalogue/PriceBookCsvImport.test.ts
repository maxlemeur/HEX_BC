import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("renders the guided assistant steps", async () => {
    const { container } = renderImporter();
    const treeText = container.textContent ?? "";

    expect(treeText).toContain("Charger");
    expect(treeText).toContain("Detection");
    expect(treeText).toContain("Associer");
    expect(treeText).toContain("Resoudre");
    expect(treeText).toContain("Importer");
  });

  it("generates a semicolon CSV template compatible with the importer", async () => {
    const createObjectURLMock = vi.fn<(object: Blob | MediaSource) => string>(
      () => "blob:price-book-template"
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

    renderImporter();
    fireEvent.click(
      screen.getByRole("button", { name: /Télécharger un modèle CSV/i })
    );

    expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    const csvBlob = createObjectURLMock.mock.calls[0][0];
    expect(csvBlob).toBeInstanceOf(Blob);
    const csvContent = await (csvBlob as Blob).text();

    expect(csvContent).toBe(
      [
        "fournisseur;reference_produit;prix_unitaire;devise",
        "CEDEO;TUBE-INOX-28;12.50;EUR",
        "ARCUS;CABLE-3G1.5;8.00;EUR",
        "",
      ].join("\n")
    );
    expect(csvContent).not.toContain("#");
    expect(csvContent.split("\n")[0]).toBe("fournisseur;reference_produit;prix_unitaire;devise");

    expect(createdAnchors).toHaveLength(1);
    expect(createdAnchors[0].download).toBe("modèle_prix_fournisseurs.csv");
    expect(createdAnchors[0].href).toBe("blob:price-book-template");
    expect(anchorClickMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:price-book-template");
  });

  it("displays detected profile and encoding after CSV analysis", async () => {
    fetchApiMock.mockResolvedValueOnce(TEST_IMPORT_RESPONSE);
    parseFileMock.mockResolvedValue({
      mode: "worker",
      parser: "csv",
      detectedEncoding: "windows-1252",
      rows: [
        {
          ID: "TUBE-INOX-28",
          F1_nom: "CEDEO",
          F1_prix: "10,00",
        },
      ],
      rowLineNumbers: [2],
    });

    const { container } = renderImporter();
    selectCsvFile(new File(["header"], "mm.csv", { type: "text/csv" }));
    analyzeSelectedFile();

    await waitFor(() => {
      expect(container.textContent).toContain("Format BDC detecte");
      expect(container.textContent).toContain("Encodage: windows-1252");
    });
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
      expect(container.textContent).toContain("Total detecte");
      expect(container.textContent).toContain("Importables");
      expect(container.textContent).toContain("Ignorees (hors perimetre)");
      expect(container.textContent).toContain("A corriger");
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

  it("sends unknown products even when supplier issue appears first", async () => {
    fetchApiMock
      .mockResolvedValueOnce(TEST_IMPORT_RESPONSE)
      .mockResolvedValueOnce({
        createdSuppliers: [],
        createdProducts: [],
      });

    parseFileMock.mockResolvedValue({
      mode: "worker",
      parser: "csv",
      detectedEncoding: "utf-8",
      rows: [
        {
          fournisseur: "SUPPLIER-NEW",
          reference_produit: "PRODUCT-NEW",
          prix_unitaire: "10,00",
          devise: "EUR",
        },
      ],
      rowLineNumbers: [2],
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { container } = renderImporter();
    selectCsvFile(
      new File(["header"], "unknown-both.csv", { type: "text/csv" })
    );
    analyzeSelectedFile();

    await waitFor(() =>
      expect(container.textContent).toContain(
        "Fournisseurs inconnus: 1 | Produits inconnus: 1"
      )
    );

    fireEvent.click(screen.getByRole("button", { name: /Creer les inconnus/i }));

    await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(2));
    expect(fetchApiMock).toHaveBeenNthCalledWith(
      2,
      "/api/prices/import/create-missing",
      expect.objectContaining({
        method: "POST",
      })
    );

    const body = JSON.parse(
      String((fetchApiMock.mock.calls[1]?.[1] as { body?: string } | undefined)?.body ?? "{}")
    );

    expect(body).toEqual({
      suppliersToCreate: ["SUPPLIER-NEW"],
      productsToCreate: ["PRODUCT-NEW"],
    });
  });

  it("creates a canonical import for the selected file without linking it to the affaire project", async () => {
    fetchApiMock.mockResolvedValueOnce(TEST_IMPORT_RESPONSE);

    parseFileMock.mockResolvedValue({
      mode: "worker",
      parser: "csv",
      detectedEncoding: "utf-8",
      rows: [
        {
          fournisseur: "CEDEO",
          reference_produit: "TUBE-INOX-28",
          prix_unitaire: "10,00",
          devise: "EUR",
        },
      ],
      rowLineNumbers: [2],
    });

    const onImported = vi.fn();

    renderImporter(onImported);
    const file = new File(["header"], "mm.csv", { type: "text/csv" });
    selectCsvFile(file);
    analyzeSelectedFile();

    await waitFor(() => expect(fetchApiMock).toHaveBeenCalledTimes(1));

    const importCall = fetchApiMock.mock.calls[0];
    expect(importCall?.[0]).toBe("/api/imports");
    const importRequest = importCall?.[1] as { body?: FormData; method?: string } | undefined;
    expect(importRequest?.method).toBe("POST");
    expect(importRequest?.body).toBeInstanceOf(FormData);
    expect(importRequest?.body?.get("projectId")).toBeNull();
    expect(importRequest?.body?.get("file")).toBe(file);

    expect(fetchApiMock).toHaveBeenCalledTimes(1);
    expect(onImported).not.toHaveBeenCalled();
  });
});
