import { z } from "zod";

import { MATERIAL_CODES, NETWORK_CODES, type MaterialCode, type NetworkCode } from "@/lib/takeoff/bench/keys";
import { guardTiers } from "@/lib/takeoff/bench/rules";
import type { BenchPass } from "@/lib/takeoff/bench/run";
import type { BenchRuleData } from "@/lib/takeoff/bench/vector-rules";
import { blockingRules } from "@/lib/takeoff/rules/blocking";
import { ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";
import type { TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffItem } from "@/lib/takeoff/types";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import { vectorNetworkDesignation } from "@/lib/takeoff/vectors/items";

// The targeted vision pass of the takeoff bench (TI-664 step 3, TI-658 pipeline step 5: « ChatGPT seulement pour ce
// que la géométrie ne donne pas »). After the fixed rules of a pass, ChatGPT (local profile) reviews the lines they
// reject and only them, on a crop of their plan around the run:
// - reviewed: the vector lines the DN × network rule rejects (network, material or size not read, size out of
//   series): a misread label, the one thing an image can settle. A line rejected for a geometric reason (duplicate
//   between zones, area, overlap, scale) or without geometry (a raster page's level C line) is not sent;
// - at most VISION_REVIEW_LIMITS.linesPerPage lines per page (the others are counted « left out »), in calls of
//   linesPerCall lines, one image per line;
// - a « corrige » answer replaces the line's network, material and size (vocabulary of the bench keys, validated),
//   rewrites its designation, and caps its confidence at VISION_CORRECTED_CONFIDENCE: a model's reading is never a
//   high-confidence line, the user still checks it; « confirme » and « illisible » change nothing;
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

export type VisionPage = { page: number; lines: VisionLine[]; left_out: number };

/** The lines of one document to review, per page: rejected by the DN × network rule, with a geometry to crop. */
export function visionCandidates(input: {
  items: readonly TakeoffItem[];
  data: ReadonlyArray<BenchRuleData | null>;
  results: ReadonlyArray<readonly TakeoffRuleResult[]>;
  /** The scale denominator of each page read (null: no length on it). */
  denominators: ReadonlyMap<number, number | null>;
}): VisionPage[] {
  const tiers = guardTiers(input.items, input.results);
  const pages = new Map<number, VisionPage>();
  input.items.forEach((item, index) => {
    const datum = input.data[index] ?? null;
    const page = item.source_page ?? null;
    const denominator = page === null ? null : input.denominators.get(page) ?? null;
    const failures = blockingRules(input.results[index], false).filter((entry) => entry.rule === "dn_network");
    if (tiers[index] !== "rejected" || failures.length === 0 || datum === null || page === null || denominator === null) return;
    const segments = datum.geometry?.segments_m ?? [];
    if (segments.length === 0) return;
    const entry = pages.get(page) ?? { page, lines: [], left_out: 0 };
    pages.set(page, entry);
    if (entry.lines.length >= VISION_REVIEW_LIMITS.linesPerPage) {
      entry.left_out += 1;
      return;
    }
    // Page metres back to sheet points (vector-rules.ts writes metres = points × mm/pt × denominator / 1000).
    const points = (metres: number) => (metres * 1000) / denominator / MM_PER_POINT;
    const xs = segments.flatMap(([x0, , x1]) => [points(x0), points(x1)]);
    const ys = segments.flatMap(([, y0, , y1]) => [points(y0), points(y1)]);
    const margin = VISION_REVIEW_LIMITS.marginPt;
    entry.lines.push({
      alias: `L${entry.lines.length + 1}`, index, designation: item.designation, quantity: item.quantity, unit: item.unit,
      failures: failures.map(({ code, reason }) => ({ code, reason })),
      read: { network: datum.inputs.network, material: datum.inputs.material, dn: datum.inputs.dn },
      box_pt: { x0: Math.min(...xs) - margin, y0: Math.min(...ys) - margin, x1: Math.max(...xs) + margin, y1: Math.max(...ys) + margin },
    });
  });
  return [...pages.values()].sort((left, right) => left.page - right.page);
}

/** A printed size: a number of millimetres, or a DN (« 22 », « DN 22 », « Ø 110 », « 1"1/4 » is not one). */
const VISION_SIZE = /^(?:DN ?|Ø ?)?\d{1,4}(?:[.,]\d{1,2})?$/;

export const visionAnswerSchema = z.object({
  lines: z.array(z.object({
    alias: z.string().max(8),
    verdict: z.enum(["confirme", "corrige", "illisible"]),
    network: z.enum(NETWORK_CODES).nullable(),
    material: z.enum(MATERIAL_CODES).nullable(),
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
    "- « corrige » si le libellé donne le réseau, le matériau ou la taille que la lecture n'a pas, ou une autre valeur : renvoie les trois tels qu'imprimés ;",
    "- « confirme » si la lecture est juste (la règle a raison : taille ou matériau vraiment non admis) ;",
    "- « illisible » si le libellé n'est pas lisible ou absent de l'image. N'invente jamais une valeur.",
    `Réseaux : ${NETWORK_CODES.join(", ")}. Matériaux : ${MATERIAL_CODES.join(", ")}. Taille : le nombre imprimé (« DN 22 », « Ø 110 »), sinon null.`,
    "",
    "Lignes :",
    ...described,
    "",
    "Réponds en JSON : { \"lines\": [ { \"alias\", \"verdict\", \"network\", \"material\", \"dn\", \"label\" } ] }, une entrée par ligne.",
  ].join("\n");
}

/** A size as the rules read it (« DN 22 »). */
function ruleSize(dn: string) {
  const number = dn.replace(/^(?:DN ?|Ø ?)/, "").replace(",", ".");
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
    if (network === null) continue;
    const size = dn === null ? null : Number(dn.replace(/^DN /, ""));
    data[index] = { ...datum, inputs: ruleInputsFromVector({ kind: "network", network, material, dn: size, quantity: datum.inputs.model_quantity }) };
    items[index] = { ...item, designation: vectorNetworkDesignation(network, material, size),
      confidence: Math.min(item.confidence ?? VISION_CORRECTED_CONFIDENCE, VISION_CORRECTED_CONFIDENCE) };
    corrected.push(index);
  }
  return { items, data, corrected };
}

export type VisionCall = {
  lines: number;
  status: "ok" | "schema_failure" | "provider_failed" | "timeout" | "rejected" | "stopped";
  latency_ms: number;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
};

/** What the review of one page gave: its calls, its renders, the answers, and a stop that ends the run. */
export type VisionPageOutcome = {
  calls: VisionCall[];
  render_ms: number[];
  answers: VisionAnswer[];
  stop: { reason: string; message: string } | null;
};

export type VisionPageSummary = {
  page: number;
  lines: number;
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
