import { describe, expect, it } from "vitest";

import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { ruleInputsFromDesignation, ruleInputsFromVectorRecord } from "@/lib/takeoff/rules/inputs";
import type { PageAnchors } from "@/lib/takeoff/rules/registration";
import type { TakeoffRuleInputs, TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { vectorItemRecords } from "@/lib/takeoff/vectors/persistence";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";

// False rejects of the fixed rules (TI-677, PR B), written before the fixes. Each rejects a right line (the safe
// direction); each fix must keep rejecting the wrong one beside it. Plans, labels and sizes are fictional.
// - A closing quotation mark read as an inch mark: « "EF cuivre 20/22" » gave the size 22" and failed the DN rule
//   (Codex #153, thread 4467344863); the unquoted designation passed.
// - An overview page with the building's anchors but no network line left out of its level's registration: two zone
//   plans it joins were « non recalées » (Codex #153, thread 4467344882).
// - A cross-line failure (a duplicate, an overlapping room) kept by a line whose partners the mapping plan skips
//   (Codex #160, thread 4467409538): the results carry their partners and their count, so that a guard can tell when
//   every partner is left out (guards.test.ts, apply-server.test.ts, pgTAP takeoff-rule-cross-exclusions).
// - A room surrounding another enclosed room read as overlapping it: the fill's outline is the outer boundary of a
//   floor that leaves the inner room out (Codex #153, thread 4467241469).

function rule(results: Map<string, TakeoffRuleResult[]>, id: string, ruleId: TakeoffRuleResult["rule"]) {
  return results.get(id)?.find((entry) => entry.rule === ruleId);
}

function inputs(overrides: Partial<TakeoffRuleInputs> = {}): TakeoffRuleInputs {
  return { version: 1, source: "vector", kind: "network", network: "EF", material: "inox-316l", dn: "DN 22", non_observable: null,
    model_quantity: 5, ...overrides };
}

function line(id: string, overrides: Partial<RuleLine> = {}): RuleLine {
  return { id, job_id: "job-z1", page_key: "job-z1#1", designation: "EF Inox 316L DN 22", unit: "ml", quantity: 5, is_excluded: false,
    frozen: false, inputs: inputs(), geometry: null, ...overrides };
}

function page(key: string, overrides: Partial<RulePage> = {}): RulePage {
  return { key, job_id: key.split("#")[0], order: 0, level: "R+1", zone: null, scale: { status: "format", reason: null }, anchors: null,
    denominator: 50, ...overrides };
}

describe("quoted plan text read as the reader reads it", () => {
  it.each([`"EF cuivre 20/22"`, "“EF cuivre 20/22”", "EF cuivre 20/22"])("reads %s as copper 20/22, which the DN rule passes", (designation) => {
    const read = ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 });
    expect(read).toMatchObject({ kind: "network", network: "EF", material: "cuivre" });
    expect(read.dn).not.toMatch(/"/);
    const { results } = evaluateTakeoffRules({ pages: [], lines: [line("quoted", { page_key: null, designation, inputs: read })] });
    expect(rule(results, "quoted", "dn_network")?.code).toBe("DN_NETWORK_COMPATIBLE");
  });

  it("keeps an inch mark inside a quoted text, and a size no series has still fails", () => {
    expect(ruleInputsFromDesignation({ designation: `"EF acier noir 3/4" fileté"`, unit: "ml", quantity: 4 }).dn).toBe(`3/4"`);
    const unknown = ruleInputsFromDesignation({ designation: `"EF cuivre DN 23"`, unit: "ml", quantity: 4 });
    const { results } = evaluateTakeoffRules({ pages: [], lines: [line("unknown", { page_key: null, inputs: unknown })] });
    expect(rule(results, "unknown", "dn_network")?.status).toBe("fail");
  });
});

describe("level registration through a page without network lines", () => {
  type Line4 = [number, number, number, number];
  /** One building, its walls and room texts seen through a sheet shifted by sx; `texts` picks the texts printed. */
  function anchors(sx: number, texts: string[]): PageAnchors {
    const walls = Array.from({ length: 24 }, (_, index): Line4 => [10 + sx, 2 + index * 0.7, 13 + (index % 5) + sx, 2 + index * 0.7]);
    const all = ["Bureau 101", "Salle de réunion", "Archives", "Local technique", "Circulation C2", "Sanitaires H", "Sanitaires F", "Hall"];
    return { version: 1, lines: walls,
      texts: texts.map((text): [string, number, number] => [text, 10.5 + (all.indexOf(text) % 4) * 1.4 + sx, 3 + all.indexOf(text) * 1.6]) };
  }
  const zone1 = ["Bureau 101", "Salle de réunion", "Archives", "Local technique"];
  const zone2 = ["Circulation C2", "Sanitaires H", "Sanitaires F", "Hall"];
  // Z1 and Z2 share no text; the overview prints both zones' texts.
  const pages = [
    page("job-z1#1", { order: 0, zone: "Z1", anchors: anchors(0, zone1) }),
    page("job-ov#1", { order: 5_000, zone: null, anchors: anchors(-20, [...zone1, ...zone2]) }),
    page("job-z2#1", { order: 10_000, zone: "Z2", anchors: anchors(-40, zone2) }),
  ];
  const z1 = line("z1", { geometry: { segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null } });
  const z2 = (segment: Line4) => line("z2", { job_id: "job-z2", page_key: "job-z2#1", quantity: 3,
    geometry: { segments_m: [segment], polygon_m: null, length_m: 3, area_m2: null }, inputs: inputs({ model_quantity: 3 }) });

  it("registers two zone plans through the overview that joins them: distinct runs pass", () => {
    // Z2's run lies 30 m to 33 m of the building, far from Z1's 0 m to 5 m.
    const { results } = evaluateTakeoffRules({ pages, lines: [z1, z2([-10, 1, -7, 1])] });
    expect(rule(results, "z1", "zone_overlap")?.code).toBe("ZONE_OVERLAP_NONE");
    expect(rule(results, "z2", "zone_overlap")?.code).toBe("ZONE_OVERLAP_NONE");
  });

  it("still finds the length both zone plans draw, through the overview", () => {
    // Z2's run 4 m to 7 m of the building: 1 m in common with Z1's.
    const { results } = evaluateTakeoffRules({ pages, lines: [z1, z2([-36, 1, -33, 1])] });
    expect(rule(results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 1 } });
    expect(rule(results, "z2", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 1 } });
  });

  it("leaves two zone plans no page joins unregistered", () => {
    const { results } = evaluateTakeoffRules({ pages: [pages[0], pages[2]], lines: [z1, z2([-10, 1, -7, 1])] });
    expect(rule(results, "z1", "zone_overlap")?.code).toBe("ZONE_OVERLAP_UNREGISTERED");
  });
});

describe("cross-line failures name all their partners", () => {
  it("counts the partners of a duplicate and the rooms an outline overlaps, whatever the list keeps", () => {
    const pages = [page("job-z1#1", { zone: "Z1", anchors: null }), page("job-z1#2", { zone: "Z1", anchors: null })];
    const room = (id: string, polygon: number[]) => line(id, { unit: "m2", quantity: 4, designation: `Surface ${id}`,
      inputs: inputs({ kind: "surface", network: null, material: null, dn: null, model_quantity: 4 }),
      geometry: { segments_m: [], polygon_m: polygon, length_m: null, area_m2: 4 } });
    const { results } = evaluateTakeoffRules({ pages, lines: [
      room("a", [0, 0, 2, 0, 2, 2, 0, 2]), room("b", [1, 0, 3, 0, 3, 2, 1, 2]), room("c", [0, 1, 2, 1, 2, 3, 0, 3]),
    ] });
    expect(rule(results, "a", "room_overlap")).toMatchObject({ code: "ROOM_OVERLAP",
      details: { overlapping_item_ids: ["b", "c"], overlap_count: 2 } });
  });

  it("counts the partners of a duplicate", () => {
    const anchorsOf = (sx: number): PageAnchors => ({ version: 1,
      lines: Array.from({ length: 24 }, (_, index): [number, number, number, number] => [10 + sx, 2 + index * 0.7, 13 + (index % 5) + sx, 2 + index * 0.7]),
      texts: [["Bureau 101", 11 + sx, 3], ["Archives", 12 + sx, 6], ["Hall", 11.5 + sx, 9]] });
    const pages = [page("job-z1#1", { zone: "Z1", anchors: anchorsOf(0) }),
      page("job-z2#1", { order: 10_000, zone: "Z2", anchors: anchorsOf(-40) })];
    const { results } = evaluateTakeoffRules({ pages, lines: [
      line("z1", { geometry: { segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null } }),
      line("z2", { job_id: "job-z2", page_key: "job-z2#1", quantity: 3, inputs: inputs({ model_quantity: 3 }),
        geometry: { segments_m: [[-36, 1, -33, 1]], polygon_m: null, length_m: 3, area_m2: null } }),
    ] });
    expect(rule(results, "z1", "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { partner_count: 1 } });
    expect(rule(results, "z1", "zone_overlap")?.details?.partners?.map((partner) => partner.item_id)).toEqual(["z2"]);
  });
});

describe("a room surrounding another room", () => {
  const A3 = { width: 1190.55, height: 841.89 };
  const POINTS_PER_METRE_AT_50 = 72 / 25.4 / 50 * 1000;
  const m = (metres: number) => metres * POINTS_PER_METRE_AT_50;

  function text(str: string, x: number, y: number): VectorText {
    return { str, x, y, width: str.length * 1.5, height: 2.5, angle: 0 };
  }

  /** Walls as separate strokes on one wall layer; labels with their printed surfaces. */
  function extraction(texts: VectorText[], boxes: Array<[number, number, number, number]>): VectorPageExtraction {
    const coordinates: number[] = [];
    const paths: VectorPath[] = [];
    for (const [x0, y0, x1, y1] of boxes) {
      for (const points of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
        paths.push({ group: 0, start: coordinates.length / 2, count: 2, closed: false });
        coordinates.push(...points);
      }
    }
    return { page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0,
      layers: [{ id: "1R", name: "FICTIF_MURS", visible: true }], groups: [{ layer: "1R", color: "#000000", width: 0.25, dash: null }],
      texts, paths, points: Float32Array.from(coordinates),
      counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
      timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 } };
  }

  /** The page read by the vector pipeline, its rooms persisted, then the rules of the version. */
  function rulesOf(sheetPage: VectorPageExtraction) {
    const reading = readVectorPage(sheetPage, { calibration: { page: 1, denominator: 50, source: "test" }, clock: () => 0 });
    const records = vectorItemRecords(reading, { zone: "Z1", level: "R+1", source: "file_name" }).filter((record) => record.geometry.kind === "surface");
    const lines = records.map((record, index): RuleLine => ({ id: record.room?.label ?? `room-${index}`, job_id: "job-z1", page_key: "job-z1#1",
      designation: record.item.designation, unit: record.item.unit, quantity: record.item.quantity, is_excluded: false, frozen: false,
      inputs: ruleInputsFromVectorRecord(record), geometry: { segments_m: [], polygon_m: record.geometry.polygon_m, length_m: null,
        area_m2: record.geometry.area_m2, ...(record.geometry.holes_m ? { holes_m: record.geometry.holes_m } : {}) } }));
    return { lines, ...evaluateTakeoffRules({ pages: [page("job-z1#1", { zone: "Z1" })], lines }) };
  }

  const [X0, Y0] = [m(2), m(2)];
  const hall: [number, number, number, number] = [X0, Y0, X0 + m(10), Y0 + m(10)];
  const office: [number, number, number, number] = [X0 + m(4), Y0 + m(4), X0 + m(6), Y0 + m(6)];

  it("reads a hall of 10 × 10 m around an office of 2 × 2 m as two rooms side by side", () => {
    const { lines, results } = rulesOf(extraction([text("Hall 96 m²", X0 + m(1), Y0 + m(1)), text("Bureau 4 m²", X0 + m(4.3), Y0 + m(5))],
      [hall, office]));
    expect(lines.map((entry) => entry.id).sort()).toEqual(["Bureau", "Hall"]);
    for (const id of ["Hall", "Bureau"]) {
      expect(rule(results, id, "area_printed")?.status, id).toBe("pass");
      expect(rule(results, id, "room_overlap")?.code, id).toBe("ROOM_OVERLAP_NONE");
    }
  });

  it("still finds a room drawn over the hall's floor, beside the office it leaves out", () => {
    // A storeroom of 2 × 1.5 m inside the hall's floor, its label within it, overlapping nothing but the hall.
    const { results } = evaluateTakeoffRules({ pages: [page("job-z1#1", { zone: "Z1" })], lines: [
      line("hall", { unit: "m2", quantity: 96, designation: "Surface « Hall »", inputs: inputs({ kind: "surface", network: null, material: null, dn: null, model_quantity: 96 }),
        geometry: { segments_m: [], polygon_m: [0, 0, 10, 0, 10, 10, 0, 10], holes_m: [[4, 4, 6, 4, 6, 6, 4, 6]], length_m: null, area_m2: 96 } }),
      line("store", { unit: "m2", quantity: 3, designation: "Surface « Réserve »", inputs: inputs({ kind: "surface", network: null, material: null, dn: null, model_quantity: 3 }),
        geometry: { segments_m: [], polygon_m: [1, 1, 3, 1, 3, 2.5, 1, 2.5], length_m: null, area_m2: 3 } }),
      line("office", { unit: "m2", quantity: 4, designation: "Surface « Bureau »", inputs: inputs({ kind: "surface", network: null, material: null, dn: null, model_quantity: 4 }),
        geometry: { segments_m: [], polygon_m: [4, 4, 6, 4, 6, 6, 4, 6], length_m: null, area_m2: 4 } }),
    ] });
    expect(rule(results, "hall", "room_overlap")).toMatchObject({ code: "ROOM_OVERLAP", details: { overlapping_item_ids: ["store"] } });
    expect(rule(results, "store", "room_overlap")?.code).toBe("ROOM_OVERLAP");
    expect(rule(results, "office", "room_overlap")?.code).toBe("ROOM_OVERLAP_NONE");
  });
});
