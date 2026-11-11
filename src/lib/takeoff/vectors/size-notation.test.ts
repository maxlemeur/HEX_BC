import { describe, expect, it } from "vitest";

import { vectorItemRuleData } from "@/lib/takeoff/bench/vector-rules";
import { evaluateTakeoffRules, type RuleLine } from "@/lib/takeoff/rules/evaluate";
import { ruleInputsFromVector, ruleInputsFromVectorRecord } from "@/lib/takeoff/rules/inputs";
import type { VectorGroupKey, VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { vectorItems } from "@/lib/takeoff/vectors/items";
import { vectorItemRecords } from "@/lib/takeoff/vectors/persistence";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";
import { parsePipeLabel, printedSize } from "@/lib/takeoff/vectors/vocabulary";

// The printed notation of a size on a vector plan (TI-683, decision D7: « la notation imprimée est conservée »).
// Ways it could be lost between the label and the line the reviewer reads, written before the change. Codes are
// generic, lengths fictional:
// - the label reader keeps the number only: « Ø 110 » and « DN 110 » are one size from there on;
// - the measured line is printed « DN 110 » for a cast-iron pipe labelled « Ø 110 » (no cast iron has a DN 110), or
//   « Ø 100 » for one labelled « DN 100 »;
// - the rule inputs of the line say « DN 100 » for a stainless drainage pipe labelled « Ø 100 »: the DN rule then
//   reads the 110 mm tube of NF EN 1124 and asks for a justification, where the label names a size that series lacks;
// - two sections of one network labelled « DN 100 » and « Ø 100 » are added up as one size;
// - the insulation line of an insulated run loses the notation of its pipe;
// - the bench's rule data (the lines the bench runs the rules on) and the worker's records disagree on the notation;
// - a reading made before the notation was kept (no notation on its totals) no longer prints « DN n ».

const A3 = { width: 1190.55, height: 841.89 };
/** Sheet points that are 5 m on site at 1/50. */
const FIVE_M = 283.46;
const CALIBRATION = { page: 1, denominator: 50, source: "test" } as const;
const ORANGE = "#ff8000";

type Stroke = { color: string; points: readonly number[] };

function text(str: string, x: number, y: number, height = 6): VectorText {
  return { str, x, y, width: Math.round(0.55 * height * str.length * 100) / 100, height, angle: 0 };
}

/** One A3 page with a legend row « EU » in orange, the given orange strokes and labels. */
function page(strokes: readonly Stroke[], texts: readonly VectorText[]): VectorPageExtraction {
  const legend = text("EU", 40, 60, 8);
  const cy = legend.y - legend.height / 2;
  const all: Stroke[] = [{ color: ORANGE, points: [legend.x + legend.width + 10, cy, legend.x + legend.width + 50, cy] }, ...strokes];
  const groups: VectorGroupKey[] = [{ layer: null, color: ORANGE, width: 0.5, dash: null }];
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (const stroke of all) {
    paths.push({ group: 0, start: coordinates.length / 2, count: stroke.points.length / 2, closed: false });
    coordinates.push(...stroke.points);
  }
  return {
    page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0, layers: [], groups, texts: [legend, ...texts], paths,
    points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 },
    memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

const pipe = (x0: number, x1: number, y = 300): Stroke => ({ color: ORANGE, points: [x0, y, x1, y] });
const read = (extraction: VectorPageExtraction) => readVectorPage(extraction, { calibration: CALIBRATION, clock: () => 0 });
const location = { zone: "Z1", level: "R+1", source: "file_name" as const };

/** A run or a total as a reading wrote it before the notation was kept. */
function withoutNotation<T extends { notation?: unknown }>(value: T): Omit<T, "notation"> {
  const copy = { ...value };
  delete copy.notation;
  return copy;
}

function ruleLine(id: string, record: ReturnType<typeof vectorItemRecords>[number]): RuleLine {
  return { id, job_id: "job", page_key: "job#1", designation: record.item.designation, unit: record.item.unit, quantity: record.item.quantity,
    is_excluded: false, frozen: false, inputs: ruleInputsFromVectorRecord(record), geometry: null };
}

describe("printed size of a vector label (TI-683, D7)", () => {
  it("reads the notation a label prints its size in", () => {
    expect(parsePipeLabel("EU - Fonte DN 100")).toMatchObject({ dn: 100, notation: "DN" });
    expect(parsePipeLabel("EU - Fonte Ø 110")).toMatchObject({ dn: 110, notation: "Ø" });
    expect(parsePipeLabel("EU - Fonte ø110")).toMatchObject({ dn: 110, notation: "Ø" });
    expect(parsePipeLabel("EU - Fonte")).toMatchObject({ dn: null, notation: null });
    // An outer diameter keeps its decimals, as a « DN 76.1 » does: the welded Ø 42,4 is never the press-fit Ø 42.
    expect(parsePipeLabel("CHW - Inox Ø 42,4")).toMatchObject({ dn: 42.4, notation: "Ø" });
    expect(parsePipeLabel("CHW - Inox Ø 88.9")).toMatchObject({ dn: 88.9, notation: "Ø" });
    expect(parsePipeLabel("CHW - Inox ⌀ 42")).toMatchObject({ dn: 42, notation: "Ø" });
    expect(parsePipeLabel("CHW - Inox ∅42")).toMatchObject({ dn: 42, notation: "Ø" });
    expect(printedSize(110, "Ø")).toBe("Ø 110");
    expect(printedSize(100, "DN")).toBe("DN 100");
    expect(printedSize(22, null)).toBe("DN 22");
    expect(printedSize(22, undefined)).toBe("DN 22");
  });

  it("prints a cast-iron pipe labelled « Ø 110 » as « Ø 110 » on its line, its record and its rule inputs", () => {
    const reading = read(page([pipe(100, 100 + FIVE_M)], [text("EU - Fonte Ø 110", 150, 297)]));
    expect((reading.networks?.totals ?? []).map(({ network, material, dn, notation }) => ({ network, material, dn, notation })))
      .toEqual([{ network: "EU", material: "fonte", dn: 110, notation: "Ø" }]);
    expect(vectorItems(reading, "plan-fictif.pdf").map((item) => item.designation)).toEqual(["EU fonte SMU Ø 110"]);
    const records = vectorItemRecords(reading, location);
    expect(records.map((record) => record.item.designation)).toEqual(["EU fonte SMU Ø 110"]);
    expect(ruleInputsFromVectorRecord(records[0])).toMatchObject({ source: "vector", version: 2, network: "EU", material: "fonte", dn: "Ø 110" });
    expect(vectorItemRuleData(reading).map((datum) => datum.inputs.dn)).toEqual(["Ø 110"]);
    const { results } = evaluateTakeoffRules({ pages: [], lines: [ruleLine("cast", records[0])] });
    expect(results.get("cast")?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "pass", code: "DN_NETWORK_COMPATIBLE" });
  });

  it("keeps « DN 100 » for a pipe labelled « DN 100 », insulation included", () => {
    const reading = read(page([pipe(100, 100 + FIVE_M)], [text("EU - Fonte DN 100 +calo", 150, 297)]));
    expect(vectorItems(reading, "plan-fictif.pdf").map((item) => item.designation)).toEqual(["EU fonte SMU DN 100", "EU calorifuge DN 100"]);
    const outer = read(page([pipe(100, 100 + FIVE_M)], [text("EU - Fonte Ø 110 +calo", 150, 297)]));
    expect(vectorItems(outer, "plan-fictif.pdf").map((item) => item.designation)).toEqual(["EU fonte SMU Ø 110", "EU calorifuge Ø 110"]);
    expect(vectorItemRecords(outer, location).map((record) => [record.item.designation, ruleInputsFromVectorRecord(record).dn]))
      .toEqual([["EU fonte SMU Ø 110", "Ø 110"], ["EU calorifuge Ø 110", "Ø 110"]]);
  });

  it("fails a stainless drainage pipe labelled « Ø 100 » as out of series, never as the DN 100 tube to justify", () => {
    const outer = vectorItemRecords(read(page([pipe(100, 100 + FIVE_M)], [text("EU - Inox Ø 100", 150, 297)])), location);
    const nominal = vectorItemRecords(read(page([pipe(100, 100 + FIVE_M)], [text("EU - Inox DN 100", 150, 297)])), location);
    expect(outer.map((record) => record.item.designation)).toEqual(["EU Inox Ø 100"]);
    expect(nominal.map((record) => record.item.designation)).toEqual(["EU Inox DN 100"]);
    const { results } = evaluateTakeoffRules({ pages: [], lines: [ruleLine("outer", outer[0]), ruleLine("nominal", nominal[0])] });
    const rule = (id: string) => results.get(id)?.find((entry) => entry.rule === "dn_network");
    expect(rule("outer")).toMatchObject({ status: "fail", code: "DN_NETWORK_DN_NOT_IN_SERIES" });
    expect(rule("nominal")).toMatchObject({ status: "fail", code: "DN_NETWORK_MATERIAL_REQUIRES_JUSTIFICATION" });
  });

  it("reads a welded stainless « Ø 42,4 » as its own tube, and carries a notation to the unlabelled run joined to it", () => {
    const label = parsePipeLabel("CHW - Inox Ø 42,4");
    const welded = ruleInputsFromVector({ kind: "network", network: "CHW", material: label.material, dn: label.dn, notation: label.notation, quantity: 5 });
    expect(welded).toMatchObject({ version: 2, dn: "Ø 42.4" });
    const line: RuleLine = { id: "welded", job_id: "job", page_key: null, designation: "Ligne fictive", unit: "ml", quantity: 5, is_excluded: false,
      frozen: false, inputs: welded, geometry: null };
    expect(evaluateTakeoffRules({ pages: [], lines: [line] }).results.get("welded")?.find((entry) => entry.rule === "dn_network"))
      .toMatchObject({ code: "DN_NETWORK_COMPATIBLE", details: { size: { od_mm: 42.4, nominal_dn: 32 } } });
    // An elbow: the horizontal run is labelled, the vertical one joined to it is not and takes its size, notation included.
    const reading = read(page([pipe(100, 300), { color: ORANGE, points: [300, 300, 300, 500] }], [text("EU - Fonte Ø 110", 150, 297)]));
    expect((reading.networks?.totals ?? []).map(({ dn, notation }) => [dn, notation])).toEqual([[110, "Ø"]]);
    expect((reading.networks?.runs ?? []).every((run) => run.dn === 110 && run.notation === "Ø")).toBe(true);
    expect((reading.networks?.runs ?? []).length).toBeGreaterThan(1);
  });

  it("keeps apart two touching sections labelled « DN 100 » and « Ø 100 »", () => {
    // Two 100 pt sections touching at x 200, each labelled inline above itself.
    const reading = read(page([pipe(100, 200), pipe(200, 300)], [text("EU - PVC DN 100", 127, 297), text("EU - PVC Ø 100", 227, 297)]));
    const totals = (reading.networks?.totals ?? []).map(({ dn, notation }) => printedSize(dn as number, notation)).sort();
    expect(totals).toEqual(["DN 100", "Ø 100"]);
    expect(vectorItems(reading, "plan-fictif.pdf").map((item) => item.designation).sort()).toEqual(["EU PVC DN 100", "EU PVC Ø 100"]);
    expect(vectorItemRecords(reading, location).map((record) => record.geometry.segments_m.length)).toEqual([1, 1]);
  });

  it("prints « DN n » for a reading made before the notation was kept", () => {
    const reading = read(page([pipe(100, 100 + FIVE_M)], [text("EU - Fonte Ø 110", 150, 297)]));
    const before = { ...reading, networks: reading.networks && {
      ...reading.networks,
      runs: reading.networks.runs.map(withoutNotation),
      totals: reading.networks.totals.map(withoutNotation),
    } };
    expect(vectorItems(before, "plan-fictif.pdf").map((item) => item.designation)).toEqual(["EU fonte SMU DN 110"]);
    const [record] = vectorItemRecords(before, location);
    expect(record.item.designation).toBe("EU fonte SMU DN 110");
    // Without its notation the size is written as before and read either way: the cast-iron Ø 110 still passes.
    expect(ruleInputsFromVectorRecord(record)).toMatchObject({ version: 1, dn: "DN 110" });
    const { results } = evaluateTakeoffRules({ pages: [], lines: [ruleLine("before", record)] });
    expect(results.get("before")?.find((entry) => entry.rule === "dn_network")).toMatchObject({ code: "DN_NETWORK_COMPATIBLE" });
  });
});
