import { describe, expect, it } from "vitest";

import {
  extractPriceBookSourceColumns,
  hasMinimumPriceBookMapping,
  suggestPriceBookColumnMapping,
  validatePriceBookRows,
  type CsvImportRow,
  type PriceBookColumnMapping,
} from "@/lib/catalogue/csv-import";

const SUPPLIER_ID_1 = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID_2 = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID_1 = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID_2 = "44444444-4444-4444-8444-444444444444";
const CATALOGUE_ITEM_ID_1 = "55555555-5555-4555-8555-555555555555";

describe("price book csv import mapping suggestions", () => {
  it("suggests columns for common french and english headers", () => {
    const sourceColumns = [
      "ID Fournisseur",
      "Product ID",
      "Prix unitaire HT",
      "Devise",
    ];

    const mapping = suggestPriceBookColumnMapping(sourceColumns);

    expect(mapping).toEqual({
      "ID Fournisseur": "supplier_id",
      "Product ID": "product_id",
      "Prix unitaire HT": "unit_price",
      Devise: "currency",
    });
  });

  it("extracts source columns in first-seen order", () => {
    const rows: CsvImportRow[] = [
      { supplier: "s1", price: "10,00" },
      { supplier: "s2", product: "p2", currency: "EUR" },
      { product: "p3", supplier: "s3" },
    ];

    expect(extractPriceBookSourceColumns(rows)).toEqual([
      "supplier",
      "price",
      "product",
      "currency",
    ]);
  });

  it("checks minimum mapping requirements", () => {
    const complete: PriceBookColumnMapping = {
      supplier: "supplier_id",
      product: "product_id",
      prix: "unit_price",
    };
    const incomplete: PriceBookColumnMapping = {
      supplier: "supplier_id",
      devise: "currency",
    };

    expect(hasMinimumPriceBookMapping(complete)).toBe(true);
    expect(hasMinimumPriceBookMapping(incomplete)).toBe(false);
  });
});

describe("price book csv import validation", () => {
  it("validates rows, defaults currency to EUR and converts prices to cents", async () => {
    const rows: CsvImportRow[] = [
      { supplier: SUPPLIER_ID_1, product: PRODUCT_ID_1, prix: "12,50", devise: "" },
      {
        supplier: SUPPLIER_ID_2,
        catalogue: CATALOGUE_ITEM_ID_1,
        prix: "7.2",
        devise: "usd",
      },
    ];

    const mapping: PriceBookColumnMapping = {
      supplier: "supplier_id",
      product: "product_id",
      catalogue: "catalogue_item_id",
      prix: "unit_price",
      devise: "currency",
    };

    const result = await validatePriceBookRows(rows, mapping);

    expect(result.totalRows).toBe(2);
    expect(result.acceptedRows).toBe(2);
    expect(result.rejectedRowsCount).toBe(0);
    expect(result.acceptedItems[0]).toMatchObject({
      supplier_id: SUPPLIER_ID_1,
      product_id: PRODUCT_ID_1,
      unit_price_cents: 1250,
      currency: "EUR",
    });
    expect(result.acceptedItems[1]).toMatchObject({
      supplier_id: SUPPLIER_ID_2,
      catalogue_item_id: CATALOGUE_ITEM_ID_1,
      unit_price_cents: 720,
      currency: "USD",
    });
    expect(result.previewRows[0]?.status).toBe("valid");
    expect(result.previewRows[1]?.status).toBe("valid");
  });

  it("rejects invalid rows with csv line numbers and explicit reasons", async () => {
    const rows: CsvImportRow[] = [
      { supplier: "", product: PRODUCT_ID_1, prix: "10,00" },
      { supplier: SUPPLIER_ID_2, product: "", prix: "11,00" },
      { supplier: SUPPLIER_ID_1, product: PRODUCT_ID_1, prix: "-1,20" },
      { supplier: SUPPLIER_ID_2, product: PRODUCT_ID_2, prix: "abc" },
    ];

    const mapping: PriceBookColumnMapping = {
      supplier: "supplier_id",
      product: "product_id",
      prix: "unit_price",
    };

    const result = await validatePriceBookRows(rows, mapping);

    expect(result.acceptedRows).toBe(0);
    expect(result.rejectedRowsCount).toBe(4);
    expect(result.rejectedRows[0]?.lineNumber).toBe(2);
    expect(result.rejectedRows[0]?.reason).toContain("supplier_id");
    expect(result.rejectedRows[1]?.lineNumber).toBe(3);
    expect(result.rejectedRows[1]?.reason).toContain("product_id ou catalogue_item_id");
    expect(result.rejectedRows[2]?.lineNumber).toBe(4);
    expect(result.rejectedRows[2]?.reason).toContain("Prix doit etre strictement positif.");
    expect(result.rejectedRows[3]?.lineNumber).toBe(5);
    expect(result.rejectedRows[3]?.reason).toContain("Prix non numerique.");
  });

  it("limits preview to 10 rows and emits chunked progress", async () => {
    const rows: CsvImportRow[] = Array.from({ length: 501 }, () => ({
      supplier: SUPPLIER_ID_1,
      product: PRODUCT_ID_1,
      prix: "1,00",
    }));

    const mapping: PriceBookColumnMapping = {
      supplier: "supplier_id",
      product: "product_id",
      prix: "unit_price",
    };

    const progressEvents: number[] = [];

    const result = await validatePriceBookRows(rows, mapping, {
      chunkSize: 120,
      onProgress: (progress) => {
        progressEvents.push(progress.percentage);
      },
    });

    expect(result.acceptedRows).toBe(501);
    expect(result.rejectedRowsCount).toBe(0);
    expect(result.previewRows).toHaveLength(10);
    expect(progressEvents[0]).toBe(0);
    expect(progressEvents[progressEvents.length - 1]).toBe(100);
    expect(progressEvents.length).toBeGreaterThan(2);
  });
});
