import { describe, expect, it } from "vitest";

import type {
  ValidImportFlowLine,
  ValidImportFlowSection,
} from "@/lib/affaires/import-flow";
import {
  toRpcImportItems,
  toRpcImportLines,
} from "@/lib/affaires/import-flow-server";

const line: ValidImportFlowLine = {
  itemType: "line",
  mappedRowId: "mapped-line",
  rowIndex: 2,
  title: "Tube acier",
  description: "ml",
  notes: "Sous-sol",
  sourcePage: null,
  sourceMetadata: {
    sheet_name: "plb Z3-5",
    source_row_number: 3,
  },
  quantity: 200,
  unitPriceHtCents: 4074,
  taxRateBp: 2000,
  kFo: 1,
  hMo: 1.2,
  hMoMajoration: 1,
  kMo: 1,
  puHtCents: 4074,
  lineTotalHtCents: 814800,
  lineTaxCents: 162960,
  lineTotalTtcCents: 977760,
};

const levelOne: ValidImportFlowSection = {
  itemType: "section",
  mappedRowId: "mapped-section-1",
  rowIndex: 0,
  title: "Eaux usées",
  level: 1,
  sourcePage: null,
  sourceMetadata: {
    sheet_name: "plb Z3-5",
    source_row_number: 2,
  },
};

const levelTwo: ValidImportFlowSection = {
  itemType: "section",
  mappedRowId: "mapped-section-2",
  rowIndex: 1,
  title: "EUEV",
  level: 2,
  sourcePage: null,
  sourceMetadata: {
    sheet_name: "plb Z3-5",
    source_row_number: 4,
  },
};

describe("DPGF RPC payload materialization", () => {
  it("keeps the historical line-only payload compatible", () => {
    expect(toRpcImportLines([line])).toEqual([
      expect.objectContaining({
        item_type: "line",
        mapped_row_id: "mapped-line",
        title: "Tube acier",
        description: "ml",
        notes: "Sous-sol",
        quantity: 200,
        unit_price_ht_cents: 4074,
        h_mo: 1.2,
      }),
    ]);
  });

  it("serializes ordered sections and lines with mapping provenance", () => {
    const payload = toRpcImportItems([levelOne, levelTwo, line], {
      importId: "33333333-3333-4333-8333-333333333333",
      mappingId: "44444444-4444-4444-8444-444444444444",
    });

    expect(payload.map((item) => item.item_type)).toEqual([
      "section",
      "section",
      "line",
    ]);
    expect(payload[0]).toMatchObject({
      title: "Eaux usées",
      section_level: 1,
      source_metadata: {
        sheet_name: "plb Z3-5",
        source_row_number: 2,
        import_id: "33333333-3333-4333-8333-333333333333",
        mapping_id: "44444444-4444-4444-8444-444444444444",
      },
    });
    expect(payload[1]).toMatchObject({
      title: "EUEV",
      section_level: 2,
    });
    expect(payload[2]).toMatchObject({
      title: "Tube acier",
      description: "ml",
      notes: "Sous-sol",
      source_metadata: {
        sheet_name: "plb Z3-5",
        source_row_number: 3,
        import_id: "33333333-3333-4333-8333-333333333333",
        mapping_id: "44444444-4444-4444-8444-444444444444",
      },
    });
  });
});
