import { afterEach, describe, expect, it, vi } from "vitest";

import {
  duplicateEstimateSection, fetchAffaireLinkedDpgfSource, fetchEstimateImportableSections,
  fetchEstimateImportSources, importEstimateSections, importLinkedDpgfSource,
} from "@/lib/estimates/client";
import { recoverEstimateEditorRead, registerEstimateEditorMutations } from "@/lib/estimates/editor-mutations";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

const source = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const section = "33333333-3333-4333-8333-333333333333";
const line = "44444444-4444-4444-8444-444444444444";
const other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const timestamp = "2026-10-28T11:00:00.123456Z";
const totals = { total_ht_cents: 1000, total_tax_cents: 200, total_ttc_cents: 1200 };

function respond(data: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
function importedSections() {
  return { source_version_id: source, target_version_id: target, mode: "append",
    imported_sections_count: 1, imported_lines_count: 1, created_section_ids: [section], created_line_ids: [line],
    totals, version: { id: target, updated_at: timestamp, content_revision: 4 } };
}
function importSections() {
  return importEstimateSections(target, { sourceVersionId: source, sectionIds: [section], mode: "append" });
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("copy and import response boundaries", () => {
  it("does not silently turn malformed source amounts into numbers", async () => {
    respond({ items: [{ id: source, project_id: other, project_name: "Source", version_number: 1,
      status: "draft", title: null, updated_at: timestamp, total_ht_cents: "1000" }] });
    await expect(fetchEstimateImportSources()).rejects.toThrow();
  });

  it.each([
    { line_count: -1 }, { total_ht_cents: 1000.5 }, { position: 1.5 },
  ])("refuses an invalid section preview instead of repairing it: %j", async (patch) => {
    respond({ source_version_id: source, items: [{ id: section, title: "Lot", line_count: 1,
      total_ht_cents: 1000, position: 1, ...patch }] });
    await expect(fetchEstimateImportableSections(source)).rejects.toThrow();
  });

  it("rejects sections belonging to another requested source", async () => {
    respond({ source_version_id: other, items: [] });
    await expect(fetchEstimateImportableSections(source)).rejects.toThrow();
  });

  it("distinguishes an absent linked DPGF from an invalid response", async () => {
    respond({ import_id: source, row_count: "invalid" });
    await expect(fetchAffaireLinkedDpgfSource(other)).rejects.toThrow();
  });

  it("accepts an explicitly absent linked DPGF", async () => {
    respond(null);
    await expect(fetchAffaireLinkedDpgfSource(other)).resolves.toBeNull();
  });

  it("does not confuse an unreadable HTTP 200 body with an absent DPGF", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 200 })));
    await expect(fetchAffaireLinkedDpgfSource(other)).rejects.toThrow();
  });

  it("accepts UUID spelling differences without accepting another version", async () => {
    respond({ source_version_id: other, items: [] });
    await expect(fetchEstimateImportableSections(other.toUpperCase())).resolves.toEqual([]);
  });

  it("accepts merge into an existing section without inventing a created section", async () => {
    respond({ ...importedSections(), mode: "merge", created_section_ids: [] });
    await expect(importEstimateSections(target, { sourceVersionId: source, sectionIds: [section], mode: "merge" }))
      .resolves.toMatchObject({ importedSectionsCount: 1, createdSectionIds: [], createdLineIds: [line] });
  });

  it("retains the precise order of source revisions inside the same millisecond", async () => {
    const row = { project_id: section, project_name: "Source", status: "draft", title: null, total_ht_cents: 1000 };
    respond({ items: [{ ...row, id: source, version_number: 1, updated_at: "2026-10-28T10:00:00.000002Z" },
      { ...row, id: other, version_number: 9, updated_at: "2026-10-28T10:00:00.000001Z" }] });
    expect((await fetchEstimateImportSources()).map((item) => item.id)).toEqual([source, other]);
  });

  it.each(["source", "target", "version", "counter", "duplicate", "totals"])(
    "refuses an incoherent import acknowledgement: %s", async (change) => {
      const data = importedSections();
      if (change === "source") data.source_version_id = other;
      if (change === "target") data.target_version_id = other;
      if (change === "version") data.version.id = other;
      if (change === "counter") data.imported_lines_count = 2;
      if (change === "duplicate") { data.created_line_ids = [line, line]; data.imported_lines_count = 2; }
      if (change === "totals") data.totals = { ...totals, total_ttc_cents: 999 };
      const fetch = respond(data);
      await expect(importSections()).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  );

  it("does not equate selected section roots with all their created descendants", async () => {
    respond({ ...importedSections(), created_section_ids: [section, other] });
    await expect(importSections()).resolves.toMatchObject({ importedSectionsCount: 1, createdSectionIds: [section, other] });
  });

  it("refuses an incoherent linked DPGF acknowledgement", async () => {
    respond({ source_import_id: source, target_version_id: target, created_section_id: section,
      created_line_ids: [line], imported_lines_count: 2, skipped_lines_count: 0, totals,
      version: { id: target, updated_at: timestamp } });
    await expect(importLinkedDpgfSource(target)).rejects.toThrow();
  });

  it("refuses a section duplication acknowledgement for another destination", async () => {
    respond({ duplicated_section_id: other, source_version_id: source, target_version_id: other,
      copied_item_count: 2, totals, version: { id: other, updated_at: timestamp } });
    await expect(duplicateEstimateSection(source, section, { targetVersionId: target })).rejects.toThrow();
  });

  it("validates before confirming an editor mutation", async () => {
    const committed = vi.fn();
    const unregister = registerEstimateEditorMutations(target, {
      getToken: () => "2026-10-28T10:00:00.123456Z",
      onCommit: committed, onPendingChange: vi.fn(),
    });
    const fetch = respond({ ...importedSections(), imported_lines_count: 3 });
    try {
      await expect(importSections()).rejects.toThrow();
      expect(committed).not.toHaveBeenCalled();
      await expect(importSections()).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { unregister(); }
  });

  it("recovers an uncertain copy with an explicit complete read without replaying its write", async () => {
    const committed = vi.fn();
    const recovery = vi.fn();
    const unregister = registerEstimateEditorMutations(target, {
      getToken: () => "2026-10-28T10:00:00.123456Z", onCommit: committed,
      onPendingChange: vi.fn(), onReadRequiredChange: recovery,
    });
    const read = createEstimateEditorResponseFixture();
    read.version.id = target;
    read.items[0].version_id = target;
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { ...importedSections(), imported_lines_count: 3 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: read })));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(importSections()).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(committed).not.toHaveBeenCalled();
      await expect(recoverEstimateEditorRead(target)).resolves.toBe(true);
      expect(fetch.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual(["POST", "GET"]);
      expect(committed).toHaveBeenCalledWith(expect.objectContaining({ structural: true, needsReload: true }));
      expect(recovery).toHaveBeenLastCalledWith(null);
    } finally { unregister(); }
  });

  it.each([500, 503])("blocks another copy after an uncertain HTTP %s response", async (status) => {
    const recovery = vi.fn();
    const unregister = registerEstimateEditorMutations(target, {
      getToken: () => timestamp, onCommit: vi.fn(), onPendingChange: vi.fn(), onReadRequiredChange: recovery,
    });
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: "INTERNAL_ERROR", message: "Confirmation indisponible" },
    }), { status }));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(importSections()).rejects.toThrow();
      await expect(importSections()).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(recovery).toHaveBeenCalledTimes(1);
    } finally { unregister(); }
  });

  it("keeps a definite validation refusal distinct from an uncertain write", async () => {
    const recovery = vi.fn();
    const unregister = registerEstimateEditorMutations(target, {
      getToken: () => timestamp, onCommit: vi.fn(), onPendingChange: vi.fn(), onReadRequiredChange: recovery,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false, error: { code: "VALIDATION_ERROR", message: "Section inconnue" },
    }), { status: 400 })));
    try {
      await expect(importSections()).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 400 });
      expect(recovery).not.toHaveBeenCalled();
    } finally { unregister(); }
  });

  it("treats an error envelope with HTTP 200 as an uncertain copy instead of permitting another POST", async () => {
    const recovery = vi.fn();
    const unregister = registerEstimateEditorMutations(target, {
      getToken: () => timestamp, onCommit: vi.fn(), onPendingChange: vi.fn(), onReadRequiredChange: recovery,
    });
    const fetch = vi.fn().mockImplementation(() => new Response(JSON.stringify({
      ok: false, error: { code: "INTERNAL_ERROR", message: "Confirmation invalide" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(importSections()).rejects.toThrow();
      await expect(importSections()).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(recovery).toHaveBeenCalledTimes(1);
    } finally { unregister(); }
  });
});
