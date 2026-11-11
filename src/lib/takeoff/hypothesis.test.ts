import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS,
  hypothesisPreselection,
  isUndecidedHypothesis,
  takeoffHypothesisCause,
  withUndecidedHypothesesAsAlternatives,
} from "@/lib/takeoff/hypothesis";
import { selectQuantitySources, type QuantitySourceItem } from "@/lib/takeoff/quantity-source-selection";

// TI-682 lot B: one reading of what an hypothesis is, in SQL (public.takeoff_item_hypothesis_cause) and here. The
// vectors and the exclusion reasons are those of the pgTAP suite, read in its file: both sides run the same cases.

const PGTAP = path.join(process.cwd(), "supabase/tests/database/takeoff-hypothesis-preselection.test.sql");
const SQL_VALUE = "(null|'(?:[^']|'')*')";
const VECTOR_ROW = new RegExp(`^\\s*\\((\\d+), ${SQL_VALUE}, ${SQL_VALUE}, ${SQL_VALUE}, ${SQL_VALUE}\\)[,;]$`);
const REASON_ROW = new RegExp(`^\\s*\\(${SQL_VALUE}, ${SQL_VALUE}\\)[,;]$`);

/** A captured value: a number as written, null, or a quoted text. */
function sqlValue(literal: string) {
  if (literal === "null") return null;
  return literal.startsWith("'") ? literal.slice(1, -1).replace(/''/g, "'") : literal;
}

/** The rows of one `insert into <table> values` block of the pgTAP suite. */
function pgTapRows(table: string, row: RegExp) {
  const sql = fs.readFileSync(PGTAP, "utf8");
  const start = sql.indexOf(`insert into ${table} values`);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf(";\n", start) + 1).split("\n").slice(1).map((line) => {
    const match = row.exec(line);
    expect(match, line).not.toBeNull();
    return match!.slice(1).map(sqlValue);
  });
}

const VECTORS = pgTapRows("hypothesis_vectors", VECTOR_ROW).map(([position, label, metadata, category, cause]) => ({
  position: Number(position), label: label!, metadata: metadata === null ? null : JSON.parse(metadata) as unknown, category, cause,
}));

describe("takeoffHypothesisCause", () => {
  it("reads every vector of the pgTAP suite, in order", () => {
    expect(VECTORS.map((vector) => vector.position)).toEqual(VECTORS.map((_, index) => index + 1));
    expect(VECTORS.length).toBeGreaterThanOrEqual(20);
  });

  it.each(VECTORS)("vector $position: $label", ({ metadata, category, cause }) => {
    expect(takeoffHypothesisCause({ metadata, quantity_entry_category: category })).toBe(cause);
  });

  it("reads a line whose entry category is not loaded as one nobody attested", () => {
    expect(takeoffHypothesisCause({ metadata: { quantity_nature: "estimated" } })).toBe("estimated");
  });
});

describe("hypothesisPreselection", () => {
  it("excludes with the reasons the insert trigger writes", () => {
    expect(Object.fromEntries(pgTapRows("hypothesis_reasons", REASON_ROW))).toEqual(TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS);
  });

  it("excludes an estimate and a quantity a plan cannot show, each with its reason", () => {
    expect(hypothesisPreselection({ metadata: { quantity_nature: "estimated" } }))
      .toEqual({ is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated });
    expect(hypothesisPreselection({ metadata: { rule_inputs: { non_observable: "support" } } }))
      .toEqual({ is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable });
  });

  it("leaves a proposed line, a vector measure and an entry its author attested as they are", () => {
    expect(hypothesisPreselection({ metadata: { quantity_nature: "proposed", rule_inputs: { non_observable: null } } })).toBeNull();
    expect(hypothesisPreselection({ metadata: { vector: { kind: "network" }, rule_inputs: { source: "vector", non_observable: null } } })).toBeNull();
    expect(hypothesisPreselection({ metadata: { rule_inputs: { non_observable: "weld" } }, quantity_entry_category: "hypothesis" })).toBeNull();
  });
});

describe("isUndecidedHypothesis", () => {
  it("is an hypothesis still excluded with the reason it arrived with", () => {
    for (const exclusion_reason of Object.values(TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS)) {
      expect(isUndecidedHypothesis({ is_excluded: true, exclusion_reason })).toBe(true);
      expect(isUndecidedHypothesis({ is_excluded: false, exclusion_reason })).toBe(false);
    }
  });

  it("is never a line someone excluded with their own reason, nor a vector measure left out", () => {
    expect(isUndecidedHypothesis({ is_excluded: true, exclusion_reason: "Hors lot." })).toBe(false);
    expect(isUndecidedHypothesis({ is_excluded: true, exclusion_reason: null })).toBe(false);
    expect(isUndecidedHypothesis({ is_excluded: true,
      exclusion_reason: "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut." })).toBe(false);
  });
});

// The worker's source selection (TI-681) pairs a vector measure with the vision line of the same identity, and the
// application refuses both. An hypothesis arrives excluded: read as excluded, it would never be paired, and including
// it later beside the measure would count the page twice.
describe("withUndecidedHypothesesAsAlternatives", () => {
  const line = (id: string, overrides: Partial<QuantitySourceItem> & { exclusion_reason?: string | null } = {}) => ({
    id, designation: "EF cuivre DN 22", quantity: 60, unit: "ml", source_file_name: "Plan RDC Z1.pdf", source_page: 1,
    is_excluded: false, exclusion_reason: null, metadata: {}, ...overrides });
  const vector = line("vector", { quantity: 58, is_excluded: true,
    exclusion_reason: "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut.",
    metadata: { vector: { kind: "network" }, quantity_source: { exploitable: true } } });
  const estimate = line("estimate", { is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated,
    metadata: { quantity_nature: "estimated" } });

  it("lets the selection pair an hypothesis that arrived excluded, exactly as the line it was before", () => {
    const before = selectQuantitySources([line("estimate", { metadata: { quantity_nature: "estimated" } }), vector]);
    const after = selectQuantitySources(withUndecidedHypothesesAsAlternatives([estimate, vector]));
    expect(after).toEqual(before);
    expect(after.find((entry) => entry.id === "estimate")).toMatchObject({ excluded: true, origin: "model" });
    expect(after.find((entry) => entry.id === "vector")).toMatchObject({ excluded: false, origin: "vector",
      comparison: { vector_quantity: 58, model_quantity: 60, delta: -2 } });
    // Read as excluded, the hypothesis is left out of the pair: nothing would refuse it beside the measure.
    expect(selectQuantitySources([estimate, vector]).map((entry) => entry.id)).toEqual(["vector"]);
  });

  it("leaves a line its reviewer excluded, and a vector measure left out, as they are", () => {
    const excluded = line("excluded", { is_excluded: true, exclusion_reason: "Hors lot." });
    expect(withUndecidedHypothesesAsAlternatives([excluded, vector, estimate]).map((entry) => entry.is_excluded)).toEqual([true, true, false]);
  });
});
