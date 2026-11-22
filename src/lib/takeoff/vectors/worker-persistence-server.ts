import "server-only";

import { randomUUID } from "node:crypto";

import { withUndecidedHypothesesAsAlternatives } from "@/lib/takeoff/hypothesis";
import { selectQuantitySources, type QuantitySourceItem } from "@/lib/takeoff/quantity-source-selection";
import { writableRuleInputs } from "@/lib/takeoff/rules/contracts";
import { ruleInputsFromVectorRecord } from "@/lib/takeoff/rules/inputs";
import { isTakeoffRulesEnabled } from "@/lib/takeoff/rules/recompute-server";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import { boundPageAnchors } from "@/lib/takeoff/rules/registration";
import { VECTOR_ITEM_EXCLUSION_REASON } from "@/lib/takeoff/vectors/alternatives";
import { VECTOR_PERSISTENCE_SCHEMA_VERSION } from "@/lib/takeoff/vectors/persistence";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";
import { cutToCodeUnits } from "@/lib/text-cut";

export { VECTOR_ITEM_EXCLUSION_REASON } from "@/lib/takeoff/vectors/alternatives";

type VectorItem = QuantitySourceItem & {
  confidence: number | null;
  evidence: string | null;
  exclusion_reason: string;
  rules_stale: boolean;
};

export function buildTakeoffVectorPersistence(
  outcomes: readonly VectorPageOutcome[],
  modelItems: readonly (QuantitySourceItem & { exclusion_reason: string | null })[],
) {
  const withRules = isTakeoffRulesEnabled();
  const items: VectorItem[] = [];
  const geometries = [];
  const pages = [];
  for (const outcome of outcomes) {
    const reading = outcome.record;
    if (!reading) continue;
    const pageId = randomUUID();
    pages.push({
      id: pageId,
      plan_file_id: outcome.document.kind === "plan_file" ? outcome.document.plan_file_id : null,
      source_file_name: cutToCodeUnits(outcome.fileName, 255),
      source_page: outcome.page,
      reading,
      schema_version: VECTOR_PERSISTENCE_SCHEMA_VERSION,
      rule_anchors: withRules && outcome.anchors ? boundPageAnchors(outcome.anchors) : null,
    });
    for (const record of outcome.items) {
      // The transaction inserts the measurements and their geometry under the same IDs.
      const id = randomUUID();
      const ruleInputs = withRules ? writableRuleInputs(ruleInputsFromVectorRecord(record)) : null;
      items.push({
        id,
        designation: record.item.designation,
        quantity: record.item.quantity,
        unit: record.item.unit,
        confidence: record.item.confidence,
        evidence: record.item.evidence,
        source_file_name: outcome.fileName,
        source_page: outcome.page,
        is_excluded: true,
        exclusion_reason: VECTOR_ITEM_EXCLUSION_REASON,
        metadata: {
          category: record.item.category,
          source_document: outcome.document,
          vector: { schema_version: VECTOR_PERSISTENCE_SCHEMA_VERSION, kind: record.geometry.kind, key: id },
          quantity_source: {
            version: 1, origin: "vector", location: reading.location,
            exploitable: (reading.scale.status === "verified" || reading.scale.status === "calibrated")
              && reading.mode !== "raster" && reading.to_review === 0
              && (record.geometry.kind === "surface" || reading.labels?.incomplete === 0),
          },
          ...(ruleInputs ? { rule_inputs: ruleInputs } : {}),
        },
        rules_stale: ruleInputs !== null,
      });
      geometries.push({ takeoff_item_id: id, vector_page_id: pageId,
        geometry: record.geometry, schema_version: VECTOR_PERSISTENCE_SCHEMA_VERSION });
    }
  }
  return {
    pages, items, geometries,
    choices: items.length ? selectQuantitySources(withUndecidedHypothesesAsAlternatives([...modelItems, ...items])) : [],
  };
}

/** A vector page, or some of its rows, left out of a publication because the database could not store them. */
export type VectorReadingLeftOut = { page: number; whole: boolean; items: number };

/**
 * The checks the database makes of a vector reading, as buildTakeoffVectorPersistence writes it: takeoff_vector_pages
 * (its reading and its registration anchors within 256 KiB as stored, schema 1, a page ≥ 1, a file name of 255 characters
 * at most), takeoff_items (a quantity positive within numeric(12,3), a confidence within [0, 1] at numeric(5,4), a page
 * the publication accepts, 1 to 100,000), takeoff_item_geometries (an object within 512 KiB as stored, schema 1), and in
 * every value a text it can store (no NUL, no lone surrogate). A failed insert of the first order's end loses the whole
 * vector reading; a text it cannot store refuses the whole call.
 */
const VECTOR_PAGE_MAX_BYTES = 262_144;
const VECTOR_GEOMETRY_MAX_BYTES = 524_288;
const VECTOR_ROW_MAX_QUANTITY_THOUSANDTHS = 999_999_999_999;

function storablePage(page: ReturnType<typeof buildTakeoffVectorPersistence>["pages"][number]) {
  return Number.isInteger(page.source_page) && page.source_page >= 1 && page.schema_version === VECTOR_PERSISTENCE_SCHEMA_VERSION
    && jsonbTextBytes(page.reading) <= VECTOR_PAGE_MAX_BYTES && jsonbTextBytes(page.rule_anchors) <= VECTOR_PAGE_MAX_BYTES
    && (page.source_file_name === null || page.source_file_name.length <= 255) && Number.isFinite(jsonbTextBytes(page));
}

function storableRow(item: ReturnType<typeof buildTakeoffVectorPersistence>["items"][number],
  geometry: ReturnType<typeof buildTakeoffVectorPersistence>["geometries"][number] | undefined) {
  const thousandths = Number.isFinite(item.quantity) ? Math.round(item.quantity * 1_000) : Number.NaN;
  return thousandths >= 1 && thousandths <= VECTOR_ROW_MAX_QUANTITY_THOUSANDTHS
    && (item.confidence === null || (Number.isFinite(item.confidence) && item.confidence >= 0 && item.confidence <= 1))
    && item.source_page !== null && Number.isInteger(item.source_page) && item.source_page >= 1 && item.source_page <= 100_000
    && typeof item.designation === "string" && typeof item.unit === "string" && Number.isFinite(jsonbTextBytes(item))
    && geometry !== undefined && geometry.schema_version === VECTOR_PERSISTENCE_SCHEMA_VERSION && typeof geometry.geometry === "object"
    && geometry.geometry !== null && jsonbTextBytes(geometry.geometry) <= VECTOR_GEOMETRY_MAX_BYTES;
}

/**
 * The vector pages of a reading against the list (lot 4) the database can store, each with the rows it can store. The
 * vector reading travels with the answers in one call, and what would refuse it refuses the paid answers too: a page the
 * database cannot store is left out with its rows, a row with its geometry; each is said in the result's warnings
 * (`leftOut`). A row left out is never an observation of an answer. Each outcome is checked as it would be written.
 */
export function storableVectorOutcomes(outcomes: readonly VectorPageOutcome[]): {
  outcomes: VectorPageOutcome[]; leftOut: VectorReadingLeftOut[];
} {
  const kept: VectorPageOutcome[] = [];
  const leftOut: VectorReadingLeftOut[] = [];
  for (const outcome of outcomes) {
    if (!outcome.record) {
      kept.push(outcome);
      continue;
    }
    const written = buildTakeoffVectorPersistence([outcome], []);
    if (!storablePage(written.pages[0])) {
      leftOut.push({ page: outcome.page, whole: true, items: outcome.items.length });
      continue;
    }
    const items = outcome.items.filter((_, index) => storableRow(written.items[index], written.geometries[index]));
    if (items.length < outcome.items.length) leftOut.push({ page: outcome.page, whole: false, items: outcome.items.length - items.length });
    kept.push(items.length === outcome.items.length ? outcome : { ...outcome, items });
  }
  return { outcomes: kept, leftOut };
}
