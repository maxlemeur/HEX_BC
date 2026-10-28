import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchTakeoffPriceSuggestion,
  requestTakeoffPriceSuggestion,
  reviewTakeoffPriceSuggestion,
} from "@/lib/takeoff/client";
import type { TakeoffPriceSuggestionSnapshot } from "@/lib/takeoff/types";

const JOB_ID = "a1111111-1111-4111-8111-111111111111";
const VERSION_ID = "b2222222-2222-4222-8222-222222222222";
const LINE_ID = "c3333333-3333-4333-8333-333333333333";
const SUGGESTION_ID = "d4444444-4444-4444-8444-444444444444";
const ACTOR_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-10-28T10:00:00.123456Z";
const QUERY = { version_id: VERSION_ID, estimate_item_id: LINE_ID };

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

  it("retains the estimate-specific snapshot, evidence and microsecond timestamps", async () => {
    const data = { suggestion: suggestion() };
    respond(data);
    expect(await fetchTakeoffPriceSuggestion(JOB_ID, QUERY)).toEqual(data);
  });

  it.each(["string ok", "missing ok", "contradictory error", "false ok"])("rejects %s envelopes with otherwise valid price receipts", async (shape) => {
    for (const [run, data] of [
      [() => fetchTakeoffPriceSuggestion(JOB_ID, QUERY), { suggestion: suggestion() }],
      [() => requestTakeoffPriceSuggestion(JOB_ID, QUERY), { suggestion: suggestion() }],
      [() => reviewTakeoffPriceSuggestion(JOB_ID, SUGGESTION_ID, { version_id: VERSION_ID, action: "apply_target", review_note: "Prix vérifié" }, LINE_ID), reviewedSuggestion()],
    ] as const) {
      const envelope = shape === "string ok" ? { ok: "yes", data }
        : shape === "missing ok" ? { data }
        : shape === "contradictory error" ? { ok: true, data, error: null }
        : { ok: false, data };
      const fetch = vi.fn().mockResolvedValue(Response.json(envelope));
      vi.stubGlobal("fetch", fetch);
      await expect(run()).rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("matches valid uppercase request UUIDs against canonical database UUIDs", async () => {
    const data = { suggestion: suggestion() };
    respond(data);
    expect(await fetchTakeoffPriceSuggestion(JOB_ID.toUpperCase(), {
      version_id: VERSION_ID.toUpperCase(), estimate_item_id: LINE_ID.toUpperCase(),
    })).toEqual(data);
    const review = reviewedSuggestion();
    respond(review);
    expect(await reviewTakeoffPriceSuggestion(JOB_ID.toUpperCase(), SUGGESTION_ID.toUpperCase(), {
      version_id: VERSION_ID.toUpperCase(), action: "apply_target", review_note: "Prix vérifié",
    }, LINE_ID)).toEqual(review);
  });

  it.each([
    ["job", { job_id: ACTOR_ID }],
    ["version", { version_id: ACTOR_ID }],
    ["line", { line_id: ACTOR_ID }],
    ["fractional cents", { target_cents: 1200.5 }],
    ["negative cents", { low_cents: -1 }],
    ["unsafe cents", { high_cents: Number.MAX_SAFE_INTEGER + 1 }],
    ["price order", { low_cents: 1500 }],
    ["status", { status: "unexpected" }],
    ["contradictory review", { selected_action: "apply_target" }],
    ["premature review note", { review_note: "Not reviewed yet" }],
    ["source price", { sources: [{ ...suggestion().sources[0], price_cents: "invalid" }] }],
  ])("refuses an invalid %s on read", async (_name, patch) => {
    respond({ suggestion: { ...suggestion(), ...patch } });
    await expect(fetchTakeoffPriceSuggestion(JOB_ID, QUERY)).rejects.toThrow();
  });

  it("validates a regenerated snapshot before showing it", async () => {
    respond({ suggestion: { ...suggestion(), line_id: ACTOR_ID } });
    await expect(requestTakeoffPriceSuggestion(JOB_ID, { ...QUERY, force_refresh: true })).rejects.toThrow();
  });

  it("sends an explicit refresh once and returns the validated replacement", async () => {
    const data = { suggestion: suggestion() };
    const fetchMock = respond(data);
    expect(await requestTakeoffPriceSuggestion(JOB_ID, { ...QUERY, force_refresh: true })).toEqual(data);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(JSON.parse(String(request.body))).toEqual({ ...QUERY, force_refresh: true });
  });

  it("acknowledges an applied price only for the reviewed suggestion and its line", async () => {
    const data = reviewedSuggestion();
    respond(data);
    expect(await reviewTakeoffPriceSuggestion(JOB_ID, SUGGESTION_ID, {
      version_id: VERSION_ID, action: "apply_target", review_note: "Prix vérifié",
    }, LINE_ID)).toEqual(data);
  });

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

  it("refuses an application with no persisted line receipt", async () => {
    respond({ ...reviewedSuggestion(), applied_item: null });
    await expect(reviewTakeoffPriceSuggestion(JOB_ID, SUGGESTION_ID, {
      version_id: VERSION_ID, action: "apply_target", review_note: "Prix vérifié",
    }, LINE_ID)).rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false });
  });

  it.each([
    { action: "apply_target", status: "applied", selected: 1200 },
    { action: "keep_current", status: "kept_current", selected: 1000 },
    { action: "reject", status: "rejected", selected: null },
  ] as const)("requires the human review evidence for $status", async ({ action, status, selected }) => {
    for (const invalidEvidence of [{ reviewed_by: null }, { review_note: null }, { review_note: "   " }]) {
      respond({
        suggestion: { ...reviewedSuggestion().suggestion, selected_action: action, status,
          selected_price_cents: selected, ...invalidEvidence },
      });
      await expect(fetchTakeoffPriceSuggestion(JOB_ID, QUERY)).rejects.toMatchObject({
        status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false,
      });
    }
  });

  it.each([
    ["suggestion", { suggestion_id: ACTOR_ID }, {}],
    ["job", { job_id: ACTOR_ID }, {}],
    ["version", { version_id: ACTOR_ID }, {}],
    ["action", { selected_action: "apply_high", selected_price_cents: 1300 }, { unit_price_ht_cents: 1300 }],
    ["applied line", {}, { id: ACTOR_ID }],
    ["another consistent line", { line_id: ACTOR_ID }, { id: ACTOR_ID }],
    ["applied price", {}, { unit_price_ht_cents: 900 }],
  ])("refuses an invalid %s after review without retrying the write", async (_name, patch, itemPatch) => {
    const data = reviewedSuggestion();
    const fetchMock = respond({
      suggestion: { ...data.suggestion, ...patch }, applied_item: { ...data.applied_item, ...itemPatch },
    });
    await expect(reviewTakeoffPriceSuggestion(JOB_ID, SUGGESTION_ID, {
      version_id: VERSION_ID, action: "apply_target", review_note: "Prix vérifié",
    }, LINE_ID)).rejects.toMatchObject({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", retryable: false, jobId: JOB_ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
