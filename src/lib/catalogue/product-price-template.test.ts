import { readFile } from "node:fs/promises";
import path from "node:path";

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  TEMPLATE_VERSION,
  parseProductPriceTemplateWorkbook,
} from "./product-price-template";

const PRODUCT_HEADERS = [
  "reference",
  "designation",
  "famille",
  "type",
  "matiere",
  "nuance",
  "dimensions",
  "norme",
  "unite",
  "prix_reference_ht",
];

/** Headers of the v2 workbook: the type column had another name, and « famille » was free text. */
const LEGACY_PRODUCT_HEADERS = PRODUCT_HEADERS.map((header) => (header === "type" ? "type_produit" : header));

const PRICE_HEADERS = [
  "reference_produit",
  "fournisseur",
  "reference_fournisseur",
  "prix_unitaire_ht",
  "unite",
  "devise",
  "date_prix",
  "quantite_minimale",
  "url_source",
  "commentaire",
];

type WorkbookOptions = {
  version?: string;
  productHeaders?: unknown[];
  productRows?: unknown[][];
  priceHeaders?: unknown[];
  priceRows?: unknown[][];
  includeInstructions?: boolean;
  includeProducts?: boolean;
  includePrices?: boolean;
};

function createWorkbook(options: WorkbookOptions = {}): ArrayBuffer {
  const workbook = XLSX.utils.book_new();

  if (options.includeInstructions !== false) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Template HEX BC"],
        ["Version", options.version ?? TEMPLATE_VERSION],
      ]),
      "Mode d'emploi"
    );
  }

  if (options.includeProducts !== false) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        options.productHeaders ?? PRODUCT_HEADERS,
        ...(options.productRows ?? []),
      ]),
      "Produits"
    );
  }

  if (options.includePrices !== false) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        options.priceHeaders ?? PRICE_HEADERS,
        ...(options.priceRows ?? []),
      ]),
      "Tarifs fournisseurs"
    );
  }

  return XLSX.write(workbook, { bookType: "xlsx", type: "array", cellDates: true });
}

describe("parseProductPriceTemplateWorkbook", () => {
  it("accepts the official workbook distributed by the application", async () => {
    const file = await readFile(
      path.join(process.cwd(), "public/templates/hex-bc-produits-tarifs-v3.xlsx")
    );
    const input = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength
    ) as ArrayBuffer;

    const result = await parseProductPriceTemplateWorkbook(input);

    // Its four example products and two example prices show how to fill it in, and are never imported.
    expect(result).toEqual({
      products: [],
      prices: [],
      issues: [],
      hasBlockingIssues: false,
      version: TEMPLATE_VERSION,
      ignoredExampleRows: 6,
    });
  });

  it("still accepts the v2 workbook", async () => {
    const file = await readFile(
      path.join(process.cwd(), "public/templates/hex-bc-produits-tarifs-v2.xlsx")
    );
    const input = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength
    ) as ArrayBuffer;

    const result = await parseProductPriceTemplateWorkbook(input);

    expect(result.version).toBe("2.0");
    expect(result.issues).toEqual([]);
    expect(result.hasBlockingIssues).toBe(false);
  });

  it("no longer reads the free-text family of a v2 workbook, and says so without blocking", async () => {
    const workbook = createWorkbook({
      version: "2.0",
      productHeaders: LEGACY_PRODUCT_HEADERS,
      productRows: [
        ["INOX-001", "Tube inox 304L", "Tuyauterie", "Tube", "Inox", "", "", "", "m", "10"],
        ["INOX-002", "Coude inox", "", "Coude", "Inox", "", "", "", "u", "4"],
      ],
    });

    const result = await parseProductPriceTemplateWorkbook(workbook);

    expect(result.hasBlockingIssues).toBe(false);
    expect(result.products.map((product) => [product.reference, product.family, product.product_type])).toEqual([
      ["INOX-001", null, "Tube"],
      ["INOX-002", null, "Coude"],
    ]);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: "LEGACY_FAMILY_IGNORED", column: "famille", blocking: false }),
    ]);
  });

  it("ignores the example rows left in a filled workbook, in both sheets", async () => {
    const workbook = createWorkbook({
      productRows: [
        ["EXEMPLE-TUB-I4L-015", "Tube inox 316L Ø15", "Tube", "Tube", "", "", "", "", "ml", "12,5"],
        ["INOX-001", "Tube inox 304L", "Tube", "Tube", "", "", "", "", "m", "10"],
      ],
      priceRows: [
        ["exemple-tub-i4l-015", "Fournisseur Démo", "", "10,8", "ml", "EUR", "2026-07-10", "1", "", ""],
        ["INOX-001", "Arcus", "", "9", "m", "EUR", "2026-07-10", "1", "", ""],
      ],
    });

    const result = await parseProductPriceTemplateWorkbook(workbook);

    expect(result.issues).toEqual([]);
    expect(result.ignoredExampleRows).toBe(2);
    expect(result.products.map((product) => product.reference)).toEqual(["INOX-001"]);
    expect(result.prices.map((price) => price.product_reference)).toEqual(["INOX-001"]);
  });

  it("still accepts the v1 workbook and ignores its trailing tva column", async () => {
    const file = await readFile(
      path.join(process.cwd(), "public/templates/hex-bc-produits-tarifs-v1.xlsx")
    );
    const input = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength
    ) as ArrayBuffer;

    const result = await parseProductPriceTemplateWorkbook(input);

    expect(result.version).toBe("1.0");
    expect(result.issues).toEqual([]);
    expect(result.hasBlockingIssues).toBe(false);
  });

  it("parses v1 product rows while dropping their tva column", async () => {
    const workbook = createWorkbook({
      version: "1.0",
      productHeaders: [...LEGACY_PRODUCT_HEADERS, "tva"],
      productRows: [
        ["INOX-003", "Te inox", "", "", "", "", "", "", "u", "10", "5,5"],
      ],
    });

    const result = await parseProductPriceTemplateWorkbook(workbook);

    expect(result.hasBlockingIssues).toBe(false);
    expect(result.products).toEqual([
      {
        reference: "INOX-003",
        designation: "Te inox",
        family: null,
        product_type: null,
        material: null,
        grade: null,
        dimensions: null,
        standard: null,
        unit: "u",
        unit_price_cents: 1000,
        is_active: true,
      },
    ]);
  });

  it("parses products and supplier prices into API-ready values", async () => {
    const workbook = createWorkbook({
      productRows: [
        [
          "INOX-001",
          "Tube inox 304L",
          "Tube",
          "Tube",
          "Inox",
          "304L",
          "DN 50",
          "EN 10217",
          "m",
          "1 234,56 €",
        ],
        [],
        ["INOX-002", "Coude inox"],
      ],
      priceRows: [
        [
          "INOX-001",
          "Sofinther",
          "SOF-99",
          "12,34",
          "m",
          "eur",
          "2026-06-30",
          "2,5",
          "https://example.test/tarif",
          "Prix negocie",
        ],
        [],
        [
          "INOX-002",
          "Arcus",
          "ARC-2",
          10.01,
          "",
          "",
          new Date(Date.UTC(2026, 6, 1)),
          "",
          "",
          "",
        ],
      ],
    });

    const result = await parseProductPriceTemplateWorkbook(workbook);

    expect(result.version).toBe(TEMPLATE_VERSION);
    expect(result.issues).toEqual([]);
    expect(result.hasBlockingIssues).toBe(false);
    expect(result.products).toEqual([
      {
        reference: "INOX-001",
        designation: "Tube inox 304L",
        family: "Tube",
        product_type: "Tube",
        material: "Inox",
        grade: "304L",
        dimensions: "DN 50",
        standard: "EN 10217",
        unit: "m",
        unit_price_cents: 123456,
        is_active: true,
      },
      {
        reference: "INOX-002",
        designation: "Coude inox",
        family: null,
        product_type: null,
        material: null,
        grade: null,
        dimensions: null,
        standard: null,
        unit: "u",
        unit_price_cents: 0,
        is_active: true,
      },
    ]);
    expect(result.prices).toEqual([
      {
        product_reference: "INOX-001",
        supplier_name: "Sofinther",
        supplier_sku: "SOF-99",
        unit_price_cents: 1234,
        unit: "m",
        currency: "EUR",
        valid_from: "2026-06-30",
        min_quantity: 2.5,
        source_url: "https://example.test/tarif",
        comment: "Prix negocie",
      },
      {
        product_reference: "INOX-002",
        supplier_name: "Arcus",
        supplier_sku: "ARC-2",
        unit_price_cents: 1001,
        unit: "u",
        currency: "EUR",
        valid_from: "2026-07-01",
        min_quantity: 1,
        source_url: null,
        comment: null,
      },
    ]);
  });

  it("reports required values, invalid numbers, dates and case-insensitive collisions", async () => {
    const workbook = createWorkbook({
      productRows: [
        ["Tube-A", "Tube A", "", "", "", "", "", "", "m", 10],
        ["tube-a", "Collision", "", "", "", "", "", "", "m", 11],
        ["", "", "", "", "", "", "", "", "m", -1],
      ],
      priceRows: [
        ["Tube-A", "Fournisseur A", "REF-1", 12, "m", "EUR", "2026-07-01", 1],
        ["tube-a", "fournisseur a", "REF-2", 15, "m", "eur", "2026-07-01", 1],
        ["", "", "", 0, "m", "EU", "2026-02-30", 0],
      ],
    });

    const result = await parseProductPriceTemplateWorkbook(workbook);
    const codes = result.issues.map((issue) => issue.code);

    expect(result.hasBlockingIssues).toBe(true);
    expect(codes).toEqual(
      expect.arrayContaining([
        "PRODUCT_REFERENCE_COLLISION",
        "PRODUCT_REFERENCE_REQUIRED",
        "PRODUCT_DESIGNATION_REQUIRED",
        "PRODUCT_PRICE_INVALID",
        "SUPPLIER_PRICE_DUPLICATE",
        "PRICE_PRODUCT_REFERENCE_REQUIRED",
        "PRICE_SUPPLIER_REQUIRED",
        "SUPPLIER_PRICE_INVALID",
        "PRICE_CURRENCY_INVALID",
        "PRICE_DATE_INVALID",
        "PRICE_MIN_QUANTITY_INVALID",
      ])
    );
    expect(result.issues.every((issue) => issue.blocking)).toBe(true);
    expect(result.products).toHaveLength(1);
    expect(result.prices).toHaveLength(1);
  });

  it("requires the exact sheets, version cell and ordered headers", async () => {
    const wrongHeaders = await parseProductPriceTemplateWorkbook(
      createWorkbook({
        version: "9.9",
        productHeaders: ["designation", "reference", ...PRODUCT_HEADERS.slice(2)],
        priceHeaders: [...PRICE_HEADERS, "colonne_en_trop"],
      })
    );

    expect(wrongHeaders.version).toBe("9.9");
    expect(wrongHeaders.products).toEqual([]);
    expect(wrongHeaders.prices).toEqual([]);
    expect(wrongHeaders.issues.map((issue) => issue.code)).toEqual([
      "TEMPLATE_VERSION_INVALID",
      "INVALID_HEADERS",
      "INVALID_HEADERS",
    ]);

    const missingSheets = await parseProductPriceTemplateWorkbook(
      createWorkbook({ includeInstructions: false, includePrices: false })
    );
    expect(missingSheets.version).toBeNull();
    expect(missingSheets.issues.map((issue) => [issue.sheet, issue.code])).toEqual([
      ["Mode d'emploi", "SHEET_MISSING"],
      ["Tarifs fournisseurs", "SHEET_MISSING"],
    ]);
  });
});
