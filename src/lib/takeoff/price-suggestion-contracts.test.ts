import { afterEach, describe, expect, it, vi } from "vitest";

import { reviewTakeoffPriceSuggestion } from "@/lib/takeoff/client";
import type { TakeoffPriceSuggestionSnapshot } from "@/lib/takeoff/types";

const JOB_ID = "a1111111-1111-4111-8111-111111111111";
const VERSION_ID = "b2222222-2222-4222-8222-222222222222";
const LINE_ID = "c3333333-3333-4333-8333-333333333333";
const SUGGESTION_ID = "d4444444-4444-4444-8444-444444444444";
const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-10-28T10:00:00.123456Z";

function suggestion(): TakeoffPriceSuggestionSnapshot {
  return {
    suggestion_id: SUGGESTION_ID, line_id: LINE_ID, version_id: VERSION_ID, job_id: JOB_ID,
    current_price_cents: 1000, low_cents: 1100, target_cents: 1200, high_cents: 1300,
    confidence_score: 0.8, confidence_label: "high", candidate_count: 1, outlier_count: 0,
    justification: "Offre récente comparable", factors: [
      { key: "unit", label: "Unité", value: "m", kind: "fact" },
    ],
    summary: { unit: "m", provenance: { preserved: true } },
    status: "pending", selected_action: null, selected_price_cents: null,
    review_note: null, reviewed_at: null, reviewed_by: null, created_at: NOW, updated_at: NOW,
    sources: [{
      source_id: "pricebook:reference-1", source_kind: "pricebook", kind: "fact",
      label: "Tube cuivre", source_ref: "Catalogue test", price_cents: 1200,
      freshness_label: "Récent", confidence_score: 0.8, rank: 1, is_outlier: false,
      source_record_table: "supplier_pricebook", source_record_id: "reference-1",
      metadata: { supplier_name: "Fournisseur fictif", unit: "m" },
    }],
  };
}

function reviewedSuggestion() {
  return {
    suggestion: {
      ...suggestion(), status: "applied", selected_action: "apply_target", selected_price_cents: 1200,
      review_note: "Prix vérifié", reviewed_at: NOW, reviewed_by: ACTOR_ID,
    },
    applied_item: { id: LINE_ID, unit_price_ht_cents: 1200, updated_at: NOW },
  };
}

function respond(data: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("takeoff price suggestion client contracts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { action: "keep_current", status: "kept_current", current: 1000, selected: 1000 },
    { action: "keep_current", status: "kept_current", current: null, selected: null },
    { action: "reject", status: "rejected", current: 1000, selected: null },
  ] as const)("preserves $action with current price $current without claiming a line write", async ({ action, status, current, selected }) => {
    const data = {
      suggestion: { ...reviewedSuggestion().suggestion, current_price_cents: current,
        selected_action: action, status, selected_price_cents: selected },
      applied_item: null,
    };
    respond(data);
    expect(await reviewTakeoffPriceSuggestion(JOB_ID, SUGGESTION_ID, {
      version_id: VERSION_ID, action, review_note: "Prix vérifié",
    }, LINE_ID)).toEqual(data);
  });
});
