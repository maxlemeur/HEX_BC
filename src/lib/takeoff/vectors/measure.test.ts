import { degrees, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import type { NetworkCode } from "@/lib/takeoff/bench/keys";
import { applyCorrespondences, applyDecisions, classifyByKeywords } from "@/lib/takeoff/vectors/classify";
import { isGrey, isNearWhite } from "@/lib/takeoff/vectors/colors";
import { extractVectorPage, type VectorGroupKey, type VectorPageExtraction, type VectorPath, type VectorText } from "@/lib/takeoff/vectors/extraction";
import { distanceToSegment, pointsToMetres, type Point } from "@/lib/takeoff/vectors/geometry";
import { mergeTextLines, readLabelBlocks } from "@/lib/takeoff/vectors/labels";
import { matchLegendColor, readLegend } from "@/lib/takeoff/vectors/legend";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";
import { readVectorPage, type VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import { classOfLayerName, type VectorClass } from "@/lib/takeoff/vectors/vocabulary";

// Ways the vector reading of network lengths (TI-662: measure.ts, legend.ts,
// classify.ts, colors.ts and the label blocks of labels.ts) could misreport a
// plan, written before the tests. Every page, layer name, colour and label is
// fictional (generic trade codes only); lengths are read at 1/50, where
// 283.46 pt of sheet are 5 m on site.
// Measure (one centreline per pipe):
// - a pipe drawn as a band (two outlines 2 pt apart, a tint between, a dashed
//   centre line of the same colour family) is measured 2 to 4 times;
// - the same band is split into two angle classes when its outlines lean by
//   ±0.01 pt (the rounding of the extraction straddles 0° and 180°), and is
//   measured twice;
// - a stroke drawn twice, or a pipe drawn in overlapping pieces, is counted twice;
// - two pipes of different networks 1.5 pt apart are merged into one run or
//   measured once;
// - the short caps across the ends of a band (apart, or the sides of a closed
//   outline) are counted as pipe;
// - the samples of the legend (inside its box) are measured as network;
// - a network code written alone on a pipe's row (an inline tag) turns the
//   whole pipe into a legend sample, and the pipe is not measured;
// - a dark pipe drawn as a closed band outline is taken for a diagram frame
//   (its own strokes are the network it « holds »), and is not measured.
// Legend and keywords:
// - a code alone (« EF », « EU/EV », « EG VC ») with its samples on its row does
//   not give their colour the network, or a pipe label beside a stroke does;
// - a colour drawn for EU and EU/EV is not EUV; a colour drawn for ECS and CS
//   is given one of them instead of staying « à revoir » with [CS, ECS];
// - a 30 % tint (#4d4dff of #0000ff) or a shade of a legend colour does not take
//   its network, or an unrelated colour does;
// - a grey (#808080) or near-white (#e0e0e0) sample or stroke becomes a network;
// - layer names: « FICTIF_EF » is not EF, « XX_CHW L00-S » not CHW-S, « EU/EV »
//   not EUV, « EVIER » reads as EV, a text layer naming a network is measured
//   as that network, a near-white or grey layer becomes a network;
// - a document correspondence does not replace a keyword class, or makes a
//   near-white group a network.
// Labels:
// - two text items of one baseline (split at a font change) are read as two
//   labels; « EU - PVC Me DN 40 » is not EU, pvc, DN 40;
// - two labels on adjacent lines, each naming its network, are merged into one,
//   or a continuation line (« PVC DN 40 » under « EU ») is not merged;
// - a label whose leader ends on its network's pipe gives its DN to a nearer
//   pipe of another network; a label without network gives a DN to a pipe;
// - a DN does not reach a joined run of the same network, or crosses into
//   another network's run;
// - a shared legend colour (ECS/CS) does not take the network of the label
//   attached to its component, or takes one when two labels disagree;
// - label votes: an unclassified saturated colour group at the end of the
//   leaders of 2 labels naming CHW-S does not take CHW-S (source « label »);
//   one vote, or votes that disagree, classify it; a grey group is classified.
// Review of 3/11/2026 (written before the fixes):
// - a schematic inside a black detail frame is measured at plan scale (the
//   frame's own black edges counted as the background it holds);
// - a near-white stroke inside a network layer is measured as that network and
//   counted in the detection badge;
// - a layer hidden in the default configuration (OFF) is measured;
// - a page whose scale is not verified still gives a length;
// - an unrelated parallel stroke of the same network elsewhere on the sheet
//   splits a band's outlines into two runs (offset clusters page-wide);
// - the network of a shared colour spreads through a joined run of another
//   network to runs of other candidates;
// - in a multi-column legend, the next column's sample is given to the code
//   before it;
// - an upward label split by pdfjs is never merged; a level « R-1 » in a layer
//   name reads as a return.
// Review of PR #145 (Codex, 3/11/2026, written before the fixes):
// - of two pipes of a label's network within inline reach, the farther one takes
//   its DN because it was compared with the nearer one's distance plus 8 pt;
// - two touching sections of one network labelled DN 40 and DN 20 merge into one
//   run that keeps the first DN for the whole length; a run whose labels
//   disagree with no single place to cut keeps one of their DN instead of
//   staying « à revoir »;
// - a short pipe of another network crossing a longer pipe is dropped as its
//   cap or fitting;
// - an open dark polyline (a U-shaped wall) or a closed non-rectangular outline
//   is taken for a diagram frame, and the pipes inside it are not measured;
// - a legend code with its direction (« CHW-S », « EG-R ») is not read, so its
//   colour stays unclassified; a pipe label (« EU - PVC ») is read as a legend code.
// Second Codex round (written before the fixes):
// - a cote on a hidden layer decides the page scale (« dimension_mismatch »
//   from a dimension that is not printed);
// - a shared colour run labelled « ECS PVC DN 20 » and « CS PVC DN 20 » takes
//   the first label's network instead of staying « à revoir ».
// Third Codex round (written before the fixes):
// - a legend read in page space: under /Rotate 90 or 270 its codes run down or
//   up the page and are never read (a code written along a pipe, now
//   horizontal, is read instead), under /Rotate 180 its samples are sought on
//   the wrong side, so the pipes of its colours stay unclassified; read in
//   every text's own frame instead, a code written along a vertical pipe on a
//   horizontal sheet (an inline tag) becomes a legend entry and its pipe piece
//   is not measured.
// Review of that round (written before the fixes):
// - the sheet's axis taken from where most characters run drops the
//   horizontal legend of an upright page dominated by vertical labels (riser
//   labels), and reads a vertical inline tag as its legend instead;
// - on a page turned by /Rotate 180, the two pieces of one label tilted by a
//   fraction of a degree read at angles on both sides of ±π and are not merged.
// Fourth Codex round (written before the fix):
// - on a large sheet (A0), a pipe drawn on a long diagonal is left out of the
//   proximity index (its bounding box spans too many cells): its inline label
//   is never attached, so it is measured without material or DN, and a
//   labelled branch joined to its middle does not pass its DN on to it.
// Review of that fix (written before its own fix):
// - a long dark wall running beside a pipe, under its label, is read as the
//   label's underline: its far ends become leader tips, and the label's DN goes
//   to another pipe of its network near one of them instead of the pipe it is
//   printed on (horizontal, or on the diagonal of an A0 sheet once indexed).
// Post-merge Codex review of PR #145 (written before the fix):
// - a label tilted by a fraction of a degree (pieces sorted along their
//   direction bucket, the cut-off measured along the line's own angle) stops
//   looking for its continuation at an unrelated text of the same style far off
//   its baseline, so « EF PVC DN » and « 40 » are read without DN because
//   another part of the sheet holds a note.
// Review of that fix (written before its own fix; both on main already):
// - the same cut-off across lines: the continuation line of a tilted label
//   (« DN 40 » right-aligned 1.2 heights under « EF - PVC PRESSION », 0.019 rad)
//   lies past the search's end once projected on its direction bucket, and the
//   label is read without DN;
// - across ±π (2π is not a multiple of the 0.04 rad buckets, the last one is
//   0.0032 rad wide), the pieces of one label at π − 0.003 and −π + 0.002 fall
//   in buckets that never compare, and are read as two labels;
// - a label straddling two buckets (0.021 and 0.019 rad) whose continuation
//   lies in the bucket read first: that piece starts a line of its own before
//   its head is read, and the two are never merged.
// Detection badge:
// - the share is not classified length ÷ stroke length without near-white
//   strokes (near-white counted, or a grey wall layer not counted classified).
// Cut and propagation of DN (TI-662 L3c, written before the change; the bench
// showed bundled runs of hundreds of strokes always left « conflict »):
// - a run whose labels disagree, drawn in several strokes between the labels
//   (a pipe exported in pieces), is never cut: it stays whole without DN, and
//   both sections lose their DN;
// - the cut lands outside the two labels (a section takes the other label's
//   DN), or not at the stroke end nearest the middle of the two labels;
// - a run drawn as one stroke between two disagreeing labels keeps no DN
//   instead of being cut midway between them;
// - two disagreeing labels printed at the same place along the run (one above,
//   one below) are cut anyway, so one side gets a DN nothing says is its own,
//   instead of the run staying « conflict » (« à revoir »);
// - a conflict run stops the DN of a labelled run from reaching the runs
//   joined beyond it, or takes that DN itself;
// - a DN labelled on a parent network (EU/EV, HW) never reaches a joined run of
//   one of its members (EU, EV, HW-S), nor a member's DN its parent's run;
// - a DN crosses between two members of one parent (EU and EV, HW-S and HW-R
//   are different pipes), joined directly or through a run of their parent.
// Review of the L3c measurement PR (written before the fixes):
// - a member's label (« EU - PVC DN 40 ») attached to its parent's run (EU/EV)
//   passes its DN through that run to the other member (EV) joined to it,
//   because the DN carries the run's network instead of the label's;
// - two labels as close (in joined runs) to an unlabelled parent run, one of a
//   member and one of the parent itself, give it the member's DN because that
//   label was read first (network order), and the other member joined to it
//   then gets no DN; on a tie the run's own network must win;
// - two disagreeing labels at the same place along a run (above and below)
//   leave the whole run « conflict », the section a clear third label names
//   included (DN 20 or DN 40 lost over metres of pipe).
// Second review of the L3c measurement PR (written before the fixes):
// - a run labelled by two agreeing labels naming different networks of one
//   family (« EU - PVC DN 100 » and « EU/EV - PVC DN 100 » on one EU/EV run)
//   carries only the network of the label read first, so the other member's
//   branch (EV) gets no DN although the parent's label reaches it; the answer
//   then depends on the order the labels are read in;
// - the first wave through an unlabelled parent run (a member's DN, nearer)
//   stops every later wave there, so a member's run joined beyond it gets no DN
//   although the parent's label reaches it over legal joins.
// Third review of the L3c measurement PR (written before the fix):
// - a run holding its own label lets no other network's DN pass on through it,
//   so the other member beyond it gets none, although the parent's DN reaches
//   it over legal joins (« EU/EV » DN 100, then a run labelled « EU » DN 40,
//   then an EV branch off that run).
// One pipe drawn in a parent's and a member's colours (TI-662 L3d, written before the fix;
// on the bench, a supply whose outlines read as HW-S by its labels and whose tint read as HW
// by the legend counted twice in its DN once the DN passed between parent and member):
// - the outlines of a member's pipe and its tint, read as the parent, are measured as two
//   pipes on one axis, both given the label's DN: the pipe counts twice;
// - a return's DN reaches another return through the tint of a supply both end on, read as
//   their parent's run;
// - a parent's pipe drawn 1.5 pt beside a member's (two pipes) is merged into it.
// Decisions classes (TI-662 L3c, classify.ts applyDecisions, written before the code):
// - a Decisions answer replaces a keyword, legend or label class, or decides a
//   shared legend colour that the labels decide per run;
// - a Decisions network lands on a near-white, grey or hidden group;
// - a document (or user) correspondence does not win over a Decisions answer;
// - a Decisions network under 0.8 is measured (or counted in the detection
//   badge) as if it were sure, instead of a proposal with its confidence; one
//   at 0.8 or more is not measured;
// - a dark closed rectangle that Decisions proposes as a network at 0.62 is
//   still not taken for a diagram frame (so the schematic inside it is
//   measured at plan scale), or one it decides at 0.9 still is;
// - a dark leader that Decisions proposes as a network at 0.62 is no longer a
//   leader, so its label's DN is lost.

const A3 = { width: 1190.55, height: 841.89 };
/** Sheet points that are 5 m (and 3 m) on site at 1/50. */
const FIVE_M = 283.46;
const THREE_M = 170.08;
const CALIBRATION = { page: 1, denominator: 50, source: "test" } as const;

const BLUE = "#0000ff"; // EF in the fixture legend
const BLUE_TINT = "#8080ff"; // 50 % tint of BLUE (band fill)
const ORANGE = "#ff8000"; // EU in the fixture legend
const RED = "#ff0000"; // drawn for both ECS and CS
const MAGENTA = "#ff00ff"; // never in a legend
const GREY = "#808080";
const NEAR_WHITE = "#e0e0e0";
const BLACK = "#000000"; // leaders

type Stroke = { color: string; points: readonly number[]; width?: number; dash?: string | null; layer?: string | null; closed?: boolean };
type Part = { strokes?: readonly Stroke[]; texts?: readonly VectorText[] };

function line(color: string, x0: number, y0: number, x1: number, y1: number, style: Omit<Partial<Stroke>, "color" | "points"> = {}): Stroke {
  return { color, points: [x0, y0, x1, y1], ...style };
}

/** A horizontal text item; (x, y) is the baseline start, width about 0.55 height per character. */
function text(str: string, x: number, y: number, height = 6): VectorText {
  return { str, x, y, width: Math.round(0.55 * height * str.length * 100) / 100, height, angle: 0 };
}

/** One A3 page, as the extraction gives it: groups keyed by layer, colour, width and dash. */
function page(parts: readonly Part[], layers: ReadonlyArray<{ id: string; name: string }> = []): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const groupIndex = new Map<string, number>();
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (const stroke of parts.flatMap((part) => part.strokes ?? [])) {
    const key: VectorGroupKey = { layer: stroke.layer ?? null, color: stroke.color, width: stroke.width ?? 0.5, dash: stroke.dash ?? null };
    const id = JSON.stringify([key.layer, key.color, key.width, key.dash]);
    let group = groupIndex.get(id);
    if (group === undefined) {
      group = groups.length;
      groupIndex.set(id, group);
      groups.push(key);
    }
    paths.push({ group, start: coordinates.length / 2, count: stroke.points.length / 2, closed: stroke.closed ?? false });
    coordinates.push(...stroke.points);
  }
  return {
    page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0,
    layers: layers.map((layer) => ({ ...layer, visible: true })),
    groups, texts: parts.flatMap((part) => part.texts ?? []), paths, points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 },
    memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

/** A legend row at the top left: the code alone (8 pt), then a 40 pt sample per colour on its row. */
function legendRow(code: string, row: number, colors: readonly string[]): Part {
  const label = text(code, 40, 60 + 24 * row, 8);
  const cy = label.y - label.height / 2;
  const x0 = label.x + label.width + 10;
  return { texts: [label], strokes: colors.map((color) => line(color, x0, cy, x0 + 40, cy)) };
}

/** Legend of most fixtures: EF in blue, EU in orange. */
const LEGEND: readonly Part[] = [legendRow("EF", 0, [BLUE]), legendRow("EU", 1, [ORANGE])];

/** A pipe drawn as a band along y: two outlines 2 pt apart, a tint between, a dashed centre line. */
function band(x0: number, x1: number, y: number, color: string, tint: string): Stroke[] {
  return [
    line(color, x0, y - 1, x1, y - 1),
    line(color, x0, y + 1, x1, y + 1),
    line(tint, x0, y, x1, y, { width: 1.5 }),
    line(color, x0, y, x1, y, { width: 0.25, dash: "6,3@0" }),
  ];
}

/** A 6 pt label, baseline at y, underlined by a dark leader whose other leg ends at the tip (the arrow end). */
function leaderLabel(str: string, x: number, y: number, tip: { x: number; y: number }): Part {
  const label = text(str, x, y);
  return {
    texts: [label],
    strokes: [
      line(BLACK, x - 2, y + 1, x + label.width + 2, y + 1, { width: 0.25 }),
      line(BLACK, x - 2, y + 1, tip.x, tip.y, { width: 0.25 }),
    ],
  };
}

function read(extraction: VectorPageExtraction, correspondences?: ReadonlyMap<string, VectorClass>) {
  return readVectorPage(extraction, { calibration: CALIBRATION, correspondences, clock: () => 0 });
}

function totals(reading: VectorPageReading) {
  return (reading.networks?.totals ?? []).map(({ network, material, dn, runs, length_m }) => ({ network, material, dn, runs, length_m }));
}

function metres(reading: VectorPageReading, network: NetworkCode) {
  return (reading.networks?.totals ?? []).filter((total) => total.network === network).reduce((sum, total) => sum + (total.length_m ?? 0), 0);
}

function classOf(reading: VectorPageReading, color: string) {
  const group = reading.groups.find((entry) => entry.layer === null && entry.colors.includes(color) && entry.dash === null && entry.width === 0.5);
  return group ? { class: group.class, source: group.source, candidates: group.candidates } : null;
}

describe("network centrelines (measure.ts)", () => {
  it("measures a pipe drawn as a band (outlines, tint, dashed centre line) once, on its centreline", () => {
    const reading = read(page([...LEGEND, { strokes: band(100, 100 + FIVE_M, 300, BLUE, BLUE_TINT) }]));
    const ink = reading.groups.filter((group) => group.class === "EF").reduce((sum, group) => sum + group.length_pt, 0);
    expect(pointsToMetres(ink, 50)).toBeGreaterThan(20); // four strokes of 5 m and the legend sample
    expect(reading.scale.denominator).toBe(50);
    expect(totals(reading)).toEqual([{ network: "EF", material: null, dn: null, runs: 1, length_m: expect.closeTo(5, 2) }]);
    const [run] = reading.networks?.runs ?? [];
    expect(run.width_pt).toBeCloseTo(2, 2);
    expect(run.segment.y0).toBeCloseTo(300, 2);
    expect(run.segment.y1).toBeCloseTo(300, 2);
  });

  it("measures a horizontal band once when its outlines lean by ±0.01 pt (rounding across 0° and 180°)", () => {
    const x1 = 100 + FIVE_M;
    const reading = read(page([...LEGEND, {
      strokes: [line(BLUE, 100, 299, x1, 299.01), line(BLUE, 100, 301.01, x1, 301), line(BLUE_TINT, 100, 300, x1, 300, { width: 1.5 })],
    }]));
    expect(metres(reading, "EF")).toBeCloseTo(5, 2);
  });

  it("counts a stroke drawn twice, or a pipe drawn in overlapping pieces, once", () => {
    const reading = read(page([...LEGEND, {
      strokes: [
        line(BLUE, 100, 300, 100 + FIVE_M, 300), line(BLUE, 100, 300, 100 + FIVE_M, 300), // 5 m, twice
        line(BLUE, 600, 200, 600, 300), line(BLUE, 600, 280, 600, 200 + THREE_M), // 3 m in two pieces sharing 20 pt
      ],
    }]));
    expect(totals(reading)).toEqual([{ network: "EF", material: null, dn: null, runs: 2, length_m: expect.closeTo(8, 2) }]);
  });

  it("keeps two pipes of different networks 1.5 pt apart as two runs with their own lengths", () => {
    const reading = read(page([...LEGEND, {
      strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300), line(ORANGE, 100, 301.5, 100 + THREE_M, 301.5)],
    }]));
    expect(metres(reading, "EF")).toBeCloseTo(5, 2);
    expect(metres(reading, "EU")).toBeCloseTo(3, 2);
    expect(reading.networks?.runs).toHaveLength(2);
  });

  it("does not count the caps across the ends of a band, drawn apart or as the sides of a closed outline", () => {
    const x1 = 100 + FIVE_M;
    const apart = read(page([...LEGEND, {
      strokes: [...band(100, x1, 300, BLUE, BLUE_TINT), line(BLUE, 100, 299, 100, 301), line(BLUE, x1, 299, x1, 301)],
    }]));
    const outline = read(page([...LEGEND, {
      strokes: [{ color: BLUE, points: [100, 299, x1, 299, x1, 301, 100, 301, 100, 299], closed: true }, line(BLUE_TINT, 100, 300, x1, 300, { width: 1.5 })],
    }]));
    for (const reading of [apart, outline]) {
      // With its two 2 pt caps the pipe would read 5.07 m.
      expect(totals(reading)).toEqual([{ network: "EF", material: null, dn: null, runs: 1, length_m: expect.closeTo(5, 2) }]);
    }
  });

  it("does not measure the samples drawn in the legend box", () => {
    const reading = read(page([...LEGEND, { strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300)] }]));
    expect(reading.legend.boxes.length).toBeGreaterThan(0);
    // The 40 pt EF sample would add 0.71 m; the EU sample alone would make an EU total.
    expect(totals(reading)).toEqual([{ network: "EF", material: null, dn: null, runs: 1, length_m: expect.closeTo(5, 2) }]);
    expect(reading.networks?.excluded.segments).toBe(2);
  });

  it("measures a pipe whose network code is written alone on its row (an inline tag)", () => {
    // « EF » (6 pt) ends at x = 90.6 on the pipe's row; the pipe starts at x = 100.
    const reading = read(page([...LEGEND, { strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300)], texts: [text("EF", 84, 303)] }]));
    expect(metres(reading, "EF")).toBeCloseTo(5, 2);
  });

  it("measures a dark pipe drawn as a closed band outline instead of taking it for a diagram frame", () => {
    const navy = "#000099"; // lightness 0.3: dark
    const navyTint = "#6666c2"; // 40 % tint of navy
    // A 4 pt band, 1000 pt long (17.64 m): its outline covers 0.4 % of the A3 page.
    const reading = read(page([legendRow("EF", 0, [navy]), {
      strokes: [
        { color: navy, points: [100, 400, 1100, 400, 1100, 404, 100, 404, 100, 400], closed: true },
        line(navyTint, 100, 402, 1100, 402, { width: 3 }),
      ],
    }]));
    expect(classOf(reading, navy)?.class).toBe("EF");
    expect(metres(reading, "EF")).toBeCloseTo(pointsToMetres(1000, 50), 2);
  });
});

describe("legend colours and keywords (legend.ts, classify.ts, colors.ts)", () => {
  it("gives a code alone (« EF », « EU/EV », « EG VC ») the colours of the samples on its row, never a pipe label's", () => {
    const model = buildPageModel(page([
      legendRow("EF", 0, [BLUE]), legendRow("EU/EV", 1, [ORANGE]), legendRow("EG VC", 2, ["#00ffff"]),
      // A pipe label with a stroke on its row is no legend entry.
      { texts: [text("EF - PER DN 16", 40, 200, 8)], strokes: [line(MAGENTA, 120, 196, 160, 196)] },
    ]));
    const legend = readLegend(model);
    expect(legend.colors).toEqual([
      { color: BLUE, network: "EF", candidates: ["EF"] },
      { color: "#00ffff", network: "CHW", candidates: ["CHW"] },
      { color: ORANGE, network: "EUV", candidates: ["EUV"] },
    ]);
    expect(legend.entries.map((entry) => entry.text)).toEqual(["EF", "EU/EV", "EG VC"]);
  });

  it("gives a colour drawn for EU and EU/EV the network EUV", () => {
    const legend = readLegend(buildPageModel(page([legendRow("EU", 0, ["#00ff00"]), legendRow("EU/EV", 1, ["#00ff00"])])));
    expect(legend.colors).toEqual([{ color: "#00ff00", network: "EUV", candidates: ["EU", "EUV"] }]);
  });

  it("keeps a colour drawn for ECS and CS unclassified with candidates [CS, ECS]", () => {
    const model = buildPageModel(page([legendRow("ECS", 0, [RED]), legendRow("CS", 1, [RED]), { strokes: [line(RED, 100, 300, 400, 300)] }]));
    const legend = readLegend(model);
    expect(legend.colors).toEqual([{ color: RED, network: null, candidates: ["CS", "ECS"] }]);
    const classes = classifyByKeywords(model, legend);
    const pipe = model.groups.findIndex((group) => group.key.color === RED);
    expect(classes[pipe]).toEqual({ class: null, source: null, confidence: null, candidates: ["CS", "ECS"] });
  });

  it("gives a 30 % tint and a shade of a legend colour its network, never an unrelated colour", () => {
    const model = buildPageModel(page([...LEGEND, {
      strokes: [line("#4d4dff", 100, 300, 400, 300), line("#000099", 100, 320, 400, 320), line(MAGENTA, 100, 340, 400, 340)],
    }]));
    const legend = readLegend(model);
    expect(matchLegendColor(legend, "#4d4dff")?.network).toBe("EF");
    expect(matchLegendColor(legend, "#000099")?.network).toBe("EF");
    expect(matchLegendColor(legend, MAGENTA)).toBeNull();
    const classes = classifyByKeywords(model, legend);
    const of = (color: string) => classes[model.groups.findIndex((group) => group.key.color === color)];
    expect(of("#4d4dff")).toMatchObject({ class: "EF", source: "legend" });
    expect(of("#000099")).toMatchObject({ class: "EF", source: "legend" });
    expect(of(MAGENTA)).toMatchObject({ class: null, candidates: [] });
  });

  it("never makes a grey or near-white sample or stroke a network", () => {
    expect([isGrey(GREY), isNearWhite(GREY), isNearWhite(NEAR_WHITE), isNearWhite("#f0f0ff"), isGrey(BLUE), isNearWhite(BLUE_TINT)])
      .toEqual([true, false, true, true, false, false]);
    const samples = readLegend(buildPageModel(page([legendRow("EF", 0, [GREY]), legendRow("EU", 1, [NEAR_WHITE])])));
    expect(samples.entries).toEqual([]);
    expect(samples.colors).toEqual([]);
    const model = buildPageModel(page([...LEGEND, { strokes: [line(GREY, 100, 300, 400, 300), line(NEAR_WHITE, 100, 320, 400, 320)] }]));
    const legend = readLegend(model);
    expect(matchLegendColor(legend, GREY)).toBeNull();
    expect(matchLegendColor(legend, NEAR_WHITE)).toBeNull();
    // A near-white tint of the EF blue is background, not EF.
    expect(matchLegendColor(legend, "#f0f0ff")).toBeNull();
    const classes = classifyByKeywords(model, legend);
    for (const color of [GREY, NEAR_WHITE]) {
      expect(classes[model.groups.findIndex((group) => group.key.color === color)].class).toBeNull();
    }
  });

  it("reads networks and other classes from layer names, never from a near-white or grey layer", () => {
    const layers = [
      { id: "1", name: "FICTIF_EF", color: BLUE },
      { id: "2", name: "XX_CHW L00-S", color: BLUE },
      { id: "3", name: "EU/EV", color: BLUE },
      { id: "4", name: "EVIER", color: BLUE },
      { id: "5", name: "FICTIF_EF_TEXTE", color: BLUE },
      { id: "6", name: "FICTIF_EU", color: NEAR_WHITE },
      { id: "7", name: "FICTIF_ECS", color: GREY },
    ];
    const reading = read(page(
      [{ strokes: layers.map((layer, index) => line(layer.color, 100, 100 + 40 * index, 100 + FIVE_M, 100 + 40 * index, { layer: layer.id })) }],
      layers,
    ));
    expect(reading.mode).toBe("layers");
    expect(Object.fromEntries(reading.groups.map((group) => [group.layerName, group.class]))).toEqual({
      FICTIF_EF: "EF", "XX_CHW L00-S": "CHW-S", "EU/EV": "EUV", EVIER: null, FICTIF_EF_TEXTE: "texte", FICTIF_EU: null, FICTIF_ECS: null,
    });
    // Only the three network layers are measured, 5 m each.
    expect(totals(reading).map((total) => total.network).sort()).toEqual(["CHW-S", "EF", "EUV"]);
    for (const total of totals(reading)) expect(total.length_m).toBeCloseTo(5, 2);
  });

  it("lets a document correspondence replace a keyword class, never make a near-white group a network", () => {
    const extraction = page([...LEGEND, {
      strokes: [line(BLUE, 100, 300, 400, 300), line(MAGENTA, 100, 320, 400, 320), line(GREY, 100, 340, 400, 340), line(NEAR_WHITE, 100, 360, 400, 360)],
    }]);
    const model = buildPageModel(extraction);
    const id = (color: string) => model.groups.find((group) => group.key.color === color)?.id ?? "";
    const correspondences = new Map<string, VectorClass>([[id(BLUE), "ECS"], [id(MAGENTA), "EU"], [id(GREY), "EF"], [id(NEAR_WHITE), "EF"]]);
    const classes = applyCorrespondences(model, classifyByKeywords(model, readLegend(model)), correspondences, "document");
    const of = (color: string) => classes[model.groups.findIndex((group) => group.key.color === color)];
    expect(of(BLUE)).toMatchObject({ class: "ECS", source: "document" });
    expect(of(MAGENTA)).toMatchObject({ class: "EU", source: "document" });
    expect(of(GREY)).toMatchObject({ class: "EF", source: "document" }); // grey is left to the document or the user
    expect(of(NEAR_WHITE)).toMatchObject({ class: null, source: null });
    // The near-white stroke is not measured: EF is the grey stroke only (300 pt).
    expect(metres(read(extraction, correspondences), "EF")).toBeCloseTo(pointsToMetres(300, 50), 2);
  });
});

describe("pipe labels (labels.ts) and their runs (measure.ts)", () => {
  it("merges two text items of one baseline split at a font change, read as EU, PVC, DN 40", () => {
    const head = text("EU - PVC", 100, 200);
    const texts = [head, text("Me DN 40", 100 + head.width + 1.5, 200)];
    expect(mergeTextLines(texts).map((entry) => entry.str)).toEqual(["EU - PVC Me DN 40"]);
    const blocks = readLabelBlocks(texts);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toMatchObject({ network: "EU", material: "pvc", dn: 40 });
  });

  it("keeps two labels on adjacent lines naming their own network apart, and merges a continuation line", () => {
    const parallel = readLabelBlocks([text("EF - PER DN 16", 100, 200), text("ECS - PER DN 16", 100, 208)]);
    expect(parallel.map((block) => [block.label.network, block.label.dn])).toEqual([["EF", 16], ["ECS", 16]]);
    const continued = readLabelBlocks([text("EU", 100, 300), text("PVC DN 40", 100, 308)]);
    expect(continued.map((block) => block.label)).toMatchObject([{ network: "EU", material: "pvc", dn: 40 }]);
  });

  it("attaches a label to the pipe of its network at the end of its leader, not to a nearer pipe of another network", () => {
    // EF at y = 300 and EU at y = 305; the arrow ends at y = 303 (2 pt from EU, 3 pt from EF);
    // the label sits 10 pt above EU, parallel to it.
    const reading = read(page([...LEGEND,
      { strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300), line(ORANGE, 100, 305, 100 + FIVE_M, 305)] },
      leaderLabel("EF - PER DN 16", 200, 318, { x: 198, y: 303 }),
    ]));
    expect(totals(reading)).toEqual(expect.arrayContaining([
      { network: "EF", material: "per", dn: 16, runs: 1, length_m: expect.closeTo(5, 2) },
      { network: "EU", material: null, dn: null, runs: 1, length_m: expect.closeTo(5, 2) },
    ]));
    expect(reading.networks?.labels).toMatchObject({ attached: 1 });
  });

  it("attaches a label without network to no pipe", () => {
    const reading = read(page([...LEGEND,
      { strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300)] },
      leaderLabel("PVC DN 40", 200, 262, { x: 198, y: 301 }),
    ]));
    expect(totals(reading)).toEqual([{ network: "EF", material: null, dn: null, runs: 1, length_m: expect.closeTo(5, 2) }]);
    expect((reading.networks?.runs ?? []).map((run) => [run.network, run.dn, run.label, run.attached])).toEqual([["EF", null, null, null]]);
    // The legend codes are read as label blocks too; none of the blocks is attached.
    expect(reading.networks?.labels.attached).toBe(0);
  });

  it("propagates a DN to a joined run of the same network, never across networks", () => {
    // EF: A (200 pt, labelled) and B (150 pt) at a corner; EU: C (148 pt) ends 2 pt from A.
    const reading = read(page([...LEGEND,
      { strokes: [line(BLUE, 100, 300, 300, 300), line(BLUE, 300, 300, 300, 450), line(ORANGE, 150, 302, 150, 450)] },
      leaderLabel("EF - PER DN 16", 220, 262, { x: 218, y: 301 }),
    ]));
    expect(totals(reading)).toEqual(expect.arrayContaining([
      { network: "EF", material: "per", dn: 16, runs: 2, length_m: expect.closeTo(pointsToMetres(350, 50), 2) },
      { network: "EU", material: null, dn: null, runs: 1, length_m: expect.closeTo(pointsToMetres(148, 50), 2) },
    ]));
    expect(totals(reading)).toHaveLength(2);
    expect((reading.networks?.runs ?? []).map((run) => [run.network, run.attached]).sort()).toEqual([["EF", "label"], ["EF", "propagated"], ["EU", null]]);
  });

  it("gives a shared legend colour (ECS/CS) the network of the label attached to its component", () => {
    const shared = [legendRow("ECS", 0, [RED]), legendRow("CS", 1, [RED]), { strokes: [line(RED, 100, 300, 300, 300), line(RED, 300, 300, 300, 450)] }];
    const labelled = read(page([...shared, leaderLabel("ECS - cuivre DN 20", 220, 262, { x: 218, y: 301 })]));
    expect(totals(labelled)).toEqual([{ network: "ECS", material: "cuivre", dn: 20, runs: 2, length_m: expect.closeTo(pointsToMetres(350, 50), 2) }]);
    // Without label, or with labels that disagree, the runs stay « à revoir ».
    const unlabelled = read(page(shared));
    expect(totals(unlabelled)).toEqual([]);
    expect((unlabelled.networks?.runs ?? []).map((run) => [run.network, run.candidates])).toEqual([[null, ["CS", "ECS"]], [null, ["CS", "ECS"]]]);
    const disagreeing = read(page([...shared, leaderLabel("ECS - cuivre DN 20", 220, 262, { x: 218, y: 301 }),
      leaderLabel("CS - cuivre DN 20", 320, 380, { x: 302, y: 380 })]));
    expect(totals(disagreeing)).toEqual([]);
  });

  it("classifies an unlegended colour by the votes of 2 labels whose leaders end on it, never by one vote or a grey group", () => {
    const pipe = (color: string): Part => ({ strokes: [line(color, 100, 300, 100 + FIVE_M, 300)] });
    const first = leaderLabel("CHW-S - acier DN 50", 120, 262, { x: 118, y: 301 });
    const second = leaderLabel("CHW-S - acier DN 50", 240, 262, { x: 238, y: 301 });
    const voted = read(page([...LEGEND, pipe(MAGENTA), first, second]));
    expect(classOf(voted, MAGENTA)).toEqual({ class: "CHW-S", source: "label", candidates: [] });
    expect(totals(voted)).toEqual([{ network: "CHW-S", material: "acier", dn: 50, runs: 1, length_m: expect.closeTo(5, 2) }]);

    const single = read(page([...LEGEND, pipe(MAGENTA), first]));
    expect(classOf(single, MAGENTA)).toEqual({ class: null, source: null, candidates: [] });
    expect(totals(single)).toEqual([]);

    // Two votes for CHW-S and one for EF: 67 % agreement, under the 80 % required.
    const split = read(page([...LEGEND, pipe(MAGENTA), first, second, leaderLabel("EF - PER DN 16", 360, 262, { x: 358, y: 301 })]));
    expect(classOf(split, MAGENTA)?.class).toBeNull();

    const grey = read(page([...LEGEND, pipe(GREY), first, second]));
    expect(classOf(grey, GREY)?.class).toBeNull();
    expect(totals(grey)).toEqual([]);
  });
});

describe("detection badge (classify.ts detectionShare)", () => {
  it("divides the classified length by the stroke length without near-white strokes", () => {
    const layers = [
      { id: "1", name: "FICTIF_EF", color: BLUE, length: 100 }, // EF: classified
      { id: "2", name: "FICTIF_MUR", color: GREY, length: 50 }, // mur, in grey: classified
      { id: "3", name: "FICTIF_XYZ", color: MAGENTA, length: 150 }, // no class
      { id: "4", name: "FICTIF_FOND", color: NEAR_WHITE, length: 300 }, // near-white: out of both
    ];
    const reading = read(page(
      [{ strokes: layers.map((layer, index) => line(layer.color, 100, 100 + 40 * index, 100 + layer.length, 100 + 40 * index, { layer: layer.id })) }],
      layers,
    ));
    expect(reading.detection).toBeCloseTo(150 / 300, 4);
  });
});

describe("review of 3/11/2026", () => {
  it("does not measure a schematic inside a black detail frame", () => {
    const frame: Stroke = { color: BLACK, points: [700, 400, 1100, 400, 1100, 700, 700, 700, 700, 400], closed: true };
    const reading = read(page([...LEGEND,
      { strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300)] },
      { strokes: [frame, line(BLUE, 750, 550, 750 + FIVE_M, 550)] },
    ]));
    expect(reading.networks?.excluded.diagram_frames).toHaveLength(1);
    expect(metres(reading, "EF")).toBeCloseTo(5, 2);
  });

  it("never measures a near-white stroke of a network layer, nor counts it in the badge", () => {
    const layers = [{ id: "1R", name: "FICTIF_EF" }];
    const reading = read(page([
      { strokes: [line(BLUE, 100, 100, 100 + FIVE_M, 100, { layer: "1R" }), line(NEAR_WHITE, 100, 400, 100 + FIVE_M, 400, { layer: "1R" })] },
      { strokes: [line(GREY, 100, 600, 100 + FIVE_M, 600)] },
    ], layers));
    expect(reading.groups.find((group) => group.layer === "1R")?.class).toBe("EF");
    expect(metres(reading, "EF")).toBeCloseTo(5, 2);
    // Classified 5 m of the 10 m of non near-white strokes (the grey line is not classified).
    expect(reading.detection).toBeCloseTo(0.5, 3);
  });

  it("does not read a layer hidden in the document's default configuration", () => {
    const extraction = page([
      { strokes: [line(BLUE, 100, 100, 100 + FIVE_M, 100, { layer: "1R" }), line(BLUE, 100, 300, 100 + FIVE_M, 300, { layer: "2R" })] },
    ], [{ id: "1R", name: "FICTIF_EF" }, { id: "2R", name: "FICTIF_EF_VARIANTE" }]);
    extraction.layers = extraction.layers.map((layer) => (layer.id === "2R" ? { ...layer, visible: false } : layer));
    const reading = read(extraction);
    expect(reading.groups.find((group) => group.layer === "2R")?.class).toBeNull();
    expect(metres(reading, "EF")).toBeCloseTo(5, 2);
  });

  it("gives no length on a page whose scale is not verified, whatever its cartouche says", () => {
    const extraction = page([...LEGEND,
      { strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300)], texts: [text("Echelle", 900, 780), text("1/50", 940, 780)] },
    ]);
    const reading = readVectorPage(extraction, { clock: () => 0 });
    expect(reading.scale).toMatchObject({ status: "unverified", denominator: null });
    expect(reading.networks?.totals.map((total) => [total.network, total.length_m])).toEqual([["EF", null]]);
  });

  it("keeps a band whole when an unrelated parallel stroke of its network lies between its offsets elsewhere", () => {
    // Band outlines at y 299 and 301 from x 100. Far to the right (x 900+), a 3 m band of three EF lines at y 293,
    // 295.4 and 297.8. Clustered page-wide by offset from y 293, the 7 pt cap cut the first band between 299 and 301.
    const reading = read(page([...LEGEND, { strokes: [
      line(BLUE, 100, 299, 100 + FIVE_M, 299), line(BLUE, 100, 301, 100 + FIVE_M, 301),
      line(BLUE, 900, 293, 900 + THREE_M, 293), line(BLUE, 900, 295.4, 900 + THREE_M, 295.4), line(BLUE, 900, 297.8, 900 + THREE_M, 297.8),
    ] }]));
    expect(metres(reading, "EF")).toBeCloseTo(8, 2);
    expect(reading.networks?.runs.filter((run) => run.network === "EF").length).toBe(2);
  });

  it("never spreads the network of a shared colour through a joined run of another network", () => {
    const reading = read(page([legendRow("ECS", 0, [RED]), legendRow("CS", 1, [RED]), legendRow("EF", 2, [BLUE]), {
      strokes: [line(RED, 100, 300, 300, 300), line(BLUE, 300, 300, 300, 450), line(RED, 300, 450, 500, 450)],
    }, leaderLabel("ECS - PER DN 16", 150, 262, { x: 148, y: 301 })]));
    const runs = (reading.networks?.runs ?? []).filter((run) => run.candidates.length > 0).map((run) => [Math.round(run.segment.y0), run.network]);
    expect(runs).toEqual(expect.arrayContaining([[300, "ECS"], [450, null]]));
  });

  it("gives each column of a legend row its own sample", () => {
    const left = text("EF", 40, 60, 8), right = text("EU", 140, 60, 8);
    const cy = left.y - left.height / 2;
    const legend = readLegend(buildPageModel(page([{ texts: [left, right], strokes: [
      line(BLUE, 60, cy, 100, cy), line(ORANGE, 160, cy, 200, cy),
    ] }])));
    expect(legend.colors.map((entry) => [entry.color, entry.network])).toEqual([[BLUE, "EF"], [ORANGE, "EU"]]);
  });

  it("merges an upward label split by pdfjs and reads a level in a layer name as no direction", () => {
    // Reading bottom to top: the first piece is the lower one, the next one above it along the baseline.
    const up = -Math.PI / 2;
    const lines = mergeTextLines([
      { str: "EU - PVC", x: 300, y: 400, width: 26.4, height: 6, angle: up },
      { str: " DN 40", x: 300, y: 373.6, width: 19.8, height: 6, angle: up },
    ]);
    expect(lines.map((entry) => entry.str)).toEqual(["EU - PVC DN 40"]);
    expect(readLabelBlocks(lines.length ? [{ str: "EU - PVC", x: 300, y: 400, width: 26.4, height: 6, angle: up },
      { str: " DN 40", x: 300, y: 373.6, width: 19.8, height: 6, angle: up }] : []).map((block) => block.label))
      .toEqual([{ network: "EU", material: "pvc", materialLabel: "PVC", dn: 40, insulated: false }]);
    expect(classOfLayerName("XX_CHW_R-1")).toBe("CHW");
    expect(classOfLayerName("XX_CHW L00-R")).toBe("CHW-R");
  });
});

describe("review of PR #145 (Codex, 3/11/2026)", () => {
  const dnOfRunAt = (reading: VectorPageReading, y: number) =>
    (reading.networks?.runs ?? []).find((run) => Math.abs(run.segment.y0 - y) < 0.5)?.dn ?? null;

  it("gives an inline label's DN to the nearest pipe of its network, whichever is indexed first", () => {
    // Two disconnected EF pipes 6 pt apart; a 6 pt label centred 2 pt from one and 8 pt from the other (both within 2.5 heights).
    const pipes = { strokes: [line(BLUE, 100, 100, 100 + FIVE_M, 100), line(BLUE, 100, 106, 100 + FIVE_M, 106)] };
    const nearUpper = read(page([...LEGEND, pipes, { texts: [text("EF - PER DN 16", 150, 101)] }]));
    expect([dnOfRunAt(nearUpper, 100), dnOfRunAt(nearUpper, 106)]).toEqual([16, null]);
    const nearLower = read(page([...LEGEND, pipes, { texts: [text("EF - PER DN 16", 150, 111)] }]));
    expect([dnOfRunAt(nearLower, 100), dnOfRunAt(nearLower, 106)]).toEqual([null, 16]);
  });

  it("cuts a run where two touching sections change DN, midway between the labels when no stroke ends between them", () => {
    // Two 100 pt EF sections touching at x 200, each labelled inline above itself (label centres at x 150 and 250).
    const labels = { texts: [text("EF - PVC DN 40", 127, 297), text("EF - PVC DN 20", 227, 297)] };
    const sections = read(page([...LEGEND, { strokes: [line(BLUE, 100, 300, 200, 300), line(BLUE, 200, 300, 300, 300)] }, labels]));
    expect(totals(sections).map(({ network, material, dn, length_m }) => ({ network, material, dn, length_m }))).toEqual(expect.arrayContaining([
      { network: "EF", material: "pvc", dn: 40, length_m: expect.closeTo(pointsToMetres(100, 50), 3) },
      { network: "EF", material: "pvc", dn: 20, length_m: expect.closeTo(pointsToMetres(100, 50), 3) },
    ]));
    expect(totals(sections)).toHaveLength(2);
    // The same 200 pt drawn as one stroke (TI-662 L3c): cut midway between the two labels, at x 200.
    const single = read(page([...LEGEND, { strokes: [line(BLUE, 100, 300, 300, 300)] }, labels]));
    expect(totals(single).map(({ dn, length_m }) => ({ dn, length_m }))).toEqual(expect.arrayContaining([
      { dn: 40, length_m: expect.closeTo(pointsToMetres(100.1, 50), 2) },
      { dn: 20, length_m: expect.closeTo(pointsToMetres(99.9, 50), 2) },
    ]));
    expect(totals(single)).toHaveLength(2);
  });

  it("never drops a short pipe of another network crossing a longer pipe as its cap", () => {
    const reading = read(page([...LEGEND, { strokes: [line(BLUE, 100, 300, 300, 300), line(ORANGE, 200, 294, 200, 306)] }]));
    expect(metres(reading, "EF")).toBeCloseTo(pointsToMetres(200, 50), 3);
    expect(metres(reading, "EU")).toBeCloseTo(pointsToMetres(12, 50), 3);
  });

  it("takes only a closed rectangle for a diagram frame, never an open U-shaped wall or a closed trapezoid", () => {
    const pipe = line(BLUE, 150, 200, 250, 200);
    const open: Stroke = { color: BLACK, points: [100, 100, 300, 100, 300, 300, 100, 300] };
    const trapezoid: Stroke = { color: BLACK, points: [100, 100, 300, 100, 300, 300, 200, 300, 100, 100], closed: true };
    for (const wall of [open, trapezoid]) {
      const reading = read(page([...LEGEND, { strokes: [wall, pipe] }]));
      expect(reading.networks?.excluded.diagram_frames).toEqual([]);
      expect(metres(reading, "EF")).toBeCloseTo(pointsToMetres(100, 50), 3);
    }
  });

  it("reads a legend code with its direction (« CHW-S », « EG-R »), never a pipe label (« EU - PVC »)", () => {
    const reading = read(page([legendRow("CHW-S", 0, [BLUE]), legendRow("EG-R", 1, [ORANGE]), legendRow("EU - PVC", 2, [MAGENTA]), { strokes: [
      line(BLUE, 100, 300, 100 + FIVE_M, 300), line(ORANGE, 100, 400, 100 + THREE_M, 400), line(MAGENTA, 100, 500, 100 + THREE_M, 500),
    ] }]));
    expect(classOf(reading, BLUE)).toMatchObject({ class: "CHW-S", source: "legend" });
    expect(classOf(reading, ORANGE)).toMatchObject({ class: "CHW-R", source: "legend" });
    expect(classOf(reading, MAGENTA)?.class).toBeNull();
    expect(metres(reading, "CHW-S")).toBeCloseTo(5, 2);
    expect(metres(reading, "CHW-R")).toBeCloseTo(3, 2);
  });
});

describe("review of PR #145, second Codex round", () => {
  it("never checks the scale with a cote of a hidden layer", () => {
    const tick = (x: number, y: number) => line(BLACK, x - 3, y + 3, x + 3, y - 3, { layer: "2R" });
    const extraction = page([
      { texts: [text("Echelle 1/50", 900, 780), text("Format A3", 900, 800)] },
      // A 200 pt dimension (3.53 m at 1/50) printed « 5.00 », on a layer OFF by default.
      { strokes: [line(BLACK, 100, 600, 300, 600, { layer: "2R" }), tick(100, 600), tick(300, 600)], texts: [text("5.00", 190, 598)] },
    ], [{ id: "2R", name: "FICTIF_COTES" }]);
    // Read from its cartouche, without the calibration of read().
    const scaleOf = () => readVectorPage(extraction, { clock: () => 0 }).scale;
    extraction.layers = extraction.layers.map((layer) => ({ ...layer, visible: false }));
    expect(scaleOf()).toMatchObject({ status: "format", denominator: 50 });
    extraction.layers = extraction.layers.map((layer) => ({ ...layer, visible: true }));
    expect(scaleOf()).toMatchObject({ status: "unverified", reason: "dimension_mismatch" });
  });

  it("leaves a shared colour run whose labels name two of its candidates « à revoir »", () => {
    const reading = read(page([legendRow("ECS", 0, [RED]), legendRow("CS", 1, [RED]), { strokes: [line(RED, 100, 300, 400, 300)] },
      { texts: [text("ECS - PVC DN 20", 127, 297), text("CS - PVC DN 20", 327, 297)] }]));
    const run = (reading.networks?.runs ?? []).find((entry) => Math.abs(entry.segment.y0 - 300) < 0.5);
    expect(run).toMatchObject({ network: null, candidates: ["CS", "ECS"] });
    expect(totals(reading).filter((total) => total.network === "ECS" || total.network === "CS")).toEqual([]);
  });
});

describe("third Codex round of PR #145 (3/11/2026)", () => {
  /**
   * One 400 x 300 pt page per rotation, drawn the same: « EF » (8 pt) with its 40 pt blue sample on its row, a
   * cartouche line, a 300 pt blue pipe, and « EF » written upward along a 35 pt blue pipe piece (an inline tag).
   */
  async function turnedLegendPdf(rotations: readonly number[]) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const rotation of rotations) {
      const sheet = doc.addPage([400, 300]);
      sheet.node.set(PDFName.of("Resources"), doc.context.obj({ Font: doc.context.obj({ F1: font.ref }) }));
      sheet.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream([
        "0 0 1 RG 0.5 w",
        "BT /F1 8 Tf 40 250 Td (EF) Tj ET", "60 254 m 100 254 l S",
        "BT /F1 8 Tf 200 40 Td (PLAN DE NIVEAU R+1 ECHELLE 1/50) Tj ET",
        "40 100 m 340 100 l S",
        "BT /F1 8 Tf 0 1 -1 0 300 150 Tm (EF) Tj ET", "296 165 m 296 200 l S",
      ].join("\n"))));
      sheet.setRotation(degrees(rotation));
    }
    return doc.save();
  }

  it("reads a legend as drawn under /Rotate 90, 180 and 270, never an inline tag across the sheet", { timeout: 60_000 }, async () => {
    const bytes = await turnedLegendPdf([0, 90, 180, 270]);
    const readings = [];
    for (const pageNumber of [1, 2, 3, 4]) {
      const model = buildPageModel(await extractVectorPage(bytes, pageNumber));
      const legend = readLegend(model);
      readings.push({
        entries: legend.entries.map((entry) => ({ text: entry.text, colors: entry.colors, sample: Math.round(entry.sampleLength_pt) })),
        blue: classifyByKeywords(model, legend)[model.groups.findIndex((group) => group.key.color === BLUE)].class,
        boxes: legend.boxes.map((box) => [box.x1 - box.x0, box.y1 - box.y0].map(Math.round)),
      });
    }
    // The same legend on every rotation, its box turned with the page (68 x 12 pt, or 12 x 68 pt a quarter turn away).
    const drawn = { entries: [{ text: "EF", colors: [BLUE], sample: 40 }], blue: "EF" };
    expect(readings).toEqual([
      { ...drawn, boxes: [[68, 12]] }, { ...drawn, boxes: [[12, 68]] }, { ...drawn, boxes: [[68, 12]] }, { ...drawn, boxes: [[12, 68]] },
    ]);
  });
});

describe("review of the third Codex round of PR #145", () => {
  it("keeps the horizontal legend of an upright page whose vertical labels outnumber it, never a vertical inline tag", { timeout: 60_000 }, async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sheet = doc.addPage([1190.55, 841.89]);
    sheet.node.set(PDFName.of("Resources"), doc.context.obj({ Font: doc.context.obj({ F1: font.ref }) }));
    const content = [
      "0.5 w", "BT /F1 8 Tf 40 780 Td (EF) Tj ET", "0 0 1 RG 60 783 m 100 783 l S",
      "BT /F1 8 Tf 40 760 Td (EU) Tj ET", "1 0.5 0 RG 60 763 m 100 763 l S",
      "BT /F1 8 Tf 900 40 Td (PLAN R+1 ECHELLE 1/50) Tj ET",
      // A vertical inline tag beside a 40 pt orange piece.
      "BT /F1 8 Tf 0 1 -1 0 996 440 Tm (EU) Tj ET", "1 0.5 0 RG 999 455 m 999 495 l S",
    ];
    // Twelve blue risers, each labelled vertically: 204 vertical characters against 25 horizontal ones.
    for (let index = 0; index < 12; index += 1) {
      const x = 200 + 50 * index;
      content.push(`0 0 1 RG ${x} 100 m ${x} 600 l S`, `BT /F1 8 Tf 0 1 -1 0 ${x - 4} 300 Tm (COLONNE EF PER 16) Tj ET`);
    }
    sheet.node.set(PDFName.of("Contents"), doc.context.register(doc.context.stream(content.join("\n"))));
    const model = buildPageModel(await extractVectorPage(await doc.save(), 1));
    const legend = readLegend(model);
    expect(legend.entries.map((entry) => [entry.text, entry.colors])).toEqual([["EF", [BLUE]], ["EU", ["#ff8000"]]]);
    expect(classifyByKeywords(model, legend)[model.groups.findIndex((group) => group.key.color === BLUE)].class).toBe("EF");
  });

  it("merges the two pieces of a label on a page turned by /Rotate 180, tilted across ±π", () => {
    // Read right to left: « EU - PVC » at angle π from x = 500, then « DN 40 » at −π + 0.005 after it.
    const head = { ...text("EU - PVC", 500, 300), angle: Math.PI };
    const tail = { ...text("DN 40", 500 - head.width - 1.5, 300), angle: -Math.PI + 0.005 };
    expect(mergeTextLines([head, tail]).map((entry) => entry.str)).toEqual(["EU - PVC DN 40"]);
  });
});

describe("fourth Codex round of PR #145", () => {
  const A0 = { width: 3370.39, height: 2383.94 };
  // An EF pipe on the diagonal of an A0 sheet: 2000 pt across and down (y = x − 100), 49.89 m at 1/50.
  const diagonal = line(BLUE, 300, 200, 2300, 2200);
  const diagonalLength = 2000 * Math.SQRT2;
  const onA0 = (parts: readonly Part[]) => read({ ...page(parts), width: A0.width, height: A0.height });

  it("attaches the inline label of a long diagonal pipe on an A0 sheet", () => {
    // « EF - PVC DN 40 » along the pipe, 2 pt above its middle (the glyphs rise along (sin, −cos)).
    const angle = Math.PI / 4;
    const label = { ...text("EF - PVC DN 40", 1200 + 2 * Math.sin(angle), 1100 - 2 * Math.cos(angle)), angle };
    const reading = onA0([...LEGEND, { strokes: [diagonal], texts: [label] }]);
    expect(totals(reading)).toEqual([
      { network: "EF", material: "pvc", dn: 40, runs: 1, length_m: expect.closeTo(pointsToMetres(diagonalLength, 50), 2) },
    ]);
  });

  it("passes the DN of a branch joined to the middle of a long diagonal pipe on to it", () => {
    // A 100 pt EF branch from the diagonal's point (1300, 1200), labelled inline above itself.
    const branch = { strokes: [diagonal, line(BLUE, 1300, 1200, 1400, 1200)], texts: [text("EF - PVC DN 25", 1320, 1197)] };
    const reading = onA0([...LEGEND, branch]);
    expect(totals(reading)).toEqual([
      { network: "EF", material: "pvc", dn: 25, runs: 2, length_m: expect.closeTo(pointsToMetres(diagonalLength + 100, 50), 2) },
    ]);
  });

  it("never takes a long wall beside a pipe for its label's underline", () => {
    // Horizontal (A3): an EF pipe labelled inline, a black wall 10 pt above it under the label, a second EF pipe 5 pt past the wall's end.
    const flat = read(page([...LEGEND, {
      strokes: [line(BLUE, 100, 300, 700, 300), line(BLACK, 100, 290, 700, 290, { width: 0.25 }), line(BLUE, 705, 290, 900, 290)],
      texts: [text("EF - PVC DN 40", 380, 297)],
    }]));
    expect((flat.networks?.runs ?? []).map((run) => [Math.round(run.segment.x0), run.dn])).toEqual(expect.arrayContaining([[100, 40], [705, null]]));
    // The same on the diagonal of an A0 sheet: the wall 10 pt from the pipe on the label's side.
    const angle = Math.PI / 4;
    const up = { x: Math.sin(angle), y: -Math.cos(angle) };
    const label = { ...text("EF - PVC DN 40", 1200 + 2 * up.x, 1100 + 2 * up.y), angle };
    const wall = line(BLACK, 300 + 10 * up.x, 200 + 10 * up.y, 2300 + 10 * up.x, 2200 + 10 * up.y, { width: 0.25 });
    const tilted = onA0([...LEGEND, { strokes: [diagonal, wall, line(BLUE, 2310, 2195, 2700, 2195)], texts: [label] }]);
    expect((tilted.networks?.runs ?? []).map((run) => [Math.round(run.segment.x0), run.dn])).toEqual(expect.arrayContaining([[300, 40], [2310, null]]));
  });
});

describe("post-merge Codex review of PR #145", () => {
  it("never lets an unrelated text far off a tilted label's baseline end the search for its continuation", () => {
    // « EF PVC DN » (50 pt wide) and « 40 » 55 pt after it on its baseline, tilted by 0.019 rad; « NOTE » 900 pt below.
    const angle = 0.019;
    const head = { ...text("EF PVC DN", 100, 100), width: 50, angle };
    const tail = { ...text("40", 155, 101.05), angle };
    const note = { ...text("NOTE", 150, 1000), angle };
    expect(mergeTextLines([head, tail]).map((entry) => entry.str)).toEqual(["EF PVC DN 40"]);
    expect(mergeTextLines([head, note, tail]).map((entry) => entry.str).sort()).toEqual(["EF PVC DN 40", "NOTE"]);
    expect(readLabelBlocks([head, note, tail]).map((block) => block.label)).toEqual([
      expect.objectContaining({ network: "EF", material: "pvc", dn: 40 }),
    ]);
    // The cut-off still holds: a piece of the same baseline past it starts its own line.
    const far = { ...text("DN 63", 100 + 80 * Math.cos(angle), 100 + 80 * Math.sin(angle)), angle };
    expect(mergeTextLines([head, note, far]).map((entry) => entry.str).sort()).toEqual(["DN 63", "EF PVC DN", "NOTE"]);
  });

  it("reads the continuation line of a tilted label, right-aligned under its first line", () => {
    const angle = 0.019, h = 2.5;
    const c = Math.cos(angle), sn = Math.sin(angle);
    const head = { ...text("EF - PVC PRESSION", 100, 100, h), width: 100, angle };
    // 90 pt along the first line and 1.2 heights below its baseline (down is (−sin, cos) in page space, y down).
    const tail = { ...text("DN 40", 100 + 90 * c - 1.2 * h * sn, 100 + 90 * sn + 1.2 * h * c, h), width: 25, angle };
    expect(readLabelBlocks([head, tail]).map((block) => block.label)).toEqual([expect.objectContaining({ network: "EF", material: "pvc-pression", dn: 40 })]);
  });

  it("merges the pieces of a label straddling two direction buckets, or either side of ±π", () => {
    // Read right to left, at π − 0.003 then −π + 0.002: the last bucket before π and the first one after it.
    const head = { ...text("EU - PVC", 500, 300, 2.5), width: 40, angle: Math.PI - 0.003 };
    const tail = { ...text("DN 40", 458.5, 300 + 41.5 * Math.sin(0.003), 2.5), width: 25, angle: -Math.PI + 0.002 };
    expect(mergeTextLines([head, tail]).map((entry) => entry.str)).toEqual(["EU - PVC DN 40"]);
    expect(readLabelBlocks([head, tail]).map((block) => block.label)).toEqual([expect.objectContaining({ network: "EU", material: "pvc", dn: 40 })]);
    // Upright, the head at 0.021 rad (bucket 1) and its continuation at 0.019 rad (bucket 0, read first).
    const upright = { ...text("EF - PVC", 100, 100, 2.5), width: 40, angle: 0.021 };
    const after = { ...text("DN 40", 100 + 41.5 * Math.cos(0.021), 100 + 41.5 * Math.sin(0.021), 2.5), width: 25, angle: 0.019 };
    expect(mergeTextLines([upright, after]).map((entry) => entry.str)).toEqual(["EF - PVC DN 40"]);
  });
});

describe("cut and propagation of DN (TI-662 L3c)", () => {
  /** The run whose centreline passes through a point: its network, DN and how it got it. */
  const runAt = (reading: VectorPageReading, point: Point) => {
    const run = (reading.networks?.runs ?? []).find((entry) => distanceToSegment(point, entry.segment) < 0.5);
    return run ? { network: run.network, dn: run.dn, attached: run.attached } : null;
  };

  it("cuts a run drawn in several strokes between two disagreeing labels at the stroke end nearest their middle", () => {
    // EF from x 100 to 400 in six 50 pt strokes; DN 40 centred at x 150, DN 20 at x 330: their middle is x 240, the nearest stroke end x 250.
    const strokes = [100, 150, 200, 250, 300, 350].map((x) => line(BLUE, x, 300, x + 50, 300));
    const reading = read(page([...LEGEND, { strokes }, { texts: [text("EF - PVC DN 40", 126.9, 297), text("EF - PVC DN 20", 306.9, 297)] }]));
    expect(totals(reading).map(({ dn, runs, length_m }) => ({ dn, runs, length_m }))).toEqual(expect.arrayContaining([
      { dn: 40, runs: 1, length_m: expect.closeTo(pointsToMetres(150, 50), 3) },
      { dn: 20, runs: 1, length_m: expect.closeTo(pointsToMetres(150, 50), 3) },
    ]));
    expect(totals(reading)).toHaveLength(2);
  });

  it("leaves a run « conflict » when two disagreeing labels are printed at the same place along it", () => {
    // DN 40 above and DN 20 below the pipe, both centred at x 200.
    const reading = read(page([...LEGEND, { strokes: [line(BLUE, 100, 300, 300, 300)] },
      { texts: [text("EF - PVC DN 40", 176.9, 297), text("EF - PVC DN 20", 176.9, 309)] }]));
    expect((reading.networks?.runs ?? []).map((run) => [run.dn, run.attached])).toEqual([[null, "conflict"]]);
    expect(totals(reading)).toEqual([{ network: "EF", material: null, dn: null, runs: 1, length_m: expect.closeTo(pointsToMetres(200, 50), 3) }]);
  });

  it("lets a DN pass through a conflict run to the runs joined beyond it, never giving it to the conflict run", () => {
    // EF: X (x 100 to 300, y 300) with DN 40 and DN 20 both pointing at x 201; Y (x 300, down to y 500) labelled DN 32; Z (x 100) unlabelled.
    const reading = read(page([...LEGEND,
      { strokes: [line(BLUE, 100, 300, 300, 300), line(BLUE, 300, 300, 300, 500), line(BLUE, 100, 300, 100, 500)] },
      leaderLabel("EF - PVC DN 40", 220, 262, { x: 201, y: 301 }), leaderLabel("EF - PVC DN 20", 220, 345, { x: 201, y: 299 }),
      leaderLabel("EF - PVC DN 32", 320, 402, { x: 301, y: 400 }),
    ]));
    expect(runAt(reading, { x: 200, y: 300 })).toEqual({ network: "EF", dn: null, attached: "conflict" });
    expect(runAt(reading, { x: 300, y: 400 })).toEqual({ network: "EF", dn: 32, attached: "label" });
    expect(runAt(reading, { x: 100, y: 400 })).toEqual({ network: "EF", dn: 32, attached: "propagated" });
  });

  it("passes a parent's DN to the joined runs of its members, and a member's DN to its parent's run", () => {
    const layers = [{ id: "1", name: "FICTIF_EU/EV" }, { id: "2", name: "FICTIF_EU" }, { id: "3", name: "FICTIF_EV" }];
    const reading = read(page([{
      strokes: [
        // EU/EV labelled DN 100, an EU run joined at its right end, an EV run at its left end.
        line(BLUE, 100, 300, 300, 300, { layer: "1" }), line(BLUE, 300, 300, 300, 450, { layer: "2" }), line(BLUE, 100, 300, 100, 450, { layer: "3" }),
        // EU labelled DN 40, an EU/EV run joined at its right end.
        line(BLUE, 500, 300, 700, 300, { layer: "2" }), line(BLUE, 700, 300, 700, 450, { layer: "1" }),
      ],
      texts: [text("EU/EV - PVC DN 100", 170.3, 297), text("EU - PVC DN 40", 576.9, 297)],
    }], layers));
    expect(runAt(reading, { x: 200, y: 300 })).toEqual({ network: "EUV", dn: 100, attached: "label" });
    expect(runAt(reading, { x: 300, y: 400 })).toEqual({ network: "EU", dn: 100, attached: "propagated" });
    expect(runAt(reading, { x: 100, y: 400 })).toEqual({ network: "EV", dn: 100, attached: "propagated" });
    expect(runAt(reading, { x: 600, y: 300 })).toEqual({ network: "EU", dn: 40, attached: "label" });
    expect(runAt(reading, { x: 700, y: 400 })).toEqual({ network: "EUV", dn: 40, attached: "propagated" });
  });

  it("never passes a DN between two members of one parent, joined directly or through their parent's run", () => {
    const layers = [{ id: "1", name: "FICTIF_EU/EV" }, { id: "2", name: "FICTIF_EU" }, { id: "3", name: "FICTIF_EV" },
      { id: "4", name: "FICTIF_HW" }, { id: "5", name: "FICTIF_HW-S" }, { id: "6", name: "FICTIF_HW-R" }];
    const reading = read(page([{
      strokes: [
        // EU labelled DN 40; EV joined at its right end; EU/EV joined at its left end, and EV joined to that run's lower end.
        line(BLUE, 100, 300, 300, 300, { layer: "2" }), line(BLUE, 300, 300, 300, 450, { layer: "3" }),
        line(BLUE, 100, 300, 100, 450, { layer: "1" }), line(BLUE, 100, 450, 250, 450, { layer: "3" }),
        // HW labelled DN 35; HW-S joined at its right end; HW-R joined to the lower end of HW-S only.
        line(BLUE, 500, 300, 700, 300, { layer: "4" }), line(BLUE, 700, 300, 700, 450, { layer: "5" }), line(BLUE, 700, 450, 850, 450, { layer: "6" }),
      ],
      texts: [text("EU - PVC DN 40", 176.9, 297), text("HW - cuivre DN 35", 553.6, 297)],
    }], layers));
    expect(runAt(reading, { x: 200, y: 300 })).toEqual({ network: "EU", dn: 40, attached: "label" });
    expect(runAt(reading, { x: 100, y: 400 })).toEqual({ network: "EUV", dn: 40, attached: "propagated" });
    expect(runAt(reading, { x: 300, y: 400 })).toEqual({ network: "EV", dn: null, attached: null });
    expect(runAt(reading, { x: 200, y: 450 })).toEqual({ network: "EV", dn: null, attached: null });
    expect(runAt(reading, { x: 600, y: 300 })).toEqual({ network: "HW", dn: 35, attached: "label" });
    expect(runAt(reading, { x: 700, y: 400 })).toEqual({ network: "HW-S", dn: 35, attached: "propagated" });
    expect(runAt(reading, { x: 800, y: 450 })).toEqual({ network: "HW-R", dn: null, attached: null });
  });
});

describe("review of the L3c measurement PR", () => {
  const runAt = (reading: VectorPageReading, point: Point) => {
    const run = (reading.networks?.runs ?? []).find((entry) => distanceToSegment(point, entry.segment) < 0.5);
    return run ? { network: run.network, dn: run.dn, attached: run.attached } : null;
  };
  const LAYERS = [{ id: "1", name: "FICTIF_EU/EV" }, { id: "2", name: "FICTIF_EU" }, { id: "3", name: "FICTIF_EV" }];
  /** A 6 pt label centred along x at cx, baseline at y. */
  const centred = (str: string, cx: number, y: number) => text(str, cx - (0.55 * 6 * str.length) / 2, y);

  it("never passes a member's DN, labelled on its parent's run, on to the other member", () => {
    const reading = read(page([{
      strokes: [line(BLUE, 100, 300, 300, 300, { layer: "1" }), line(BLUE, 300, 300, 300, 450, { layer: "3" }), line(BLUE, 100, 300, 100, 450, { layer: "2" })],
      texts: [centred("EU - PVC DN 40", 200, 297)],
    }], LAYERS));
    expect(runAt(reading, { x: 200, y: 300 })).toEqual({ network: "EUV", dn: 40, attached: "label" });
    expect(runAt(reading, { x: 100, y: 400 })).toEqual({ network: "EU", dn: 40, attached: "propagated" });
    expect(runAt(reading, { x: 300, y: 400 })).toEqual({ network: "EV", dn: null, attached: null });
  });

  it("gives a run reached at once by two labels the DN of its own network, which then reaches the other member", () => {
    // EU labelled DN 40 and EU/EV labelled DN 100 both join the unlabelled EU/EV run P; the EV run X joins P only.
    const reading = read(page([{
      strokes: [
        line(BLUE, 100, 300, 300, 300, { layer: "2" }), line(BLUE, 300, 300, 300, 500, { layer: "1" }),
        line(BLUE, 300, 500, 500, 500, { layer: "1" }), line(BLUE, 300, 400, 150, 400, { layer: "3" }),
      ],
      texts: [centred("EU - PVC DN 40", 200, 297), centred("EU/EV - PVC DN 100", 400, 497)],
    }], LAYERS));
    expect(runAt(reading, { x: 200, y: 300 })).toEqual({ network: "EU", dn: 40, attached: "label" });
    expect(runAt(reading, { x: 400, y: 500 })).toEqual({ network: "EUV", dn: 100, attached: "label" });
    expect(runAt(reading, { x: 300, y: 450 })).toEqual({ network: "EUV", dn: 100, attached: "propagated" });
    expect(runAt(reading, { x: 200, y: 400 })).toEqual({ network: "EV", dn: 100, attached: "propagated" });
  });

  it("keeps « conflict » to the piece where two labels disagree at one place, and cuts before a clear third label", () => {
    // EF from x 100 to 500 in one stroke; two labels at x 150 and 153 (above, below), a third at x 400.
    const at = (first: number, second: number, third: number) => read(page([...LEGEND, { strokes: [line(BLUE, 100, 300, 500, 300)] },
      { texts: [centred(`EF - PVC DN ${first}`, 150, 297), centred(`EF - PVC DN ${second}`, 153, 309), centred(`EF - PVC DN ${third}`, 400, 297)] }]));
    // DN 40 and DN 20 at x 150-153, DN 20 at x 400: cut midway between x 153 and x 400.
    const twenty = at(40, 20, 20);
    expect(runAt(twenty, { x: 150, y: 300 })).toEqual({ network: "EF", dn: null, attached: "conflict" });
    expect(runAt(twenty, { x: 400, y: 300 })).toEqual({ network: "EF", dn: 20, attached: "label" });
    expect(totals(twenty).map(({ dn, length_m }) => ({ dn, length_m }))).toEqual(expect.arrayContaining([
      { dn: 20, length_m: expect.closeTo(pointsToMetres(500 - 276.5, 50), 2) },
      { dn: null, length_m: expect.closeTo(pointsToMetres(276.5 - 100, 50), 2) },
    ]));
    // DN 40 at x 150, DN 40 and DN 20 at x 395-400: the clear DN 40 section is kept, cut midway between x 150 and x 395.
    const forty = read(page([...LEGEND, { strokes: [line(BLUE, 100, 300, 500, 300)] },
      { texts: [centred("EF - PVC DN 40", 150, 297), centred("EF - PVC DN 40", 395, 309), centred("EF - PVC DN 20", 400, 297)] }]));
    expect(runAt(forty, { x: 150, y: 300 })).toEqual({ network: "EF", dn: 40, attached: "label" });
    expect(runAt(forty, { x: 400, y: 300 })).toEqual({ network: "EF", dn: null, attached: "conflict" });
    expect(totals(forty).map(({ dn, length_m }) => ({ dn, length_m }))).toEqual(expect.arrayContaining([
      { dn: 40, length_m: expect.closeTo(pointsToMetres(272.5 - 100, 50), 2) },
    ]));
  });
});

describe("second review of the L3c measurement PR", () => {
  const runAt = (reading: VectorPageReading, point: Point) => {
    const run = (reading.networks?.runs ?? []).find((entry) => distanceToSegment(point, entry.segment) < 0.5);
    return run ? { network: run.network, dn: run.dn, attached: run.attached } : null;
  };
  const LAYERS = [{ id: "1", name: "FICTIF_EU/EV" }, { id: "2", name: "FICTIF_EU" }, { id: "3", name: "FICTIF_EV" }];
  const centred = (str: string, cx: number, y: number) => text(str, cx - (0.55 * 6 * str.length) / 2, y);

  it("carries every network the agreeing labels of a run name, whatever their order", () => {
    // One EU/EV run from x 100 to 500 labelled DN 100 twice; an EU branch at its left end, an EV branch at its right end.
    const strokes = [line(BLUE, 100, 300, 500, 300, { layer: "1" }), line(BLUE, 100, 300, 100, 450, { layer: "2" }), line(BLUE, 500, 300, 500, 450, { layer: "3" })];
    for (const [left, right] of [["EU", "EU/EV"], ["EU/EV", "EU"], ["EU", "EV"], ["EV", "EU"]]) {
      const reading = read(page([{ strokes, texts: [centred(`${left} - PVC DN 100`, 150, 297), centred(`${right} - PVC DN 100`, 450, 297)] }], LAYERS));
      expect(runAt(reading, { x: 300, y: 300 })).toEqual({ network: "EUV", dn: 100, attached: "label" });
      expect(runAt(reading, { x: 100, y: 400 })).toEqual({ network: "EU", dn: 100, attached: "propagated" });
      expect(runAt(reading, { x: 500, y: 400 })).toEqual({ network: "EV", dn: 100, attached: "propagated" });
    }
  });

  it("lets a parent's DN pass on through a run a member's nearer DN reached first", () => {
    // EU/EV: P1 labelled « EU » DN 40, P2 unlabelled, Q diagonal, P3 labelled « EU/EV » DN 100; the EV run X joins P2 only.
    const reading = read(page([{
      strokes: [
        line(BLUE, 100, 300, 300, 300, { layer: "1" }), line(BLUE, 300, 300, 300, 500, { layer: "1" }),
        line(BLUE, 300, 400, 450, 400, { layer: "3" }),
        line(BLUE, 300, 500, 400, 600, { layer: "1" }), line(BLUE, 400, 600, 600, 600, { layer: "1" }),
      ],
      texts: [centred("EU - PVC DN 40", 200, 297), centred("EU/EV - PVC DN 100", 500, 597)],
    }], LAYERS));
    expect(runAt(reading, { x: 200, y: 300 })).toEqual({ network: "EUV", dn: 40, attached: "label" });
    // P2 is one join from P1 and two from P3: the nearer DN is its own.
    expect(runAt(reading, { x: 300, y: 450 })).toEqual({ network: "EUV", dn: 40, attached: "propagated" });
    expect(runAt(reading, { x: 350, y: 550 })).toEqual({ network: "EUV", dn: 100, attached: "propagated" });
    // EU's DN never reaches EV; the parent's DN does, through P2.
    expect(runAt(reading, { x: 400, y: 400 })).toEqual({ network: "EV", dn: 100, attached: "propagated" });
  });

  it("lets a parent's DN pass on through a run its member's own label holds (third review of the PR)", () => {
    // D labelled « EU/EV » DN 100, A labelled « EU » DN 40 joined to it; the EV run F joins A only.
    const reading = read(page([{
      strokes: [
        line(BLUE, 100, 300, 300, 300, { layer: "1" }), line(BLUE, 300, 300, 600, 300, { layer: "1" }),
        line(BLUE, 450, 300, 450, 450, { layer: "3" }),
      ],
      texts: [centred("EU/EV - PVC DN 100", 200, 297), centred("EU - PVC DN 40", 520, 297)],
    }], LAYERS));
    // A keeps its own label's DN; the parent's DN goes on through it to the other member, never EU's.
    expect(runAt(reading, { x: 520, y: 300 })).toMatchObject({ network: "EUV", dn: 40, attached: "label" });
    expect(runAt(reading, { x: 450, y: 400 })).toEqual({ network: "EV", dn: 100, attached: "propagated" });
  });
});

describe("Decisions classes (classify.ts applyDecisions)", () => {
  const decisionsRead = (extraction: VectorPageExtraction, decisions: ReadonlyMap<string, { class: VectorClass; confidence: number }>,
    correspondences?: ReadonlyMap<string, VectorClass>) => readVectorPage(extraction, { calibration: CALIBRATION, decisions, correspondences, clock: () => 0 });
  const idOf = (extraction: VectorPageExtraction, color: string) => buildPageModel(extraction).groups.find((group) => group.key.color === color)?.id ?? "";

  it("measures a Decisions network only at confidence 0.8 or more; under it, a proposal shown with its confidence", () => {
    const extraction = page([...LEGEND, { strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300), line(MAGENTA, 100, 500, 100 + FIVE_M, 500)] }]);
    const magenta = idOf(extraction, MAGENTA);
    const unsure = decisionsRead(extraction, new Map([[magenta, { class: "EU" as const, confidence: 0.62 }]]));
    expect(classOf(unsure, MAGENTA)).toEqual({ class: "EU", source: "decisions", candidates: [] });
    expect(unsure.groups.find((group) => group.id === magenta)?.confidence).toBe(0.62);
    expect(metres(unsure, "EU")).toBe(0);
    expect(metres(unsure, "EF")).toBeCloseTo(5, 2);
    const keywordsOnly = read(extraction);
    expect(unsure.detection).toBeCloseTo(keywordsOnly.detection ?? NaN, 6);
    const sure = decisionsRead(extraction, new Map([[magenta, { class: "EU" as const, confidence: 0.8 }]]));
    expect(metres(sure, "EU")).toBeCloseTo(5, 2);
    expect(sure.detection).toBeGreaterThan((keywordsOnly.detection ?? 0) + 0.3);
  });

  it("fills only groups left without class nor candidates, never a network on a near-white, grey or hidden group", () => {
    const extraction = page([...LEGEND, legendRow("ECS", 2, [RED]), legendRow("CS", 3, [RED]), {
      strokes: [
        line(BLUE, 100, 300, 400, 300), line(RED, 100, 320, 400, 320), line(GREY, 100, 340, 400, 340), line(GREY, 100, 360, 400, 360, { width: 1 }),
        line(NEAR_WHITE, 100, 380, 400, 380), line(MAGENTA, 100, 400, 400, 400),
      ],
    }]);
    const model = buildPageModel(extraction);
    const index = (color: string, width = 0.5) => model.groups.findIndex((group) => group.key.color === color && group.key.width === width);
    const sure = (value: VectorClass) => ({ class: value, confidence: 0.95 });
    const decisions = new Map([
      [model.groups[index(BLUE)].id, sure("EU")], [model.groups[index(RED)].id, sure("ECS")], [model.groups[index(GREY)].id, sure("EU")],
      [model.groups[index(GREY, 1)].id, sure("mur")], [model.groups[index(NEAR_WHITE)].id, sure("EF")], [model.groups[index(MAGENTA)].id, sure("EP")],
    ]);
    const classes = applyDecisions(model, classifyByKeywords(model, readLegend(model)), decisions);
    expect(classes[index(BLUE)]).toMatchObject({ class: "EF", source: "legend" });
    expect(classes[index(RED)]).toEqual({ class: null, source: null, confidence: null, candidates: ["CS", "ECS"] });
    expect(classes[index(GREY)]).toMatchObject({ class: null, source: null });
    expect(classes[index(GREY, 1)]).toEqual({ class: "mur", source: "decisions", confidence: 0.95, candidates: [] });
    expect(classes[index(NEAR_WHITE)]).toMatchObject({ class: null, source: null });
    expect(classes[index(MAGENTA)]).toEqual({ class: "EP", source: "decisions", confidence: 0.95, candidates: [] });
    // A layer hidden by the default configuration is never a Decisions network.
    const layered = page([{ strokes: [line(MAGENTA, 100, 100, 100 + FIVE_M, 100, { layer: "9R" })] }], [{ id: "9R", name: "FICTIF_XYZ" }]);
    layered.layers = layered.layers.map((layer) => ({ ...layer, visible: false }));
    const hidden = decisionsRead(layered, new Map([["oc:9R", sure("EF")]]));
    expect(hidden.groups[0]).toMatchObject({ class: null, source: null });
  });

  it("lets a document correspondence win over a Decisions answer", () => {
    const extraction = page([...LEGEND, { strokes: [line(MAGENTA, 100, 400, 100 + FIVE_M, 400)] }]);
    const magenta = idOf(extraction, MAGENTA);
    const reading = decisionsRead(extraction, new Map([[magenta, { class: "EU" as const, confidence: 0.95 }]]), new Map([[magenta, "EF"]]));
    expect(classOf(reading, MAGENTA)).toEqual({ class: "EF", source: "document", candidates: [] });
    expect(metres(reading, "EF")).toBeCloseTo(5, 2);
    expect(metres(reading, "EU")).toBe(0);
  });

  it("takes a dark rectangle Decisions proposes as a network at 0.62 for a diagram frame, never one it decides at 0.9", () => {
    // Dark green: dark, not grey (black is grey: never a Decisions network), no shade of a legend colour.
    const green = "#006600";
    const frame: Stroke = { color: green, points: [700, 400, 1100, 400, 1100, 700, 700, 700, 700, 400], closed: true };
    const extraction = page([...LEGEND, { strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300)] }, { strokes: [frame, line(BLUE, 750, 550, 750 + FIVE_M, 550)] }]);
    const frameGroup = idOf(extraction, green);
    const unsure = decisionsRead(extraction, new Map([[frameGroup, { class: "EU" as const, confidence: 0.62 }]]));
    expect(unsure.networks?.excluded.diagram_frames).toHaveLength(1);
    expect(metres(unsure, "EF")).toBeCloseTo(5, 2);
    const sure = decisionsRead(extraction, new Map([[frameGroup, { class: "EU" as const, confidence: 0.9 }]]));
    expect(sure.networks?.excluded.diagram_frames).toHaveLength(0);
    expect(metres(sure, "EF")).toBeCloseTo(10, 2);
  });

  it("keeps a dark leader Decisions proposes as a network at 0.62 a leader, never one it decides at 0.9", () => {
    // The label sits 60 pt above the EF pipe: only its dark green leader, ending on the pipe, attaches it.
    const green = "#006600";
    const label = text("EF cuivre DN 22", 200, 240);
    const extraction = page([...LEGEND, {
      texts: [label],
      strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300), line(green, 198, 241, 200 + label.width + 2, 241, { width: 0.25 }),
        line(green, 198, 241, 180, 300, { width: 0.25 })],
    }]);
    const leader = idOf(extraction, green);
    const dn = (reading: VectorPageReading) => totals(reading).filter((total) => total.network === "EF").map((total) => total.dn);
    expect(dn(read(extraction))).toEqual([22]);
    expect(dn(decisionsRead(extraction, new Map([[leader, { class: "EU" as const, confidence: 0.62 }]])))).toEqual([22]);
    expect(dn(decisionsRead(extraction, new Map([[leader, { class: "EU" as const, confidence: 0.9 }]])))).toEqual([null]);
  });
});

describe("one pipe drawn in a parent's and a member's colours (TI-662 L3d)", () => {
  const runAt = (reading: VectorPageReading, point: Point) => {
    const run = (reading.networks?.runs ?? []).find((entry) => distanceToSegment(point, entry.segment) < 0.5);
    return run ? { network: run.network, dn: run.dn, attached: run.attached } : null;
  };
  const LAYERS = [{ id: "1", name: "FICTIF_HW" }, { id: "2", name: "FICTIF_HW-S" }, { id: "3", name: "FICTIF_HW-R" }];
  const centred = (str: string, cx: number, y: number) => text(str, cx - (0.55 * 6 * str.length) / 2, y);
  /** A supply pipe along y from x0 to x1: its outlines in the member's layer, its tint (from x0 to tintEnd) in the parent's. */
  const supply = (x0: number, x1: number, y: number, tintEnd = x1): Stroke[] => [
    line(BLUE, x0, y - 1, x1, y - 1, { layer: "2" }), line(BLUE, x0, y + 1, x1, y + 1, { layer: "2" }),
    line(BLUE_TINT, x0, y, tintEnd, y, { width: 1.5, layer: "1" }),
  ];

  it("measures once, as the member, a pipe whose outlines are a member's and whose tint is its parent's", () => {
    // 5 m of supply labelled DN 35; its tint goes on 3 m past the outlines' end, alone: that part stays the parent's.
    const reading = read(page([{
      strokes: supply(100, 100 + FIVE_M, 300, 100 + FIVE_M + THREE_M),
      texts: [centred("HW-S - cuivre DN 35", 200, 297)],
    }], LAYERS));
    expect(totals(reading)).toEqual(expect.arrayContaining([
      { network: "HW-S", material: "cuivre", dn: 35, runs: 1, length_m: expect.closeTo(5, 2) },
      { network: "HW", material: "cuivre", dn: 35, runs: 1, length_m: expect.closeTo(3, 2) },
    ]));
    expect(totals(reading)).toHaveLength(2);
    expect(runAt(reading, { x: 200, y: 300 })).toEqual({ network: "HW-S", dn: 35, attached: "label" });
  });

  it("keeps a parent's pipe drawn 1.5 pt beside a member's as two pipes", () => {
    const reading = read(page([{
      strokes: [line(BLUE, 100, 300, 100 + FIVE_M, 300, { layer: "1" }), line(BLUE, 100, 301.5, 100 + FIVE_M, 301.5, { layer: "2" })],
    }], LAYERS));
    expect(metres(reading, "HW")).toBeCloseTo(5, 2);
    expect(metres(reading, "HW-S")).toBeCloseTo(5, 2);
  });

  it("never passes a return's DN to another return through the tint of a supply they both join", () => {
    // Supply from x 100 to 400; return A (x 150) labelled DN 28 and return B (x 350) both end on it.
    const reading = read(page([{
      strokes: [...supply(100, 400, 300), line(BLUE, 150, 300, 150, 450, { layer: "3" }), line(BLUE, 350, 300, 350, 450, { layer: "3" })],
      texts: [{ ...centred("HW-R - cuivre DN 28", 0, 0), x: 147, y: 420, angle: -Math.PI / 2 }],
    }], LAYERS));
    expect(runAt(reading, { x: 150, y: 400 })).toEqual({ network: "HW-R", dn: 28, attached: "label" });
    expect(runAt(reading, { x: 350, y: 400 })).toEqual({ network: "HW-R", dn: null, attached: null });
    expect(metres(reading, "HW")).toBeCloseTo(0, 2);
  });
});
