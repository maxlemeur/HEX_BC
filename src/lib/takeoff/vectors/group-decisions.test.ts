import { describe, expect, it } from "vitest";

import type { OpenAiDecisionAnswer } from "@/lib/ai/decisions";
import { NETWORK_CODES } from "@/lib/takeoff/bench/keys";
import type { VectorGroupKey, VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import {
  aliasOf,
  decisionBatches,
  GROUP_DECISIONS_LIMITS,
  groupEvidence,
  groupQuestions,
  needsDedicated,
  nearestLabelTexts,
  readGroupAnswers,
  selectDecisionCandidates,
  type DecisionCandidate,
} from "@/lib/takeoff/vectors/group-decisions";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";
import { OTHER_CLASSES, type VectorClass } from "@/lib/takeoff/vectors/vocabulary";

// Ways the Decisions batches of vector groups (TI-662 L3c, group-decisions.ts)
// could misreport a page or break the call, written before the code. Every
// page, colour, layer and label is fictional (generic trade codes only).
// Candidates:
// - a group already classed (keyword, legend, label, document), a shared legend
//   colour the labels decide per run, a near-white group, a layer hidden by the
//   default configuration (OFF), or the groups of a raster page are sent to
//   Decisions;
// - the 0.1 % share is taken of the stroke length with its near-white strokes
//   (the architecture background), so a group of 0.13 % of the visible
//   strokes is left out; or a group of 0.08 % is sent;
// - candidates are not longest first, or more than 36 × 10 are kept without
//   counting the left-out tail (which stays « à revoir »).
// Questions:
// - a question is named by its group id (« c:#ff0000|w:0.5|d:6,3@0 » can pass
//   160 characters and Decisions refuses the call), aliases repeat across
//   batches or are not in sheet order, so an answer lands on another group;
// - a grey group is offered a network (TI-658: the background is never a
//   network); a choice misses a network code or its label, or repeats a value;
// - a batch holds more than 36 questions.
// Evidence:
// - long labels or layer names push the evidence past 256 KiB and the call
//   throws before sending (callOpenAiDecisions refuses it); or the trim drops
//   a group's alias, so the model cannot tell which tile it answers for;
// - a length in metres is given on a page whose scale is not measurable; the
//   bbox is not in page fractions; the share is not of the visible length;
// - the nearest labels are not the 3 nearest, or include the legend's own codes.
// Answers:
// - an answer naming a network for a grey group, or a value outside the
//   choices, is kept; a refused or missing answer gets a class;
// - a confidence of exactly 0.5 is asked again, or one under it is not.
// Candidate filter (TI-704, written before the code): on the development plans,
// 135 of the 171 groups sent could never be a network, at 0 networks found.
// - a grey or black group (background, frames, insulation hatches drawn in
//   grey), a pattern stroke, a frame or title-block layer, a furniture or
//   joinery layer, a legend sample (inside the legend box, or a short thin strip
//   beside a text) or an air-duct colour (the colour of an air legend row, or a
//   tint of it) is still sent; or the filter loses a network: a shade of an air
//   colour (a dark red heating pipe beside a red extract duct), a pale tint of
//   an air colour that is also the tint of a network classed on the page, a long
//   straight pipe beside its label, a layer coloured like an air duct;
// - a filtered group gets a class instead of staying « à revoir », or is not
//   counted, so the review cannot tell why it was not asked.
// Review of the filter (written before its fix):
// - a plumbing legend row « EA » (softened water, EFA) reads as an air row, and
//   its unclassed pipes are filtered; one lone air code on a page (an
//   equipment tag « AS » with a stroke after it) is taken for an air legend;
// - the network guard protects a tint of a network colour, not the base colour
//   of a network drawn as a tint: a band pipe's outline in an air colour, whose
//   tinted fill the labels class, is filtered;
// - a short pipe run beside its own label (« QRS DN 22 ») is a legend sample.

const A3 = { width: 1190.55, height: 841.89 };
const MAGENTA = "#ff00ff";
const GREEN = "#00aa00";
const TEAL = "#00cccc";
const GREY = "#808080";
const NEAR_WHITE = "#e0e0e0";
const BLUE = "#0000ff";
const RED = "#ff0000";

type Stroke = { color: string; points: readonly number[]; width?: number; dash?: string | null; layer?: string | null };

function line(color: string, x0: number, y0: number, x1: number, y1: number, style: Omit<Partial<Stroke>, "color" | "points"> = {}): Stroke {
  return { color, points: [x0, y0, x1, y1], ...style };
}

function text(str: string, x: number, y: number, height = 6): VectorText {
  return { str, x, y, width: Math.round(0.55 * height * str.length * 100) / 100, height, angle: 0 };
}

function page(strokes: readonly Stroke[], texts: readonly VectorText[] = [], options: {
  layers?: ReadonlyArray<{ id: string; name: string; visible?: boolean }>; imageCoverage?: number;
} = {}): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const index = new Map<string, number>();
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (const stroke of strokes) {
    const key: VectorGroupKey = { layer: stroke.layer ?? null, color: stroke.color, width: stroke.width ?? 0.5, dash: stroke.dash ?? null };
    const id = JSON.stringify(key);
    let group = index.get(id);
    if (group === undefined) {
      group = groups.length;
      index.set(id, group);
      groups.push(key);
    }
    paths.push({ group, start: coordinates.length / 2, count: stroke.points.length / 2, closed: false });
    coordinates.push(...stroke.points);
  }
  const imageCoverage = options.imageCoverage ?? 0;
  return {
    page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0,
    layers: (options.layers ?? []).map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible ?? true })),
    groups, texts: [...texts], paths, points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: imageCoverage > 0 ? 1 : 0, imageCoverage },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

/** A legend row: the code alone (8 pt), then a 40 pt sample per colour on its row. */
function legendRow(code: string, row: number, colors: readonly string[]) {
  const label = text(code, 40, 60 + 24 * row, 8);
  const cy = label.y - label.height / 2;
  const x0 = label.x + label.width + 10;
  return { texts: [label], strokes: colors.map((color) => line(color, x0, cy, x0 + 40, cy)) };
}

const LEGEND = [legendRow("EF", 0, [BLUE]), legendRow("ECS", 1, [RED]), legendRow("CS", 2, [RED])];
const CALIBRATION = { page: 1, denominator: 50, source: "test" } as const;

/** Strokes of `length` pt along y, cut into pieces of at most 800 pt. */
function long(color: string, y: number, length: number, style: Omit<Partial<Stroke>, "color" | "points"> = {}): Stroke[] {
  const strokes: Stroke[] = [];
  for (let start = 0, row = 0; start < length; start += 800, row += 1) {
    strokes.push(line(color, 200, y + 4 * row, 200 + Math.min(800, length - start), y + 4 * row, style));
  }
  return strokes;
}

function prepared(extraction: VectorPageExtraction, correspondences?: ReadonlyMap<string, VectorClass>) {
  const model = buildPageModel(extraction);
  const reading = readVectorPage(extraction, { calibration: CALIBRATION, correspondences, clock: () => 0 });
  return { model, reading };
}

/** Candidates built by hand, for the groups the selection no longer sends (a grey group) but the questions still guard. */
function handCandidates(model: PageModel, groups: readonly number[]): DecisionCandidate[] {
  return groups.map((group, rank) => ({ alias: aliasOf(rank + 1), group, id: model.groups[group].id,
    visibleLength_pt: model.groups[group].visibleLength_pt, share: model.groups[group].visibleLength_pt / model.visibleLength_pt }));
}

function groupIndex(model: PageModel, color: string, width = 0.5) {
  const index = model.groups.findIndex((group) => group.key.color === color && group.key.width === width && group.layer === null);
  if (index < 0) throw new Error(`no group ${color} ${width}`);
  return index;
}

describe("Decisions candidates (group-decisions.ts selectDecisionCandidates)", () => {
  it("sends only unclassed, visible groups of at least 0.1 % of the visible strokes, longest first", () => {
    const base = [
      ...LEGEND.flatMap((row) => row.strokes),
      ...long(MAGENTA, 300, 1000), ...long(GREEN, 340, 400), ...long(GREY, 380, 600, { width: 1 }),
      ...long(BLUE, 420, 300), ...long(RED, 460, 200), ...long(NEAR_WHITE, 500, 8000),
    ];
    const texts = LEGEND.flatMap((row) => row.texts);
    const visible = buildPageModel(page(base, texts)).visibleLength_pt;
    // 0.08 % and 0.13 % of the visible strokes: out and in, whatever the near-white background adds.
    const extraction = page([...base, line(TEAL, 200, 700, 200 + 0.0008 * visible, 700), line(TEAL, 200, 720, 200 + 0.0013 * visible, 720, { width: 1 })], texts);
    const { model, reading } = prepared(extraction);
    const selection = selectDecisionCandidates(model, reading);
    const colours = selection.candidates.map((candidate) => [model.groups[candidate.group].key.color, model.groups[candidate.group].key.width]);
    // TI-704: the grey group (600 pt, second longest) is no longer sent; it is counted as filtered and stays « à revoir ».
    expect(colours).toEqual([[MAGENTA, 0.5], [GREEN, 0.5], [TEAL, 1]]);
    expect(selection.candidates.map((candidate) => candidate.alias)).toEqual(["groupe_01", "groupe_02", "groupe_03"]);
    expect(selection.candidates[0].share).toBeCloseTo(1000 / model.visibleLength_pt, 6);
    expect(selection.candidates.map((candidate) => candidate.id)).toEqual(selection.candidates.map((candidate) => model.groups[candidate.group].id));
    expect(selection).toMatchObject({ eligible: 3, left_out: 0 });
    expect(selection.filtered).toEqual([{ group: groupIndex(model, GREY, 1), id: model.groups[groupIndex(model, GREY, 1)].id, reason: "grey" }]);
  });

  it("never sends a hidden layer, a classed layer, or any group of a raster page", () => {
    const layers = [{ id: "1R", name: "FICTIF_XYZ" }, { id: "2R", name: "FICTIF_EF" }, { id: "3R", name: "FICTIF_ABC", visible: false }];
    const strokes = [...long(MAGENTA, 300, 500, { layer: "1R" }), ...long(BLUE, 400, 500, { layer: "2R" }), ...long(GREEN, 500, 500, { layer: "3R" })];
    const { model, reading } = prepared(page(strokes, [], { layers }));
    expect(selectDecisionCandidates(model, reading).candidates.map((candidate) => candidate.id)).toEqual(["oc:1R"]);
    const raster = prepared(page(strokes, [], { layers, imageCoverage: 0.95 }));
    expect(selectDecisionCandidates(raster.model, raster.reading)).toEqual({ candidates: [], eligible: 0, left_out: 0, filtered: [] });
  });

  it("keeps at most 36 × 10 groups and counts the tail left out", () => {
    // 400 magenta groups told apart by their width, the first the longest.
    const strokes = Array.from({ length: 400 }, (_, index) => line(MAGENTA, 100, 1 + 2 * index, 1100 - index, 1 + 2 * index, { width: 0.01 * (index + 1) }));
    const { model, reading } = prepared({ ...page(strokes), height: 900 });
    const selection = selectDecisionCandidates(model, reading);
    expect(GROUP_DECISIONS_LIMITS.batchSize * GROUP_DECISIONS_LIMITS.maxBatchCalls).toBe(360);
    expect(selection.candidates).toHaveLength(360);
    expect(selection).toMatchObject({ eligible: 400, left_out: 40 });
    expect(model.groups[selection.candidates[0].group].key.width).toBe(0.01);
    expect(selection.candidates[359].alias).toBe("groupe_360");
    const batches = decisionBatches(selection.candidates);
    expect(batches.map((batch) => batch.length)).toEqual(Array.from({ length: 10 }, () => 36));
    expect(new Set(selection.candidates.map((candidate) => candidate.alias)).size).toBe(360);
  });
});

describe("Decisions questions and evidence (group-decisions.ts)", () => {
  const longDash = Array.from({ length: 60 }, (_, index) => String(index + 1)).join(",") + "@0";

  it("names each question by its alias, offers every class with its label, and a grey group no network", () => {
    const { model } = prepared(page([...long(MAGENTA, 300, 600, { dash: longDash }), ...long(GREY, 400, 500, { width: 1 })]));
    // The grey group is never sent (TI-704); its questions still offer no network if it ever were.
    const candidates = handCandidates(model, [0, 1]);
    expect(candidates[0].id.length).toBeGreaterThan(160);
    const questions = groupQuestions(model, candidates, "batch");
    expect(questions.map((question) => question.name)).toEqual(["groupe_01", "groupe_02"]);
    const [colour, grey] = questions;
    if (colour.type !== "choice" || grey.type !== "choice") throw new Error("choice questions expected");
    expect(colour.choices.map((choice) => choice.value)).toEqual([...NETWORK_CODES, ...OTHER_CLASSES]);
    expect(colour.choices.find((choice) => choice.value === "EU")?.description).toContain("Eaux usées");
    expect(new Set(colour.choices.map((choice) => choice.value)).size).toBe(colour.choices.length);
    expect(grey.choices.map((choice) => choice.value)).toEqual([...OTHER_CLASSES]);
    expect(questions.every((question) => question.instructions.includes(question.name))).toBe(true);
  });

  it("keeps the evidence under 256 KiB with long labels, and every alias when trimmed harder", () => {
    // 36 groups, each with 3 labels of 3 000 characters within 10 pt.
    const strokes: Stroke[] = [];
    const texts: VectorText[] = [];
    for (let index = 0; index < 36; index += 1) {
      const y = 20 + 22 * index;
      strokes.push(line(MAGENTA, 100, y, 1000 - index, y, { width: 0.1 * (index + 1) }));
      for (let label = 0; label < 3; label += 1) texts.push({ ...text(`EF ${"x".repeat(3000)} DN 22`, 150 + 250 * label, y - 4, 2), width: 200 });
    }
    const { model, reading } = prepared(page(strokes, texts));
    const { candidates } = selectDecisionCandidates(model, reading);
    expect(candidates).toHaveLength(36);
    const labels = nearestLabelTexts(model, reading, candidates);
    const evidence = groupEvidence({ model, reading, candidates, labels, call: "batch", legendImage: "page_thumbnail" });
    expect(Buffer.byteLength(JSON.stringify(evidence), "utf8")).toBeLessThanOrEqual(256 * 1024);
    const small = groupEvidence({ model, reading, candidates, labels, call: "batch", legendImage: "page_thumbnail", maxBytes: 6_000 });
    expect(Buffer.byteLength(JSON.stringify(small), "utf8")).toBeLessThanOrEqual(6_000);
    expect((small.groups as Array<{ alias: string }>).map((group) => group.alias)).toEqual(candidates.map((candidate) => candidate.alias));
  });

  it("describes each group in page fractions and metres only when the scale is measurable, with its 3 nearest labels", () => {
    const layers = [{ id: "1R", name: "FICTIF_XYZ_RESEAU" }];
    const strokes = [line(MAGENTA, 119.055, 84.189, 595.275, 84.189, { layer: "1R" }), line(MAGENTA, 595.275, 84.189, 595.275, 420.945, { layer: "1R" })];
    const texts = [text("EF DN 20", 300, 80), text("EF DN 25", 300, 70), text("EF DN 32", 300, 60), text("EF DN 40", 300, 50), text("Échelle 1/50", 1000, 780, 5)];
    const extraction = page(strokes, texts, { layers });
    const { model, reading } = prepared(extraction);
    const { candidates } = selectDecisionCandidates(model, reading);
    const labels = nearestLabelTexts(model, reading, candidates);
    const evidence = groupEvidence({ model, reading, candidates, labels, call: "dedicated", legendImage: "page_thumbnail" });
    const [group] = evidence.groups as Array<Record<string, unknown>>;
    expect(group).toMatchObject({
      alias: "groupe_01", layer: "FICTIF_XYZ_RESEAU", colors: [MAGENTA], width: 0.5, dash: null, paths: 2, segments: 2, closed: 0,
      length_pt: expect.closeTo(476.22 + 336.756, 1), length_m: expect.closeTo((476.22 + 336.756) * (25.4 / 72) * 50 / 1000, 2), share: 1,
      labels: ["EF DN 20", "EF DN 25", "EF DN 32"],
    });
    expect(group.bbox).toEqual([expect.closeTo(0.1, 3), expect.closeTo(0.1, 3), expect.closeTo(0.5, 3), expect.closeTo(0.5, 3)]);
    expect(evidence).toMatchObject({ task: "takeoff_vector_groups", call: "dedicated", page: { mode: "layers", scale: { denominator: 50 } } });
    // Without a measurable scale (no cartouche, no calibration), no metres.
    const unscaled = readVectorPage(page(strokes, texts.slice(0, 4), { layers }), { clock: () => 0 });
    const plain = groupEvidence({ model, reading: unscaled, candidates, labels, call: "batch", legendImage: "page_thumbnail" });
    expect((plain.groups as Array<Record<string, unknown>>)[0].length_m).toBeNull();
  });

  it("gives the legend entries and leaves the legend's own codes out of the nearest labels", () => {
    const strokes = [...LEGEND.flatMap((row) => row.strokes), line(MAGENTA, 40, 140, 400, 140)];
    const texts = [...LEGEND.flatMap((row) => row.texts), text("EU DN 100", 200, 136)];
    const { model, reading } = prepared(page(strokes, texts));
    const { candidates } = selectDecisionCandidates(model, reading);
    const labels = nearestLabelTexts(model, reading, candidates);
    expect(labels.get(candidates[0].id)).toEqual(["EU DN 100"]);
    const evidence = groupEvidence({ model, reading, candidates, labels, call: "batch", legendImage: "legend_crop" });
    expect(evidence.legend).toEqual([{ code: "EF", colors: [BLUE] }, { code: "ECS", colors: [RED] }, { code: "CS", colors: [RED] }]);
  });
});

describe("Decisions answers (group-decisions.ts readGroupAnswers)", () => {
  it("keeps only answered classes among the group's choices, never a network for a grey group", () => {
    const { model } = prepared(page([...long(MAGENTA, 300, 900), ...long(GREY, 400, 800, { width: 1 }), ...long(GREEN, 500, 700),
      ...long(TEAL, 600, 600)]));
    // By hand: the selection no longer sends the grey group (TI-704), the answers still refuse it a network.
    const candidates = handCandidates(model, [0, 1, 2, 3]);
    const answer = (name: string, status: OpenAiDecisionAnswer["status"], value: string | null, confidence: number | null): OpenAiDecisionAnswer =>
      ({ name, type: "choice", status, value, confidence });
    const answers = readGroupAnswers(model, candidates, [
      answer("groupe_01", "answered", "EU", 0.9), answer("groupe_02", "answered", "EU", 0.99), answer("groupe_03", "refused", null, null),
    ]);
    expect(answers.get(candidates[0].id)).toEqual({ class: "EU", confidence: 0.9, status: "answered" });
    expect(answers.get(candidates[1].id)).toEqual({ class: null, confidence: null, status: "invalid" });
    expect(answers.get(candidates[2].id)).toEqual({ class: null, confidence: null, status: "refused" });
    expect(answers.get(candidates[3].id)).toEqual({ class: null, confidence: null, status: "missing" });
    const grey = readGroupAnswers(model, [candidates[1]], [answer("groupe_02", "answered", "mur", 0.7)]);
    expect(grey.get(candidates[1].id)).toEqual({ class: "mur", confidence: 0.7, status: "answered" });
  });

  it("asks again an unanswered group or one under 0.5, never one at 0.5", () => {
    expect(GROUP_DECISIONS_LIMITS.dedicatedBelow).toBe(0.5);
    expect(needsDedicated({ class: "EU", confidence: 0.5, status: "answered" })).toBe(false);
    expect(needsDedicated({ class: "EU", confidence: 0.49, status: "answered" })).toBe(true);
    expect(needsDedicated({ class: null, confidence: null, status: "missing" })).toBe(true);
    expect(needsDedicated({ class: null, confidence: null, status: "invalid" })).toBe(true);
    expect(needsDedicated(undefined)).toBe(true);
  });
});

describe("Decisions candidate filter (TI-704, group-decisions.ts selectDecisionCandidates)", () => {
  const ORANGE = "#ff8000";
  const AIR_BLUE = "#0000ff";
  const AIR_RED = "#ff0000";
  const AIR_CYAN = "#00ffff";
  /** 30 % white over AIR_BLUE, as a duct's band is shaded: an air-duct colour. */
  const AIR_BLUE_TINT = "#4d4dff";
  /** 30 % white over AIR_RED, and no tint of the network red below: an air-duct colour. */
  const AIR_RED_TINT = "#ff4d4d";
  /** A shade (13 % black) of AIR_RED: a heating pipe, never taken for the red extract duct. */
  const NETWORK_RED = "#dd0000";
  /** A pale pink, the tint of AIR_RED and of NETWORK_RED alike: kept, NETWORK_RED being a network of this page. */
  const NETWORK_PALE = "#f7abae";
  const NETWORK_TEAL = "#00cccc";

  function filteredReasons(model: PageModel, selection: ReturnType<typeof selectDecisionCandidates>) {
    return new Map(selection.filtered.map((entry) => [entry.id, entry.reason]));
  }

  it("keeps every network of a page with an air legend, and sends none of its ducts, greys, hatches or legend samples", () => {
    // Legend: a network row (ECS, orange) and three air rows (AN, AEX, AS): their codes are no network.
    const rows = [legendRow("ECS", 0, [ORANGE]), legendRow("AN", 1, [AIR_BLUE]), legendRow("AEX", 2, [AIR_RED]), legendRow("AS", 3, [AIR_CYAN])];
    const legendStrokes = rows.flatMap((row) => row.strokes);
    const legendTexts = rows.flatMap((row) => row.texts);
    const sampleText = text("XYZ - Réseau fictif", 600, 720, 8);
    const strokes: Stroke[] = [
      ...legendStrokes,
      // Air ducts, in a legend colour (another width) and a white tint of one.
      ...long(AIR_BLUE, 300, 900, { width: 0.57 }), ...long(AIR_BLUE_TINT, 340, 600), ...long(AIR_RED_TINT, 380, 500),
      // Networks: a shade of the extract red, the same red classed at another width, its pale tint, a straight pipe beside its label.
      ...long(NETWORK_RED, 420, 700), ...long(NETWORK_RED, 460, 650, { width: 1 }), ...long(NETWORK_PALE, 500, 550),
      line(NETWORK_TEAL, 200, 560, 900, 560),
      // Background and hatches: mid grey, black, a pattern stroke.
      ...long(GREY, 600, 600, { width: 1 }), ...long("#000000", 640, 500, { width: 0.3 }), ...long("pattern", 680, 450, { width: 0.2 }),
      // A legend sample: a short thin strip just above a text, in no legend row.
      line(GREEN, 600, 709, 760, 709), line(GREEN, 600, 711, 760, 711), line(GREEN, 600, 710, 760, 710),
    ];
    const texts = [...legendTexts, text("QRS DN 22", 300, 556), sampleText];
    const extraction = page(strokes, texts);
    const classed = new Map<string, VectorClass>([[buildPageModel(extraction).groups.find((group) => group.key.color === NETWORK_RED
      && group.key.width === 1)?.id as string, "HW-S"]]);
    const { model, reading } = prepared(extraction, classed);
    const selection = selectDecisionCandidates(model, reading);
    const sent = new Set(selection.candidates.map((candidate) => candidate.id));
    const id = (color: string, width = 0.5) => model.groups[groupIndex(model, color, width)].id;
    expect([...sent].sort()).toEqual([id(NETWORK_RED), id(NETWORK_PALE), id(NETWORK_TEAL)].sort());
    const reasons = filteredReasons(model, selection);
    expect(reasons.get(id(AIR_BLUE, 0.57))).toBe("air_duct");
    expect(reasons.get(id(AIR_BLUE_TINT))).toBe("air_duct");
    expect(reasons.get(id(AIR_RED_TINT))).toBe("air_duct");
    expect(reasons.get(id(GREY, 1))).toBe("grey");
    expect(reasons.get(id("#000000", 0.3))).toBe("grey");
    expect(reasons.get(id("pattern", 0.2))).toBe("pattern");
    expect(reasons.get(id(GREEN))).toBe("legend_sample");
    // The air legend's own samples (AN, AEX, AS at 0.5) are legend samples too, never sent.
    for (const color of [AIR_BLUE, AIR_RED, AIR_CYAN]) expect(["legend_sample", "air_duct"]).toContain(reasons.get(id(color)));
    // Filtered groups stay « à revoir »: no class, and counted by the reading as before.
    for (const entry of selection.filtered) expect(reading.groups[entry.group].class).toBeNull();
    expect(reading.counts.to_review).toBe(selection.eligible + selection.filtered.length);
  });

  it("never filters a layer by an air colour, and keeps a pale or straight network layer beside a legend sample layer", () => {
    const layers = [
      { id: "1R", name: "FICTIF_CARTOUCHE" }, { id: "2R", name: "Fictif frame" }, { id: "3R", name: "FICTIF_MOBILIER" },
      { id: "4R", name: "FICTIF_MENUISERIES" }, { id: "5R", name: "FICTIF_EQUIPEMENT" }, { id: "6R", name: "FICTIF_QRS-S" },
      { id: "7R", name: "FICTIF_LMN" }, { id: "8R", name: "FICTIF_TUV" },
    ];
    const air = [legendRow("AS", 0, [MAGENTA]), legendRow("AN", 1, [TEAL])];
    const sample = text("LMN - Réseau fictif", 900, 743, 11.4);
    const strokes: Stroke[] = [
      ...air.flatMap((row) => row.strokes),
      ...long(RED, 300, 900, { layer: "1R" }), ...long(GREEN, 340, 600, { layer: "2R" }), ...long("#0037dd", 380, 700, { layer: "3R" }),
      ...long(BLUE, 420, 650, { layer: "4R" }), ...long("#000000", 460, 800, { layer: "5R" }), ...long(GREY, 470, 300, { layer: "5R" }),
      // A straight vertical pipe, 12 pt wide and 650 pt long, in a pale colour, beside its label.
      line("#f7abae", 500, 120, 500, 770, { layer: "6R" }), line("#f7abae", 512, 120, 512, 770, { layer: "6R" }),
      // A legend sample on its own layer: 230 × 3 pt just above its text (11.4 pt).
      ...Array.from({ length: 4 }, (_, row) => line("#33ccff", 860, 727 + row, 1090, 727 + row, { layer: "7R" })),
      // A network layer drawn in the air legend's magenta.
      ...long(MAGENTA, 600, 700, { layer: "8R" }),
    ];
    const { model, reading } = prepared(page(strokes, [...air.flatMap((row) => row.texts), text("QRS-S DN 50", 520, 300), sample], { layers }));
    expect(reading.mode).toBe("layers");
    const selection = selectDecisionCandidates(model, reading);
    expect(selection.candidates.map((candidate) => candidate.id).sort()).toEqual(["oc:6R", "oc:8R"]);
    expect(Object.fromEntries(selection.filtered.filter((entry) => entry.id.startsWith("oc:")).map((entry) => [entry.id, entry.reason]))).toEqual({
      "oc:1R": "frame_layer", "oc:2R": "frame_layer", "oc:3R": "architecture_layer", "oc:4R": "architecture_layer", "oc:5R": "grey",
      "oc:7R": "legend_sample",
    });
  });

  it("filters only among the groups it would send, before the per-page caps", () => {
    // 380 grey groups and 10 coloured ones: the coloured ones are all sent, the grey ones are counted, none left out.
    const strokes = [
      ...Array.from({ length: 380 }, (_, index) => line(GREY, 100, 1 + 2 * index, 1100 - index, 1 + 2 * index, { width: 0.01 * (index + 1) })),
      ...Array.from({ length: 10 }, (_, index) => line(MAGENTA, 100, 770 + 2 * index, 900, 770 + 2 * index, { width: 0.01 * (index + 1) })),
    ];
    const { model, reading } = prepared({ ...page(strokes), height: 900 });
    const selection = selectDecisionCandidates(model, reading);
    expect(selection).toMatchObject({ eligible: 10, left_out: 0 });
    expect(selection.candidates).toHaveLength(10);
    expect(selection.filtered).toHaveLength(380);
    expect(new Set(selection.filtered.map((entry) => entry.reason))).toEqual(new Set(["grey"]));
  });

  it("needs two air codes on the page, never reads a plumbing code as one, and keeps a network's outline or a pipe beside its label", () => {
    const shortPipe = (color: string, y: number) => [line(color, 300, y, 380, y), line(color, 300, y + 1, 380, y + 1), line(color, 300, y + 2, 380, y + 2)];
    // A plumbing row « EA » and one air row « AN »: one air code only, no air colour.
    const lone = [legendRow("EA", 0, ["#33aa77"]), legendRow("AN", 1, [AIR_BLUE])];
    const lonePage = page([...lone.flatMap((row) => row.strokes), ...long("#33aa77", 300, 800), ...long(AIR_BLUE, 340, 700, { width: 0.57 })],
      lone.flatMap((row) => row.texts));
    const first = prepared(lonePage);
    const loneSelection = selectDecisionCandidates(first.model, first.reading);
    const loneSent = new Set(loneSelection.candidates.map((candidate) => candidate.id));
    expect(loneSent.has(first.model.groups[groupIndex(first.model, "#33aa77")].id)).toBe(true);
    expect(loneSent.has(first.model.groups[groupIndex(first.model, AIR_BLUE, 0.57)].id)).toBe(true);
    expect(loneSelection.filtered.some((entry) => entry.reason === "air_duct")).toBe(false);

    // Two air codes (AN, AEX): a band pipe classed on its tinted fill keeps its outline in the air blue; a short run of
    // pipe beside its label is no legend sample; the duct in the air red is filtered.
    const rows = [legendRow("AN", 0, [AIR_BLUE]), legendRow("AEX", 1, [AIR_RED])];
    const fill = "#8080ff";
    const strokes: Stroke[] = [...rows.flatMap((row) => row.strokes), ...long(fill, 300, 700, { width: 2 }), ...long(AIR_BLUE, 305, 700, { width: 0.3 }),
      ...shortPipe(NETWORK_TEAL, 500), ...long(AIR_RED, 600, 800, { width: 0.57 })];
    const extraction = page(strokes, [...rows.flatMap((row) => row.texts), text("QRS DN 22", 300, 508, 6)]);
    const fillId = buildPageModel(extraction).groups.find((group) => group.key.color === fill)?.id as string;
    const { model, reading } = prepared(extraction, new Map<string, VectorClass>([[fillId, "EF"]]));
    const selection = selectDecisionCandidates(model, reading);
    const sent = new Set(selection.candidates.map((candidate) => candidate.id));
    expect(sent.has(model.groups[groupIndex(model, AIR_BLUE, 0.3)].id)).toBe(true);
    expect(sent.has(model.groups[groupIndex(model, NETWORK_TEAL)].id)).toBe(true);
    expect(filteredReasons(model, selection).get(model.groups[groupIndex(model, AIR_RED, 0.57)].id)).toBe("air_duct");
  });
});
