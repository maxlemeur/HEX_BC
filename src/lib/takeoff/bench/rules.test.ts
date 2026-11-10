import { describe, expect, it } from "vitest";

import { buildBenchReport, renderBenchReportMarkdown, type BenchReportMetadata } from "@/lib/takeoff/bench/report";
import { guardTiers } from "@/lib/takeoff/bench/rules";
import { GroupTruthFileSchema, ManifestDocumentSchema, TruthFileSchema, type GroupTruthFile, type ManifestDocument } from "@/lib/takeoff/bench/schemas";
import { buildScoreScopes, scoreScopes } from "@/lib/takeoff/bench/score";
import { assertRuleDataAligned, vectorItemRuleData } from "@/lib/takeoff/bench/vector-rules";
import { runVectorBench, type VectorBenchDocument } from "@/lib/takeoff/bench/vector-run";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { VectorGroupKey, VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { vectorItems } from "@/lib/takeoff/vectors/items";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";
import type { TakeoffItem } from "@/lib/takeoff/types";

// Ways the bench could misreport the rules of TI-664, written before the code.
// Every document, label and quantity is fictional:
// - a line is classed at high confidence while the guard blocks it (no
//   confidence, under the threshold) or a rule fails it, or a medium line is
//   taken as high;
// - a key is counted at high confidence with one uncertain line, or a key in
//   error at high confidence (out of tolerance, or invented) is not counted, or
//   still counted once a failed rule rejected its line;
// - the vector lines the rules read are not the items the bench scores (one
//   more or one less, in another order), so a result lands on another line;
// - two zone plans of one level and lot are not compared in a vector pass, or
//   compared across lots;
// - the report does not show the lines before and after the rules per plan.
// Found by the independent review, written before their fix:
// - the per-role counter before and after the rules was never checked (after
//   showing before, or main showing the reserve);
// - unreadable lines of one reason were one key: a rule rejecting one hid the
//   others' errors;
// - the alignment guard only compared counts.

function item(designation: string, quantity: number, confidence: number | undefined, extra: Partial<TakeoffItem> = {}): TakeoffItem {
  return { designation, quantity, unit: "ml", source_page: 1, confidence, evidence: "Fictional evidence", ...extra };
}

const failed: TakeoffRuleResult = { rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 1, acceptable: true, reason: "Fictional" };

describe("guard tiers on the bench", () => {
  it("classes lines as the apply guard would, then with their failed rules", () => {
    const items = [item("A", 1, undefined), item("B", 1, 0.3), item("C", 1, 0.6), item("D", 1, 0.9), item("E", 1, 0.95, { evidence: "" })];
    expect(guardTiers(items, null)).toEqual(["uncertain", "uncertain", "uncertain", "high", "rejected"]);
    expect(guardTiers(items, [[], [], [], [failed], []])).toEqual(["uncertain", "uncertain", "uncertain", "uncertain", "rejected"]);
  });
});

function manifestDocument(id: string, overrides: Record<string, unknown> = {}): ManifestDocument {
  const [lot, kind] = id.split("-");
  return ManifestDocumentSchema.parse({
    id, lot, kind, drive_id: `fixture-${id}`, original_title: `Fictional ${id}`, project: null, file_type: "pdf",
    file_size: 100, modified_time: "2026-01-06T10:00:00.000Z", raw_status: "binary", raw_path: `raw/${id}.pdf`,
    sha256: "0".repeat(64), structure_check: { status: "passed", method: "fixture", detail: null }, pages: 1,
    format: "A3", scale: "1/50", index: "A", vector: true, ocg_count: 0, level: "R+1", zone: "Z1", role: "truth",
    duplicate_of: null, notes: null, ...overrides,
  });
}

function truthOf(ids: string[], lines: Array<Record<string, unknown>>) {
  return {
    file: `truth/${ids.join("+")}.json`,
    truth: TruthFileSchema.parse({
      schema_version: 1, lot: "a", scope: ids.length === 1 ? "document" : "level", documents: ids, source_document: "a-devis-01",
      rules: "Fictional rule.",
      lines: lines.map((overrides, row) => ({
        kind: "network", zone: "Z1", level: "R+1", network: "EF", material: "cuivre", dn: "DN 22", organ: null, room: null,
        unit: "ml", quantity: 10, observable_on_plan: true,
        source: { document: "a-devis-01", sheet: "Lot", row: row + 1, row_basis: "workbook", text: "Fictional row" }, ...overrides,
      })),
    }),
  };
}

describe("high-confidence keys in error", () => {
  const document = manifestDocument("a-plan-01");
  const scopes = buildScoreScopes([truthOf(["a-plan-01"], [{}, { network: "ECS", quantity: 4 }])], [document]);
  const items = [item("EF cuivre DN 22", 14, 0.9), item("ECS cuivre DN 22", 4, 0.9), item("EP PVC DN 100", 3, 0.9)];
  const score = (tiers: Array<"rejected" | "uncertain" | "high">) =>
    scoreScopes(scopes, new Map([["a-plan-01", items]]), { tiers: new Map([["a-plan-01", tiers]]) })[0].confidence;

  it("counts a key out of tolerance and an invented one whose lines are all at high confidence", () => {
    const confidence = score(["high", "high", "high"]);
    expect(confidence).toMatchObject({ keys_high_confidence: 3, keys_high_confidence_error: 2, lines: { rejected: 0, uncertain: 0, high: 3 } });
    expect(confidence?.high_confidence_errors.map((entry) => entry.kind).sort()).toEqual(["invented", "out_of_tolerance"]);
  });

  it("no longer counts them once a line is uncertain or rejected", () => {
    expect(score(["uncertain", "high", "rejected"])).toMatchObject({ keys_high_confidence: 1, keys_high_confidence_error: 0 });
  });

  it("counts a key at high confidence only when all its lines are", () => {
    const lines = [item("EF cuivre DN 22", 7, 0.9), item("EF cuivre DN 22", 7, 0.9, { source_page: 2 })];
    const twoLines = (tiers: Array<"rejected" | "uncertain" | "high">) =>
      scoreScopes(scopes, new Map([["a-plan-01", lines]]), { tiers: new Map([["a-plan-01", tiers]]) })[0].confidence;
    expect(twoLines(["high", "uncertain"])).toMatchObject({ keys_high_confidence: 0, keys_high_confidence_error: 0 });
    expect(twoLines(["high", "high"])).toMatchObject({ keys_high_confidence: 1, keys_high_confidence_error: 1 });
  });

  it("counts each unreadable line as its own key, so that rejecting one hides no other", () => {
    const unreadable = [item("Vanne DN 23", 2, 0.9, { unit: "u" }), item("Clapet DN 23", 3, 0.9, { unit: "u" })];
    const both = (tiers: Array<"rejected" | "uncertain" | "high">) =>
      scoreScopes(scopes, new Map([["a-plan-01", unreadable]]), { tiers: new Map([["a-plan-01", tiers]]) })[0].confidence;
    expect(both(["high", "high"])).toMatchObject({ keys_high_confidence_error: 2 });
    expect(both(["rejected", "high"])).toMatchObject({ keys_high_confidence_error: 1 });
  });
});

/** An A3 sheet in points. */
const SHEET = { width: 1190.55, height: 841.89 };
const RED: VectorGroupKey = { layer: null, color: "#ff0000", width: 1, dash: null };
const GREY: VectorGroupKey = { layer: null, color: "#808080", width: 0.5, dash: null };
const RED_ID = "c:#ff0000|w:1|d:";

/** The bench's correspondence (truth/groups) that classes the red group as EF on page 1 of each document. */
function redIsEf(documents: readonly string[]): Map<string, GroupTruthFile> {
  return new Map(documents.map((document) => [document,
    GroupTruthFileSchema.parse({ schema_version: 1, document, groups: [{ page: 1, group: RED_ID, class: "EF" }] })]));
}

function text(str: string, x: number, y: number, width: number, height = 6): VectorText {
  return { str, x, y, width, height, angle: 0 };
}

/**
 * A fictional zone plan at 1/50: a grey building of 24 walls and three rooms, an EF copper DN 22 pipe and its label,
 * the drawing shifted by `shift` points on the sheet; the title block stays at its sheet place.
 */
function zonePlan(shift: number): VectorPageExtraction {
  const strokes: Array<{ group: number; points: Array<[number, number]> }> = [];
  for (let index = 0; index < 24; index += 1) strokes.push({ group: 1, points: [[80 + shift, 100 + index * 25], [380 + shift + (index % 4) * 40, 100 + index * 25]] });
  strokes.push({ group: 0, points: [[100 + shift, 400], [500 + shift, 400]] });
  const coordinates: number[] = [];
  const paths: VectorPath[] = strokes.map((stroke) => {
    const path = { group: stroke.group, start: coordinates.length / 2, count: stroke.points.length, closed: false };
    for (const [x, y] of stroke.points) coordinates.push(x, y);
    return path;
  });
  return {
    page: 1, pages: 1, width: SHEET.width, height: SHEET.height, userUnit: 1, rotate: 0, layers: [], groups: [RED, GREY],
    texts: [
      text("EF cuivre DN 22", 300 + shift, 396, 60), text("Bureau 101", 120 + shift, 140, 40), text("Archives", 160 + shift, 240, 40),
      text("Salle de réunion", 200 + shift, 340, 60), text("Échelle 1/50", 1000, 780, 50, 5), text("Format A3", 1000, 800, 40, 5),
    ],
    paths, points: Float32Array.from(coordinates),
    counts: { operators: 10, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 1, walk_ms: 1, text_ms: 1, total_ms: 3 }, memory: { max_rss_kb: 50_000, heap_used_mb: 20 },
  };
}

describe("rules in the vector pipeline", () => {
  it("refuses rule data that do not describe the items, line for line", () => {
    const items = [item("EF cuivre DN 22", 5, 0.9), item("Surface « Bureau »", 12, 0.9, { unit: "m2" })];
    const network = { inputs: { version: 1, source: "vector" as const, kind: "network" as const, network: "EF" as const, material: "cuivre" as const,
      dn: "DN 22", non_observable: null, model_quantity: 5 }, geometry: null };
    const surface = { inputs: { ...network.inputs, kind: "surface" as const, network: null, material: null, dn: null }, geometry: null };
    expect(() => assertRuleDataAligned(items, [network, surface], "fixture")).not.toThrow();
    expect(() => assertRuleDataAligned(items, [surface, network], "fixture")).toThrow(/does not describe/);
    // An unlabelled line is named by its network alone.
    expect(() => assertRuleDataAligned([item("EU/EV", 3, 0.5)], [{ ...network, inputs: { ...network.inputs, network: "EUV" as const } }], "fixture"))
      .not.toThrow();
  });

  it("gives the rules exactly the items the bench scores, in their order", () => {
    const reading = readVectorPage(zonePlan(0), { correspondences: new Map([[RED_ID, "EF"]]), correspondenceSource: "document" });
    const items = vectorItems(reading, "a-plan-01");
    const data = vectorItemRuleData(reading);
    expect(items.length).toBeGreaterThan(0);
    expect(data).toHaveLength(items.length);
    expect(data.map((entry) => entry.inputs.network)).toEqual(items.map((entry) => entry.designation.split(" ")[0]));
  });

  const metadata: BenchReportMetadata = {
    started_at: "2026-11-03T10:00:00.000Z", finished_at: "2026-11-03T10:01:00.000Z", command: ["npm", "run", "takeoff:bench"],
    cwd: "/fixture", env: {}, node: "v26.12.1", commit: "f".repeat(40), dirty: false,
    dataset: { sha256: "e".repeat(64), documents: [], skipped: [] }, profile: { model: null, reasoning_effort: null, unchanged: null },
  };

  function benchDocument(id: string, zone: string, lot = "a"): VectorBenchDocument {
    return { id, lot, role: "truth", bytes: new Uint8Array([37, 80, 68, 70]), sha256: "1".repeat(64), pages: 1, level: "R+1", zone };
  }

  it("fails the run drawn on both zone plans of one level and lot, and reports the lines before and after", async () => {
    const order = ["a-plan-01", "a-plan-02"];
    let call = 0;
    const plans = [zonePlan(0), zonePlan(150)];
    const result = await runVectorBench({
      documents: order.map((id, index) => benchDocument(id, index === 0 ? "Z1" : "Z2")), groups: redIsEf(order), repeat: 1,
      extract: async () => plans[call++],
    });
    const [pass] = result.run.couples[0].passes;
    const codes = pass.documents.map((document) => document.item_rules?.[0]?.find((entry) => entry.rule === "zone_overlap")?.code);
    expect(codes).toEqual(["ZONE_OVERLAP_DUPLICATE", "ZONE_OVERLAP_DUPLICATE"]);
    expect(result.vector.passes[0].registrations?.find((entry) => entry.page === "a-plan-02#1")?.registration).toMatchObject({ status: "registered" });

    const scopes = buildScoreScopes([truthOf(["a-plan-01", "a-plan-02"], [{}, { zone: "Z2" }])],
      [manifestDocument("a-plan-01"), manifestDocument("a-plan-02", { zone: "Z2" })]);
    const report = buildBenchReport({ metadata, run: result.run, scopes, noise: null, pipeline: "vector" });
    const rules = report.couples[0].passes[0].rules;
    expect(rules?.documents.map((entry) => [entry.id, entry.before.high, entry.after.high, entry.after.rejected]))
      .toEqual([["a-plan-01", 1, 0, 0], ["a-plan-02", 1, 0, 0]]);
    // Both zones read 7.06 m for 10 m each: two keys out of tolerance at high confidence before the rules, none after.
    expect(rules?.confidence.main.before).toMatchObject({ scopes: 1, keys_high_confidence: 2, keys_high_confidence_error: 2 });
    expect(rules?.confidence.main.after).toMatchObject({ scopes: 1, keys_high_confidence: 0, keys_high_confidence_error: 0 });
    expect(rules?.confidence.reserve.after).toMatchObject({ scopes: 0, keys_high_confidence_error: 0 });
    expect(renderBenchReportMarkdown(report)).toContain("### Règles fixes");
  });

  it("never compares the plans of two lots", async () => {
    let call = 0;
    const plans = [zonePlan(0), zonePlan(150)];
    const result = await runVectorBench({
      documents: [benchDocument("a-plan-01", "Z1"), benchDocument("b-plan-11", "Z2", "b")], groups: redIsEf(["a-plan-01", "b-plan-11"]), repeat: 1,
      extract: async () => plans[call++],
    });
    const codes = result.run.couples[0].passes[0].documents.map((document) => document.item_rules?.[0]?.find((entry) => entry.rule === "zone_overlap")?.code);
    expect(codes).toEqual(["ZONE_OVERLAP_NONE", "ZONE_OVERLAP_NONE"]);
  });
});
