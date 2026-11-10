import { describe, expect, it } from "vitest";

import {
  FORCE_MESSAGES,
  forcedItemError,
  forceReasonsFor,
  packForcedItems,
  type ForcedItem,
} from "@/lib/takeoff/force-reasons";
import { checkApplyGuard, type ApplyGuardItem } from "@/lib/takeoff/guards";
import { leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// TI-686 D10: an administrator forces each blocked line with a coded reason and a justification of 10 to 500
// characters. The reasons that name a rule are computed on the failures that block the line, as TI-681 defines them
// (the apply guard and takeoff_item_rule_blocked): a quantity warning (scale, printed surface, overlaps, a missing DN)
// only recommends a review, so it is never a rule to declare a false positive of. Ways it fails, written before
// force-reasons.ts:
// - a false positive is declared on a line no rule blocks (forced for its missing proof), or names a rule that does not
//   block it (a scale warning, an acceptable failure the line's V settles);
// - a « doublon résolu » is declared on an overlap that no longer blocks (TI-681, or left out by the plan);
// - results to compute again (or unreadable, which the route reads as such) still offer the two conditional reasons;
// - a justification counts JS string units, or the payload stores the same text once per line.

const ids = {
  a: "f4000000-0000-4000-8000-00000000000a",
  b: "f4000000-0000-4000-8000-00000000000b",
  c: "f4000000-0000-4000-8000-00000000000c",
  partner: "f4000000-0000-4000-8000-0000000000ff",
};

const blockedMaterial: TakeoffRuleResult = { rule: "dn_network", status: "fail", code: "DN_NETWORK_MATERIAL_BLOCKED", version: 3,
  acceptable: false, reason: "Matériau interdit sur ce réseau (fictif)." };
const materialToJustify: TakeoffRuleResult = { rule: "dn_network", status: "fail", code: "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION",
  version: 3, acceptable: true, reason: "Matériau à justifier (fictif)." };
const scaleMismatch: TakeoffRuleResult = { rule: "scale_dimension", status: "fail", code: "SCALE_DIMENSION_MISMATCH", version: 2,
  acceptable: true, reason: "Une cote contredit l’échelle (fictif)." };
const duplicate: TakeoffRuleResult = { rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 101,
  acceptable: true, reason: "Tronçon compté aussi sur Z2 (fictif).", details: { partner_count: 1, overlap_m: 1,
    partners: [{ item_id: ids.partner, job_id: ids.c, zone: "Z2", designation: "EF", overlap_m: 1, resolved: false }] } };

function line(id: string, overrides: Partial<ApplyGuardItem> = {}): ApplyGuardItem {
  return { id, designation: `Ligne ${id.slice(-1)}`, confidence: 0.95, evidence: "Repère localisé", source_page: 1,
    is_verified: false, is_excluded: false, rule_results: [], rules_stale: false, ...overrides };
}

/** The line as the apply guard reports it blocked (level C, plan exclusions read as the route reads them). */
function blocked(item: ApplyGuardItem, others: ApplyGuardItem[] = []) {
  const result = checkApplyGuard([item, ...others], 0.5, { level: "C", leftOut: leftOutByPartners });
  const found = result.blocked_items.find((entry) => entry.item_id === item.id);
  if (!found) throw new Error(`${item.id} is not blocked`);
  return found;
}

const NOTE = "Fiche technique du fabricant jointe au dossier.";
const forced = (reason_code: ForcedItem["reason_code"], extra: Partial<ForcedItem> = {}): Omit<ForcedItem, "item_id"> =>
  ({ reason_code, justification_index: 0, ...extra });
const UNCONDITIONAL = ["additional_evidence", "engineer_or_client_confirmation", "controlled_correction", "priced_hypothesis"];

describe("forceReasonsFor and forcedItemError", () => {
  it("never offers a false positive on a line no rule blocks (forced for its missing localized proof)", () => {
    const noProof = blocked(line(ids.a, { evidence: null }));
    expect(forceReasonsFor(noProof)).toEqual(UNCONDITIONAL);
    expect(forcedItemError(noProof, forced("rule_false_positive", { false_positive_rules: ["dn_network"] }), [NOTE]))
      .toBe(FORCE_MESSAGES.falsePositive);
    expect(forcedItemError(noProof, forced("additional_evidence"), [NOTE])).toBeNull();
  });

  it("declares a false positive only of a rule whose failure blocks the line", () => {
    const material = blocked(line(ids.b, { rule_results: [blockedMaterial] }));
    expect(forceReasonsFor(material)).toEqual(["rule_false_positive", ...UNCONDITIONAL]);
    expect(forcedItemError(material, forced("rule_false_positive", { false_positive_rules: ["dn_network"] }), [NOTE])).toBeNull();
    expect(forcedItemError(material, forced("rule_false_positive", { false_positive_rules: ["area_printed"] }), [NOTE]))
      .toBe(FORCE_MESSAGES.falsePositiveRules);
    expect(forcedItemError(material, forced("rule_false_positive", { false_positive_rules: [] }), [NOTE]))
      .toBe(FORCE_MESSAGES.falsePositiveRules);
    expect(forcedItemError(material, forced("rule_false_positive", { false_positive_rules: ["dn_network", "dn_network"] }), [NOTE]))
      .toBe(FORCE_MESSAGES.falsePositiveRules);
    expect(forcedItemError(material, forced("rule_false_positive"), [NOTE])).toBe(FORCE_MESSAGES.falsePositiveRules);
    expect(forcedItemError(material, forced("additional_evidence", { false_positive_rules: ["dn_network"] }), [NOTE]))
      .toBe(FORCE_MESSAGES.falsePositiveRulesForbidden);
  });

  // TI-681: a scale mismatch is a quantity warning; it recommends a review and never blocks, so it is no false positive
  // to declare, even unverified on a line blocked for its missing page.
  it("refuses a false positive of a quantity warning, which never blocks since TI-681", () => {
    const warned = blocked(line(ids.a, { source_page: null, rule_results: [scaleMismatch] }));
    expect(forceReasonsFor(warned)).toEqual(UNCONDITIONAL);
    expect(forcedItemError(warned, forced("rule_false_positive", { false_positive_rules: ["scale_dimension"] }), [NOTE]))
      .toBe(FORCE_MESSAGES.falsePositive);
  });

  it("refuses a false positive of an acceptable failure the line's verification settles", () => {
    const settled = blocked(line(ids.a, { source_page: null, is_verified: true, rule_results: [materialToJustify] }));
    expect(settled.rule_failures).toBeUndefined();
    expect(forcedItemError(settled, forced("rule_false_positive", { false_positive_rules: ["dn_network"] }), [NOTE]))
      .toBe(FORCE_MESSAGES.falsePositive);
  });

  it("never offers « doublon résolu » on an overlap that does not block, kept or left out by the plan", () => {
    const kept = blocked(line(ids.a, { evidence: null, rule_results: [duplicate] }));
    const leftOut = blocked(line(ids.a, { evidence: null, rule_results: [duplicate] }),
      [line(ids.partner, { is_excluded: true })]);
    for (const entry of [kept, leftOut]) {
      expect(forceReasonsFor(entry)).toEqual(UNCONDITIONAL);
      expect(forcedItemError(entry, forced("duplicate_resolved"), [NOTE])).toBe(FORCE_MESSAGES.duplicateResolved);
      expect(forcedItemError(entry, forced("rule_false_positive", { false_positive_rules: ["zone_overlap"] }), [NOTE]))
        .toBe(FORCE_MESSAGES.falsePositive);
    }
  });

  // Every overlap code this version writes is a quantity warning; a code it does not know (written by another version of
  // the rules) keeps its protection (quantity-review-policy.ts) and blocks: « doublon résolu » then holds, as in SQL.
  it("offers « doublon résolu » on a zone or room overlap that blocks the line, and accepts it", () => {
    for (const rule of ["zone_overlap", "room_overlap"] as const) {
      const overlap = { rule, status: "fail", code: "OVERLAP_FROM_ANOTHER_VERSION", version: 9, acceptable: true,
        reason: "Chevauchement relevé par une autre version des règles (fictif)." } as unknown as TakeoffRuleResult;
      const entry = blocked(line(ids.a, { rule_results: [overlap] }));
      expect(entry.rule_failures?.map((failure) => failure.rule)).toEqual([rule]);
      expect(forceReasonsFor(entry)).toEqual(["rule_false_positive", "additional_evidence", "engineer_or_client_confirmation",
        "controlled_correction", "duplicate_resolved", "priced_hypothesis"]);
      expect(forcedItemError(entry, forced("duplicate_resolved"), [NOTE])).toBeNull();
      expect(forcedItemError(entry, forced("duplicate_resolved"), ["Trop bref"])).toBe(FORCE_MESSAGES.justification);
    }
  });

  // listTakeoffApplyGuardItems reads unreadable results as [] and stale: the four unconditional reasons only.
  it("offers only the unconditional reasons on results to compute again, as on unreadable ones", () => {
    const stale = blocked(line(ids.b, { rules_stale: true, rule_results: [blockedMaterial] }));
    expect(forceReasonsFor(stale)).toEqual(UNCONDITIONAL);
    expect(forcedItemError(stale, forced("rule_false_positive", { false_positive_rules: ["dn_network"] }), [NOTE]))
      .toBe(FORCE_MESSAGES.falsePositive);
    expect(forcedItemError(stale, forced("additional_evidence"), [NOTE])).toBeNull();
    const unreadable = blocked(line(ids.b, { rules_stale: true, rule_results: [] }));
    expect(forceReasonsFor(unreadable)).toEqual(UNCONDITIONAL);
  });

  it("requires a justification of 10 to 500 code points, without the blanks at its ends", () => {
    const noProof = blocked(line(ids.a, { evidence: null }));
    expect(forcedItemError(noProof, forced("controlled_correction", { justification_index: 1 }), [NOTE]))
      .toBe(FORCE_MESSAGES.justification);
    expect(forcedItemError(noProof, forced("controlled_correction"), [" \n123456789 \t"])).toBe(FORCE_MESSAGES.justification);
    expect(forcedItemError(noProof, forced("controlled_correction"), ["😀😀😀😀😀"])).toBe(FORCE_MESSAGES.justification);
    expect(forcedItemError(noProof, forced("controlled_correction"), ["1234567890"])).toBeNull();
    expect(forcedItemError(noProof, forced("controlled_correction"), ["é".repeat(500)])).toBeNull();
    expect(forcedItemError(noProof, forced("controlled_correction"), ["é".repeat(501)])).toBe(FORCE_MESSAGES.justification);
  });
});

describe("packForcedItems", () => {
  it("sorts the lines, stores each justification once and points every line to it", () => {
    expect(packForcedItems([
      { item_id: ids.b, reason_code: "rule_false_positive", false_positive_rules: ["dn_network"], justification: `  ${NOTE}\n` },
      { item_id: ids.c, reason_code: "priced_hypothesis", justification: "Quantité chiffrée sur hypothèse de tracé." },
      { item_id: ids.a, reason_code: "additional_evidence", justification: NOTE },
    ])).toEqual({
      forced_justifications: [NOTE, "Quantité chiffrée sur hypothèse de tracé."],
      forced_items: [
        { item_id: ids.a, reason_code: "additional_evidence", justification_index: 0 },
        { item_id: ids.b, reason_code: "rule_false_positive", false_positive_rules: ["dn_network"], justification_index: 0 },
        { item_id: ids.c, reason_code: "priced_hypothesis", justification_index: 1 },
      ],
    });
  });
});
