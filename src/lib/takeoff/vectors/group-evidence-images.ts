import { isNearWhite, lightnessSaturation, parseHexColor } from "@/lib/takeoff/vectors/colors";
import type { Box } from "@/lib/takeoff/vectors/geometry";
import type { CandidateEvidence, LegendBlock } from "@/lib/takeoff/vectors/group-evidence";
import type { PageModel } from "@/lib/takeoff/vectors/page-model";

// What the images of the v2 questions draw (TI-704), pure; drawn by
// group-evidence-render-server.ts from one analysis of the PDF page.
// - A group's image is 2 × 2 panels of 512 px with a 22 px caption: A the real
//   plan over the group's 160 pt window (3.06 px/pt, its texts readable);
//   B the same view faded, the group redrawn in its true colours and widths
//   (at least 2.2 px; a very light stroke gets a grey outline); C the 800 pt
//   surroundings, faded, the group at 1.6 px and A's window framed; D the
//   whole page, faded, the group at 1.4 px and C's window framed.
// - The group's own printed strokes (never its near-white ones, nor a hidden
//   layer's) are drawn whole up to maxPoints (fewer when a page asks many
//   groups: maxPagePoints in all); past it, the strokes crossing A's window are
//   kept first, then one stroke in k of the others.
// - A legend block is rendered with its texts, up to 2 000 px on its longer
//   side and at most 5 px/pt.

export const GROUP_EVIDENCE_IMAGES = {
  panelPx: 512,
  captionPx: 22,
  detailPt: 160,
  contextPt: 800,
  fade: { detail: 0.78, context: 0.7, page: 0.75 },
  minLineWidthPx: { detail: 2.2, context: 1.6, page: 1.4 },
  /** A stroke lighter than this gets a grey outline under it in B, C and D. */
  outlineLightness: 0.78,
  outline: { color: "#6b6b6b", extraPx: 1.6 },
  frame: { color: "#ff00ff", widthPx: 1.5 },
  border: "#7a7a7a",
  captionFontPx: 15,
  jpegQualities: [82, 70, 60],
  legend: { maxEdgePx: 2000, maxScale: 5, jpegQualities: [85, 70, 60] },
  maxBytes: 1_500_000,
  maxPoints: 60_000,
  /** Points of all the groups of a page at most (its plan stays within some 15 MB of JSON): shared between them. */
  maxPagePoints: 1_200_000,
} as const;

/** One stroked subpath of the group, in page space (x, y pairs), with its own colour and width. */
export type OverlayPath = { color: string; width: number; outline: boolean; points: number[] };
export type GroupImagePlan = { alias: string; detail: Box; context: Box; paths: OverlayPath[]; points: { drawn: number; total: number } };
export type LegendImagePlan = { box: Box; scale: number };
export type EvidenceImagePlan = { page: number; legends: LegendImagePlan[]; groups: GroupImagePlan[] };

const round = (value: number) => Math.round(value * 100) / 100;

/** The render box and scale of each legend block, clamped to the page (none left empty). */
export function planLegendImages(blocks: readonly LegendBlock[], width: number, height: number): LegendImagePlan[] {
  return blocks.flatMap(({ box: block }) => {
    const box = { x0: Math.max(0, block.x0), y0: Math.max(0, block.y0), x1: Math.min(width, block.x1), y1: Math.min(height, block.y1) };
    const side = Math.max(box.x1 - box.x0, box.y1 - box.y0);
    if (!(box.x1 > box.x0 && box.y1 > box.y0)) return [];
    return [{ box, scale: Math.min(GROUP_EVIDENCE_IMAGES.legend.maxScale, GROUP_EVIDENCE_IMAGES.legend.maxEdgePx / side) }];
  });
}

/** The image plan of the groups asked (module comment). */
export function planGroupImage(model: PageModel, candidate: Pick<CandidateEvidence, "alias" | "group" | "focus">,
  maxPoints: number = GROUP_EVIDENCE_IMAGES.maxPoints): GroupImagePlan {
  const { extraction, groupOf } = model;
  const hiddenLayers = new Set(extraction.layers.filter((layer) => !layer.visible).map((layer) => layer.id));
  const own = extraction.paths.filter((path) => {
    const key = extraction.groups[path.group];
    return groupOf[path.group] === candidate.group && !isNearWhite(key.color) && !(key.layer !== null && hiddenLayers.has(key.layer));
  });
  const total = own.reduce((sum, path) => sum + path.count, 0);
  let kept = own;
  if (total > maxPoints) {
    const { detail } = candidate.focus;
    const crosses = (path: (typeof own)[number]) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let index = path.start; index < path.start + path.count; index += 1) {
        x0 = Math.min(x0, extraction.points[2 * index]);
        x1 = Math.max(x1, extraction.points[2 * index]);
        y0 = Math.min(y0, extraction.points[2 * index + 1]);
        y1 = Math.max(y1, extraction.points[2 * index + 1]);
      }
      return x1 >= detail.x0 && x0 <= detail.x1 && y1 >= detail.y0 && y0 <= detail.y1;
    };
    const inside: typeof own = [];
    const outside: typeof own = [];
    let insidePoints = 0;
    for (const path of own) {
      if (crosses(path) && insidePoints + path.count <= maxPoints) {
        inside.push(path);
        insidePoints += path.count;
      } else outside.push(path);
    }
    const room = maxPoints - insidePoints;
    const outsidePoints = outside.reduce((sum, path) => sum + path.count, 0);
    const stride = room <= 0 ? Infinity : Math.ceil(outsidePoints / room);
    const strided = outside.filter((_, index) => Number.isFinite(stride) && index % stride === 0);
    // A stride by stroke may still pass the cap when strokes differ in length: the longest are dropped last.
    let left = room;
    kept = [...inside, ...strided.filter((path) => (left -= path.count) >= 0)];
  }
  const paths = kept.map((path): OverlayPath => {
    const key = extraction.groups[path.group];
    const rgb = parseHexColor(key.color);
    const points: number[] = [];
    for (let index = path.start; index < path.start + path.count; index += 1) points.push(round(extraction.points[2 * index]), round(extraction.points[2 * index + 1]));
    return { color: key.color, width: key.width, outline: rgb !== null && lightnessSaturation(rgb).lightness > GROUP_EVIDENCE_IMAGES.outlineLightness, points };
  });
  return { alias: candidate.alias, detail: candidate.focus.detail, context: candidate.focus.context, paths,
    points: { drawn: paths.reduce((sum, path) => sum + path.points.length / 2, 0), total } };
}

/** The whole plan of a page's images: its legend blocks, then the groups asked, in their order. */
export function planEvidenceImages(model: PageModel, page: number, blocks: readonly LegendBlock[],
  asked: ReadonlyArray<Pick<CandidateEvidence, "alias" | "group" | "focus">>): EvidenceImagePlan {
  const maxPoints = Math.min(GROUP_EVIDENCE_IMAGES.maxPoints, Math.floor(GROUP_EVIDENCE_IMAGES.maxPagePoints / Math.max(1, asked.length)));
  return { page, legends: planLegendImages(blocks, model.extraction.width, model.extraction.height),
    groups: asked.map((candidate) => planGroupImage(model, candidate, maxPoints)) };
}
