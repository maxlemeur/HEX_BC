import { describe, expect, it } from "vitest";

import { IMPORT_PREVIEW_REQUIRED_MESSAGE } from "@/lib/affaires/import-flow";
import { attachImportRowStructure } from "@/lib/imports/payload";
import {
  buildDefaultEstimateCategories,
  buildEstimateCreationVersionPlan,
  buildMissingDefaultEstimateLaborRoles,
  defaultEstimateLaborRoleNames,
  prepareLinkedDpgfCreationRows,
} from "@/lib/estimates/version-creation-plan";

function mapped(id: string, fields: Record<string, unknown>) {
  return { id, payload: { row_index: 4, mapped_row: { designation: id, ...fields } } };
}

describe("estimate creation plans", () => {
  it("keeps the policy expectation separate from the persisted version and uses the coefficients that priced the source", () => {
    const version = {
      expected_calc_engine_version: 3 as const,
      currency: "USD" as const,
      sale_coefficient_fo: 1.3,
      sale_coefficient_mo: 1.2,
      discount_steps: [250, 100],
      global_coefficient: 1.1,
      max_section_depth: 3,
    };
    const before = structuredClone(version);
    const plan = buildEstimateCreationVersionPlan({
      version,
      normalizedCurrency: "GBP",
      linkedDpgfSaleCoefficients: { fo: 1.4, mo: 1.6, source: "workbook" },
    });
    expect(plan.expectedCalcEngineVersion).toBe(3);
    expect(plan.version).toEqual({
      currency: "GBP", sale_coefficient_fo: 1.4, sale_coefficient_mo: 1.6,
      discount_steps: [250, 100], global_coefficient: 1.1, max_section_depth: 3,
    });
    expect(version).toEqual(before);
  });

  it("leaves unspecified creation defaults to the canonical transaction", () => {
    expect(buildEstimateCreationVersionPlan({
      version: undefined, normalizedCurrency: undefined, linkedDpgfSaleCoefficients: null,
    })).toEqual({ expectedCalcEngineVersion: undefined, version: {} });
  });

  it("uses the actor for categories and the project owner for missing labor roles", () => {
    const categories = buildDefaultEstimateCategories({ tenantId: "tenant", userId: "admin" });
    expect(categories).toEqual([
      { tenant_id: "tenant", user_id: "admin", name: "Materiaux", position: 1, color: null },
      { tenant_id: "tenant", user_id: "admin", name: "Main d'oeuvre", position: 2, color: null },
      { tenant_id: "tenant", user_id: "admin", name: "Sous-traitance", position: 3, color: null },
    ]);
    const names = new Set(defaultEstimateLaborRoleNames());
    names.delete("Plombier");
    expect(buildMissingDefaultEstimateLaborRoles({
      tenantId: "tenant", ownerUserId: "owner", existingNames: names,
    })).toEqual([
      { tenant_id: "tenant", user_id: "owner", name: "Plombier", hourly_rate_cents: 0, is_active: true, position: 3 },
    ]);
    expect(buildMissingDefaultEstimateLaborRoles({
      tenantId: "tenant", ownerUserId: "owner", existingNames: new Set(defaultEstimateLaborRoleNames()),
    })).toEqual([]);
  });

  it.each([
    { version: undefined, latestVersionDefaults: null, pu: 1000, tax: 400 },
    { version: undefined, latestVersionDefaults: { margin_multiplier: 1.2, tax_rate_bp: 1000 }, pu: 1200, tax: 240 },
    { version: { margin_multiplier: 1.5, tax_rate_bp: 550 }, latestVersionDefaults: { margin_multiplier: 1.2, tax_rate_bp: 1000 }, pu: 1500, tax: 165 },
  ])("keeps the requested, previous and initial legacy pricing precedence: $pu", ({ version, latestVersionDefaults, pu, tax }) => {
    const rows = [mapped("Tube", { quantity: 2, unit_price_ht: 10 })];
    const before = structuredClone(rows);
    const result = prepareLinkedDpgfCreationRows({
      mappedRows: rows, version, latestVersionDefaults, lineContext: {},
    });
    expect(result.validLines[0]).toMatchObject({
      puHtCents: pu, lineTotalHtCents: pu * 2, lineTaxCents: tax,
    });
    expect(result.validItems).toEqual(result.validLines);
    expect(rows).toEqual(before);
  });

  it("prices v3 with the resolved sale coefficients and keeps its unit", () => {
    const result = prepareLinkedDpgfCreationRows({
      mappedRows: [mapped("Tube", { quantity: 2, unit: "ml", unit_price_ht: "10,50" })],
      version: { margin_multiplier: 7 },
      latestVersionDefaults: null,
      lineContext: { engine: 3, saleCoefficientFo: 1.5, saleCoefficientMo: 1.2 },
    });
    expect(result.validLines[0]).toMatchObject({
      unitCode: "ml", pricingStatus: "priced", unitPriceHtCents: 1050,
      puHtCents: 1575, lineTotalHtCents: 3150,
    });
  });

  it("keeps the direct wizard's unreviewed row structure instead of inferring sections", () => {
    const result = prepareLinkedDpgfCreationRows({
      mappedRows: [
        {
          id: "section",
          payload: {
            row_index: 1,
            raw_row: attachImportRowStructure({ Désignation: "Plomberie", Qte: null, U: null, Prix: null }, {
              sheet_name: "Lot plomberie", source_row_number: 2, bold_columns: ["Désignation"],
              merged_columns: [], outline_level: null, column_order: ["Désignation", "Qte", "U", "Prix"],
            }),
            mapped_row: { designation: "Plomberie" },
          },
        },
        mapped("Tube", { quantity: 2, unit_price_ht: 10 }),
      ],
      version: undefined, latestVersionDefaults: null, lineContext: {},
    });
    expect(result.validItems.map((item) => [item.itemType, item.title])).toEqual([
      ["line", "Plomberie"], ["line", "Tube"],
    ]);
  });

  it("refuses sources needing the import preview before accepting their otherwise valid lines", () => {
    expect(() => prepareLinkedDpgfCreationRows({
      mappedRows: [mapped("Tube", { quantity: 2, unit_price_ht: 10, labor_hours_per_unit: 1.5 })],
      version: undefined, latestVersionDefaults: null, lineContext: {},
    })).toThrow(IMPORT_PREVIEW_REQUIRED_MESSAGE);
  });

  it("rejects sources with no usable line", () => {
    expect(() => prepareLinkedDpgfCreationRows({
      mappedRows: [mapped("invalid", { designation: "", quantity: 1, unit_price_ht: 5 })],
      version: undefined, latestVersionDefaults: null, lineContext: {},
    })).toThrow("Aucune ligne DPGF valide à importer depuis la source liée.");
  });
});
