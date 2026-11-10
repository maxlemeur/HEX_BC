import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSupabaseFake } from "@/lib/takeoff/metre-m3.test-utils";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";
import type { PageAnchors } from "@/lib/takeoff/rules/registration";
import type { VectorPageRecord } from "@/lib/takeoff/vectors/persistence";
import { discardTakeoffVectorReading, persistTakeoffVectorReading } from "@/lib/takeoff/vectors/worker-persistence-server";

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
