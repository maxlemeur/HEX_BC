import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSupabaseFake } from "@/lib/takeoff/metre-m3.test-utils";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import type { PageAnchors } from "@/lib/takeoff/rules/registration";
import type { VectorPageRecord } from "@/lib/takeoff/vectors/persistence";
import { discardTakeoffVectorReading, persistTakeoffVectorReading } from "@/lib/takeoff/vectors/worker-persistence-server";
import { TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS } from "@/lib/takeoff/hypothesis";

// TI-677 (Codex #160, thread 4467830243), prerequisite of MERGEONE_TAKEOFF_RULES=1: the page row was inserted with
// anchors over the 262,144-byte check of takeoff_vector_pages.rule_anchors; the insert failed and the processor
// discarded the job's whole vector reading. Ways it still fails, written before the fix (fictional values):
// - anchors over the bound reach the insert as they are;
// - anchors that cannot be stored at all (a NUL) fail the page instead of leaving it without anchors (unregistered).

const ANCHORS_MAX_BYTES = 262_144;
const JOB = { id: "9f000000-0000-4000-8000-000000000001", tenant_id: "9f000000-0000-4000-8000-000000000002" };

function outcome(anchors: PageAnchors) {
  return { document: { kind: "job_upload" as const, job_id: JOB.id }, fileName: "plan-fictif.pdf", page: 1,
    record: {} as VectorPageRecord, items: [], error: null, anchors };
}

function persist(anchors: PageAnchors) {
  const fake = createSupabaseFake({
    tables: { takeoff_vector_pages: () => ({ data: { id: "9f000000-0000-4000-8000-000000000003" }, error: null }) },
  });
  const run = persistTakeoffVectorReading({ supabase: fake.client as never, job: JOB, resultId: "9f000000-0000-4000-8000-000000000004",
    outcomes: [outcome(anchors)] });
  return { fake, run };
}

const previous = process.env.MERGEONE_TAKEOFF_RULES;
beforeEach(() => {
  process.env.MERGEONE_TAKEOFF_RULES = "1";
});
afterEach(() => {
  if (previous === undefined) delete process.env.MERGEONE_TAKEOFF_RULES;
  else process.env.MERGEONE_TAKEOFF_RULES = previous;
});

describe("registration anchors written with the page", () => {
  it("does not delete the selected reading or report a fallback after an ambiguous selection response", async () => {
    const fake = createSupabaseFake({ tables: {} });
    const error = Object.assign(new Error("Selection response lost after commit"), { code: "TAKEOFF_QUANTITY_SOURCE_SELECTION_UNRESOLVED" });
    await expect(discardTakeoffVectorReading({ supabase: fake.client as never, job: JOB,
      resultId: "9f000000-0000-4000-8000-000000000004", error })).rejects.toBe(error);
    expect(fake.writesTo("takeoff_items")).toHaveLength(0);
    expect(fake.writesTo("takeoff_vector_pages")).toHaveLength(0);
  });
  it("bounds anchors over 256 KiB before the insert, so that the page and its reading are kept", async () => {
    const anchors: PageAnchors = { version: 1,
      texts: Array.from({ length: 1500 }, (_, index): [string, number, number] => [`${"管".repeat(74)}${String(index).padStart(6, "0")}`, index, 1]),
      lines: Array.from({ length: 1500 }, (_, index): [number, number, number, number] => [index, 0, index, 1.764]) };
    const { fake, run } = persist(anchors);
    await expect(run).resolves.toEqual({ pages: 1, items: 0 });
    const inserted = (fake.writesTo("takeoff_vector_pages")[0]?.payload ?? {}) as { rule_anchors?: PageAnchors };
    expect(Buffer.byteLength(JSON.stringify(inserted.rule_anchors ?? null))).toBeLessThanOrEqual(ANCHORS_MAX_BYTES);
    expect(jsonbTextBytes(inserted.rule_anchors ?? null)).toBeLessThanOrEqual(ANCHORS_MAX_BYTES);
    expect(inserted.rule_anchors?.lines).toHaveLength(1500);
  });

  it("drops a text the database cannot store instead of failing the page", async () => {
    const anchors: PageAnchors = { version: 1, texts: [["Salle\u0000 101", 1, 1], ["Bureau 102", 2, 2]], lines: [[0, 0, 0, 2]] };
    const { fake, run } = persist(anchors);
    await expect(run).resolves.toEqual({ pages: 1, items: 0 });
    const inserted = (fake.writesTo("takeoff_vector_pages")[0]?.payload ?? {}) as { rule_anchors?: PageAnchors };
    expect(inserted.rule_anchors?.texts).toEqual([["Bureau 102", 2, 2]]);
  });
});

// TI-682 (D11): an hypothesis arrives excluded, yet the source selection (TI-681) still reads it as the alternative
// reading of its page. Way it fails: read as excluded, the hypothesis is never paired with the measure of the same
// identity; included later beside it, both readings of the page reach the estimate with nothing to refuse them.
describe("source selection with an hypothesis that arrived excluded", () => {
  const stored = <T extends { id: string }>(overrides: T) => ({
    designation: "EF cuivre DN 22", unit: "ml", confidence: 0.9, evidence: "Plan", source_file_name: "plan-fictif.pdf", source_page: 1,
    is_verified: false, verified_at: null, verified_by: null, created_at: "2026-11-11T08:00:00.000Z",
    updated_at: "2026-11-11T08:00:00.000Z", ...overrides });

  it("hands the selection the hypothesis as included, so that it is paired with the comparable measure", async () => {
    const estimate = stored({ id: "9f000000-0000-4000-8000-0000000000a1", quantity: 60, is_excluded: true,
      exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated, metadata: { quantity_nature: "estimated" } });
    const measure = stored({ id: "9f000000-0000-4000-8000-0000000000a2", quantity: 58, is_excluded: true,
      exclusion_reason: "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut.",
      metadata: { vector: { kind: "network" }, quantity_source: { version: 1, origin: "vector", exploitable: true } } });
    let listed = false;
    const fake = createSupabaseFake({
      tables: {
        takeoff_vector_pages: () => ({ data: { id: "9f000000-0000-4000-8000-000000000003" }, error: null }),
        takeoff_item_geometries: () => ({ data: null, error: null }),
        takeoff_items: (query) => {
          if (query.operation === "insert") {
            const rows = query.payload as Array<{ metadata: unknown }>;
            return { data: rows.map((row) => ({ id: measure.id, metadata: row.metadata })), error: null };
          }
          if (listed) return { data: [], error: null, count: 2 };
          listed = true;
          return { data: [estimate, measure], error: null, count: 2 };
        },
      },
      rpc: { select_takeoff_quantity_sources: () => ({ data: null, error: null }) },
    });
    const record = { location: null, mode: "layers", to_review: 0, scale: { status: "verified" }, labels: { incomplete: 0 } } as unknown as VectorPageRecord;
    const persisted = await persistTakeoffVectorReading({ supabase: fake.client as never, job: JOB, resultId: "9f000000-0000-4000-8000-000000000004",
      outcomes: [{ document: { kind: "job_upload" as const, job_id: JOB.id }, fileName: "plan-fictif.pdf", page: 1, record, error: null,
        items: [{ item: { designation: "EF cuivre DN 22", quantity: 58, unit: "ml", confidence: 0.9, evidence: "Lecture vectorielle", category: "réseau (lecture vectorielle)" },
          geometry: { kind: "network", network: "EF", material: "cuivre", dn: 22 } } as never] }] });
    expect(persisted).toEqual({ pages: 1, items: 1 });

    const selection = fake.rpcCalls.find((call) => call.fn === "select_takeoff_quantity_sources")?.args as
      { p_choices: Array<{ id: string; origin: string; excluded: boolean; comparison: unknown }> } | undefined;
    expect(selection?.p_choices.map(({ id, origin, excluded }) => ({ id, origin, excluded })).sort((left, right) => left.id.localeCompare(right.id))).toEqual([
      { id: estimate.id, origin: "model", excluded: true },
      { id: measure.id, origin: "vector", excluded: false },
    ]);
    expect(selection?.p_choices[0].comparison).toMatchObject({ vector_quantity: 58, model_quantity: 60, delta: -2 });
  });
});
