import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bulkUpdateEstimateItems, createEstimate, createEstimateItem, createEstimateVariant,
  duplicateEstimateVersion, fetchEstimateVersionEvents, promoteEstimateVariant,
  saveEstimateVersion, updateEstimateItem, updateEstimateStatus,
} from "@/lib/estimates/client";
import { recoverEstimateEditorRead, registerEstimateEditorMutations } from "@/lib/estimates/editor-mutations";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

const fixture = createEstimateEditorResponseFixture();
const { version, items: [item] } = fixture;
const other = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const token = { id: version.id, updated_at: version.updated_at, content_revision: version.content_revision };
const createInput = { version_id: version.id, item_type: "line" as const, title: "Tube", position: 1 };
const cleanup: Array<() => void> = [];
function response(data: unknown, status = 200) {
  return Response.json({ ok: status < 400, ...(status < 400 ? { data } : { error: data }) }, { status });
}
function editor() {
  const onCommit = vi.fn();
  const onReadRequiredChange = vi.fn();
  cleanup.push(registerEstimateEditorMutations(version.id, {
    getToken: () => version.updated_at, getRevision: () => version.content_revision,
    onCommit, onReadRequiredChange, onPendingChange: vi.fn(),
  }));
  return { onCommit, onReadRequiredChange };
}
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop());
  vi.unstubAllGlobals();
});
const writes = [
  { name: "settings", run: () => saveEstimateVersion(version.id, { title: "Réglages" }, version.updated_at, version.content_revision), data: { version, items: [item] }, invalid: { version: { ...version, total_ttc_cents: 1 }, items: [item] } },
  { name: "bulk", run: () => bulkUpdateEstimateItems(version.id, version.updated_at, [{ id: item.id, updates: { title: "Tube" } }]), data: { updated_count: 1, version: token }, invalid: { updated_count: 1, version: token, totals: { total_ht_cents: 100, total_tax_cents: 20, total_ttc_cents: 121 } } },
  { name: "create item", run: () => createEstimateItem(version.id, createInput), data: { item, version: token }, invalid: { item: { ...item, version_id: other }, version: token } },
  { name: "update item", run: () => updateEstimateItem(version.id, item.id, { title: "Tube" }), data: { item, version: token }, invalid: { item: { ...item, id: other }, version: token } },
  { name: "status", run: () => updateEstimateStatus(version.id, "sent", version.updated_at), data: { version: { ...version, status: "sent" } }, invalid: { version: { ...version, status: "draft" } } },
];

describe("validated receipts before editor publication", () => {
  for (const write of writes) {
    it.each(["malformed data", "HTML 200", "ok:false 200"])(`${write.name}: %s blocks publication and another write until a verified GET`, async (kind) => {
      const session = editor();
      const invalidResponse = kind === "HTML 200" ? new Response("<html>Login</html>")
        : kind === "ok:false 200" ? Response.json({ ok: false, data: write.data }) : response(write.invalid);
      const fetch = vi.fn().mockResolvedValueOnce(invalidResponse)
        .mockResolvedValueOnce(Response.json({ ok: false, data: fixture }))
        .mockResolvedValueOnce(response(fixture));
      vi.stubGlobal("fetch", fetch);
      await expect(write.run()).rejects.toMatchObject({ code: "ESTIMATE_EDITOR_READ_REQUIRED" });
      expect(session.onCommit).not.toHaveBeenCalled();
      expect(session.onReadRequiredChange).toHaveBeenCalledWith(expect.any(String));
      await expect(updateEstimateItem(version.id, item.id, { title: "Second write" })).rejects.toMatchObject({ code: "ESTIMATE_EDITOR_READ_REQUIRED" });
      expect(fetch).toHaveBeenCalledTimes(1);
      await expect(recoverEstimateEditorRead(version.id)).rejects.toThrow();
      expect(session.onCommit).not.toHaveBeenCalled();
      await expect(write.run()).rejects.toMatchObject({ code: "ESTIMATE_EDITOR_READ_REQUIRED" });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(await recoverEstimateEditorRead(version.id)).toBe(true);
      expect(session.onCommit).toHaveBeenCalledTimes(1);
      expect(session.onCommit).toHaveBeenLastCalledWith(expect.objectContaining({ needsReload: true }));
      expect(fetch.mock.calls.slice(1).map(([, init]) => init.method)).toEqual(["GET", "GET"]);
    });
  }

  it.each([400, 403, 422])("preserves deterministic %s refusals without requiring a recovery read", async (status) => {
    const session = editor();
    const fetch = vi.fn().mockResolvedValueOnce(response({ message: "Refus déterministe", code: "VALIDATION_ERROR" }, status))
      .mockResolvedValueOnce(response({ item, version: token }));
    vi.stubGlobal("fetch", fetch);
    await expect(updateEstimateItem(version.id, item.id, { title: "Refus" })).rejects.toMatchObject({ status, code: "VALIDATION_ERROR" });
    expect(session.onReadRequiredChange).not.toHaveBeenCalled();
    await updateEstimateItem(version.id, item.id, { title: "Valide" });
    expect(session.onCommit).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not enrich an acknowledged CREATE with an invalid timestamp from its complementary GET", async () => {
    const session = editor();
    const onVersionToken = vi.fn();
    const acknowledged = { id: version.id, updated_at: version.updated_at };
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ item, version: acknowledged }))
      .mockResolvedValueOnce(response({ version: { ...token, updated_at: "invalid", content_revision: 99 } }))
      .mockResolvedValueOnce(response({ version: { ...token, updated_at: "invalid", content_revision: 99 } }))
      .mockResolvedValueOnce(response({ version: token }));
    vi.stubGlobal("fetch", fetch);

    await expect(createEstimateItem(version.id, createInput, { documentOwnsReceipt: true, onVersionToken }))
      .resolves.toEqual(item);
    expect(onVersionToken).toHaveBeenCalledWith(acknowledged);
    expect(session.onCommit).toHaveBeenCalledWith(expect.objectContaining({
      version: acknowledged, deferVersionPublication: true,
    }));
    expect(session.onReadRequiredChange).toHaveBeenCalledWith(expect.any(String));
    await expect(updateEstimateItem(version.id, item.id, { title: "Second write" }))
      .rejects.toMatchObject({ code: "ESTIMATE_EDITOR_READ_REQUIRED" });
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(recoverEstimateEditorRead(version.id)).rejects.toThrow();
    expect(session.onCommit).toHaveBeenCalledTimes(1);
    await expect(recoverEstimateEditorRead(version.id)).resolves.toBe(true);
    expect(session.onCommit).toHaveBeenLastCalledWith(expect.objectContaining({ version: token, needsReload: true }));
    expect(fetch.mock.calls.slice(1).map(([, init]) => init.method)).toEqual(["GET", "GET", "GET"]);
  });

  it("enriches a legacy receipt using a token-only GET with UUID aliases and microseconds", async () => {
    const onCommit = vi.fn();
    const onVersionToken = vi.fn();
    const onReadRequiredChange = vi.fn();
    cleanup.push(registerEstimateEditorMutations(other, {
      getToken: () => version.updated_at, onCommit, onPendingChange: vi.fn(), onReadRequiredChange,
    }));
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ item: { ...item, version_id: other }, version: { id: other, updated_at: version.updated_at } }))
      .mockResolvedValueOnce(response({ versionToken: { ...token, id: other.toUpperCase(), updated_at: version.updated_at } }));
    vi.stubGlobal("fetch", fetch);
    await createEstimateItem(other, { ...createInput, version_id: other }, { documentOwnsReceipt: true, onVersionToken });
    expect(onVersionToken).toHaveBeenCalledWith({ ...token, id: other });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ version: { ...token, id: other }, deferVersionPublication: true }));
    expect(onReadRequiredChange).not.toHaveBeenCalled();
  });

  it("accepts UUID case differences before committing the requested editor identity", async () => {
    const onCommit = vi.fn();
    cleanup.push(registerEstimateEditorMutations(other, {
      getToken: () => version.updated_at, onCommit, onPendingChange: vi.fn(),
    }));
    const receivedVersion = { ...token, id: other.toUpperCase() };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      item: { ...item, version_id: other.toUpperCase() }, version: receivedVersion,
    })));
    await createEstimateItem(other, { ...createInput, version_id: other });
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ version: { ...token, id: other } }));
  });

  it("never calls the document receipt callback for an invalid CREATE", async () => {
    const session = editor();
    const onVersionToken = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ item: { ...item, line_total_ttc_cents: 1 }, version: token })));
    await expect(createEstimateItem(version.id, createInput, { documentOwnsReceipt: true, onVersionToken })).rejects.toThrow();
    expect(onVersionToken).not.toHaveBeenCalled();
    expect(session.onCommit).not.toHaveBeenCalled();
  });
});

describe("lifecycle and event client response validation", () => {
  it.each([
    () => createEstimate({ projectId: version.project_id, title: "Devis", dateDevis: "2026-10-28", validiteJours: 30 }),
    () => duplicateEstimateVersion(version.id), () => createEstimateVariant(version.id),
    () => promoteEstimateVariant(version.id), () => fetchEstimateVersionEvents(version.id),
  ])("rejects incomplete success envelopes instead of extracting arbitrary identifiers %#", async (run) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ id: "invalid", version: { id: version.id } })));
    await expect(run()).rejects.toThrow();
  });

  it("returns a canonical event list and rejects a foreign event", async () => {
    const event = { id: other, estimate_version_id: version.id, event_type: "sent", metadata: {}, created_by: null, actor_name: null, occurred_at: version.updated_at, created_at: version.updated_at };
    const fetch = vi.fn().mockResolvedValueOnce(response({ events: [event] }))
      .mockResolvedValueOnce(response({ events: [{ ...event, estimate_version_id: other }] }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchEstimateVersionEvents(version.id)).toEqual([{
      id: other, estimateVersionId: version.id, eventType: "sent", metadata: {}, createdBy: null,
      actorName: null, occurredAt: version.updated_at, createdAt: version.updated_at,
    }]);
    await expect(fetchEstimateVersionEvents(version.id)).rejects.toThrow();
  });
});
