import type { VectorPageExtraction } from "@/lib/takeoff/vectors/extraction";
import { MM_PER_POINT } from "@/lib/takeoff/vectors/geometry";
import type { VectorPageReading } from "@/lib/takeoff/vectors/pipeline";
import { evaluateTakeoffRules, type LevelRegistration, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { ruleInputsFromDesignation, ruleInputsFromVector } from "@/lib/takeoff/rules/inputs";
import { pageAnchors, type PageAnchors } from "@/lib/takeoff/rules/registration";
import type { TakeoffRuleInputs, TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import type { TakeoffItem } from "@/lib/takeoff/types";
import type { Centreline } from "@/lib/takeoff/rules/zone-overlap";

// The fixed rules in the vector pipeline of the bench (TI-664): each vector
// item of a page (vectorItems, items.ts, in its order) with the inputs and
// geometry the worker would persist (persistence.ts), the page's scale and
// registration anchors; after a pass, the rules run per lot (one estimate
// version of the product: its plans of all zones), the reserve with its lot as
// a version would hold it. Zone and level come from the manifest.

export type BenchRuleData = { inputs: TakeoffRuleInputs; geometry: RuleLine["geometry"] };

function round(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Inputs and geometry of each item vectorItems gives for this reading, in its order: one per network, material and
 * DN total (its runs' centrelines), its insulation when labelled, then one per room polygon (its outline).
 */
export function vectorItemRuleData(reading: VectorPageReading): BenchRuleData[] {
  const denominator = reading.scale.denominator;
  if (denominator === null || reading.mode === "raster") return [];
  const metres = (value: number) => round((value * MM_PER_POINT * denominator) / 1000);
  const data: BenchRuleData[] = [];
  for (const total of reading.networks?.totals ?? []) {
    if (total.length_m === null || total.length_m < 0.01) continue;
    const runs = (reading.networks?.runs ?? []).filter((run) => run.network === total.network && run.material === total.material && run.dn === total.dn);
    const segments = (insulated: boolean) => runs.filter((run) => !insulated || run.insulated)
      .map(({ segment }): Centreline => [metres(segment.x0), metres(segment.y0), metres(segment.x1), metres(segment.y1)]);
    const quantity = round(total.length_m, 2);
    data.push({
      inputs: ruleInputsFromVector({ kind: "network", network: total.network, material: total.material, dn: total.dn, quantity }),
      geometry: { segments_m: segments(false), polygon_m: null, length_m: total.length_m, area_m2: null },
    });
    if (total.insulated_m !== null && total.insulated_m >= 0.01 && total.dn !== null) {
      data.push({
        inputs: ruleInputsFromVector({ kind: "insulation", network: total.network, material: "calorifuge", dn: total.dn, quantity: round(total.insulated_m, 2) }),
        geometry: { segments_m: segments(true), polygon_m: null, length_m: total.insulated_m, area_m2: null },
      });
    }
  }
  for (const surface of reading.surfaces) {
    if (surface.polygon_m2 === null || surface.polygon_m2 <= 0) continue;
    data.push({
      inputs: ruleInputsFromVector({ kind: "surface", network: null, material: null, dn: null, quantity: surface.polygon_m2, room: surface.room,
        printed_m2: surface.printed_m2 }),
      geometry: { segments_m: [], polygon_m: surface.outline ? surface.outline.points.map(metres) : null, length_m: null, area_m2: surface.polygon_m2 },
    });
  }
  return data;
}

/**
 * Each rule datum describes its item: same count, and item for item the same unit and network code (a surface is
 * in m2, a length in ml and names its network first). A drift would put a rule result on another line.
 */
export function assertRuleDataAligned(items: readonly TakeoffItem[], data: readonly BenchRuleData[], where: string) {
  if (data.length !== items.length) throw new Error(`vectorItemRuleData gave ${data.length} entries for ${items.length} items (${where}).`);
  data.forEach((entry, index) => {
    const item = items[index];
    const surface = entry.inputs.kind === "surface";
    const code = entry.inputs.network === "EUV" ? "EU/EV" : entry.inputs.network;
    const named = item.designation === code || item.designation.startsWith(`${code} `);
    if ((item.unit === "m2") !== surface || (!surface && !named)) {
      throw new Error(`vectorItemRuleData entry ${index} (${entry.inputs.kind} ${code ?? "-"}) does not describe item « ${item.designation} » (${where}).`);
    }
  });
}

/** Registration anchors of a page whose scale is measurable; null otherwise (no length, nothing to compare). */
export function benchPageAnchors(extraction: VectorPageExtraction, reading: VectorPageReading): PageAnchors | null {
  if (reading.scale.denominator === null || reading.mode === "raster") return null;
  return pageAnchors(extraction, reading.scale.denominator, new Map(reading.groups.map((group) => [group.id, group.class])));
}

export type BenchRulePage = {
  document: string;
  lot: string;
  page: number;
  level: string | null;
  zone: string | null;
  scale: RulePage["scale"];
  denominator: number | null;
  anchors: PageAnchors | null;
};

export type BenchRuleDocument = {
  id: string;
  lot: string;
  order: number;
  items: readonly TakeoffItem[];
  /** Per item, its vector data, or null for an item read by the model (a raster page's level C items). */
  data: ReadonlyArray<BenchRuleData | null>;
};

/** Runs the rules per lot on one pass; returns each document's results in its items' order, and the registrations. */
export function benchRulePass(documents: readonly BenchRuleDocument[], pages: readonly BenchRulePage[]) {
  const results = new Map<string, TakeoffRuleResult[][]>();
  const registrations: Array<LevelRegistration & { lot: string }> = [];
  const order = new Map(documents.map((document) => [document.id, document.order]));
  for (const lot of [...new Set(documents.map((document) => document.lot))].sort()) {
    const lotDocuments = documents.filter((document) => document.lot === lot);
    const rulePages: RulePage[] = pages.filter((page) => page.lot === lot).map((page) => ({
      key: `${page.document}#${page.page}`, job_id: page.document, order: (order.get(page.document) ?? 0) * 10_000 + page.page,
      level: page.level, zone: page.zone, scale: page.scale, denominator: page.denominator, anchors: page.anchors,
    }));
    const lines: RuleLine[] = lotDocuments.flatMap((document) => document.items.map((item, index) => {
      const data = document.data[index] ?? null;
      return {
        id: `${document.id}#${index}`, job_id: document.id, page_key: item.source_page ? `${document.id}#${item.source_page}` : null,
        designation: item.designation, unit: item.unit, quantity: item.quantity, is_excluded: false, frozen: false,
        inputs: data?.inputs ?? ruleInputsFromDesignation({ designation: item.designation, category: item.category ?? null,
          evidence: item.evidence ?? null, unit: item.unit, quantity: item.quantity }),
        geometry: data?.geometry ?? null,
      };
    }));
    const evaluation = evaluateTakeoffRules({ lines, pages: rulePages });
    for (const document of lotDocuments) {
      results.set(document.id, document.items.map((_, index) => evaluation.results.get(`${document.id}#${index}`) ?? []));
    }
    registrations.push(...evaluation.registrations.map((entry) => ({ ...entry, lot })));
  }
  return { results, registrations };
}
