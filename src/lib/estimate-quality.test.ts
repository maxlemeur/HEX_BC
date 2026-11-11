import { describe, expect, it } from "vitest";

import { computeEstimateQualityFlagsForItem } from "@/lib/estimate-quality";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

function createLine(input: {
  id: string;
  quantity: number;
  unitPriceHtCents: number;
  laborHours?: number;
  laborRoleId?: string | null;
  hMoAtelier?: number | null;
  hMoChantier?: number | null;
  laborRoleAtelierId?: string | null;
  laborRoleChantierId?: string | null;
  lineNature?: EstimateItem["line_nature"];
}): EstimateItem {
  return {
    id: input.id,
    item_type: "line",
    line_nature: input.lineNature ?? null,
    quantity: input.quantity,
    unit_price_ht_cents: input.unitPriceHtCents,
    h_mo: input.laborHours ?? 1,
    labor_role_id: input.laborRoleId ?? "role-1",
    h_mo_atelier: input.hMoAtelier ?? null,
    h_mo_chantier: input.hMoChantier ?? null,
    labor_role_atelier_id: input.laborRoleAtelierId ?? null,
    labor_role_chantier_id: input.laborRoleChantierId ?? null,
  } as EstimateItem;
}

describe("estimate quality flags", () => {
  it("adds outlier flags and excludes dismissed outliers", () => {
    const item = createLine({
      id: "line-1",
      quantity: 2,
      unitPriceHtCents: 2500,
    });

    const flags = computeEstimateQualityFlagsForItem(item, {
      outlierFlagsByItemId: {
        "line-1": ["price_outlier", "quantity_outlier"],
      },
      dismissedOutlierFlagsByItemId: {
        "line-1": ["price_outlier"],
      },
    });

    expect(flags).toContain("quantity_outlier");
    expect(flags).not.toContain("price_outlier");
  });

  it("flags stale supplier prices and incomplete labor split", () => {
    const item = createLine({
      id: "line-1",
      quantity: 1,
      unitPriceHtCents: 1000,
      hMoAtelier: 2,
      hMoChantier: 0,
      laborRoleAtelierId: "role-atelier",
      laborRoleChantierId: null,
    });

    const flags = computeEstimateQualityFlagsForItem(item, {
      staleSupplierPriceItemIds: new Set(["line-1"]),
      isLaborSplitEnabled: true,
    });

    expect(flags).toContain("supplier_price_outdated");
    expect(flags).toContain("labor_split_incomplete");
  });

  it("does not require a supply price for a labor-only line", () => {
    const flags = computeEstimateQualityFlagsForItem(
      createLine({
        id: "labor-only",
        quantity: 1,
        unitPriceHtCents: 0,
        laborHours: 2,
        laborRoleId: "role-1",
        lineNature: "labor_only",
      }),
    );

    expect(flags).not.toContain("missing_price");
  });

  it("requires both supply and labor for a mixed line", () => {
    const flags = computeEstimateQualityFlagsForItem(
      createLine({
        id: "mixed",
        quantity: 1,
        unitPriceHtCents: 0,
        laborHours: 0,
        laborRoleId: null,
        lineNature: "supply_and_labor",
      }),
    );

    expect(flags).toEqual(
      expect.arrayContaining(["missing_price", "missing_labor_time"]),
    );
  });

  it("flags labor values hidden by a supply-only nature", () => {
    const flags = computeEstimateQualityFlagsForItem(
      createLine({
        id: "supply-with-labor",
        quantity: 1,
        unitPriceHtCents: 2500,
        laborHours: 2,
        laborRoleId: "role-1",
        lineNature: "supply_only",
      }),
    );

    expect(flags).toContain("line_nature_mismatch");
  });

  it("flags supply values hidden by a labor-only nature", () => {
    const flags = computeEstimateQualityFlagsForItem(
      createLine({
        id: "labor-with-supply",
        quantity: 1,
        unitPriceHtCents: 2500,
        laborHours: 2,
        laborRoleId: "role-1",
        lineNature: "labor_only",
      }),
    );

    expect(flags).toContain("line_nature_mismatch");
  });
  // TI-539 : POSE SEULE autorise un coût de fourniture nul et garde la main-d'œuvre attendue.
  it("does not require a supply price for a POSE SEULE line", () => {
    const flags = computeEstimateQualityFlagsForItem(
      createLine({
        id: "pose-only",
        quantity: 1,
        unitPriceHtCents: 0,
        laborHours: 2,
        laborRoleId: "role-1",
        lineNature: "pose_only",
      }),
    );

    expect(flags).toEqual([]);
  });

  it("still expects the labor of a POSE SEULE line", () => {
    const flags = computeEstimateQualityFlagsForItem(
      createLine({
        id: "pose-only-without-labor",
        quantity: 1,
        unitPriceHtCents: 0,
        laborHours: 0,
        laborRoleId: null,
        lineNature: "pose_only",
      }),
    );

    expect(flags).toContain("missing_labor_time");
    expect(flags).not.toContain("missing_price");
  });

  // Réponse de Maxime du 11/11/2026 : une POSE SEULE peut porter une petite fourniture nécessaire à la pose
  // (supportage). Un coût saisi ne contredit donc plus la nature et ne bloque pas l'envoi.
  it("accepts a small supply on a POSE SEULE line", () => {
    const flags = computeEstimateQualityFlagsForItem(
      createLine({
        id: "pose-only-with-supply",
        quantity: 1,
        unitPriceHtCents: 2500,
        laborHours: 2,
        laborRoleId: "role-1",
        lineNature: "pose_only",
      }),
    );

    expect(flags).toEqual([]);
  });

  // L'article d'origine (type de fourniture, offre) porte les temps de pose : il ne contredit pas POSE SEULE
  // tant qu'aucun coût de fourniture n'est saisi. « Main-d'œuvre seule » garde sa règle d'origine.
  it("keeps the catalogue origin of a POSE SEULE line without a supply cost", () => {
    const origin = { supply_type_id: "type-1", selected_supplier_price_id: "offer-1" };
    const line = (lineNature: EstimateItem["line_nature"]) => ({
      ...createLine({ id: "from-article", quantity: 1, unitPriceHtCents: 0, laborHours: 2, laborRoleId: "role-1", lineNature }),
      ...origin,
    }) as EstimateItem;

    expect(computeEstimateQualityFlagsForItem(line("pose_only"))).toEqual([]);
    expect(computeEstimateQualityFlagsForItem(line("labor_only"))).toContain("line_nature_mismatch");
  });

  // Un article du catalogue sans prix, posé sur une ligne qui a des heures, est déduit « Main-d'œuvre seule » à
  // la création : sa fourniture ne doit pas devenir gratuite en silence. Le coût manque jusqu'à sa saisie ou
  // jusqu'au choix explicite POSE SEULE ; une prestation sans article (étude, essai) n'attend aucune fourniture.
  it("keeps the missing cost of a catalogue article visible on an inferred labor-only line", () => {
    const line = (lineNature: EstimateItem["line_nature"], productId: string | null, unitPriceHtCents = 0) => ({
      ...createLine({ id: "article", quantity: 1, unitPriceHtCents, laborHours: 2, laborRoleId: "role-1", lineNature }),
      product_id: productId,
    }) as EstimateItem;

    expect(computeEstimateQualityFlagsForItem(line("labor_only", "product-1"))).toContain("missing_price");
    expect(computeEstimateQualityFlagsForItem(line("labor_only", null))).toEqual([]);
    expect(computeEstimateQualityFlagsForItem(line("pose_only", "product-1"))).toEqual([]);
    expect(computeEstimateQualityFlagsForItem(line("supply_and_labor", "product-1", 1200))).toEqual([]);
  });

  // Un coût manquant n'est pas un coût nul volontaire : sans POSE SEULE, la ligne reste incomplète.
  it("keeps a missing supply price blocking when the line is not POSE SEULE", () => {
    const flags = computeEstimateQualityFlagsForItem(
      createLine({
        id: "missing-price",
        quantity: 1,
        unitPriceHtCents: 0,
        laborHours: 2,
        laborRoleId: "role-1",
        lineNature: "supply_and_labor",
      }),
    );

    expect(flags).toContain("missing_price");
  });
});
