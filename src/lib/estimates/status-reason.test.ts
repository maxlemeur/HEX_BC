import { describe, expect, it } from "vitest";

import {
  applyStatusReasonRules,
  asksStatusReason,
  estimateStatusReasonInputSchema,
  formatStatusReason,
  readEstimateStatusReason,
  requiresStatusReason,
  statusReasonError,
} from "@/lib/estimates/status-reason";

// TI-682, lot C (D11, D25): the internal reason of an exclusion. These rules mirror the database's
// (estimate_status_reason_valid, private.track_estimate_item_status_reason), tested in
// supabase/tests/database/estimate-line-status-reason.test.sql; here, what the editor and the send gate decide with them.

const TEN = "Lot CVC du marché";

describe("the internal reason of an exclusion (TI-682)", () => {
  it("accepts a code of the list, alone or with a note of 10 to 500 code points once its blanks are trimmed", () => {
    expect(statusReasonError({ code: "other_trade", note: null })).toBeNull();
    expect(statusReasonError({ code: "other_trade", note: `  ${TEN}\n` })).toBeNull();
    expect(statusReasonError({ code: "client_supplied", note: "é".repeat(500) })).toBeNull();
    expect(statusReasonError({ code: "client_supplied", note: "123456789" })).toMatch(/10 à 500/);
    expect(statusReasonError({ code: "client_supplied", note: "é".repeat(501) })).toMatch(/10 à 500/);
    // « Other » says nothing by itself: its note is the whole explanation.
    expect(statusReasonError({ code: "other", note: "   " })).toMatch(/Autre/);
    expect(statusReasonError({ code: "other", note: TEN })).toBeNull();
  });

  it("refuses at the request an unknown code, an extra key and a short note, and parses the note as stored", () => {
    expect(estimateStatusReasonInputSchema.safeParse({ code: "unknown" }).success).toBe(false);
    expect(estimateStatusReasonInputSchema.safeParse({ code: "other_trade", note: null, by: "x" }).success).toBe(false);
    expect(estimateStatusReasonInputSchema.safeParse({ code: "other_trade", note: "court" }).success).toBe(false);
    expect(estimateStatusReasonInputSchema.parse({ code: "other_trade", note: ` ${TEN} ` })).toEqual({ code: "other_trade", note: TEN });
    expect(estimateStatusReasonInputSchema.parse({ code: "other_trade" })).toEqual({ code: "other_trade", note: null });
  });

  it("reads back only a reason of the stored shape, its note trimmed", () => {
    expect(readEstimateStatusReason({ code: "included_elsewhere", note: ` ${TEN} ` })).toEqual({ code: "included_elsewhere", note: TEN });
    expect(readEstimateStatusReason({ code: "included_elsewhere", note: "" })).toEqual({ code: "included_elsewhere", note: null });
    for (const value of [null, "other_trade", [], { code: "nope", note: null }, { code: "other", note: null }]) {
      expect(readEstimateStatusReason(value)).toBeNull();
    }
  });

  it("requires a reason only on a line that was « Non chiffrée » in this version and now carries an excluded status", () => {
    const reason = { code: "other_trade", note: null };
    expect(requiresStatusReason({ item_type: "line", pricing_status: "out_of_scope", was_not_priced: true, status_reason: null })).toBe(true);
    for (const status of ["included", "for_memory", "not_applicable"]) {
      expect(requiresStatusReason({ item_type: "line", pricing_status: status, was_not_priced: true, status_reason: null })).toBe(true);
    }
    expect(requiresStatusReason({ item_type: "line", pricing_status: "out_of_scope", was_not_priced: true, status_reason: reason })).toBe(false);
    // An unreadable stored value is no reason: the send waits for one.
    expect(requiresStatusReason({ item_type: "line", pricing_status: "out_of_scope", was_not_priced: true,
      status_reason: { code: "other", note: null } })).toBe(true);
    // Created or imported directly with a status (a DPGF's « PM », V3E16, V3E20): not concerned.
    expect(requiresStatusReason({ item_type: "line", pricing_status: "for_memory", was_not_priced: false, status_reason: null })).toBe(false);
    // Still « Non chiffrée » (not_priced_unclassified says so), or priced again.
    expect(requiresStatusReason({ item_type: "line", pricing_status: "not_priced", was_not_priced: true, status_reason: null })).toBe(false);
    expect(requiresStatusReason({ item_type: "line", pricing_status: "priced", was_not_priced: true, status_reason: null })).toBe(false);
    expect(requiresStatusReason({ item_type: "section", pricing_status: "out_of_scope", was_not_priced: true, status_reason: null })).toBe(false);
  });

  it("asks for the reason when an excluded status is chosen for a line that is or was « Non chiffrée »", () => {
    expect(asksStatusReason({ pricing_status: "not_priced", was_not_priced: false }, "out_of_scope")).toBe(true);
    expect(asksStatusReason({ pricing_status: "priced", was_not_priced: true }, "included")).toBe(true);
    expect(asksStatusReason({ pricing_status: "priced", was_not_priced: false }, "included")).toBe(false);
    expect(asksStatusReason({ pricing_status: "not_priced", was_not_priced: true }, "priced")).toBe(false);
  });

  it("keeps the line as the database leaves it: « was not priced » is sticky, a reason leaves with the excluded statuses", () => {
    const reason = { code: "other_trade", note: null };
    // not_priced → priced → out_of_scope: the two-step way round stays « was not priced ».
    const priced = applyStatusReasonRules({ pricing_status: "not_priced", was_not_priced: false, status_reason: null },
      { pricing_status: "priced", was_not_priced: false, status_reason: null });
    expect(priced.was_not_priced).toBe(true);
    expect(applyStatusReasonRules(priced, { ...priced, pricing_status: "out_of_scope" }).was_not_priced).toBe(true);
    // Into « Non chiffrée » too.
    expect(applyStatusReasonRules({ pricing_status: "priced", was_not_priced: false }, { pricing_status: "not_priced", was_not_priced: false })
      .was_not_priced).toBe(true);
    // An excluded line priced again loses its reason; moving between excluded statuses keeps it.
    const excluded = { pricing_status: "out_of_scope", was_not_priced: true, status_reason: reason };
    expect(applyStatusReasonRules(excluded, { ...excluded, pricing_status: "priced" }).status_reason).toBeNull();
    expect(applyStatusReasonRules(excluded, { ...excluded, pricing_status: "not_applicable" }).status_reason).toBe(reason);
    // A line never « Non chiffrée » stays so through excluded statuses.
    expect(applyStatusReasonRules({ pricing_status: "priced", was_not_priced: false }, { pricing_status: "for_memory", was_not_priced: false })
      .was_not_priced).toBe(false);
    // No change, same object (the grid keeps the identity of an unchanged row).
    const unchanged = { pricing_status: "out_of_scope", was_not_priced: true, status_reason: reason };
    expect(applyStatusReasonRules(unchanged, unchanged)).toBe(unchanged);
  });

  it("formats the reason for the internal CSV", () => {
    expect(formatStatusReason({ code: "client_supplied", note: null })).toBe("Fourni ou réalisé par le maître d'ouvrage ou le client");
    expect(formatStatusReason({ code: "other", note: TEN })).toBe(`Autre motif (à préciser) : ${TEN}`);
    expect(formatStatusReason(null)).toBe("");
  });
});
