import { describe, expect, it } from "vitest";

import { readItemKey, type BenchItemKey } from "@/lib/takeoff/bench/item-keys";
import { NETWORK_CODES, type MaterialCode, type NetworkCode } from "@/lib/takeoff/bench/keys";
import { TakeoffItemSchema } from "@/lib/takeoff/schemas";
import type { TakeoffItem } from "@/lib/takeoff/types";
import type { VectorPageExtraction, VectorText } from "@/lib/takeoff/vectors/extraction";
import { vectorItems } from "@/lib/takeoff/vectors/items";
import type { MeasuredNetwork } from "@/lib/takeoff/vectors/measure";
import { readVectorPage, type VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import type { RoomSurface } from "@/lib/takeoff/vectors/surfaces";
import { parsePipeLabel } from "@/lib/takeoff/vectors/vocabulary";

// Ways the takeoff items of a vector reading (TI-662) could fail the bench or
// the import, written from the module contract before the tests. Codes are
// generic, rooms and lengths fictional:
// - a network total is printed so that the bench reader (item-keys.ts) reads
//   another key: EUV printed « EUV » or « EU EV » (read as two networks), a
//   supply code losing its direction (CHW-S read as CHW), a material label the
//   reader takes for another material or for a network, a DN lost;
// - any network the measure may give, with any material the label vocabulary
//   reads, does not read back as that network and material with its DN;
// - an insulated total gets no insulation item, or one of the pipe's whole
//   length instead of its insulated length, or the pipe item loses that
//   length; the insulation item does not read back as network × calorifuge × DN;
// - a total without measurable scale (length_m null), or of a few millimetres,
//   becomes an item of no or zero quantity;
// - a room without closed polygon gets an item from its printed surface, or a
//   room with one gets the printed surface instead of the polygon area, or
//   does not read back as that room;
// - confidence is 0.9 without DN or without material (it must be 0.5 « à
//   revoir »), or 0.5 with both;
// - source_page or source_file is missing, so the item cannot be located, or
//   an item breaks the takeoff item schema (strict, quantity > 0);
// - read end to end (readVectorPage on a small page at a calibrated 1/50), a
//   labelled EU/EV pipe and a closed room do not give their two items.

function scale(denominator: number | null): VectorPageReading["scale"] {
  return {
    rule_version: 1, status: denominator === null ? "unverified" : "verified", reason: denominator === null ? "no_scale" : null,
    denominator, cartouche: denominator === null ? null : { denominator, text: `Échelle 1/${denominator}`, labelled: true },
    candidates: denominator === null ? [] : [denominator],
    format: { cartouche: null, cartouche_mm: null, page_mm: [1189, 841], matches: null }, cotes: [], calibration: null,
  };
}

function reading(input: { page?: number; denominator: number | null; totals?: MeasuredNetwork[]; surfaces?: RoomSurface[] }): VectorPageReading {
  return {
    version: 1, page: input.page ?? 1, mode: "layers", size_pt: [3370.39, 2383.94], userUnit: 1, rotate: 0,
    counts: { operators: 0, strokePaths: 0, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0, texts: 0, groups: 0, groups_visible: 0 },
    scale: scale(input.denominator), legend: { version: 1, entries: [], colors: [], boxes: [] }, groups: [], detection: null,
    networks: {
      rule_version: 1, runs: [], totals: input.totals ?? [],
      excluded: { legend_boxes: [], diagram_frames: [], segments: 0 },
      labels: { blocks: 0, attached: 0, unattached: 0, superposed: 0, incomplete: 0 },
    },
    surfaces: input.surfaces ?? [],
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0, reading_ms: 0 },
    memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

function total(network: NetworkCode, material: MaterialCode | null, dn: number | null, length_m: number | null, insulated_m: number | null = 0): MeasuredNetwork {
  return { network, material, dn, runs: 2, length_pt: 0, length_m, insulated_pt: 0, insulated_m: length_m === null ? null : insulated_m };
}

function surface(room: string, printed_m2: number, polygon_m2: number | null): RoomSurface {
  return { room, printed_m2, anchor: { x: 0, y: 0 }, polygon_m2, polygon_points: polygon_m2 === null ? null : 5,
    outline: polygon_m2 === null ? null : { group: "oc:oc2", points: [0, 0, 10, 0, 10, 10, 0, 10, 0, 0] },
    deviation: polygon_m2 === null ? null : (polygon_m2 - printed_m2) / printed_m2 };
}

/** The bench key of an item, failing with the reading when it is not read. */
function keyOf(item: TakeoffItem, rooms: readonly string[] = []): BenchItemKey {
  const read = readItemKey({ designation: item.designation, unit: item.unit, category: item.category, evidence: item.evidence }, { rooms });
  if (read.status !== "read") throw new Error(`« ${item.designation} » is not read: ${JSON.stringify(read)}`);
  return read.key;
}

function dnEntries(key: BenchItemKey) {
  return key.dn === null ? null : key.dn.entries.map((entry) => `${entry.family}:${entry.od_mm}`).sort();
}

describe("vectorItems", () => {
  it("prints an EUV total as « EU/EV PVC DN 40 », read back as EUV, PVC, DN 40 in ml", () => {
    const items = vectorItems(reading({ denominator: 50, totals: [total("EUV", "pvc", 40, 12.3456)] }), "a-plan-01");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ designation: "EU/EV PVC DN 40", quantity: 12.35, unit: "ml" });
    const key = keyOf(items[0]);
    expect(key).toMatchObject({ kind: "network", network: "EUV", material: "pvc", unit: "ml" });
    expect(dnEntries(key)).toEqual(["pvc:40"]);
  });

  it("prints a chilled water supply total so that it reads back CHW-S, inox 316L, DN 22", () => {
    const [item] = vectorItems(reading({ denominator: 50, totals: [total("CHW-S", "inox-316l", 22, 7.5)] }), "a-plan-01");
    expect(item.designation).toBe("CHW-S Inox 316L DN 22");
    const key = keyOf(item);
    expect(key).toMatchObject({ kind: "network", network: "CHW-S", material: "inox-316l", unit: "ml" });
    expect(dnEntries(key)).toEqual(["inox-sertir:22"]);
  });

  it("reads back every network with every material the label vocabulary reads, with its DN", () => {
    // Printed material spellings of plan labels, with a DN their series has.
    const printed: Array<[label: string, dn: number]> = [
      ["Inox 316L", 22], ["Inox 304L", 22], ["inox", 22], ["PVC pression", 40], ["PVC", 40], ["multicouche", 20], ["PER", 16],
      ["PEHD", 32], ["cuivre", 22], ["fonte", 100], ["galva", 25], ["acier noir", 25], ["acier", 25],
    ];
    const materials = printed.map(([label, dn]) => ({ material: parsePipeLabel(`EF - ${label} DN ${dn}`).material, dn }));
    expect(materials.every((entry) => entry.material !== null)).toBe(true);
    expect(new Set(materials.map((entry) => entry.material)).size).toBe(printed.length);
    const misread: string[] = [];
    for (const network of NETWORK_CODES) {
      for (const { material, dn } of materials) {
        const [item] = vectorItems(reading({ denominator: 50, totals: [total(network, material, dn, 3)] }), "a-plan-01");
        const read = readItemKey({ designation: item.designation, unit: item.unit, category: item.category, evidence: item.evidence }, { rooms: [] });
        const ok = read.status === "read" && read.key.network === network && read.key.material === material && read.key.dn !== null;
        if (!ok) misread.push(`${network} ${material} DN ${dn} → « ${item.designation} » ${JSON.stringify(read)}`);
      }
    }
    expect(misread).toEqual([]);
  });

  it("adds an insulation item of the insulated length to an insulated total, the pipe keeping its whole length", () => {
    const items = vectorItems(reading({ denominator: 50, totals: [total("HW", "acier-noir", 32, 18.4, 11.25)] }), "a-plan-01");
    expect(items.map(({ designation, quantity, unit }) => ({ designation, quantity, unit }))).toEqual([
      { designation: "HW acier noir DN 32", quantity: 18.4, unit: "ml" },
      { designation: "HW calorifuge DN 32", quantity: 11.25, unit: "ml" },
    ]);
    expect(keyOf(items[1])).toMatchObject({ kind: "network", network: "HW", material: "calorifuge", unit: "ml" });
    expect(dnEntries(keyOf(items[1]))).toContain("acier:42.4");
    for (const network of NETWORK_CODES) {
      const insulation = vectorItems(reading({ denominator: 50, totals: [total(network, "cuivre", 22, 4, 4)] }), "a-plan-01")[1];
      expect(keyOf(insulation)).toMatchObject({ network, material: "calorifuge" });
    }
    const bare = vectorItems(reading({ denominator: 50, totals: [total("HW", "acier-noir", 32, 18.4, 0)] }), "a-plan-01");
    expect(bare.map((item) => item.designation)).toEqual(["HW acier noir DN 32"]);
  });

  it("gives no item for a total without measurable scale or of a few millimetres", () => {
    const unmeasured = vectorItems(reading({
      denominator: null, totals: [total("EF", "cuivre", 22, null), total("HW", "acier-noir", 32, null, null)],
      surfaces: [surface("Infirmerie", 13.62, null)],
    }), "a-plan-01");
    expect(unmeasured).toEqual([]);
    const tiny = vectorItems(reading({ denominator: 50, totals: [total("EF", "cuivre", 22, 0.004, 0.004)] }), "a-plan-01");
    expect(tiny).toEqual([]);
  });

  it("gives a room surface item only for a room with a closed polygon, of the polygon area", () => {
    const items = vectorItems(reading({
      denominator: 50, surfaces: [surface("Infirmerie", 13.62, 14), surface("circulation", 84.95, null)],
    }), "a-plan-01");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: 14, unit: "m2" });
    expect(keyOf(items[0], ["Infirmerie", "Circulation"])).toMatchObject({ kind: "surface", room: "Infirmerie", unit: "m2" });
  });

  it("gives confidence 0.9 with DN and material, 0.5 without one of them", () => {
    const items = vectorItems(reading({
      denominator: 50,
      totals: [total("EF", "cuivre", 22, 10), total("EF", null, 22, 9), total("EF", "cuivre", null, 8), total("EF", null, null, 7)],
    }), "a-plan-01");
    expect(items.map(({ designation, confidence }) => ({ designation, confidence }))).toEqual([
      { designation: "EF cuivre DN 22", confidence: 0.9 },
      { designation: "EF DN 22", confidence: 0.5 },
      { designation: "EF cuivre", confidence: 0.5 },
      { designation: "EF", confidence: 0.5 },
    ]);
  });

  it("locates every item on its page and file, within the takeoff item schema", () => {
    const items = vectorItems(reading({
      page: 3, denominator: 50,
      totals: [total("EUV", "pvc", 100, 21.5), total("HW", "acier-noir", 32, 6, 6), total("EF", "cuivre", 22, 0.012)],
      surfaces: [surface("Infirmerie", 13.62, 14)],
    }), "b-plan-02");
    expect(items).toHaveLength(5);
    for (const item of items) {
      expect(item).toMatchObject({ source_page: 3, source_file: "b-plan-02" });
      expect(TakeoffItemSchema.safeParse(item).success).toBe(true);
    }
  });

  it("gives the items of a small page read end to end at a calibrated 1/50", () => {
    const pt = (metres: number) => ((metres * 1000) / 50) * (72 / 25.4);
    const text = (str: string, x: number, y: number): VectorText => ({ str, x, y, width: str.length * 1.4, height: 2.5, angle: 0 });
    // A 4 m EU/EV pipe labelled inline, and a 4 m × 3.5 m room outlined on the wall layer, away from it.
    const coordinates = [100, 400, 100 + pt(4), 400, 100, 100, 100 + pt(4), 100, 100 + pt(4), 100 + pt(3.5), 100, 100 + pt(3.5), 100, 100];
    const extraction: VectorPageExtraction = {
      page: 1, pages: 1, width: 841.89, height: 595.28, userUnit: 1, rotate: 0,
      layers: [{ id: "oc1", name: "RES_EU-EV", visible: true }, { id: "oc2", name: "MURS", visible: true }],
      groups: [{ layer: "oc1", color: "#7a3f00", width: 0.35, dash: null }, { layer: "oc2", color: "#000000", width: 0.5, dash: null }],
      texts: [text("EU/EV - PVC DN 40", 150, 397), text("Infirmerie 13.62m²", 150, 200)],
      paths: [{ group: 0, start: 0, count: 2, closed: false }, { group: 1, start: 2, count: 5, closed: true }],
      points: Float32Array.from(coordinates),
      counts: { operators: 0, strokePaths: 2, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
      timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 },
      memory: { max_rss_kb: 0, heap_used_mb: 0 },
    };
    const page = readVectorPage(extraction, { calibration: { page: 1, denominator: 50, source: "fictional" }, clock: () => 0 });
    const items = vectorItems(page, "a-plan-01");
    expect(items.map(({ designation, quantity, unit, confidence }) => ({ designation, quantity, unit, confidence }))).toEqual([
      { designation: "EU/EV PVC DN 40", quantity: 4, unit: "ml", confidence: 0.9 },
      { designation: "Surface « Infirmerie »", quantity: 14, unit: "m2", confidence: 0.9 },
    ]);
    expect(keyOf(items[0])).toMatchObject({ network: "EUV", material: "pvc" });
    expect(keyOf(items[1], ["Infirmerie"])).toMatchObject({ kind: "surface", room: "Infirmerie" });
  });
});
