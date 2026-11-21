import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import type { PageAnchors } from "@/lib/takeoff/rules/registration";
import type { VectorPageRecord } from "@/lib/takeoff/vectors/persistence";
import { buildTakeoffVectorPersistence } from "@/lib/takeoff/vectors/worker-persistence-server";
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

const previous = process.env.MERGEONE_TAKEOFF_RULES;
beforeEach(() => {
  process.env.MERGEONE_TAKEOFF_RULES = "1";
});
afterEach(() => {
  if (previous === undefined) delete process.env.MERGEONE_TAKEOFF_RULES;
  else process.env.MERGEONE_TAKEOFF_RULES = previous;
});

describe("registration anchors written with the page", () => {
  it("bounds anchors over 256 KiB before the insert, so that the page and its reading are kept", () => {
    const anchors: PageAnchors = { version: 1,
      texts: Array.from({ length: 1500 }, (_, index): [string, number, number] => [`${"管".repeat(74)}${String(index).padStart(6, "0")}`, index, 1]),
      lines: Array.from({ length: 1500 }, (_, index): [number, number, number, number] => [index, 0, index, 1.764]) };
    const payload = buildTakeoffVectorPersistence([outcome(anchors)], []);
    expect(payload.pages).toHaveLength(1);
    expect(payload.items).toHaveLength(0);
    const inserted = payload.pages[0];
    expect(Buffer.byteLength(JSON.stringify(inserted.rule_anchors ?? null))).toBeLessThanOrEqual(ANCHORS_MAX_BYTES);
    expect(jsonbTextBytes(inserted.rule_anchors ?? null)).toBeLessThanOrEqual(ANCHORS_MAX_BYTES);
    expect(inserted.rule_anchors?.lines).toHaveLength(1500);
  });

  it("drops a text the database cannot store instead of failing the page", () => {
    const anchors: PageAnchors = { version: 1, texts: [["Salle\u0000 101", 1, 1], ["Bureau 102", 2, 2]], lines: [[0, 0, 0, 2]] };
    const payload = buildTakeoffVectorPersistence([outcome(anchors)], []);
    expect(payload.pages).toHaveLength(1);
    expect(payload.items).toHaveLength(0);
    const inserted = payload.pages[0];
    expect(inserted.rule_anchors?.texts).toEqual([["Bureau 102", 2, 2]]);
  });
});

// TI-682 (D11): an hypothesis arrives excluded, yet the source selection (TI-681) still reads it as the alternative
// reading of its page. Way it fails: read as excluded, the hypothesis is never paired with the measure of the same
// identity; included later beside it, both readings of the page reach the estimate with nothing to refuse them.
describe("source selection with an hypothesis that arrived excluded", () => {
  it("pairs the comparable measure with the hypothesis while preserving geometry identity", () => {
    const source = { kind: "job_upload" as const, job_id: JOB.id };
    const estimate = {
      id: "9f000000-0000-4000-8000-0000000000a1", designation: "EF cuivre DN 22",
      unit: "ml", source_file_name: "plan-fictif.pdf", source_page: 1,
      quantity: 60, is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated,
      metadata: { quantity_nature: "estimated", source_document: source },
    };
    const record = { location: null, mode: "layers", to_review: 0, scale: { status: "verified" },
      labels: { incomplete: 0 } } as unknown as VectorPageRecord;
    const payload = buildTakeoffVectorPersistence([{
      document: source, fileName: "plan-fictif.pdf", page: 1, record, error: null,
      items: [{
        item: { designation: "EF cuivre DN 22", quantity: 58, unit: "ml", confidence: 0.9,
          evidence: "Lecture vectorielle", category: "réseau (lecture vectorielle)" },
        geometry: { kind: "network", network: "EF", material: "cuivre", dn: 22 },
      } as never],
    }], [estimate]);

    expect(payload.pages).toHaveLength(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.geometries).toMatchObject([{
      takeoff_item_id: payload.items[0].id, vector_page_id: payload.pages[0].id, geometry: { kind: "network" },
    }]);
    expect(payload.choices).toHaveLength(2);
    expect(payload.choices).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: estimate.id, origin: "model", excluded: true }),
      expect.objectContaining({ id: payload.items[0].id, origin: "vector", excluded: false }),
    ]));
    expect(payload.choices[0].comparison).toMatchObject({ vector_quantity: 58, model_quantity: 60, delta: -2 });
  });
});
