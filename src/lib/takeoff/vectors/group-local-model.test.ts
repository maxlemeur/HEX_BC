import { describe, expect, it } from "vitest";

import { NETWORK_CODES } from "@/lib/takeoff/bench/keys";
import {
  applyDecisions, classifyByKeywords, isLocalModelPromptVersion, isMeasuredNetwork, LOCAL_MODEL_ACCEPTED_PROBABILITY,
} from "@/lib/takeoff/vectors/classify";
import type { VectorGroupKey, VectorPageExtraction, VectorPath, VectorText } from "@/lib/takeoff/vectors/extraction";
import { decisionsAnswerOf, GROUP_DECISIONS_DEVELOPER, GROUP_DECISIONS_PROMPT_VERSION, selectDecisionCandidates } from "@/lib/takeoff/vectors/group-decisions";
import { buildGroupEvidence, groupJson } from "@/lib/takeoff/vectors/group-evidence";
import {
  GROUP_LOCAL_MODEL, GROUP_LOCAL_MODEL_PROMPT_VERSION, localModelChoices, localModelEntries, localModelPageJson, localModelPrompt, readLocalModelAnswer,
  readLocalModelEntries,
} from "@/lib/takeoff/vectors/group-local-model";
import { buildPageModel } from "@/lib/takeoff/vectors/page-model";
import { readVectorPage } from "@/lib/takeoff/vectors/pipeline";

// Ways the local-mode reading of vector groups (TI-704 option B,
// group-local-model.ts) could misread a group, written before the code.
// Fictional pages and labels only.
// - the words differ from the measured ones: the developer message, the order
//   of the images (legend blocks first, then one per group in the list's
//   order), the choices with the plan's codes, the page and group JSON;
// - the model's probability is taken for a margin, or a network under 0.8 is
//   measured, one at 0.8 is not;
// - « hors_liste » gets a class instead of its proposal, « inconnu » a class,
//   an unknown value a class; a group answered twice or not at all gets one;
// - the pale guard is skipped, or applied on a layered page;
// - the answer reaches the reading as Decisions' (at Decisions' 0.5 margin).

const A3 = { width: 1190.55, height: 841.89 };
const BLUE = "#0000ff";
const RED = "#ff0000";
const MAGENTA = "#ff00ff";
const BEIGE = "#f0e0c8";

type Stroke = { color: string; points: readonly number[]; width?: number; layer?: string | null };
const line = (color: string, x0: number, y0: number, x1: number, y1: number, style: Omit<Partial<Stroke>, "color" | "points"> = {}): Stroke =>
  ({ color, points: [x0, y0, x1, y1], ...style });
const text = (str: string, x: number, y: number, height = 6): VectorText => ({ str, x, y, width: Math.round(0.55 * height * str.length * 100) / 100, height, angle: 0 });

function page(strokes: readonly Stroke[], texts: readonly VectorText[] = []): VectorPageExtraction {
  const groups: VectorGroupKey[] = [];
  const index = new Map<string, number>();
  const paths: VectorPath[] = [];
  const coordinates: number[] = [];
  for (const stroke of strokes) {
    const key: VectorGroupKey = { layer: stroke.layer ?? null, color: stroke.color, width: stroke.width ?? 0.5, dash: null };
    const id = JSON.stringify(key);
    let group = index.get(id);
    if (group === undefined) {
      group = groups.length;
      index.set(id, group);
      groups.push(key);
    }
    paths.push({ group, start: coordinates.length / 2, count: 2, closed: false });
    coordinates.push(...stroke.points);
  }
  return {
    page: 1, pages: 1, width: A3.width, height: A3.height, userUnit: 1, rotate: 0, layers: [], groups, texts: [...texts], paths,
    points: Float32Array.from(coordinates),
    counts: { operators: 0, strokePaths: paths.length, fillPaths: 0, clipPaths: 0, images: 0, imageCoverage: 0 },
    timings: { operators_ms: 0, walk_ms: 0, text_ms: 0, total_ms: 0 }, memory: { max_rss_kb: 0, heap_used_mb: 0 },
  };
}

/** A titled legend EG-A blue, EG-R red, their pipes, a magenta and a beige group to ask. */
function fixture() {
  const legend = ["EG-A", "EG-R"].map((code, row) => text(code, 40, 60 + 24 * row, 8));
  const samples = legend.map((entry, row) => line(row === 0 ? BLUE : RED, entry.x + entry.width + 10, entry.y - 4, entry.x + entry.width + 50, entry.y - 4));
  const extraction = page([...samples, line(BLUE, 300, 400, 900, 400), line(RED, 300, 404, 900, 404), line(MAGENTA, 300, 600, 900, 600),
    line(BEIGE, 300, 650, 900, 650)], [text("LEGENDE", 40, 40, 8), ...legend, text("EG-A DN 50", 300, 380), text("EG-A DN 40", 600, 380)]);
  const model = buildPageModel(extraction);
  const reading = readVectorPage(extraction, { clock: () => 0 });
  const selection = selectDecisionCandidates(model, reading);
  const evidence = buildGroupEvidence(model, reading, selection.candidates, new Set(selection.unclassed));
  const of = (color: string) => evidence.candidates.find((candidate) => candidate.stats.colors.includes(color))!;
  return { extraction, model, reading, evidence, of };
}

describe("local-mode requests (group-local-model.ts, TI-704 option B)", () => {
  it("asks with the measured words: the developer message, the legend images first, the choices with the plan's codes, page and group JSON", () => {
    const { evidence, of } = fixture();
    const groups = [of(MAGENTA), of(BEIGE)];
    const prompt = localModelPrompt(evidence, groups, 1);
    expect(GROUP_LOCAL_MODEL).toMatchObject({ model: "gpt-6.1-sol", reasoningEffort: "low", groupsPerRequest: 8 });
    expect(prompt.startsWith(`${GROUP_DECISIONS_DEVELOPER}\n\nClasse chacun des groupes de tracés ci-dessous. Les 1 premières images sont les blocs de légende du plan ; `
      + "chaque image suivante est celle d'un groupe, dans l'ordre de la liste")).toBe(true);
    const choices = localModelChoices(evidence);
    expect(choices.map((choice) => choice.value)).toEqual([...NETWORK_CODES, "gaine", "fond", "cadre_texte", "symbole", "hors_liste", "inconnu"]);
    expect(choices.find((choice) => choice.value === "CHW-S")?.description).toBe("Réseau CHW-S : " + choices.find((choice) => choice.value === "CHW-S")!.description
      .slice("Réseau CHW-S : ".length));
    expect(choices.find((choice) => choice.value === "CHW-S")?.description).toMatch(/sur ce plan : EG-A \(2 libellés\) ; légende : « EG-A »$/);
    expect(prompt).toContain(`- inconnu : Je ne sais pas : les preuves ne permettent pas de trancher`);
    expect(prompt).toContain(`Page (JSON) : ${JSON.stringify(localModelPageJson(evidence, 1))}`);
    expect(prompt).toContain(`Groupes (JSON) : ${JSON.stringify(groups.map((group) => groupJson(group)))}`);
    expect(localModelPageJson(evidence, 1)).not.toHaveProperty("classes");
  });

  it("reads the model's class and probability, « hors_liste » with its proposal, « inconnu », unknown and doubled answers without class", () => {
    const { evidence, of } = fixture();
    const magenta = of(MAGENTA), beige = of(BEIGE);
    const read = readLocalModelAnswer(evidence, [magenta, beige], localModelEntries({ groupes: [
      { groupe: magenta.alias, classe: "EU", probabilite: 0.8, classe_suivante: "EF", probabilite_suivante: 0.1 },
      { groupe: beige.alias, classe: "EU", probabilite: 0.95 },
    ] }));
    expect(read.get(magenta.id)).toEqual({ class: "EU", confidence: 0.8, proposal: null, status: "answered" });
    // The pale guard of a colour page.
    expect(read.get(beige.id)).toEqual({ class: null, confidence: null, proposal: null, status: "answered" });
    const others = readLocalModelAnswer(evidence, [magenta, beige], { groupes: [
      { groupe: magenta.alias, classe: "hors_liste", probabilite: 0.9 }, { groupe: beige.alias, classe: "réseau inventé", probabilite: 0.9 },
    ] });
    expect(others.get(magenta.id)).toEqual({ class: null, confidence: 0.9, proposal: "canalisation hors nomenclature", status: "answered" });
    expect(others.get(beige.id)).toMatchObject({ class: null, status: "invalid" });
    const twice = readLocalModelAnswer(evidence, [magenta, beige], { groupes: [{ groupe: magenta.alias, classe: "inconnu", probabilite: 0.6 },
      { groupe: beige.alias, classe: "fond", probabilite: 0.9 }, { groupe: beige.alias, classe: "EU", probabilite: 0.9 }] });
    expect(twice.get(magenta.id)).toEqual({ class: null, confidence: 0.6, proposal: null, status: "answered" });
    expect(twice.get(beige.id)).toMatchObject({ class: null, status: "invalid" });
    expect(readLocalModelAnswer(evidence, [magenta], { groupes: [] }).get(magenta.id)).toMatchObject({ status: "missing" });
  });

  it("reads an answer group by group: one probability out of [0, 1] or not a number makes only that group invalid", () => {
    const { evidence, of } = fixture();
    const magenta = of(MAGENTA), beige = of(BEIGE);
    // 85 for 0.85, a string, an entry that is not an object, a missing class: the other group keeps its answer.
    const entries = readLocalModelEntries({ groupes: [{ groupe: magenta.alias, classe: "EU", probabilite: 85, probabilite_suivante: "x" }, 7,
      { groupe: beige.alias, classe: "fond", probabilite: 0.9, classe_suivante: 3 }] });
    expect(entries).toEqual({ groupes: [{ groupe: magenta.alias, classe: "EU", probabilite: null }, { groupe: beige.alias, classe: "fond", probabilite: 0.9 }] });
    const read = readLocalModelAnswer(evidence, [magenta, beige], entries!);
    expect(read.get(magenta.id)).toEqual({ class: null, confidence: null, proposal: null, status: "invalid" });
    expect(read.get(beige.id)).toEqual({ class: "fond", confidence: 0.9, proposal: null, status: "answered" });
    expect(readLocalModelEntries({ groupes: [{ groupe: magenta.alias, probabilite: "0.9" }] })).toEqual({ groupes: [{ groupe: magenta.alias, classe: "", probabilite: null }] });
    for (const unusable of [null, "texte", { groupes: "x" }, { autre: [] }]) expect(readLocalModelEntries(unusable)).toBeNull();
  });

  it("names its prompt version as local, which the review and the bench read", () => {
    expect(isLocalModelPromptVersion(GROUP_LOCAL_MODEL_PROMPT_VERSION)).toBe(true);
    expect(isLocalModelPromptVersion(GROUP_DECISIONS_PROMPT_VERSION)).toBe(false);
  });

  it("measures a local model's network from a probability of 0.8, never under it, as the source « chatgpt »", () => {
    const { model, reading, of } = fixture();
    expect(LOCAL_MODEL_ACCEPTED_PROBABILITY).toBe(0.8);
    const magenta = of(MAGENTA);
    const keywords = classifyByKeywords(model, reading.legend);
    const index = model.groups.findIndex((group) => group.id === magenta.id);
    for (const [confidence, measured] of [[0.8, true], [0.79, false]] as const) {
      const answer = decisionsAnswerOf({ class: "EU", confidence, status: "answered", proposal: null, via: "local" });
      expect(answer).toEqual({ class: "EU", confidence, source: "chatgpt" });
      const classes = applyDecisions(model, keywords, new Map([[magenta.id, answer!]]));
      expect(classes[index]).toMatchObject({ class: "EU", source: "chatgpt", confidence });
      expect(isMeasuredNetwork(classes[index])).toBe(measured);
    }
  });
});
