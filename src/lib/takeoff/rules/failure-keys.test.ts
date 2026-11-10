import { describe, expect, it } from "vitest";

import { evaluateTakeoffRules } from "@/lib/takeoff/rules/evaluate";
import { ruleFailureKeys, ruleFailuresReopen } from "@/lib/takeoff/rules/failure-keys";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";

// TI-677 (PR D): the keys of a line's failed rules, read from the stored JSON. The same cases run in pgTAP against
// takeoff_rule_failure_keys and takeoff_rule_failures_reopen (supabase/tests/database/takeoff-rule-decisions.test.sql):
// the writer withdraws a verification on the SQL side, the override's audit records the TS side, and the trigger
// compares them.

const A = "0a000000-0000-4000-8000-00000000000a";
const B = "0b000000-0000-4000-8000-00000000000b";
const B_UPPER = "0B000000-0000-4000-8000-00000000000B";

const fail = (rule: string, code: string, extra: Record<string, unknown> = {}) =>
  ({ rule, status: "fail", code, version: 1, acceptable: true, reason: "Fictif.", ...extra });

const FAILURE_KEY_CASES: Array<[string, unknown, string[]]> = [
  ["no results", null, []],
  ["an object instead of a list", { rule: "dn_network" }, []],
  ["an empty list", [], []],
  ["a passed rule", [{ rule: "dn_network", status: "pass", code: "DN_NETWORK_COMPATIBLE", version: 1, acceptable: true, reason: "" }], []],
  ["a failed rule without partner", [fail("dn_network", "DN_NETWORK_DN_MISSING")], ["dn_network|DN_NETWORK_DN_MISSING|1|"]],
  ["one key per partner, in lower case, sorted", [fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE",
    { details: { partners: [{ item_id: B_UPPER }, { item_id: A }] } })],
  [`zone_overlap|ZONE_OVERLAP_DUPLICATE|1|${A}`, `zone_overlap|ZONE_OVERLAP_DUPLICATE|1|${B}`]],
  ["overlapping rooms named twice", [fail("room_overlap", "ROOM_OVERLAP", { details: { overlapping_item_ids: [B, B_UPPER] } })],
    [`room_overlap|ROOM_OVERLAP|1|${B}`]],
  ["partners and overlapping rooms together", [fail("room_overlap", "ROOM_OVERLAP",
    { details: { partners: [{ item_id: A }], overlapping_item_ids: [B] } })],
  [`room_overlap|ROOM_OVERLAP|1|${A}`, `room_overlap|ROOM_OVERLAP|1|${B}`]],
  ["a version written 1.0", [fail("dn_network", "DN_NETWORK_DN_MISSING", { version: 1.0 })], ["dn_network|DN_NETWORK_DN_MISSING|1|"]],
  ["a version that is not an integer", [fail("dn_network", "DN_NETWORK_DN_MISSING", { version: 1.5 }),
    fail("dn_network", "DN_NETWORK_DN_MISSING", { version: "2" }), fail("dn_network", "DN_NETWORK_DN_MISSING", { version: -1 }),
    fail("dn_network", "DN_NETWORK_DN_MISSING", { version: 2147483648 })], ["dn_network|DN_NETWORK_DN_MISSING|?|"]],
  ["the largest version", [fail("dn_network", "DN_NETWORK_DN_MISSING", { version: 2147483647 })],
    ["dn_network|DN_NETWORK_DN_MISSING|2147483647|"]],
  ["a rule or a code that is not a name", [fail("dn network", "DN_NETWORK_DN_MISSING"), { ...fail("x", "BAD|CODE"), rule: 5 }],
    ["?|?|1|", "?|DN_NETWORK_DN_MISSING|1|"]],
  ["a partner without identifier, or with a separator", [fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE",
    { details: { partners: [{ zone: "Z1" }, { item_id: `${A},${B}` }, "x", null, { item_id: 7 }] } })],
  ["zone_overlap|ZONE_OVERLAP_DUPLICATE|1|?"]],
  ["a status written in capitals, and a result that is not an object", [{ ...fail("dn_network", "DN_NETWORK_DN_MISSING"),
    status: "FAIL" }, "fail", ["fail"], 1], []],
  ["the same failure twice", [fail("closed_box", "CLOSED_BOX_LABEL"), fail("closed_box", "CLOSED_BOX_LABEL")],
    ["closed_box|CLOSED_BOX_LABEL|1|"]],
  ["details that are a list", [fail("zone_overlap", "ZONE_OVERLAP_UNREGISTERED", { details: [{ partners: [{ item_id: A }] }] })],
    ["zone_overlap|ZONE_OVERLAP_UNREGISTERED|1|"]],
  ["partners that are not a list", [fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE", { details: { partners: { item_id: A },
    overlapping_item_ids: A } })], ["zone_overlap|ZONE_OVERLAP_DUPLICATE|1|"]],
  ["several rules, sorted by byte", [fail("room_overlap", "ROOM_OVERLAP"), fail("area_printed", "AREA_PRINTED_MISMATCH"),
    fail("non_observable", "NON_OBSERVABLE_TO_ENTER", { acceptable: false })],
  ["area_printed|AREA_PRINTED_MISMATCH|1|", "non_observable|NON_OBSERVABLE_TO_ENTER|1|", "room_overlap|ROOM_OVERLAP|1|"]],
  ["an empty partner list", [fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE", { details: { partners: [] } })],
    ["zone_overlap|ZONE_OVERLAP_DUPLICATE|1|"]],
];

const duplicate = (partners: string[], extra: Record<string, unknown> = {}) =>
  fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE", { details: { partners: partners.map((item_id) => ({ item_id })) }, ...extra });

const REOPEN_CASES: Array<[string, unknown, unknown, boolean]> = [
  ["a failure the line did not have", [], [duplicate([A])], true],
  ["the same failure computed again", [duplicate([A])], [duplicate([A])], false],
  ["a failure that disappears closes by itself", [duplicate([A])], [], false],
  ["a new partner", [duplicate([A])], [duplicate([A, B])], true],
  ["a partner that leaves", [duplicate([A, B])], [duplicate([A])], false],
  ["a new version of the rule", [duplicate([A])], [duplicate([A], { version: 2 })], true],
  ["another code of the rule", [duplicate([A])], [fail("zone_overlap", "ZONE_OVERLAP_UNREGISTERED")], true],
  ["one failure of two left", [duplicate([A]), fail("room_overlap", "ROOM_OVERLAP")], [fail("room_overlap", "ROOM_OVERLAP")], false],
  ["stored results that are not a list", { broken: true }, [duplicate([A])], true],
  ["results to write that are not a list", [duplicate([A])], "broken", false],
  ["a passed rule that fails", [{ rule: "area_printed", status: "pass", code: "AREA_PRINTED_CONSISTENT", version: 1,
    acceptable: true, reason: "" }], [fail("area_printed", "AREA_PRINTED_MISMATCH")], true],
  ["the same identifier in capitals", [duplicate([B])], [duplicate([B_UPPER])], false],
];

describe("rule failure keys (TS = SQL takeoff_rule_failure_keys)", () => {
  it.each(FAILURE_KEY_CASES)("%s", (_name, results, expected) => {
    expect(ruleFailureKeys(results)).toEqual(expected);
  });

  it("reads a stored result as written, never through a schema", () => {
    const stored = JSON.parse(`[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":1.0}]`);
    expect(ruleFailureKeys(stored)).toEqual(["dn_network|DN_NETWORK_DN_MISSING|1|"]);
  });
});

describe("a computation reopens a verified line (TS = SQL takeoff_rule_failures_reopen)", () => {
  it.each(REOPEN_CASES)("%s", (_name, previous, next, expected) => {
    expect(ruleFailuresReopen(previous, next)).toBe(expected);
  });
});

describe("replaying a pending verification after the server saved a new revision", () => {
  const displayed = Array.from({ length: 50 }, (_, index) => `item-${index + 1}`);
  const firstDigest = "a".repeat(64);
  const changedDigest = "b".repeat(64);
  function truncated(ids: string[], digest?: string) {
    return [fail("zone_overlap", "ZONE_OVERLAP_DUPLICATE", { details: {
      partner_count: 51, partners: ids.map((item_id) => ({ item_id })),
      ...(digest ? { failure_keys_sha256: digest } : {}),
    } })];
  }

  it("stops replay when a hidden replacement changes the digest behind the identical 50 displayed IDs", () => {
    expect(ruleFailuresReopen(truncated(displayed, firstDigest), truncated(displayed, changedDigest))).toBe(true);
  });

  it("allows replay when the complete set is identical even if a different subset is displayed", () => {
    const reordered = ["hidden-51", ...displayed.slice(1)];
    expect(ruleFailuresReopen(truncated(displayed, firstDigest), truncated(reordered, firstDigest))).toBe(false);
  });

  it("does not replay after legacy truncation without a fingerprint", () => {
    expect(ruleFailuresReopen(truncated(displayed), truncated(displayed))).toBe(true);
    expect(ruleFailuresReopen(truncated(displayed), truncated(displayed, firstDigest))).toBe(true);
  });

  it("allows a provable reduction to a complete subset of previously visible IDs", () => {
    expect(ruleFailuresReopen(truncated(displayed, firstDigest), [duplicate(displayed.slice(0, 3))])).toBe(false);
    expect(ruleFailuresReopen(truncated(displayed, firstDigest), [])).toBe(false);
  });
});

// TI-686 D9: version 2 of the scale rule reopens every V given without a coded reason; the key still has no partner,
// so a page calibrated again but still contradicted keeps its reason.
describe("key of a scale failure", () => {
  it("carries version 2 of the rule and no partner", () => {
    const designation = "EF cuivre DN 22";
    const { results } = evaluateTakeoffRules({
      pages: [{ key: "p", job_id: "j", order: 1, level: "R+1", zone: null, anchors: null,
        scale: { status: "unverified", reason: "dimension_mismatch" } }],
      lines: [{ id: "i", job_id: "j", page_key: "p", designation, unit: "ml", quantity: 5, is_excluded: false, frozen: false,
        inputs: ruleInputsFromDesignation({ designation, unit: "ml", quantity: 5 }), geometry: null }],
    });
    expect(ruleFailureKeys(results.get("i")).filter((key) => key.startsWith("scale_dimension|")))
      .toEqual(["scale_dimension|SCALE_DIMENSION_MISMATCH|2|"]);
  });
});
