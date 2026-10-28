import { act, cleanup, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateEditorSyncController } from "@/hooks/useEstimateEditorSyncController";
import { createEstimateItem, type EstimateVersionToken } from "@/lib/estimates/client";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

vi.mock("@/hooks/useDraftLock", () => ({ useDraftLock: () => ({
  holderName: null, isOwnedByCurrentUser: true, isLockedByOther: false,
  isAcquiring: false, isForcingUnlock: false, error: null,
  acquire: async () => true, release: async () => true, forceUnlockAndAcquire: async () => true,
}) }));
vi.mock("@/hooks/useAutoSaveNavigationGuard", () => ({ useAutoSaveNavigationGuard: () => {} }));
vi.mock("@/hooks/useAutoSave", () => ({
  resolveAutoSaveStatusLabel: (status: string) => status,
  isSaveShortcutKey: () => false,
  useAutoSave: () => ({ status: "idle", statusLabel: "idle", isSaving: false, isOnline: true,
    lastSavedAt: null, flushNow: async () => {}, scheduleSave: () => {} }),
}));

const NEXT = "2026-10-28T10:00:00.123457Z";
const LAST = "2026-10-28T10:00:00.123458Z";

function response(data: unknown) {
  return new Response(JSON.stringify({ ok: true, data }), {
    headers: { "Content-Type": "application/json" },
  });
}

function setup() {
  const fixture = createEstimateEditorResponseFixture();
  const created = fixture.items[0];
  const data = parseEstimateEditorData({ ...fixture, items: [] }, fixture.version.id);
  const document = new EstimateEditorDocument({
    actorId: "55555555-5555-4555-8555-555555555555",
    tenantId: data.version.tenant_id, versionId: data.version.id,
  });
  document.acceptRead(prepareEstimateEditorRead(data, false));
  const applyVersion = vi.fn((value: { updatedAt: string; contentRevision?: number }) => {
    document.setConfirmedVersion((previous) => previous && {
      ...previous, updated_at: value.updatedAt,
      content_revision: value.contentRevision ?? previous.content_revision,
    });
  });
  const setTotalsOutOfSync = vi.fn();
  renderHook(() => {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
    return useEstimateEditorSyncController({
      document, routeVersionId: data.version.id, activeVersion: snapshot.version,
      currentUserId: "55555555-5555-4555-8555-555555555555", currentTenantId: data.version.tenant_id,
      isViewerReadOnly: false, hasPendingSettingsChanges: false, isSavingSettings: false,
      savePendingSettings: async () => true, items: snapshot.items, settings: snapshot.settings,
      getVersionSnapshot: () => document.getSnapshot().version, getPersistedTotals: () => null,
      replaceItems: document.setDraftItems,
      applyRestoredDraft: () => ({ restoredItems: [], skippedItemCount: 0 }),
      applyVersionFlushResult: applyVersion, setTotalsOutOfSync, clearHistory: () => {},
      reportError: () => {}, reportNotice: () => {}, resolveErrorMessage: (message) => message,
    });
  });
  return { document, data, created, applyVersion, setTotalsOutOfSync };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("creation receipt through the real client, mediator and document observer", () => {
  it.each([true, false])("publishes the created row and its confirmed revision together (revision in receipt: %s)", async (hasRevision) => {
    const { document, data, created, applyVersion, setTotalsOutOfSync } = setup();
    const token = { id: data.version.id, updated_at: NEXT, content_revision: data.version.content_revision + 1 };
    const fetch = vi.fn().mockResolvedValueOnce(response({ item: created,
      version: hasRevision ? token : { id: token.id, updated_at: token.updated_at } }));
    if (!hasRevision) fetch.mockResolvedValueOnce(response({ version: token }));
    vi.stubGlobal("fetch", fetch);
    const tempId = "tmp:atomic-receipt";
    act(() => document.setDraftItems((items) => [...items, { ...created, id: tempId, _pendingCreate: true }]));
    const publications: Array<{ token: string | undefined; revision: number | undefined; ids: string[] }> = [];
    const stop = document.subscribe(() => publications.push({ token: document.getSnapshot().version?.updated_at,
      revision: document.getSnapshot().version?.content_revision,
      ids: document.getSnapshot().confirmedItems.map((item) => item.id) }));
    await act(async () => {
      let receipt: EstimateVersionToken | undefined;
      const item = await createEstimateItem(data.version.id, created, {
        documentOwnsReceipt: true, onVersionToken: (version) => { receipt = version; },
      });
      expect(document.acceptCreatedItem(tempId, item, document.captureScope(), undefined, receipt)).toBe(true);
    });
    stop();
    expect(publications).toEqual([{ token: NEXT, revision: token.content_revision, ids: [created.id] }]);
    expect(applyVersion).not.toHaveBeenCalled();
    expect(setTotalsOutOfSync).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(hasRevision ? 1 : 2);
  });

  it("preserves immediate version publication for callers without a document owner", async () => {
    const { data, created, document, applyVersion } = setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response({ item: created,
      version: { id: data.version.id, updated_at: NEXT, content_revision: data.version.content_revision + 1 } })));
    await act(async () => { await createEstimateItem(data.version.id, created); });
    expect(applyVersion).toHaveBeenCalledOnce();
    expect(document.getSnapshot().version?.updated_at).toBe(NEXT);
  });

  it("keeps the acknowledged token for the next queued write before the document publishes the first row", async () => {
    const { data, created, document } = setup();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ item: created,
        version: { id: data.version.id, updated_at: NEXT, content_revision: 5 } }))
      .mockResolvedValueOnce(response({ item: { ...created, id: "66666666-6666-4666-8666-666666666666" },
        version: { id: data.version.id, updated_at: LAST, content_revision: 6 } }));
    vi.stubGlobal("fetch", fetch);
    await act(async () => {
      await createEstimateItem(data.version.id, created, { documentOwnsReceipt: true, onVersionToken: () => {} });
      await createEstimateItem(data.version.id, created, { documentOwnsReceipt: true, onVersionToken: () => {} });
    });
    expect(new Headers(fetch.mock.calls[1][1].headers).get("If-Match")).toBe(NEXT);
    expect(document.getSnapshot().version?.updated_at).toBe(data.version.updated_at);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
