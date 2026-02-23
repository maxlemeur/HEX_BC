import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PriceBookCsvImport } from "@/components/catalogue/PriceBookCsvImport";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TEST_LOOKUPS = {
  suppliers: [{ id: "supplier-1", name: "CEDEO" }],
  products: [{ id: "product-1", reference: "TUBE-INOX-28", designation: "Tube inox 28" }],
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
});
