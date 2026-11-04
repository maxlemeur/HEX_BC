import { describe, expect, it } from "vitest";

import { ruleInputsFromVectorRecord } from "@/lib/takeoff/rules/inputs";
import type { MeasuredNetwork, NetworkRun } from "@/lib/takeoff/vectors/measure";
import {
  budgetVectorItems, VECTOR_GEOMETRY_LIMITS, VECTOR_PAGE_LIMITS, vectorItemRecords, vectorPageRecord, VectorPageRecordSchema, type VectorItemRecord,
  type VectorPageDecisions,
} from "@/lib/takeoff/vectors/persistence";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import type { RoomSurface } from "@/lib/takeoff/vectors/surfaces";

// Ways the persisted items of a vector reading (TI-662, review of PR #147)
// could stop matching their geometry, written before the fix. The army
// journeys (TKW08, TKW09) cover the persisted networks and room of a small
// plan; a network of thousands of centrelines is only reachable here. Lengths
// are fictional:
// - a network or insulation total of more than VECTOR_GEOMETRY_LIMITS.segments
//   centrelines keeps its whole quantity and length with only the first
//   centrelines: the drawn geometry is shorter than the measure it carries;
// - split into several items, a centreline is lost or repeated, an item goes
//   over the limit, or the parts do not add up to the measured total (quantity
//   rounded to the cm, length to the mm), or a part's quantity is not the
//   length of its own centrelines, or a part has a zero quantity (refused by
//   takeoff_items);
// - a total up to the limit is split, or loses its evidence or its rounding.
// The rooms the worker persists (written before the fix with the journeys):
// - a ring past VECTOR_GEOMETRY_LIMITS.polygon points fails the whole page
//   (the strict geometry schema) instead of keeping its measured area without
//   its outline (never a cut shape);
// - a room without closed polygon, or a room of a page whose scale is not
//   measurable or which is raster, is persisted.
// Review of these fixes (written before the fix):
// - a page of more rooms than its record keeps (VECTOR_PAGE_LIMITS.surfaces)
//   persists an item for each, beyond the rooms its record lists;
// - a job of many rooms and networks persists more geometries or segments
//   than its review reads (read-contracts.ts), so the whole viewer fails with
//   413 instead of showing the pages that fit.
// The Decisions summary of a page (worker, TI-662 L3d, written before the code):
// - a page row stored before it (no summary) no longer reads;
// - a summary holds an unknown stop, or an unbounded message.

function reading(input: { totals?: MeasuredNetwork[]; runs?: NetworkRun[]; surfaces?: RoomSurface[]; denominator?: number | null }): VectorPageReading {
  const denominator = input.denominator === undefined ? 50 : input.denominator;
  return {
    version: 1, page: 1, mode: "layers", size_pt: [3370.39, 2383.94], userUnit: 1, rotate: 0,
    counts: { operators: 0, strokePaths: 0, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0, texts: 0, groups: 0, groups_visible: 0, to_review: 0 },
    scale: {
      rule_version: 1, status: denominator === null ? "unverified" : "verified", reason: denominator === null ? "no_scale" : null, denominator,
      cartouche: denominator === null ? null : { denominator, text: `Échelle 1/${denominator}`, labelled: true },
      candidates: denominator === null ? [] : [denominator], format: { cartouche: null, cartouche_mm: null, page_mm: [1189, 841], matches: null },
      cotes: [], calibration: null,
    },
    legend: { version: 1, entries: [], colors: [], boxes: [] }, groups: [], detection: null,
    networks: {
      rule_version: 1, runs: input.runs ?? [], totals: input.totals ?? [],
      excluded: { legend_boxes: [], diagram_frames: [], segments: 0 },
      labels: { blocks: 0, attached: 0, unattached: 0, superposed: 0, incomplete: 0 },
    },
    surfaces: input.surfaces ?? [],
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0, reading_ms: 0 },
    memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

/** `count` separate 10 pt centrelines of EF cuivre DN 22, 300 per row, the first `insulated` of them insulated. */
function runs(count: number, insulated = 0): NetworkRun[] {
  return Array.from({ length: count }, (_, index) => {
    const x0 = 20 + (index % 300) * 12, y0 = 20 + Math.floor(index / 300) * 12;
    return { network: "EF", candidates: [], segment: { x0, y0, x1: x0 + 10, y1: y0 }, length_pt: 10, width_pt: 0, dn: 22, material: "cuivre",
      insulated: index < insulated, label: "EF - cuivre DN 22", attached: "propagated" };
  });
}

const location = { zone: "Z1", level: "R+1", source: "file_name" as const };
const drawn = (segments: ReadonlyArray<readonly [number, number, number, number]>) =>
  segments.reduce((sum, [x0, y0, x1, y1]) => sum + Math.hypot(x1 - x0, y1 - y0), 0);

describe("vectorItemRecords over the segment limit of a geometry", () => {
  it("keeps a total up to the segment limit as one record of all its centrelines", () => {
    // 4,000 runs of 10 pt at 1/50: 40,000 pt, 705.556 m.
    const [record, ...rest] = vectorItemRecords(reading({ runs: runs(4000),
      totals: [{ network: "EF", material: "cuivre", dn: 22, runs: 4000, length_pt: 40000, length_m: 705.556, insulated_pt: 0, insulated_m: 0 }] }), location);
    expect(rest).toEqual([]);
    expect(record.item).toMatchObject({ designation: "EF cuivre DN 22", quantity: 705.56,
      evidence: "Lecture vectorielle : 4000 tronçons d’axe, échelle 1/50 (verified)." });
    expect(record.geometry).toMatchObject({ kind: "network", length_m: 705.556 });
    expect(record.geometry.segments_m).toHaveLength(VECTOR_GEOMETRY_LIMITS.segments);
  });

  it("splits a network and its insulation over the limit into complete records adding up to the total", () => {
    // 4,500 runs of 10 pt at 1/50 (45,000 pt, 793.75 m), 4,320 of them insulated (43,200 pt, 762 m).
    const records = vectorItemRecords(reading({ runs: runs(4500, 4320),
      totals: [{ network: "EF", material: "cuivre", dn: 22, runs: 4500, length_pt: 45000, length_m: 793.75, insulated_pt: 43200, insulated_m: 762 }] }), location);
    const expected = [["network", "EF cuivre DN 22", 4500, 793.75], ["insulation", "EF calorifuge DN 22", 4320, 762]] as const;
    for (const [kind, designation, count, length] of expected) {
      const parts = records.filter((record) => record.geometry.kind === kind);
      expect(parts.length).toBeGreaterThan(1);
      // Every centreline once, no record over the limit, one designation (one bench key).
      expect(parts.every((record) => record.geometry.segments_m.length <= VECTOR_GEOMETRY_LIMITS.segments)).toBe(true);
      expect(parts.reduce((sum, record) => sum + record.geometry.segments_m.length, 0)).toBe(count);
      expect(new Set(parts.flatMap((record) => record.geometry.segments_m.map((segment) => segment.join())))).toHaveProperty("size", count);
      expect(new Set(parts.map((record) => record.item.designation))).toEqual(new Set([designation]));
      // The parts add up to the measured total; each quantity is the length of its own centrelines (endpoints kept to 0.1 mm).
      expect(Math.round(parts.reduce((sum, record) => sum + record.item.quantity, 0) * 100) / 100).toBe(length);
      expect(Math.round(parts.reduce((sum, record) => sum + (record.geometry.length_m ?? 0), 0) * 1000) / 1000).toBe(length);
      for (const { item, geometry } of parts) {
        expect(item.quantity).toBeGreaterThan(0);
        expect(Math.abs(item.quantity - (geometry.length_m ?? 0))).toBeLessThanOrEqual(0.01 + 1e-9);
        expect(Math.abs(drawn(geometry.segments_m) - (geometry.length_m ?? 0))).toBeLessThanOrEqual(0.001 + 1e-4 * geometry.segments_m.length);
      }
    }
  });
});

describe("vectorItemRecords, rooms (review of PR #147)", () => {
  function surface(room: string, printed_m2: number, polygon_m2: number | null, points = 5): RoomSurface {
    return { room, printed_m2, anchor: { x: 0, y: 0 }, polygon_m2, polygon_points: polygon_m2 === null ? null : points,
      outline: polygon_m2 === null ? null : { group: "oc:oc2", points: Array.from({ length: 2 * points }, (_, index) => index % 7) },
      deviation: polygon_m2 === null ? null : (polygon_m2 - printed_m2) / printed_m2, method: polygon_m2 === null ? null : "ring", fill_rejected: null };
  }

  it("carries each room's own printed surface to its rule inputs, two rooms alike in label and area included (Codex #160)", () => {
    // Two « Bureau » measured 10 m² each, printed 10 m² and 12 m²: the second was given the first's printed surface.
    const records = vectorItemRecords(reading({ surfaces: [surface("Bureau", 10, 10), surface("Bureau", 12, 10)] }), location);
    expect(records.map((record) => ruleInputsFromVectorRecord(record))).toMatchObject([
      { kind: "surface", room: "Bureau", printed_m2: 10 }, { kind: "surface", room: "Bureau", printed_m2: 12 },
    ]);
  });

  it("keeps the area of a ring past the bound without its outline, and persists no open, unscaled or raster room", () => {
    const hall = surface("Hall", 120, 118.5, VECTOR_GEOMETRY_LIMITS.polygon + 1);
    const office = surface("Bureau", 12.4, 12.5, VECTOR_GEOMETRY_LIMITS.polygon);
    const records = vectorItemRecords(reading({ surfaces: [hall, office, surface("circulation", 84.95, null)] }), location);
    expect(records.map(({ item, geometry }) => [item.designation, item.quantity, item.unit, geometry.kind, geometry.area_m2, geometry.polygon_m?.length ?? null]))
      .toEqual([
        ["Surface « Hall »", 118.5, "m2", "surface", 118.5, null],
        ["Surface « Bureau »", 12.5, "m2", "surface", 12.5, 2 * VECTOR_GEOMETRY_LIMITS.polygon],
      ]);
    expect(vectorItemRecords(reading({ denominator: null, surfaces: [{ ...surface("Hall", 120, null), outline: office.outline }] }), location)).toEqual([]);
    expect(vectorItemRecords({ ...reading({ surfaces: [office] }), mode: "raster" }, location)).toEqual([]);
  });
});

describe("vector items within the review's read limits (review of PR #147)", () => {
  const room = (index: number): RoomSurface => ({ room: `Pièce ${index}`, printed_m2: 10, anchor: { x: index, y: 0 }, polygon_m2: 10, polygon_points: 5,
    outline: { group: "oc:oc2", points: [0, 0, 10, 0, 10, 10, 0, 10, 0, 0] }, deviation: 0, method: "ring", fill_rejected: null });

  it("persists the rooms its page record keeps, never more", () => {
    const rooms = Array.from({ length: VECTOR_PAGE_LIMITS.surfaces + 1 }, (_, index) => room(index));
    const records = vectorItemRecords(reading({ surfaces: rooms }), location);
    expect(records).toHaveLength(VECTOR_PAGE_LIMITS.surfaces);
    expect(records.at(-1)?.item.designation).toBe(`Surface « Pièce ${VECTOR_PAGE_LIMITS.surfaces - 1} »`);
  });

  it("keeps the items of the pages that fit the job's limits, in page order, and drops a page's items as a whole", () => {
    const network = (segments: number): VectorItemRecord => ({
      item: { designation: "EF", quantity: 1, unit: "ml", confidence: 0.9, evidence: "", category: "réseau (lecture vectorielle)" },
      geometry: { schema_version: 1, kind: "network", network: "EF", material: null, dn: null, zone: null, level: null, groups: [],
        segments_m: Array.from({ length: segments }, () => [0, 0, 1, 0] as [number, number, number, number]), polygon_m: null, length_m: 1,
        area_m2: null, transform: null },
    });
    const surfaceItem = vectorItemRecords(reading({ surfaces: [room(0)] }), location)[0]; // a 5-point polygon: 5 edges
    const pages = [
      { page: 1, items: [network(6), surfaceItem], error: null }, // 2 geometries, 11 segments
      { page: 2, items: [network(10)], error: null }, // would reach 21 segments: dropped
      { page: 3, items: [network(4), network(1)], error: null }, // 4 geometries, 16 segments: fits
      { page: 4, items: [network(1)], error: null }, // a fifth geometry: dropped
      { page: 5, items: [], error: "extraction_timeout: fictional" },
    ];
    const budgeted = budgetVectorItems(pages, { geometries: 4, segments: 20 });
    expect(budgeted.map(({ page, items, error }) => [page, items.length, error])).toEqual([
      [1, 2, null],
      [2, 0, "item_budget: 1 geometries and 10 segments over the 4 geometries and 20 segments the review reads"],
      [3, 2, null],
      [4, 0, "item_budget: 1 geometries and 1 segments over the 4 geometries and 20 segments the review reads"],
      [5, 0, "extraction_timeout: fictional"],
    ]);
  });
});

describe("the Decisions summary of a page record (worker, TI-662 L3d)", () => {
  const summary: VectorPageDecisions = {
    prompt_version: "takeoff-vector-groups-v1", candidates: 3, eligible: 3, left_out: 0, dedicated_left_out: 0, calls: { batch: 1, dedicated: 1, failed: 1 },
    answered: 2, total_tokens: 1200, latency_ms: 900, stop: { reason: "call_failed", message: "Fictional failure.", from_earlier_page: false },
  };

  it("still reads a page row stored before it, and keeps the summary when given", () => {
    const before = vectorPageRecord(reading({}), location);
    expect(before).not.toHaveProperty("decisions");
    expect(VectorPageRecordSchema.parse(JSON.parse(JSON.stringify(before)))).toEqual(before);
    expect(vectorPageRecord(reading({}), location, summary).decisions).toEqual(summary);
  });

  it("refuses an unknown stop and cuts a long message to its bound", () => {
    const record = vectorPageRecord(reading({}), location, summary);
    expect(() => VectorPageRecordSchema.parse({ ...record, decisions: { ...summary, stop: { ...summary.stop, reason: "retry" } } })).toThrow();
    expect(() => VectorPageRecordSchema.parse({ ...record, decisions: { ...summary, evidence: {} } })).toThrow();
    const long = vectorPageRecord(reading({}), location, { ...summary, stop: { ...summary.stop!, message: "x".repeat(400) } });
    expect(long.decisions?.stop?.message).toHaveLength(300);
  });
});
