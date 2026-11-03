// Page triage cases (TI-663), written before the code: a changed or vanished file
// keeps a stale page_triage (D3), a page_triage of another file version or page
// count survives, an upload source carries one, or the reconcile touches pages,
// active, or a correction status (E3, E5).
import { describe, expect, it } from "vitest";
import type { TakeoffPageTriage } from "@/lib/takeoff/page-triage";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import { getPreparationPlanSourceVersion, reconcilePreparationSources, toPreparationPlanSource, type PreparationPlanFile } from "@/lib/takeoff/preparation-sources";

const file: PreparationPlanFile = {
  id: "file-a", plan_set_id: "set-a", file_name: "Plan fictif.pdf", file_path: "tenant/set/file.pdf",
  file_size_bytes: 1000, page_count: 2, file_hash: null, updated_at: "2026-10-29T00:00:00Z", metadata: { revision: "A" },
};

describe("preparation source identities", () => {
  it("binds object identity, hash, size and revision metadata rather than only the date", () => {
    const initial = getPreparationPlanSourceVersion(file);
    expect(getPreparationPlanSourceVersion({ ...file, file_path: "new-path.pdf" })).not.toBe(initial);
    expect(getPreparationPlanSourceVersion({ ...file, file_hash: "b".repeat(64) })).not.toBe(initial);
    expect(getPreparationPlanSourceVersion({ ...file, file_size_bytes: 999 })).not.toBe(initial);
  });

  it("keeps disappeared references visible and invalidates an added file in the selected set", () => {
    const prep = confirmedPreparationFixture().preparation;
    prep.sources = [{ ...toPreparationPlanSource(file), active: true, confirmed: true }];
    const missing = reconcilePreparationSources(prep, []);
    expect(missing.draft.sources[0]).toMatchObject({ document_id: file.id, confirmed: false, source_version: "" });
    const added = reconcilePreparationSources(prep, [toPreparationPlanSource(file), toPreparationPlanSource({ ...file, id: "file-b", file_path: "new.pdf" })]);
    expect(added.changedSourceIds).toEqual(["file-b"]);
    expect(added.draft.sources[1]).toMatchObject({ active: false, confirmed: false });
  });

  it("requires a new page calibration when its source changes", () => {
    const prep = confirmedPreparationFixture().preparation;
    prep.sources = [{ ...toPreparationPlanSource(file), active: true, confirmed: true }];
    prep.conventions.calibration = { document_id: file.id, page: 1, reference_length: 2, reference_unit: "m", measured_span: 50, measured_span_unit: "paper_mm" };
    const changed = reconcilePreparationSources(prep, [toPreparationPlanSource({ ...file, updated_at: "2026-10-29T01:00:00Z" })]);
    expect(changed.draft.conventions.calibration).toBeNull();
    expect(changed.draft.conventions.confirmed).toBe(false);
  });
});

describe("page triage reconciliation", () => {
  const triageFor = (sourceVersion: string, accepted: boolean, pageCount = 2): TakeoffPageTriage => ({
    source_version: sourceVersion, page_count: pageCount, questions_fingerprint: "a".repeat(64), model: "gpt-6-luna",
    prompt_version: "takeoff-page-triage-v1", usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
    generated_at: "2026-11-03T10:00:00.000Z", accepted,
    pages: Array.from({ length: pageCount }, (_, index) => ({
      page: index + 1, request_fingerprint: "b".repeat(64), type: index === 0 ? "facade" as const : "reseau" as const,
      level: null, zone: null, confidence: 0.95, proposal: index === 0 ? "exclude" as const : "keep" as const, status: "proposed" as const, reason: null,
    })),
  });
  const planSource = () => toPreparationPlanSource(file);

  it("drops the triage of a changed or vanished file without touching pages or active", () => {
    const prep = confirmedPreparationFixture().preparation;
    prep.sources = [{ ...planSource(), active: true, confirmed: true, pages: [2], page_triage: triageFor(planSource().source_version, true) }];
    const changed = reconcilePreparationSources(prep, [toPreparationPlanSource({ ...file, file_hash: "c".repeat(64) })]);
    expect(changed.draft.sources[0]).toMatchObject({ active: true, pages: [2], page_triage: null, confirmed: false });
    const vanished = reconcilePreparationSources(prep, []);
    expect(vanished.draft.sources[0]).toMatchObject({ active: true, pages: [2], page_triage: null });
  });

  it("drops a triage of another version or page count and on an upload source", () => {
    const prep = confirmedPreparationFixture().preparation;
    prep.sources = [
      { ...planSource(), active: true, page_triage: triageFor("other-version", false) },
      { ...planSource(), document_id: `upload:${"d".repeat(64)}`, plan_set_id: null, file_path: null, source_version: "d".repeat(64), page_triage: triageFor("d".repeat(64), false) },
    ];
    const reconciled = reconcilePreparationSources(prep, [planSource()]);
    expect(reconciled.draft.sources.map((source) => source.page_triage)).toEqual([null, null]);
    prep.sources = [{ ...planSource(), active: true, page_triage: triageFor(planSource().source_version, false, 3) }];
    expect(reconcilePreparationSources(prep, [planSource()]).draft.sources[0].page_triage).toBeNull();
  });

  it("keeps a current triage and marks a correction after acceptance", () => {
    const prep = confirmedPreparationFixture().preparation;
    prep.sources = [{ ...planSource(), active: true, confirmed: true, pages: [], page_triage: triageFor(planSource().source_version, true) }];
    const reconciled = reconcilePreparationSources(prep, [planSource()]);
    expect(reconciled.changedSourceIds).toEqual([]);
    expect(reconciled.draft.sources[0]).toMatchObject({ active: true, pages: [], confirmed: true });
    expect(reconciled.draft.sources[0].page_triage?.pages.map((page) => page.status)).toEqual(["corrected", "proposed"]);
  });
});
