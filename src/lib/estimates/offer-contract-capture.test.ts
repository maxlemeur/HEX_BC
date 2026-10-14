import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { prepareEstimateDocumentData, type EstimateItem } from "@/components/estimate-document/prepare-estimate-document-data";
import { computeEstimateBreakdown } from "@/lib/estimate-calculations";
import { COMPANY_INFO } from "@/lib/company-info";
import type { ClientContract1 } from "@/lib/estimates/offer-contract";

// Specialist exception written before capture code: a missing FREE line in the
// actual calculation Map becomes a zero placeholder in the preparer, numerically
// indistinguishable from a genuine free line. Army cannot corrupt that Map.
const MODULE = path.resolve("src/lib/estimates/offer-contract-capture.ts");
const vector = JSON.parse(readFileSync(path.resolve("src/test/fixtures/offer-contract-legacy-vectors.json"), "utf8"))
  .vectors.find((entry: { id: string }) => entry.id === "source-defaults/engine2/payload4");
const originalItem = vector.input.items[0] as EstimateItem;

function source() {
  // This is a real zero-price/free-supply calculation input, not a fake item
  // manufactured from a commercial snapshot to fit an old renderer's type.
  const items: EstimateItem[] = [{ ...structuredClone(originalItem), line_nature: "supply_only",
    unit_price_ht_cents: 0, h_mo: 0, h_mo_atelier: null, h_mo_chantier: null,
    labor_role_id: null, labor_role_atelier_id: null, labor_role_chantier_id: null }];
  const breakdown = computeEstimateBreakdown({ items, marginMultiplier: 1.5, marginMode: "fixed", marginTiers: [],
    discountCents: 0, discountMode: "simple", discountStepsBp: [], globalCoefficient: 1, taxRateBp: 2000,
    roundingMode: "none", roundingStepCents: 0, isLaborSplitEnabled: false, laborRateById: new Map(),
    laborRateAtelierById: new Map(), laborRateChantierById: new Map(), calcEngineVersion: 2 });
  return { items, breakdown };
}
function captureInput(model: ReturnType<typeof source>) {
  const prepared = prepareEstimateDocumentData({ items: model.items, breakdown: model.breakdown,
    calcEngineVersion: 2, taxRateBp: 2000, currency: "EUR", validiteJours: 45 });
  const totals = model.breakdown.totals;
  return {
    version: { id: vector.input.version.id, tenantId: vector.input.version.tenant_id, projectId: vector.input.version.project_id,
      number: 2, contentRevision: 7, calcEngineVersion: 2 as const, dateDevis: "2026-10-13", validiteJours: 45,
      currency: "EUR" as const, contractorRole: "principal" as const, taxRateBp: 2000 },
    project: { name: "ARMY actual free calculation", reference: null, estimateReference: "ARMY_FREE_V2",
      clientName: "Synthetic client", siteAddress: "Synthetic site" },
    issuer: { userId: "11111111-1111-4111-8111-111111111111", displayName: "Captured actual actor", displayRole: null, phone: null, email: null },
    company: structuredClone(COMPANY_INFO), sourceRows: model.items, prepared,
    sourceLineIds: new Set(model.breakdown.lineById.keys()),
    footer: { totalHtCents: totals.saleTotalCents, actualVatCents: totals.taxCents,
      amountDueCents: totals.roundedTtcCents, roundingAdjustmentCents: totals.roundingAdjustmentCents }, exclusions: null,
  };
}
let capture: (input: ReturnType<typeof captureInput>) => ClientContract1;
describe("offer capture source completeness with the actual calculator and preparer", () => {
  beforeAll(async () => {
    if (!existsSync(MODULE)) throw new Error("MISSING_PRECONDITION: capture module absent; no business RED/PASS.");
    const api = await import(/* @vite-ignore */ MODULE);
    capture = api.captureOfferClientContract;
  });
  it("refuses a missing real zero-value calculation entry even though rendered zeros and footer still reconcile", () => {
    const model = source();
    expect(model.breakdown.lineById.has(model.items[0].id)).toBe(true);
    expect(model.breakdown.totals.saleTotalCents).toBe(0);
    model.breakdown.lineById.delete(model.items[0].id);
    const input = captureInput(model);
    expect(input.prepared.lineSplitsById[model.items[0].id].totalHtCents).toBe(0);
    expect(() => capture(input)).toThrowError(expect.objectContaining({ code: "OFFER_CAPTURE_SOURCE_INVALID" }));
  });
  it("keeps a genuine computed free line and its exact footer, without mutating the source", () => {
    const input = captureInput(source());
    const before = structuredClone(input);
    const result = capture(input);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].saleHtCents).toBe(0);
    expect(result.totals).toEqual({ saleHtCents: 0, taxCents: 0, calculatedTtcCents: 0,
      payableTtcCents: 0, roundingAdjustmentCents: 0 });
    expect(input).toEqual(before);
  });
});
