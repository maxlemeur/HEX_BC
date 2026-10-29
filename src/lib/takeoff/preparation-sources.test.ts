import { describe, expect, it } from "vitest";
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

  it("preserves unchanged choices and content evidence while reopening changed source decisions", () => {
    const source = { ...toPreparationPlanSource(file), active: true, confirmed: true, pages: [2], content_hash: "a".repeat(64) };
    const prep = confirmedPreparationFixture().preparation;
    prep.sources = [source];
    const stable = reconcilePreparationSources(prep, [toPreparationPlanSource(file)]);
    expect(stable.changedSourceIds).toEqual([]);
    expect(stable.draft.sources[0]).toEqual(source);
    const changed = reconcilePreparationSources(prep, [toPreparationPlanSource({ ...file, updated_at: "2026-10-29T01:00:00Z" })]);
    expect(changed.changedSourceIds).toEqual([file.id]);
    expect(changed.draft.sources[0]).toMatchObject({ active: true, confirmed: false, pages: [2], content_hash: null });
    expect(changed.draft.scope).toEqual(prep.scope);
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
