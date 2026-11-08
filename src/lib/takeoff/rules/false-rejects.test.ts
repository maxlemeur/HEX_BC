import { describe, expect, it } from "vitest";

import { vectorItemRuleData } from "@/lib/takeoff/bench/vector-rules";
import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { ruleInputsFromDesignation, ruleInputsFromVectorRecord } from "@/lib/takeoff/rules/inputs";
import type { PageAnchors } from "@/lib/takeoff/rules/registration";
import type { TakeoffRuleInputs, TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { geometryWeight, vectorItemRecords } from "@/lib/takeoff/vectors/persistence";
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

  // Review of PR B: a quoted size alone (« "20/22" ») or an ID/OD pair closed by a quote still gave 22".
  it.each([`EF cuivre "20/22"`, "EF cuivre “20/22”", `EF cuivre 20/22"`])("reads %s as copper 20/22 too", (designation) => {
    const read = ruleInputsFromDesignation({ designation, unit: "ml", quantity: 10 });
    // Never the inch size 22" (the reader prints the last one « 20/22" », copper 20/22 as well).
    expect(read.dn).toMatch(/^20\/22/);
    const { results } = evaluateTakeoffRules({ pages: [], lines: [line("quoted", { page_key: null, designation, inputs: read })] });
    expect(rule(results, "quoted", "dn_network")?.code).toBe("DN_NETWORK_COMPATIBLE");
  });

  // Review of PR B (a false accept beside the fix): a quoted weld line was no quantity to enter.
  it("reads a quoted quantity the plan cannot show as one to enter", () => {
    expect(ruleInputsFromDesignation({ designation: `"Soudures acier DN 50"`, unit: "u", quantity: 48 }).non_observable).toBe("weld");
    expect(ruleInputsFromDesignation({ designation: "“Supports EF cuivre 20/22”", unit: "u", quantity: 12 }).non_observable).toBe("support");
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

  // Review of PR B, written before the fix: an overview only proposes a frame. Composed through it, two hops each
  // within 2 cm moved a far zone plan by more than the 5 cm a duplicate allows (an overview drawn 0.2 % off scale), and
  // pages already compared through a zone plan were rerouted through the overview once another page was left apart.
  describe("an overview drawn slightly off scale", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const building: Line4[] = [];
    for (let index = 0; index < 500; index += 1) {
      const [x, y, length] = [random() * 62 + 1, random() * 4 + 1, 1 + random() * 2.5];
      building.push(random() < 0.5 ? [x, y, x + length, y] : [x, y, x, y + length]);
    }
    const labels = Array.from({ length: 60 }, (_, index): [string, number, number] => [`Local ${index}`, 1 + index * 1.05, 1.5 + (index % 4)]);
    const within = (x0: number, x1: number) => ([a, , c]: Line4) => Math.min(a, c) >= x0 && Math.max(a, c) <= x1;
    const drawn = (lines: Line4[], texts: Array<[string, number, number]>, sx: number, scale = 1): PageAnchors => ({ version: 1,
      lines: lines.map(([a, b, c, d]): Line4 => [a * scale + sx, b * scale, c * scale + sx, d * scale]),
      texts: texts.map(([text, x, y]): [string, number, number] => [text, x * scale + sx, y * scale]) });
    const z1 = drawn(building.filter(within(0, 34)), labels.filter(([, x]) => x < 29), 0);
    const z3 = drawn(building.filter(within(18, 50)), labels.filter(([, x]) => (x > 18 && x < 29) || (x > 35 && x < 50)), -18);
    const z4 = drawn(building.filter(within(30, 66)), labels.filter(([, x]) => x > 35), -30);
    const run = (id: string, key: string, segment: Line4, dn = "DN 22") => line(id, { job_id: key.split("#")[0], page_key: key, quantity: 4,
      inputs: inputs({ dn, model_quantity: 4 }), geometry: { segments_m: [segment], polygon_m: null, length_m: 4, area_m2: null } });

    it.each([0.0015, 0.0018, 0.002])("never lets a duplicate through two hops of an overview %d off scale", (error) => {
      const pages = [page("z1#1", { order: 0, zone: "Z1", anchors: z1 }), page("ov#1", { order: 5_000, anchors: drawn(building, labels, -20, 1 + error) }),
        page("z4#1", { order: 10_000, zone: "Z4", anchors: z4 })];
      // The same 4 m run at x = 32 m of the building, on Z1 and on Z4.
      const { results } = evaluateTakeoffRules({ pages, lines: [run("z1", "z1#1", [32, 1.2, 32, 5.2]), run("z4", "z4#1", [2, 1.2, 2, 5.2])] });
      expect(rule(results, "z1", "zone_overlap")?.status).toBe("fail");
      expect(rule(results, "z4", "zone_overlap")?.status).toBe("fail");
    });

    it("keeps comparing pages joined through a zone plan in their own frame, whatever an overview printed first", () => {
      for (const error of [0.0015, 0.0019]) {
        const pages = [page("ov#1", { order: 0, anchors: drawn(building, labels, -20, 1 + error) }), page("z1#1", { order: 10, zone: "Z1", anchors: z1 }),
          page("z3#1", { order: 20, zone: "Z3", anchors: z3 }), page("z4#1", { order: 30, zone: "Z4", anchors: z4 }),
          page("z2#1", { order: 40, zone: "Z2", anchors: null })];
        const { results } = evaluateTakeoffRules({ pages, lines: [run("z1", "z1#1", [32, 1.2, 32, 5.2]), run("z4", "z4#1", [2, 1.2, 2, 5.2]),
          run("z3", "z3#1", [5, 1, 9, 1], "DN 28"), run("z2", "z2#1", [0, 0, 4, 0], "DN 28")] });
        expect(rule(results, "z1", "zone_overlap"), `${error}`).toMatchObject({ code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 4 } });
      }
    });
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
    // TI-680: a geometric non-overlap is still valid, but the quantity comparison requires an explicit printed basis.
    const { lines, results } = rulesOf(extraction([text("Hall sol net 96 m²", X0 + m(1), Y0 + m(1)), text("Bureau sol net 4 m²", X0 + m(4.3), Y0 + m(5))],
      [hall, office]));
    expect(lines.map((entry) => entry.id).sort()).toEqual(["Bureau sol net", "Hall sol net"]);
    for (const id of ["Hall sol net", "Bureau sol net"]) {
      expect(rule(results, id, "area_printed")?.status, id).toBe("pass");
      expect(rule(results, id, "room_overlap")?.code, id).toBe("ROOM_OVERLAP_NONE");
    }
  });

  it("keeps the holes in the bench's rule data and in the geometry's weight", () => {
    const reading = readVectorPage(extraction([text("Hall 96 m²", X0 + m(1), Y0 + m(1)), text("Bureau 4 m²", X0 + m(4.3), Y0 + m(5))],
      [hall, office]), { calibration: { page: 1, denominator: 50, source: "test" }, clock: () => 0 });
    const hallData = vectorItemRuleData(reading).find((entry) => entry.inputs.room === "Hall");
    expect(hallData?.geometry?.holes_m?.length).toBe(1);
    const hallRecord = vectorItemRecords(reading, { zone: "Z1", level: "R+1", source: "file_name" }).find((record) => record.room?.label === "Hall");
    const geometry = hallRecord?.geometry;
    expect(geometry?.holes_m?.length).toBe(1);
    if (!geometry) return;
    expect(geometryWeight(geometry)).toBe((geometry.polygon_m?.length ?? 0) / 2 + (geometry.holes_m ?? []).reduce((sum, hole) => sum + hole.length / 2, 0));
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
