import { z } from "zod";

import { MATERIAL_CODES, NETWORK_CODES, type MaterialCode, type NetworkCode } from "@/lib/takeoff/bench/keys";
import type { BenchPass } from "@/lib/takeoff/bench/run";
import type { BenchRuleData } from "@/lib/takeoff/bench/vector-rules";
import { blockingRules } from "@/lib/takeoff/rules/blocking";
import { ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";
import { WRAPPING_MATERIALS } from "@/lib/takeoff/rules/network-diameters";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffItem } from "@/lib/takeoff/types";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import { vectorNetworkDesignation } from "@/lib/takeoff/vectors/items";

// The targeted vision pass of the takeoff bench (TI-664 step 3, TI-658 pipeline step 5: « ChatGPT seulement pour ce
// que la géométrie ne donne pas »). After the fixed rules of a pass, ChatGPT (local profile) reviews the lines they
// reject and only them, on a crop of their plan around the run:
// - reviewed: the vector lines the DN × network rule rejects (network, material or size not read, size out of
//   series), and only it: a misread label, the one thing an image can settle. A line also rejected for another reason
//   (duplicate between zones, area, overlap, scale: no correction clears it) or without geometry (a raster page's
//   level C line) is not sent; nor a total whose runs spread wider than maxSpanPt (its crop would be most of the sheet,
//   its labels unreadable, and one answer would rewrite all its runs), counted « too spread »;
// - at most VISION_REVIEW_LIMITS.linesPerPage lines per page (the others are counted « left out »), in calls of
//   linesPerCall lines, one image per line;
// - a « corrige » answer replaces the line's network, material and size (vocabulary of the bench keys, validated, a
//   wrapping material never: it would take the pipe out of the DN rule), rewrites its designation, and caps its
//   confidence at VISION_CORRECTED_CONFIDENCE: a model's reading is never a high-confidence line, the user still
//   checks it; its insulation line (same total) follows. One that repeats the reading, « confirme » and « illisible »
//   change nothing;
// - the corrected lines and their rules computed again are a separate state, « after vision », scored apart from
//   « after the rules »; the profile is never changed, and the first quota, rate limit or authorisation stop ends
//   the run (the script's preflight and classifyCallError).

export const VISION_REVIEW_VERSION = 1;
export const VISION_REVIEW_PROMPT_VERSION = "takeoff-vision-review-v1";
export const VISION_REVIEW_LIMITS = {
  linesPerPage: 12,
  linesPerCall: 6,
  /** Around the run: its label is printed next to it (a leader line at most), 25.4 mm of paper. */
  marginPt: 72,
  /** Widest run span sent (318 mm of paper): with its margins, at maxEdgePx, about 1.3 px per point (a 7 pt label 9 px). */
  maxSpanPt: 900,
  maxEdgePx: 1400,
  maxScale: 4,
  jpegQualities: [80, 65],
  maxBytes: 1_200_000,
  callTimeoutMs: 120_000,
  renderTimeoutMs: 60_000,
} as const;
/** The confidence of a line a vision answer corrected: uncertain (0.5 ≤ c < 0.8), never high. */
export const VISION_CORRECTED_CONFIDENCE = 0.7;

export type VisionLine = {
  alias: string;
  /** Index of the line among its document's items (the run's order). */
  index: number;
  designation: string;
  quantity: number;
  unit: string;
  failures: Array<{ code: string; reason: string }>;
  read: { network: NetworkCode | null; material: MaterialCode | null; dn: string | null };
  /** The crop, in page space (points, origin top left, y down, as the extraction reads it). */
  box_pt: { x0: number; y0: number; x1: number; y1: number };
};

export type VisionPage = { page: number; lines: VisionLine[]; left_out: number; too_spread: number };

/** The lines of one document to review, per page: rejected by the DN × network rule, with a geometry to crop. */
export function visionCandidates(input: {
  items: readonly TakeoffItem[];
  data: ReadonlyArray<BenchRuleData | null>;
  results: ReadonlyArray<readonly TakeoffRuleResult[]>;
  /** The scale denominator of each page read (null: no length on it). */
  denominators: ReadonlyMap<number, number | null>;
}): VisionPage[] {
  const pages = new Map<number, VisionPage>();
  input.items.forEach((item, index) => {
    const datum = input.data[index] ?? null;
    const page = item.source_page ?? null;
    const denominator = page === null ? null : input.denominators.get(page) ?? null;
    const blocking = blockingRules(input.results[index], false);
    const failures = blocking.filter((entry) => entry.rule === "dn_network");
    if (failures.length === 0 || failures.length !== blocking.length) return;
    if (datum === null || datum.inputs.kind !== "network" || page === null || denominator === null) return;
    const segments = datum.geometry?.segments_m ?? [];
    if (segments.length === 0) return;
    // Page metres back to sheet points (vector-rules.ts writes metres = points × mm/pt × denominator / 1000).
    const points = (metres: number) => (metres * 1000) / denominator / MM_PER_POINT;
    // Bounds accumulated one point at a time: a total can hold far more runs than Math.min/max accept as arguments.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x0, y0, x1, y1] of segments) {
      for (const [x, y] of [[points(x0), points(y0)], [points(x1), points(y1)]]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const entry = pages.get(page) ?? { page, lines: [], left_out: 0, too_spread: 0 };
    pages.set(page, entry);
    if (Math.max(maxX - minX, maxY - minY) > VISION_REVIEW_LIMITS.maxSpanPt) {
      entry.too_spread += 1;
      return;
    }
    if (entry.lines.length >= VISION_REVIEW_LIMITS.linesPerPage) {
      entry.left_out += 1;
      return;
    }
    const margin = VISION_REVIEW_LIMITS.marginPt;
    entry.lines.push({
      alias: `L${entry.lines.length + 1}`, index, designation: item.designation, quantity: item.quantity, unit: item.unit,
      failures: failures.map(({ code, reason }) => ({ code, reason })),
      read: { network: datum.inputs.network, material: datum.inputs.material, dn: datum.inputs.dn },
      box_pt: { x0: minX - margin, y0: minY - margin, x1: maxX + margin, y1: maxY + margin },
    });
  });
  return [...pages.values()].sort((left, right) => left.page - right.page);
}

/** A printed size: a number of millimetres, or a DN (« 22 », « DN 22 », « Ø 110 », « 1"1/4 » is not one). */
const VISION_SIZE = /^(?:DN ?|[Øø] ?)?\d{1,4}(?:[.,]\d{1,2})?$/i;

/** The materials a pipe may be: never a wrapping (insulation, heating cable), which the DN rule does not read. */
export const VISION_PIPE_MATERIALS = MATERIAL_CODES.filter((code) => !WRAPPING_MATERIALS.includes(code)) as
  [Exclude<MaterialCode, "calorifuge" | "cordon-chauffant">, ...Array<Exclude<MaterialCode, "calorifuge" | "cordon-chauffant">>];

export const visionAnswerSchema = z.object({
  lines: z.array(z.object({
    alias: z.string().max(8),
    verdict: z.enum(["confirme", "corrige", "illisible"]),
    network: z.enum(NETWORK_CODES).nullable(),
    material: z.enum(VISION_PIPE_MATERIALS).nullable(),
    dn: z.string().max(12).regex(VISION_SIZE).nullable(),
    /** The label as read on the image, for the report. */
    label: z.string().max(200).nullable(),
  })).max(VISION_REVIEW_LIMITS.linesPerCall),
});
export type VisionAnswer = z.infer<typeof visionAnswerSchema>["lines"][number];

/** The question for one call: the lines in the order of their images. */
export function visionPrompt(lines: readonly VisionLine[]) {
  const described = lines.map((line, position) => [
    `- ${line.alias} (image ${position + 1}) : « ${line.designation} », ${line.quantity} ${line.unit}.`,
    `  Lu sur le plan : réseau ${line.read.network ?? "non lu"}, matériau ${line.read.material ?? "non lu"}, taille ${line.read.dn ?? "non lue"}.`,
    `  Règle en échec : ${line.failures.map((failure) => failure.reason).join(" ")}`,
  ].join("\n"));
  return [
    "Tu relis des lignes de métré de plomberie lues sur un plan vectoriel, que des règles fixes ont rejetées.",
    "Chaque image est un extrait du plan centré sur le tronçon de la ligne ; son libellé (réseau, matériau, diamètre) est imprimé à côté.",
    "Pour chaque ligne, lis le libellé imprimé près du tronçon :",
    "- « corrige » si le libellé donne le réseau, le matériau ou la taille que la lecture n'a pas, ou une autre valeur : renvoie les trois, en codes de la liste ci-dessous ;",
    "- « confirme » si la lecture est juste (la règle a raison : taille ou matériau vraiment non admis) ;",
    "- « illisible » si le libellé n'est pas lisible ou absent de l'image. N'invente jamais une valeur.",
    `Codes de réseau : ${NETWORK_CODES.join(", ")}. Codes de matériau du tube : ${VISION_PIPE_MATERIALS.join(", ")} (un calorifuge n'est pas un matériau de tube). Taille : le nombre imprimé (« 22 », « 110 »), sinon null.`,
    "",
    "Lignes :",
    ...described,
    "",
    "Réponds en JSON : { \"lines\": [ { \"alias\", \"verdict\", \"network\", \"material\", \"dn\", \"label\" } ] }, une entrée par ligne.",
  ].join("\n");
}

/** A size as the rules read it (« DN 22 »). */
function ruleSize(dn: string) {
  const number = dn.replace(/^(?:DN ?|[Øø] ?)/i, "").replace(",", ".");
  return `DN ${Number(number)}`;
}

/**
 * The lines with the corrections of a vision pass, as a new state: only a « corrige » answer for a line of the list
 * changes it (network, material, size; designation rewritten; confidence capped). The given lists are not touched.
 */
export function applyVisionAnswers(input: { items: readonly TakeoffItem[]; data: ReadonlyArray<BenchRuleData | null>;
  answers: ReadonlyMap<number, VisionAnswer> }) {
  const items = [...input.items];
  const data = [...input.data];
  const corrected: number[] = [];
  for (const [index, answer] of [...input.answers].sort(([left], [right]) => left - right)) {
    const item = input.items[index];
    const datum = input.data[index];
    if (answer.verdict !== "corrige" || !item || !datum || datum.inputs.kind !== "network") continue;
    const network = answer.network ?? datum.inputs.network;
    const material = answer.material ?? datum.inputs.material;
    const dn = answer.dn === null ? datum.inputs.dn : ruleSize(answer.dn);
    if (network === null || (material !== null && WRAPPING_MATERIALS.includes(material))) continue;
    // A « corrige » that repeats the reading changes nothing.
    if (network === datum.inputs.network && material === datum.inputs.material && dn === datum.inputs.dn) continue;
    const size = dn === null ? null : Number(dn.replace(/^DN /, ""));
    const capped = (value: number | null | undefined) => Math.min(value ?? VISION_CORRECTED_CONFIDENCE, VISION_CORRECTED_CONFIDENCE);
    data[index] = { ...datum, inputs: ruleInputsFromVector({ kind: "network", network, material, dn: size, quantity: datum.inputs.model_quantity }) };
    items[index] = { ...item, designation: vectorNetworkDesignation(network, material, size), confidence: capped(item.confidence) };
    // vectorItems writes a total's insulation line right after its pipe, on the same network and size: it follows.
    const sibling = input.data[index + 1];
    const siblingItem = input.items[index + 1];
    if (sibling && siblingItem && sibling.inputs.kind === "insulation" && sibling.inputs.network === datum.inputs.network
      && sibling.inputs.dn === datum.inputs.dn && size !== null) {
      data[index + 1] = { ...sibling, inputs: ruleInputsFromVector({ kind: "insulation", network, material: "calorifuge", dn: size,
        quantity: sibling.inputs.model_quantity }) };
      items[index + 1] = { ...siblingItem, designation: vectorNetworkDesignation(network, "calorifuge", size), confidence: capped(siblingItem.confidence) };
    }
    corrected.push(index);
  }
  return { items, data, corrected };
}

export type VisionCall = {
  lines: number;
  status: "ok" | "schema_failure" | "provider_failed" | "timeout" | "rejected" | "stopped";
  latency_ms: number;
  /** output_tokens excludes the reasoning tokens, counted apart; total_tokens counts both. */
  usage: { input_tokens: number; output_tokens: number; reasoning_tokens?: number; total_tokens: number } | null;
};

/** What the review of one page gave: its calls, its renders, the lines whose crop was not drawn, the answers, a stop. */
export type VisionPageOutcome = {
  calls: VisionCall[];
  render_ms: number[];
  not_drawn?: Array<{ alias: string; issue: string }>;
  answers: VisionAnswer[];
  stop: { reason: string; message: string } | null;
};

/**
 * A reviewed page's line counts. The lines asked are those actually sent: with a crop drawn, and, after a provider stop
 * mid-page, only those of the calls made. Lines whose batch was never sent because of the stop are counted unattempted.
 */
export function visionLineCounts(candidates: number, outcome: Pick<VisionPageOutcome, "calls" | "not_drawn" | "stop">) {
  const notDrawn = outcome.not_drawn?.length ?? 0;
  const drawn = Math.max(0, candidates - notDrawn);
  const sent = outcome.stop ? Math.min(drawn, outcome.calls.reduce((total, call) => total + call.lines, 0)) : drawn;
  return { lines: sent, not_drawn: notDrawn, unattempted: drawn - sent };
}

export type VisionPageSummary = {
  page: number;
  /** Lines sent (a crop drawn, and a call made); not_drawn, too_spread and unattempted are not. */
  lines: number;
  /** Lines never sent because the provider stopped mid-page. */
  unattempted?: number;
  not_drawn: number;
  too_spread: number;
  left_out: number;
  corrected: number;
  calls: VisionCall[];
  render_ms: number[];
  answers: Array<VisionAnswer & { index: number; designation: string }>;
};

export type VisionPassSummary = {
  documents: Array<{ id: string; pages: VisionPageSummary[] }>;
  stop: { reason: string; message: string } | null;
};

/**
 * Per page read and reviewed, its time: the vector call (extraction and reading) and its vision review (renders and
 * calls). The comparison with the level C baseline (L1) reads total_ms, never the vector time alone.
 */
export function visionPageTimings(vector: ReadonlyArray<{ pass: number; vision?: VisionPassSummary }>, passes: readonly Pick<BenchPass, "pass" | "documents">[]) {
  const timings: Array<{ document: string; page: number; pass: number; vector_ms: number; vision_ms: number; total_ms: number }> = [];
  for (const pass of passes) {
    const vision = vector.find((entry) => entry.pass === pass.pass)?.vision;
    for (const document of pass.documents) {
      for (const call of document.calls) {
        if (call.status !== "ok") continue;
        const reviewed = vision?.documents.find((entry) => entry.id === document.id)?.pages.find((entry) => entry.page === call.start_page);
        const visionMs = reviewed ? reviewed.render_ms.reduce((sum, value) => sum + value, 0)
          + reviewed.calls.reduce((sum, value) => sum + value.latency_ms, 0) : 0;
        timings.push({ document: document.id, page: call.start_page, pass: pass.pass, vector_ms: call.duration_ms, vision_ms: visionMs,
          total_ms: call.duration_ms + visionMs });
      }
    }
  }
  return timings;
}
