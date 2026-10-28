import { describe, expect, it } from "vitest";

import {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
  type EstimateSealVersionFields,
} from "@/lib/estimates/estimate-seal";
import { evaluateHistoricalEstimateSeal } from "@/lib/estimates/version-seal-plan";

function source(engine: 1 | 2 | 3) {
  const version: EstimateSealVersionFields & { seal_payload_version: number | null } = {
    id: "44444444-4444-4444-8444-444444444444",
    tenant_id: "22222222-2222-4222-8222-222222222222",
    project_id: "33333333-3333-4333-8333-333333333333",
    version_number: 2,
    title: "Offre hydraulique",
    exclusions: "Hors peinture",
    date_devis: "2026-10-28",
    validite_jours: 45,
    currency: "EUR",
    total_ht_cents: 10000,
    total_tax_cents: 2000,
    total_ttc_cents: 12000,
    rounding_adjustment_cents: 50,
    margin_multiplier: 1.35,
    margin_mode: "tiered",
    discount_bp: 1000,
    discount_mode: "cascade",
    discount_steps: [500, 250],
    global_coefficient: 1.1,
    max_section_depth: 4,
    tax_rate_bp: 2000,
    rounding_mode: "nearest",
    rounding_step_cents: 5,
    calc_engine_version: engine,
    calc_snapshot_content_revision: 7,
    calc_snapshot_context: { labor_split_enabled: true },
    contractor_role: "principal",
    seal_hash: null,
    seal_payload_version: null,
  };
  return { version, items: [] };
}

describe("historical estimate seal compatibility", () => {
  it.each([2, 3, 4])("verifies engine 2 payload %i and returns the matched historical hash", (payloadVersion) => {
    const sealSource = source(2);
    const hash = computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource, { payloadVersion }));
    sealSource.version.seal_hash = `  ${hash.toUpperCase()}  `;

    expect(evaluateHistoricalEstimateSeal(sealSource)).toMatchObject({
      valid: true,
      computed_hash: hash,
      stored_hash: hash,
      matched_seal_scheme: `v${payloadVersion}`,
      calc_payload_version: payloadVersion,
    });
  });

  it("retains old engine 1 payloads without accepting that fallback for engine 2", () => {
    const sealSource = source(1);
    const hash = computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource, {
      payloadVersion: 1,
      includeCalcEngineVersion: false,
    }));
    sealSource.version.seal_hash = hash;
    expect(evaluateHistoricalEstimateSeal(sealSource)).toMatchObject({
      valid: true,
      computed_hash: hash,
      calc_payload_version: 1,
    });

    sealSource.version.calc_engine_version = 2;
    expect(evaluateHistoricalEstimateSeal(sealSource)).toMatchObject({
      valid: false,
      matched_seal_scheme: null,
      calc_payload_version: null,
    });
  });

  it("reports the current engine-specific diagnostic hash when no stored seal matches", () => {
    const sealSource = source(2);
    const hash = computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource));
    expect(evaluateHistoricalEstimateSeal(sealSource)).toMatchObject({
      valid: false,
      stored_hash: null,
      computed_hash: hash,
      calc_payload_version: null,
    });
  });

  it("never validates a v3 calculation hash as an historical document seal", () => {
    const sealSource = source(3);
    const hash = computeEstimateSealHash(buildCanonicalEstimateSealPayload(sealSource));
    sealSource.version.seal_hash = hash;
    sealSource.version.seal_payload_version = 6;
    expect(evaluateHistoricalEstimateSeal(sealSource)).toEqual({
      valid: false,
      computed_hash: hash,
      stored_hash: hash,
      seal_payload_version: 6,
      client_contract_version: null,
      calc_payload_version: null,
      matched_seal_scheme: null,
    });
  });
});
