import { degrees, PDFDocument, PDFNumber, PDFName, PDFString, PDFOperator, PDFOperatorNames, rgb, StandardFonts } from "pdf-lib";
import type { OrganCode } from "../keys";
import type { Poste } from "./types";
import type { Box, Point } from "../../vectors/geometry";

const symbols = {
  valve: [
    [
      [-6, 0],
      [-4, -4],
    ],
    [
      [-4, -4],
      [4, 4],
    ],
    [
      [4, 4],
      [6, 0],
    ],
    [
      [-4, 4],
      [4, -4],
    ],
  ],
  valveB: [
    [
      [-6, 0],
      [0, -4],
    ],
    [
      [0, -4],
      [6, 0],
    ],
    [
      [6, 0],
      [0, 4],
    ],
    [
      [0, 4],
      [-6, 0],
    ],
  ],
  check: [
    [
      [-6, 0],
      [4, -4],
    ],
    [
      [4, -4],
      [4, 4],
    ],
    [
      [4, 4],
      [-6, 0],
    ],
    [
      [4, 0],
      [6, 0],
    ],
  ],
  pump: [
    [
      [-6, 0],
      [-2, -4],
    ],
    [
      [-2, -4],
      [6, 0],
    ],
    [
      [6, 0],
      [-2, 4],
    ],
    [
      [-2, 4],
      [-6, 0],
    ],
    [
      [-2, 0],
      [2, 0],
    ],
  ],
};
type Variant = keyof typeof symbols;
type Case = {
  x: number;
  y: number;
  shape: Variant;
  case: string;
  size?: number;
  turn?: boolean;
  flip?: boolean;
  label?: boolean;
  seed?: boolean;
};
const cases: Case[][] = [
  [
    { x: 100, y: 70, shape: "valve", case: "first example", label: true, seed: true },
    { x: 290, y: 70, shape: "valveB", case: "second variant", size: 32, label: true, seed: true },
    { x: 110, y: 180, shape: "pump", case: "pump example", seed: true, label: true },
    { x: 206, y: 235, shape: "check", case: "family without example", size: 25, label: true },
    { x: 404, y: 235, shape: "check", case: "unlabelled copy without example", size: 25 },
    { x: 300, y: 175, shape: "valve", case: "rotated", turn: true, size: 32 },
    { x: 100, y: 295, shape: "pump", case: "mirrored", flip: true },
    { x: 300, y: 295, shape: "valveB", case: "close neighbours" },
    { x: 318, y: 295, shape: "valveB", case: "close neighbours" },
  ],
  [
    { x: 90, y: 80, shape: "valve", case: "plain run", seed: true, label: true },
    { x: 265, y: 80, shape: "valve", case: "tee", label: true },
    { x: 90, y: 180, shape: "valve", case: "reducer", label: true },
    { x: 265, y: 180, shape: "valve", case: "crossing", label: true },
    { x: 380, y: 175, shape: "valve", case: "different branches" },
    ...[80, 225, 370].map((x) => ({
      x,
      y: 300,
      shape: "pump" as const,
      case: "installation shown in detail",
      seed: x === 80,
      label: x === 80,
    })),
  ],
];

// Every installed occurrence gets exactly one truth record. The detail and
// legend are explanatory ink. Detail x3 describes the three drawn installations.
export const FICTION_SEED = 676;
export const FICTION_TARGETS = [
  { id: "vanne-ef", organ: "vanne", basis: "installed", discriminants: ["EF"], requiresDn: true },
  { id: "pompe-service", organ: "pompe", basis: "installed", discriminants: [], requiresDn: false },
  { id: "clapet-ef", organ: "clapet-anti-retour", basis: "installed", discriminants: ["EF"], requiresDn: true },
] as const satisfies readonly Poste[];
type TargetId = (typeof FICTION_TARGETS)[number]["id"];
type FictionPin = Point & { organ: OrganCode; poste: TargetId; dn: string | null; scenario: string };
type Example = { organ: OrganCode; box: Box; truthIndex: number };
type ReplayPoint = [x: number, y: number, poste: TargetId, dn: number | null];
type DrawingReplayPoint = [...ReplayPoint, staticPosition?: "legend"];
type Fixture = {
  id: string;
  dossier: string;
  page: number;
  bytes: Uint8Array;
  size: { width: number; height: number };
  rotation: 0 | 90 | 180 | 270;
  userUnit: number;
  support: "vector" | "raster";
  truth: FictionPin[];
  examples: Example[];
  negativeZones: Record<string, Box>;
  replay: ReplayPoint[];
  truncateTile?: number;
};

const width = 480;
const height = 420;
const baseSize = { width, height };
const rotatedLayout: Case[] = [
  { x: 200, y: 100, shape: "valve", case: "sample on transformed page", seed: true },
  { x: 220, y: 100, shape: "valve", case: "same drawing, another DN", size: 32, flip: true },
  { x: 150, y: 190, shape: "check", case: "rotated field symbol", size: 25, turn: true, label: true },
];
const fixturePlans = [
  { layout: cases[0], rotation: 0, replay: [[100, 71, "vanne-ef", 20], [110, 180, "pompe-service", null], [388, 48, "vanne-ef", null, "legend"]] },
  { layout: cases[1], rotation: 0, replay: [[90, 80, "vanne-ef", 20], [225, 301, "pompe-service", null], [266, 180, "vanne-ef", null]] },
  { layout: rotatedLayout, rotation: 90, replay: [[200, 100, "vanne-ef", 32], [220, 100, "vanne-ef", 20], [150, 190, "clapet-ef", 25]] },
  { layout: rotatedLayout, rotation: 180, replay: [[200, 100, "vanne-ef", 20], [220, 100, "vanne-ef", 32]], truncateTile: 2 },
  { layout: rotatedLayout, rotation: 270, replay: [[200, 100, "vanne-ef", 20], [220, 100, "vanne-ef", 32]] },
] satisfies { layout: Case[]; rotation: Fixture["rotation"]; replay: DrawingReplayPoint[]; truncateTile?: number }[];

function pageSpace(rotation: Fixture["rotation"], crop: Box, userUnit: number) {
  const w = crop.x1 - crop.x0;
  const h = crop.y1 - crop.y0;
  function point(x: number, y: number): Point {
    const u = x - crop.x0;
    const v = y - crop.y0;
    switch (rotation) {
      case 0: return { x: u * userUnit, y: v * userUnit };
      case 90: return { x: (h - v) * userUnit, y: u * userUnit };
      case 180: return { x: (w - u) * userUnit, y: (h - v) * userUnit };
      case 270: return { x: v * userUnit, y: (w - u) * userUnit };
    }
  }
  function box(bounds: Box): Box {
    const a = point(bounds.x0, bounds.y0);
    const b = point(bounds.x1, bounds.y1);
    return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
  }
  return {
    point, box,
    size: rotation % 180 === 0 ? { width: w * userUnit, height: h * userUnit } : { width: h * userUnit, height: w * userUnit },
  };
}

async function newFictionPdf() {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  return pdf;
}

export async function fictionalSheets(seed = FICTION_SEED) {
  let state = seed >>> 0;
  function jitter() {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state % 9) - 4;
  }
  const sheets: Fixture[] = [];
  for (const [number, plan] of fixturePlans.entries()) {
    const { layout, rotation } = plan;
    const pdf = await newFictionPdf();
    const page = pdf.addPage([width, height]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const crop = rotation ? { x0: 17, y0: 14, x1: 471, y1: 411 } : { x0: 0, y0: 0, x1: width, y1: height };
    const userUnit = rotation === 270 ? 2 : 1;
    const frame = pageSpace(rotation, crop, userUnit);
    page.setCropBox(crop.x0, height - crop.y1, crop.x1 - crop.x0, crop.y1 - crop.y0);
    page.setRotation(degrees(rotation));
    page.node.set(PDFName.of("UserUnit"), PDFNumber.of(userUnit));
    const ef = pdf.context.register(pdf.context.obj({ Type: "OCG", Name: PDFString.of("FICTIF_EF") }));
    pdf.catalog.set(PDFName.of("OCProperties"), pdf.context.obj({ OCGs: [ef], D: { Order: [ef], ON: [ef] } }));
    page.node.Resources()!.set(PDFName.of("Properties"), pdf.context.obj({ pipe: ef }));
    const id = "fiction-" + (number + 1);
    const truth: FictionPin[] = [];
    const examples: Example[] = [];
    function stroke(x: number, y: number, u: number, v: number, pipe = false) {
      if (pipe)
        page.pushOperators(
          PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of("OC"), PDFName.of("pipe")]),
        );
      page.drawLine({
        start: { x, y: height - y },
        end: { x: u, y: height - v },
        color: pipe ? rgb(0, 0.35, 0.9) : rgb(0, 0, 0),
        thickness: pipe ? 1 : 0.6,
      });
      if (pipe) page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    }
    function label(text: string, x: number, y: number) {
      page.drawText(text, { x, y: height - y, size: 6, font });
    }
    const dx = jitter(),
      dy = jitter();
    for (const c of layout) {
      const x = c.x + dx,
        y = c.y + dy,
        size = c.size ?? 20;
      const organ = c.shape === "pump" ? "pompe" : c.shape === "check" ? "clapet-anti-retour" : "vanne";
      function map(a: number, b: number): [number, number] {
        if (c.flip) a = -a;
        return c.turn ? [x - b, y + a] : [x + a, y + b];
      }
      for (const [[a, b], [u, v]] of symbols[c.shape]) stroke(...map(a, b), ...map(u, v));
      const left = c.x === 318 ? -12 : -46,
        right = c.x === 300 && c.y === 295 ? 12 : 46;
      stroke(...map(left, 0), ...map(-6, 0), true);
      stroke(...map(6, 0), ...map(right, 0), true);
      if (left < -12) label("EF DN " + size, ...map(-43, -2));
      if (right > 12) label("EF DN " + (c.case === "reducer" ? 32 : size), ...map(22, -2));
      if (c.case === "tee") stroke(x + 6, y, x + 6, y + 40, true);
      if (c.case === "different branches") {
        stroke(x + 6, y, x + 6, y + 45, true);
        label("EF DN 32", x + 8, y + 30);
      }
      if (c.case === "crossing") stroke(x, y - 40, x, y + 40, true);
      if (c.label) {
        stroke(x, y - 3, x + 14, y - 22);
        label(
          organ === "pompe" ? "Pompe" : organ === "clapet-anti-retour" ? "Clapet anti-retour" : "Vanne",
          x + 15,
          y - 23,
        );
      }
      const target = FICTION_TARGETS.find((poste) => poste.organ === organ)!;
      if (c.seed) {
        const rx = c.turn ? 4.1 : 6.1;
        const ry = c.turn ? 6.1 : 4.1;
        examples.push({ organ, truthIndex: truth.length, box: frame.box({ x0: x - rx, y0: y - ry, x1: x + rx, y1: y + ry }) });
      }
      truth.push({ ...frame.point(x, y), organ, poste: target.id, dn: target.requiresDn ? "DN " + size : null, scenario: c.case });
    }
    label("LEGENDE", 370, 30);
    label("Vanne", 402, 52);
    stroke(384, 45, 394, 51);
    stroke(384, 51, 394, 45);
    label(number === 1 ? "DETAIL TYPE x 3" : "DETAIL TYPE", 340, 383);
    for (const [[a, b], [u, v]] of symbols.pump) stroke(400 + a, 390 + b, 400 + u, 390 + v);
    stroke(24, 380, 28, 387);
    stroke(28, 387, 34, 384);
    if (number === 0) pdf.addPage([width, height]);
    const bytes = await pdf.save();
    const dossier = number < 2 ? "fiction-reseau" : "fiction-transforms";
    const replay = plan.replay.map(([x, y, poste, dn, staticPosition]): ReplayPoint => {
      const point = frame.point(x + (staticPosition ? 0 : dx), y + (staticPosition ? 0 : dy));
      return [point.x, point.y, poste, dn];
    });
    const negativeZones = {
      legend: frame.box({ x0: 360, y0: 15, x1: 460, y1: 65 }),
      detail: frame.box({ x0: 334, y0: 364, x1: 450, y1: 410 }),
    };
    sheets.push({
      id, dossier, bytes, page: 1, size: frame.size, rotation, userUnit, support: "vector",
      truth, examples, negativeZones, replay, truncateTile: plan.truncateTile,
    });
    if (number === 0) sheets.push({
      id, dossier, bytes, page: 2, size: baseSize, rotation: 0, userUnit: 1, support: "vector",
      truth: [], examples: [], negativeZones: {}, replay: [],
    });
  }
  sheets.push(await rasterSheet());
  return sheets;
}

// The scanned page is a PDF image XObject, with no text or vector symbol layer.
async function rasterSheet(): Promise<Fixture> {
  const pdf = await newFictionPdf();
  const page = pdf.addPage([width, height]);
  page.setRotation(degrees(90));
  const pixels = new Uint8Array(width * height).fill(240);
  const placements = [[135, 210, 20], [318, 100, 32]] as const;
  const digits = {
    "0": ["111", "101", "101", "101", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
  };
  for (const [x, y, dn] of placements) {
    for (const [[a, b], [u, v]] of symbols.valve) {
      const steps = Math.max(Math.abs(a - u), Math.abs(b - v));
      for (let i = 0; i <= steps; i++) {
        const px = x + Math.round(a + ((u - a) * i) / steps);
        const py = y + Math.round(b + ((v - b) * i) / steps);
        pixels[py * width + px] = 20;
      }
    }
    [...String(dn)].forEach((digit, index) => {
      digits[digit as keyof typeof digits].forEach((row, r) => {
        [...row].forEach((pixel, c) => {
          if (pixel === "1") pixels[(y - 12 + r) * width + x + 8 + 4 * index + c] = 20;
        });
      });
    });
  }
  const image = pdf.context.register(pdf.context.flateStream(pixels, {
    Type: "XObject", Subtype: "Image", Width: width, Height: height, ColorSpace: "DeviceGray", BitsPerComponent: 8,
  }));
  const name = page.node.newXObject("Scan", image);
  page.pushOperators(
    PDFOperator.of(PDFOperatorNames.PushGraphicsState),
    PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix, [width, 0, 0, height, 0, 0].map(PDFNumber.of)),
    PDFOperator.of(PDFOperatorNames.DrawObject, [name]),
    PDFOperator.of(PDFOperatorNames.PopGraphicsState),
  );
  return {
    id: "fiction-scan", dossier: "fiction-scan", bytes: await pdf.save(), page: 1,
    size: { width: height, height: width }, rotation: 90, userUnit: 1, support: "raster",
    truth: placements.map(([x, y, dn]) => ({
      x: height - y, y: x, organ: "vanne", poste: "vanne-ef", dn: "DN " + dn, scenario: "scanned drawing",
    })),
    examples: [], negativeZones: {},
    replay: [[210, 135, "vanne-ef", 20], [321, 317, "vanne-ef", null]],
  };
}
