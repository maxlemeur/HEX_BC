import "server-only";

import { randomUUID } from "node:crypto";

import { withUndecidedHypothesesAsAlternatives } from "@/lib/takeoff/hypothesis";
import { selectQuantitySources, type QuantitySourceItem } from "@/lib/takeoff/quantity-source-selection";
import { writableRuleInputs } from "@/lib/takeoff/rules/contracts";
import { ruleInputsFromVectorRecord } from "@/lib/takeoff/rules/inputs";
import { isTakeoffRulesEnabled } from "@/lib/takeoff/rules/recompute-server";
import { boundPageAnchors } from "@/lib/takeoff/rules/registration";
import { VECTOR_ITEM_EXCLUSION_REASON } from "@/lib/takeoff/vectors/alternatives";
import { VECTOR_PERSISTENCE_SCHEMA_VERSION } from "@/lib/takeoff/vectors/persistence";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

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
      source_file_name: outcome.fileName.slice(0, 255),
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
