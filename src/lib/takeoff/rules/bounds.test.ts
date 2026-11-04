import { describe, expect, it } from "vitest";

import { isRuleBlocked } from "@/lib/takeoff/rules/blocking";
import { TakeoffRuleResultsSchema, boundRuleResults } from "@/lib/takeoff/rules/contracts";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import { pageAnchors } from "@/lib/takeoff/rules/registration";
import type { TakeoffRuleResult, ZoneOverlapPartner } from "@/lib/takeoff/rules/types";
import type { VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";

// Byte bounds of the rule columns, checked before the write (TI-677, prerequisites of MERGEONE_TAKEOFF_RULES=1).
// The database refuses rule_results over 65,536 bytes and rule_anchors over 262,144 bytes (octet_length of the jsonb
// text). Ways a write could still fail, written before the code (all values fictional):
// - a duplicate in a large group: 50 partners with 500-character multibyte designations and a 1,000-character reason
//   give about 80 KB, and every line of the 400-line write chunk stays stale (Codex #160, thread 4467409549);
// - a room overlapping thousands of rooms lists every id;
// - bounding changes what blocks: a code, a status, « acceptable », the length counted twice or the group size;
// - bounding trims results that already fit;
// - a text-heavy page: 1,500 printed texts of 80 multibyte characters give about 400 KB of anchors, the page insert
//   fails and the worker discards the job's whole vector reading (Codex #160, thread 4467830243);
// - a text the database cannot store (a NUL, a lone surrogate) is kept as an anchor and fails the insert.

const RESULTS_MAX_BYTES = 65_536;
const ANCHORS_MAX_BYTES = 262_144;

/** Bytes of JSON.stringify: a lower bound of the jsonb text (which adds a space after each separator). */
function lowerBound(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function uuid(index: number) {
  return `9f000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function partner(index: number): ZoneOverlapPartner {
  return { item_id: uuid(index), job_id: uuid(9000), zone: "Zone 2", designation: `${"管".repeat(494)}${String(index).padStart(6, "0")}`,
    overlap_m: 10 - index * 0.1, resolved: false };
}

const DN_PASS: TakeoffRuleResult = { rule: "dn_network", status: "pass", code: "DN_NETWORK_COMPATIBLE", version: 1, acceptable: true,
  reason: "DN 22 en cuivre compatible avec le réseau EF.", details: { network: "EF", material: "cuivre", dn: "DN 22" } };

const GROUP_DUPLICATE: TakeoffRuleResult = { rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 101,
  acceptable: true, reason: "管".repeat(1000),
  details: { level: "R+1", partners: Array.from({ length: 50 }, (_, index) => partner(index)), overlap_m: 3.2, group_size: 51 } };

const ROOMS_OVERLAP: TakeoffRuleResult = { rule: "room_overlap", status: "fail", code: "ROOM_OVERLAP", version: 1, acceptable: true,
  reason: "Ce contour recouvre 3000 autres pièces de la page sur 12,50 m².",
  details: { overlapping_item_ids: Array.from({ length: 3000 }, (_, index) => uuid(index)), overlap_m2: 12.5 } };

function expectSameDecision(bounded: readonly TakeoffRuleResult[], original: readonly TakeoffRuleResult[]) {
  expect(bounded.map(({ rule, status, code, version, acceptable }) => ({ rule, status, code, version, acceptable })))
    .toEqual(original.map(({ rule, status, code, version, acceptable }) => ({ rule, status, code, version, acceptable })));
  for (const verified of [false, true]) expect(isRuleBlocked(bounded, false, verified)).toBe(isRuleBlocked(original, false, verified));
}

describe("rule results within the column's byte budget", () => {
  it("bounds a large group of multibyte duplicates under 64 KiB, keeping what decides and guides the line", () => {
    const original = [DN_PASS, GROUP_DUPLICATE];
    const bounded = boundRuleResults(original);
    expect(lowerBound(bounded)).toBeLessThanOrEqual(RESULTS_MAX_BYTES);
    expect(jsonbTextBytes(bounded)).toBeLessThanOrEqual(RESULTS_MAX_BYTES);
    expect(TakeoffRuleResultsSchema.parse(bounded)).toEqual(bounded);
    expectSameDecision(bounded, original);
    const details = bounded[1].details;
    expect(details).toMatchObject({ level: "R+1", overlap_m: 3.2, group_size: 51 });
    // The partners kept are the first ones (largest common length first), with their ids, lengths and states.
    const kept = details?.partners ?? [];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.map(({ item_id, job_id, zone, overlap_m, resolved }) => ({ item_id, job_id, zone, overlap_m, resolved })))
      .toEqual(GROUP_DUPLICATE.details?.partners?.slice(0, kept.length)
        .map(({ item_id, job_id, zone, overlap_m, resolved }) => ({ item_id, job_id, zone, overlap_m, resolved })));
  });

  it("bounds a room overlapping thousands of rooms, keeping the overlapping area", () => {
    const bounded = boundRuleResults([ROOMS_OVERLAP]);
    expect(lowerBound(bounded)).toBeLessThanOrEqual(RESULTS_MAX_BYTES);
    expect(jsonbTextBytes(bounded)).toBeLessThanOrEqual(RESULTS_MAX_BYTES);
    expectSameDecision(bounded, [ROOMS_OVERLAP]);
    expect(bounded[0].details?.overlap_m2).toBe(12.5);
    const ids = bounded[0].details?.overlapping_item_ids ?? [];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(ROOMS_OVERLAP.details?.overlapping_item_ids?.slice(0, ids.length));
  });

  it("bounds sixteen failed results at once", () => {
    const original = Array.from({ length: 16 }, () => GROUP_DUPLICATE);
    const bounded = boundRuleResults(original);
    expect(jsonbTextBytes(bounded)).toBeLessThanOrEqual(RESULTS_MAX_BYTES);
    expectSameDecision(bounded, original);
  });

  // Review of TI-677: past seven rules at their caps the ladder ran out and threw; the line then kept its stored state,
  // which is not stale when only the rules changed (a deploy). The last bound keeps what decides and guides only.
  it("bounds sixteen results with every field at its cap and free text in their details, never throwing", () => {
    const capped: TakeoffRuleResult = { ...GROUP_DUPLICATE, reason: "😀".repeat(500),
      details: { level: "R+1", overlap_m: 3.2, group_size: 51, cause: "😀".repeat(2000), scale_reason: "管".repeat(3000),
        partners: Array.from({ length: 50 }, (_, index) => ({ ...partner(index), designation: "😀".repeat(250), zone: "😀".repeat(8) })),
        overlapping_item_ids: Array.from({ length: 3000 }, (_, index) => uuid(index)), overlap_m2: 12.5 } };
    const original = Array.from({ length: 16 }, () => capped);
    const bounded = boundRuleResults(original);
    expect(jsonbTextBytes(bounded)).toBeLessThanOrEqual(RESULTS_MAX_BYTES);
    expect(TakeoffRuleResultsSchema.parse(bounded)).toEqual(bounded);
    expectSameDecision(bounded, original);
    for (const entry of bounded) expect(entry.details).toMatchObject({ level: "R+1", overlap_m: 3.2, group_size: 51, overlap_m2: 12.5 });
  });

  it("leaves results that already fit as they are", () => {
    const small = [DN_PASS, { ...GROUP_DUPLICATE, reason: "Tronçon compté aussi en Zone 2.",
      details: { level: "R+1", partners: [partner(1), partner(2)].map((entry) => ({ ...entry, designation: "EF cuivre 20/22" })),
        overlap_m: 1, group_size: 3 } }];
    expect(boundRuleResults(small)).toEqual(small);
  });
});

/** A page of `texts` printed texts (each printed once, 80 characters) and `lines` grey building lines, read at 1/50. */
function extraction(input: { texts: string[]; lines: number }): Pick<VectorPageExtraction, "texts" | "paths" | "points" | "groups" | "layers"> {
  const points = new Float32Array(input.lines * 4);
  for (let index = 0; index < input.lines; index += 1) points.set([index, 0, index, 100], index * 4);
  return {
    layers: [],
    groups: [{ layer: null, color: "#808080", width: 0.1, dash: null }],
    texts: input.texts.map((str, index) => ({ str, x: index, y: index % 100, width: 10, height: 2, angle: 0 })),
    paths: Array.from({ length: input.lines }, (_, index) => ({ group: 0, start: index * 2, count: 2, closed: false })),
    points,
  };
}

describe("registration anchors within the column's byte budget", () => {
  it("bounds the anchors of a text-heavy page under 256 KiB, keeping every building line and the longest texts", () => {
    const texts = Array.from({ length: 1600 }, (_, index) => `${"管".repeat(74)}${String(index).padStart(6, "0")}`);
    const anchors = pageAnchors(extraction({ texts, lines: 1500 }), 50);
    expect(lowerBound(anchors)).toBeLessThanOrEqual(ANCHORS_MAX_BYTES);
    expect(jsonbTextBytes(anchors)).toBeLessThanOrEqual(ANCHORS_MAX_BYTES);
    expect(anchors.lines).toHaveLength(1500);
    // Texts of one length are kept in their order: a prefix, still enough to propose translations.
    expect(anchors.texts.length).toBeGreaterThanOrEqual(500);
    expect(anchors.texts.map(([text]) => text)).toEqual(texts.slice(0, anchors.texts.length));
  });

  it("keeps no text the database cannot store", () => {
    const texts = ["Salle\u0000 101", "Gaine \ud800", "Bureau 102", "Couloir 103"];
    const anchors = pageAnchors(extraction({ texts, lines: 30 }), 50);
    expect(anchors.texts.map(([text]) => text).sort()).toEqual(["Bureau 102", "Couloir 103"]);
    expect(Number.isFinite(jsonbTextBytes(anchors))).toBe(true);
  });
});
