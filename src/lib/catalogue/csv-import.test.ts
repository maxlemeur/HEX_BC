import { describe, expect, it } from "vitest";

import {
  suggestPriceBookColumnMapping,
  validatePriceBookRows,
  type CsvImportRow,
  type PriceBookColumnMapping,
  type PriceBookLookups,
} from "@/lib/catalogue/csv-import";

const SUPPLIER_ID_1 = "11111111-1111-4111-8111-111111111111";
const SUPPLIER_ID_2 = "22222222-2222-4222-8222-222222222222";
const PRODUCT_ID_1 = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID_2 = "44444444-4444-4444-8444-444444444444";

const TEST_LOOKUPS: PriceBookLookups = {
  suppliers: [
    { id: SUPPLIER_ID_1, name: "CEDEO" },
    { id: SUPPLIER_ID_2, name: "ARCUS" },
  ],
  products: [
    { id: PRODUCT_ID_1, reference: "TUBE-INOX-28", designation: "Tube inox 28mm" },
    { id: PRODUCT_ID_2, reference: "CABLE-3G1.5", designation: "Cable 3G 1.5mm" },
  ],
};

describe("price book csv import mapping suggestions", () => {
  it("maps legacy supplier_id/product_id headers to new target fields", () => {
    const sourceColumns = ["supplier_id", "product_id", "unit_price"];
    const mapping = suggestPriceBookColumnMapping(sourceColumns);

    expect(mapping).toEqual({
      supplier_id: "supplier_name",
      product_id: "product_reference",
      unit_price: "unit_price",
    });
  });
});

describe("price book csv import validation with lookups", () => {
  it("resolves supplier names and product references to UUIDs", async () => {
    const rows: CsvImportRow[] = [
      { fournisseur: "CEDEO", ref: "TUBE-INOX-28", prix: "12,50", devise: "" },
      { fournisseur: "ARCUS", ref: "CABLE-3G1.5", prix: "7.2", devise: "usd" },
    ];

    const mapping: PriceBookColumnMapping = {
      fournisseur: "supplier_name",
      ref: "product_reference",
      prix: "unit_price",
      devise: "currency",
    };

    const result = await validatePriceBookRows(rows, mapping, {
      lookups: TEST_LOOKUPS,
    });

    expect(result.totalRows).toBe(2);
    expect(result.acceptedRows).toBe(2);
    expect(result.rejectedRowsCount).toBe(0);
    expect(result.ignoredRowsCount).toBe(0);
    expect(result.acceptedItems[0]).toMatchObject({
      supplier_id: SUPPLIER_ID_1,
      product_id: PRODUCT_ID_1,
      unit_price_cents: 1250,
      currency: "EUR",
    });
    expect(result.acceptedItems[1]).toMatchObject({
      supplier_id: SUPPLIER_ID_2,
      product_id: PRODUCT_ID_2,
      unit_price_cents: 720,
      currency: "USD",
    });
    expect(result.previewRows[0]?.status).toBe("valid");
    expect(result.previewRows[1]?.status).toBe("valid");
  });

  it("resolves products by designation when no reference mapped", async () => {
    const rows: CsvImportRow[] = [
      { fournisseur: "CEDEO", produit: "Tube inox 28mm", prix: "10,00" },
    ];

    const mapping: PriceBookColumnMapping = {
      fournisseur: "supplier_name",
      produit: "product_designation",
      prix: "unit_price",
    };

    const result = await validatePriceBookRows(rows, mapping, {
      lookups: TEST_LOOKUPS,
    });

    expect(result.acceptedRows).toBe(1);
    expect(result.acceptedItems[0]).toMatchObject({
      supplier_id: SUPPLIER_ID_1,
      product_id: PRODUCT_ID_1,
    });
  });

  it("resolves case-insensitively with trim", async () => {
    const rows: CsvImportRow[] = [
      { fournisseur: "  cedeo  ", ref: " tube-inox-28 ", prix: "10,00" },
    ];

    const mapping: PriceBookColumnMapping = {
      fournisseur: "supplier_name",
      ref: "product_reference",
      prix: "unit_price",
    };

    const result = await validatePriceBookRows(rows, mapping, {
      lookups: TEST_LOOKUPS,
    });

    expect(result.acceptedRows).toBe(1);
    expect(result.acceptedItems[0]?.supplier_id).toBe(SUPPLIER_ID_1);
  });

  it("rejects ambiguous supplier when multiple match", async () => {
    const ambiguousLookups: PriceBookLookups = {
      suppliers: [
        { id: SUPPLIER_ID_1, name: "DuplicateSupplier" },
        { id: SUPPLIER_ID_2, name: "DuplicateSupplier" },
      ],
      products: TEST_LOOKUPS.products,
    };

    const rows: CsvImportRow[] = [
      { fournisseur: "DuplicateSupplier", ref: "TUBE-INOX-28", prix: "10,00" },
    ];

    const mapping: PriceBookColumnMapping = {
      fournisseur: "supplier_name",
      ref: "product_reference",
      prix: "unit_price",
    };

    const result = await validatePriceBookRows(rows, mapping, {
      lookups: ambiguousLookups,
    });

    expect(result.rejectedRowsCount).toBe(1);
    expect(result.rejectedRows[0]?.reason).toContain("Fournisseur ambigu");
  });

  it("uses provided source line numbers when available", async () => {
    const rows: CsvImportRow[] = [
      { fournisseur: "", ref: "TUBE-INOX-28", prix: "10,00" },
      { fournisseur: "CEDEO", ref: "", prix: "11,00" },
      { fournisseur: "CEDEO", ref: "TUBE-INOX-28", prix: "-1,20" },
    ];

    const mapping: PriceBookColumnMapping = {
      fournisseur: "supplier_name",
      ref: "product_reference",
      prix: "unit_price",
    };

    const result = await validatePriceBookRows(rows, mapping, {
      rowLineNumbers: [2, 5, 9],
      autoFillSingleSupplier: false,
      lookups: TEST_LOOKUPS,
    });

    expect(result.acceptedRows).toBe(0);
    expect(result.rejectedRowsCount).toBe(3);
    expect(result.rejectedRows[0]?.lineNumber).toBe(2);
    expect(result.rejectedRows[1]?.lineNumber).toBe(5);
    expect(result.rejectedRows[2]?.lineNumber).toBe(9);
    expect(result.previewRows[0]?.lineNumber).toBe(2);
    expect(result.previewRows[1]?.lineNumber).toBe(5);
    expect(result.previewRows[2]?.lineNumber).toBe(9);
  });

  it("does not overcount progress when duplicate candidates are ignored", async () => {
    const rows: CsvImportRow[] = [
      { fournisseur: "CEDEO", ref: "TUBE-INOX-28", prix: "10,00" },
      { fournisseur: "CEDEO", ref: "TUBE-INOX-28", prix: "10,00" },
    ];

    const mapping: PriceBookColumnMapping = {
      fournisseur: "supplier_name",
      ref: "product_reference",
      prix: "unit_price",
    };

    const progressEvents: Array<{ processed: number; total: number; percentage: number }> = [];

    const result = await validatePriceBookRows(rows, mapping, {
      chunkSize: 1,
      lookups: TEST_LOOKUPS,
      onProgress: (progress) => {
        progressEvents.push(progress);
      },
    });

    expect(result.totalRows).toBe(2);
    expect(result.acceptedRows).toBe(1);
    expect(result.ignoredRowsCount).toBe(1);
    expect(result.ignoredRows[0]?.errorCode).toBe("DUPLICATE_CANDIDATE");
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents.every((event) => event.processed <= event.total)).toBe(true);
    expect(Math.max(...progressEvents.map((event) => event.processed))).toBe(2);
    expect(progressEvents[progressEvents.length - 1]).toMatchObject({
      processed: 2,
      total: 2,
      percentage: 100,
    });
  });

  it("normalizes mm_bdc alternatives and ignores rows without supplier price", async () => {
    const rows: CsvImportRow[] = [
      {
        ID: "TUBE-INOX-28",
        Materiau: "Tube inox",
        Dimension: "DN15",
        Caracteristique: "Soude",
        F1_nom: "CEDEO",
        F1_prix: "12,50",
        F2_nom: "ARCUS",
        F2_prix: "12,20",
      },
      {
        ID: "CABLE-3G1.5",
        Materiau: "Cable",
        Dimension: "3G1.5",
        Caracteristique: "Cuivre",
        F1_nom: "",
        F1_prix: "",
      },
    ];

    const result = await validatePriceBookRows(
      rows,
      {
        F1_nom: "supplier_name",
        ID: "product_reference",
        F1_prix: "unit_price",
      },
      {
        profile: "mm_bdc",
        lookups: TEST_LOOKUPS,
        includeSupplierAlternatives: true,
      }
    );

    expect(result.acceptedRows).toBe(2);
    expect(result.rejectedRowsCount).toBe(0);
    expect(result.ignoredRowsCount).toBe(1);
    expect(result.ignoredRows[0]?.errorCode).toBe("NO_SUPPLIER_PRICE");
  });

  // Sub-lot 2.2/2.9 (D4-16, C-09): the base de chiffrage carries its unit in « Unite »; it was
  // written as null, then defaulted to « u » in SQL, so a tube priced per metre became a unit.
  it("keeps the mm_bdc unit column on every supplier alternative", async () => {
    // Known articles and suppliers of TEST_LOOKUPS, so that every row is accepted.
    const rows: CsvImportRow[] = [
      { ID: "TUBE-INOX-28", Materiau: "Tube inox", Dimension: "DN15", Unite: "ml",
        F1_nom: "CEDEO", F1_prix: "12,50", F2_nom: "ARCUS", F2_prix: "12,20" },
      { ID: "CABLE-3G1.5", Materiau: "Cable", Dimension: "3G1.5", Unite: "U", F1_nom: "CEDEO", F1_prix: "1,10" },
      { ID: "CABLE-3G1.5", Materiau: "Cable", Dimension: "3G1.5", Unite: "", F1_nom: "ARCUS", F1_prix: "1,15" },
    ];

    const result = await validatePriceBookRows(
      rows,
      { F1_nom: "supplier_name", ID: "product_reference", F1_prix: "unit_price" },
      { profile: "mm_bdc", lookups: TEST_LOOKUPS, includeSupplierAlternatives: true }
    );

    expect(result.rejectedRowsCount).toBe(0);
    expect(result.acceptedItems.map((item) => item.unit)).toEqual(["ml", "ml", "U", null]);
  });

  it("parses mm_bdc rows when headers are lowercase variants", async () => {
    const rows: CsvImportRow[] = [
      {
        id: "TUBE-INOX-28",
        materiau: "Tube inox",
        dimension: "DN15",
        caracteristique: "Soude",
        f1_nom: "CEDEO",
        f1_prix: "12,50",
        devise: "EUR",
      },
    ];

    const result = await validatePriceBookRows(
      rows,
      {
        f1_nom: "supplier_name",
        id: "product_reference",
        f1_prix: "unit_price",
      },
      {
        profile: "mm_bdc",
        lookups: TEST_LOOKUPS,
        includeSupplierAlternatives: true,
      }
    );

    expect(result.acceptedRows).toBe(1);
    expect(result.rejectedRowsCount).toBe(0);
    expect(result.ignoredRowsCount).toBe(0);
    expect(result.acceptedItems[0]).toMatchObject({
      supplier_id: SUPPLIER_ID_1,
      product_id: PRODUCT_ID_1,
      unit_price_cents: 1250,
      currency: "EUR",
    });
  });

  it("autofills supplier when one supplier is uniquely identifiable", async () => {
    const rows: CsvImportRow[] = [
      {
        ID: "TUBE-INOX-28",
        F1_nom: "CEDEO",
        F1_prix: "10,00",
      },
      {
        ID: "CABLE-3G1.5",
        F1_nom: "",
        F1_prix: "8,00",
      },
    ];

    const result = await validatePriceBookRows(
      rows,
      {
        F1_nom: "supplier_name",
        ID: "product_reference",
        F1_prix: "unit_price",
      },
      {
        profile: "mm_bdc",
        lookups: TEST_LOOKUPS,
      }
    );

    expect(result.acceptedRows).toBe(2);
    expect(result.autofilledSupplierCount).toBe(1);
  });
});
