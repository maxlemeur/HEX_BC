import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
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

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TEST_LOOKUPS = {
  suppliers: [{ id: "supplier-1", name: "CEDEO" }],
  products: [{ id: "product-1", reference: "TUBE-INOX-28", designation: "Tube inox 28" }],
};
const TEST_IMPORT_RESPONSE = {
  id: "import-1",
  filename: "mm.csv",
};

function extractText(node: ReactTestInstance | string): string {
  if (typeof node === "string") return node;
  if (!node.children) return "";
  return node.children.map((child) => extractText(child as ReactTestInstance | string)).join("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PriceBookCsvImport", () => {
  beforeEach(() => {
    parseFileMock.mockReset();
    fetchApiMock.mockReset();
  });

  it("renders the guided assistant steps", async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(PriceBookCsvImport, {
          onImported: vi.fn(),
          lookups: TEST_LOOKUPS,
        })
      );
    });

    const treeText = renderer!.root
      .findAll((node) => typeof node.type === "string")
      .map(extractText)
      .join(" ");

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

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(PriceBookCsvImport, {
          onImported: vi.fn(),
          lookups: TEST_LOOKUPS,
        })
      );
    });

    const templateButton = renderer!.root
      .findAllByType("button")
      .find((button) => extractText(button).includes("Télécharger un modèle CSV"));

    expect(templateButton).toBeDefined();

    await act(async () => {
      templateButton!.props.onClick();
    });

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

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(PriceBookCsvImport, {
          onImported: vi.fn(),
          lookups: TEST_LOOKUPS,
        })
      );
    });

    const fileInput = renderer!.root.findByProps({ id: "price-book-csv-input" });
    await act(async () => {
      fileInput.props.onChange({
        target: {
          files: [new File(["header"], "mm.csv", { type: "text/csv" })],
        },
      });
    });

    const analyzeButton = renderer!.root
      .findAllByType("button")
      .find((button) => extractText(button).includes("Analyser"));

    expect(analyzeButton).toBeDefined();

    await act(async () => {
      await analyzeButton!.props.onClick();
    });

    const treeText = renderer!.root.findAll((node) => typeof node.type === "string").map(extractText).join(" ");
    expect(treeText).toContain("Format BDC detecte");
    expect(treeText).toContain("Encodage: windows-1252");
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

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(PriceBookCsvImport, {
          onImported: vi.fn(),
          lookups: TEST_LOOKUPS,
        })
      );
    });

    const fileInput = renderer!.root.findByProps({ id: "price-book-csv-input" });
    await act(async () => {
      fileInput.props.onChange({
        target: {
          files: [new File(["header"], "unknown.csv", { type: "text/csv" })],
        },
      });
    });

    const analyzeButton = renderer!.root
      .findAllByType("button")
      .find((button) => extractText(button).includes("Analyser"));

    expect(analyzeButton).toBeDefined();

    await act(async () => {
      await analyzeButton!.props.onClick();
    });

    const treeText = renderer!.root
      .findAll((node) => typeof node.type === "string")
      .map(extractText)
      .join(" ");
    expect(treeText).toContain("Total detecte");
    expect(treeText).toContain("Importables");
    expect(treeText).toContain("Ignorees (hors perimetre)");
    expect(treeText).toContain("A corriger");

    const exportButton = renderer!.root
      .findAllByType("button")
      .find((button) => extractText(button).includes("Exporter les corrections CSV"));

    expect(exportButton).toBeDefined();

    await act(async () => {
      exportButton!.props.onClick();
    });

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

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(PriceBookCsvImport, {
          onImported: vi.fn(),
          lookups: TEST_LOOKUPS,
        })
      );
    });

    const fileInput = renderer!.root.findByProps({ id: "price-book-csv-input" });
    await act(async () => {
      fileInput.props.onChange({
        target: {
          files: [new File(["header"], "unknown-both.csv", { type: "text/csv" })],
        },
      });
    });

    const analyzeButton = renderer!.root
      .findAllByType("button")
      .find((button) => extractText(button).includes("Analyser"));

    expect(analyzeButton).toBeDefined();

    await act(async () => {
      await analyzeButton!.props.onClick();
    });

    const countsText = renderer!.root
      .findAll((node) => typeof node.type === "string")
      .map(extractText)
      .join(" ");
    expect(countsText).toContain("Fournisseurs inconnus: 1 | Produits inconnus: 1");

    const createMissingButton = renderer!.root
      .findAllByType("button")
      .find((button) => extractText(button).includes("Creer les inconnus"));

    expect(createMissingButton).toBeDefined();

    await act(async () => {
      await createMissingButton!.props.onClick();
    });

    expect(fetchApiMock).toHaveBeenCalledTimes(2);
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

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(PriceBookCsvImport, {
          onImported,
          lookups: TEST_LOOKUPS,
        })
      );
    });

    const fileInput = renderer!.root.findByProps({ id: "price-book-csv-input" });
    const file = new File(["header"], "mm.csv", { type: "text/csv" });

    await act(async () => {
      fileInput.props.onChange({
        target: {
          files: [file],
        },
      });
    });

    const analyzeButton = renderer!.root
      .findAllByType("button")
      .find((button) => extractText(button).includes("Analyser"));

    expect(analyzeButton).toBeDefined();

    await act(async () => {
      await analyzeButton!.props.onClick();
    });

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
