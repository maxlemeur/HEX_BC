// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback } from "react";

import { useEstimateEditorDocument } from "@/hooks/useEstimateEditorDocument";
import { useEstimateEditorReadController, useEstimateEditorReadState } from "@/hooks/useEstimateEditorReadController";
import { useEstimateEditorSyncController } from "@/hooks/useEstimateEditorSyncController";
import { useEstimateEditorStatusController } from "@/hooks/useEstimateEditorStatusController";
import { haveEstimateSettingsChanged } from "@/lib/estimates/editor-settings-state";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import type { EstimateEditorConflictDraft } from "@/hooks/useEstimateEditorSyncController.types";
import { useEstimateEditorHistoryController } from "@/hooks/useEstimateEditorHistoryController";
import { writeDocumentAutoSaveDraft, writeDocumentConflictDraft } from "@/lib/estimates/editor-document-drafts";
import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";
import type { EstimateLineSaveReceipt } from "@/lib/estimates/editor-line-save";

const io = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), error: vi.fn(), notice: vi.fn(), schedule: vi.fn(), gating: vi.fn(), status: vi.fn(), openSettings: vi.fn() }));
vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateEditorData: io.read,
  fetchEstimateSendGating: io.gating,
  updateEstimateStatus: io.status,
  fetchEstimateSuggestionLearnings: async () => null,
  isEstimateApiError: () => false,
}));
vi.mock("@/lib/estimates/editor-line-save", () => ({ saveEstimateEditorLines: io.save }));
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
    lastSavedAt: null, flushNow: async () => {}, scheduleSave: io.schedule }),
}));
const identity = (message: string) => message;
const noTotals = () => null;
const noSaveSettings = async () => true;
const noOp = () => {};

function data() {
  const value = createEstimateEditorResponseFixture();
  value.items[0].quantity = 1;
  return parseEstimateEditorData(value, value.version.id);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const first = data();
const scope = { actorId: "55555555-5555-4555-8555-555555555555", tenantId: first.version.tenant_id, versionId: first.version.id };

function useEditor(input: typeof scope & { reload: number }) {
  const owner = useEstimateEditorDocument(input);
  const readState = useEstimateEditorReadState();
  const history = useEstimateEditorHistoryController({
    scopeKey: `${input.actorId}/${input.tenantId}/${input.versionId}/${owner.generation}`, reportError: io.error,
  });
  const getVersion = useCallback(() => owner.document.getSnapshot().version, [owner.document]);
  const acceptVersion = useCallback((value: { versionId: string; updatedAt: string; contentRevision?: number }) => {
    owner.document.setConfirmedVersion((previous) => previous?.id === value.versionId
      ? { ...previous, updated_at: value.updatedAt, content_revision: value.contentRevision ?? previous.content_revision }
      : previous);
  }, [owner.document]);
  const { document, setSettings, setItems } = owner;
  const restore = useCallback((draft: EstimateEditorConflictDraft) => {
    if (draft.settings && document.getSnapshot().version?.calc_engine_version !== 3) {
      setSettings(draft.settings);
    }
    const current = document.getSnapshot().items;
    const restoredItems = draft.items.filter((item) => current.some((row) => row.id === item.id));
    setItems([...restoredItems, ...current.filter((item) => !restoredItems.some((row) => row.id === item.id))]);
    return { restoredItems, skippedItemCount: 0, settingsRestored: Boolean(draft.settings) };
  }, [document, setItems, setSettings]);
  const hasPendingSettingsChanges = haveEstimateSettingsChanged(owner.settings, owner.savedSettings);
  const sync = useEstimateEditorSyncController({
    document: owner.document, routeVersionId: input.versionId, activeVersion: owner.version,
    currentUserId: input.actorId, currentTenantId: input.tenantId, isViewerReadOnly: false,
    hasPendingSettingsChanges, isSavingSettings: false, savePendingSettings: noSaveSettings,
    items: owner.items, settings: owner.settings, getVersionSnapshot: getVersion,
    getPersistedTotals: noTotals, replaceItems: owner.setItems, applyRestoredDraft: restore,
    applyVersionFlushResult: acceptVersion, setTotalsOutOfSync: noOp,
    clearHistory: history.actions.clear, reportError: io.error, reportNotice: io.notice, resolveErrorMessage: identity,
  });
  useEstimateEditorReadController({
    ...input, readState, reloadToken: input.reload + sync.meta.reloadToken,
    isLaborSplitEnabled: false, autoOpenVersionZero: false,
    handlers: {
      getCurrentVersion: getVersion, isRecoveryRequired: sync.meta.isReadRecoveryRequired,
      clearSuggestions: noOp, apply: (prepared) => { owner.document.acceptRead(prepared); },
      finish: sync.actions.markVersionReloadFinished, reportRefreshError: io.error, resolveErrorMessage: identity,
    },
  });
  const status = useEstimateEditorStatusController({
    document: owner.document,
    routeVersionId: input.versionId, getVersionSnapshot: getVersion,
    applyUpdatedVersion: (updated) => owner.setVersion((previous) => previous && ({ ...previous, ...updated })),
    isAdmin: false, isViewerReadOnly: false, isConflictLocked: sync.meta.isConflictLocked,
    isDraftLockPending: false, isDraftLockedByOther: false, isDraftLockAcquiring: false, isForcingDraftUnlock: false,
    hasPendingSettingsChanges, openSettings: io.openSettings,
    isFlushInProgress: sync.actions.isFlushInProgress, flushBufferedItemUpdates: sync.actions.flushBufferedItemUpdates,
    hasPendingUpdatesNow: sync.actions.hasPendingUpdatesNow, releaseDraftLock: async () => true,
    handleVersionConflict: () => false, resolveErrorMessage: identity, refreshTimeline: noOp,
  });
  const edit = (quantity: number) => {
    const previous = owner.document.getSnapshot().items[0].quantity;
    const id = owner.document.getSnapshot().items[0].id;
    const apply = (value: number | null) => {
      owner.setItems((items) => items.map((item) => item.id === id ? { ...item, quantity: value } : item));
      sync.actions.enqueueItemUpdate(id, { quantity: value });
    };
    apply(quantity);
    history.actions.push({ undo: async () => apply(previous), redo: async () => apply(quantity) });
  };
  return { ...owner, readState, sync, history, status, edit };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear(); window.sessionStorage.clear();
  io.read.mockReset().mockResolvedValue(data()); io.save.mockReset();
  io.gating.mockResolvedValue({ canSend: true, blockingFlags: [], warningFlags: [], stalePriceDays: 30, checkedAt: first.version.updated_at });
  io.status.mockImplementation(async () => ({ ...data().version, status: "sent" }));
});
afterEach(cleanup);

function receipt(): EstimateLineSaveReceipt {
  return { version: { id: scope.versionId, updated_at: "2026-10-28T10:00:00.123457Z", content_revision: 5 },
    linesCommitted: true, totals: undefined, results: [] };
}

describe("document / read / sync / history integration", () => {
  it("keeps a new edit through a reread and acknowledgement of the submitted edit", async () => {
    const saving = deferred<EstimateLineSaveReceipt>(); io.save.mockReturnValue(saving.promise);
    const view = renderHook(useEditor, { initialProps: { ...scope, reload: 0 } });
    await waitFor(() => expect(view.result.current.items[0]?.quantity).toBe(1));
    act(() => view.result.current.edit(2));
    let flush!: Promise<unknown>;
    act(() => { flush = view.result.current.sync.actions.flushBufferedItemUpdates(); });
    await waitFor(() => expect(io.save).toHaveBeenCalledOnce());
    act(() => view.result.current.edit(3));
    view.rerender({ ...scope, reload: 1 });
    await waitFor(() => expect(io.read).toHaveBeenCalledTimes(2));
    expect(view.result.current.items[0].quantity).toBe(3);
    await act(async () => { saving.resolve(receipt()); await flush; });
    expect(view.result.current.items[0].quantity).toBe(3);
    expect(view.result.current.confirmedItems[0].quantity).toBe(2);
    expect(view.result.current.document.getPendingUpdates().get(first.items[0].id)?.quantity).toBe(3);
  });

  it("undoes and redoes through the same journal, and retains the draft on save failure", async () => {
    io.save.mockRejectedValue(new TypeError("offline"));
    const view = renderHook(useEditor, { initialProps: { ...scope, reload: 0 } });
    await waitFor(() => expect(view.result.current.items[0]?.quantity).toBe(1));
    act(() => view.result.current.edit(4));
    await act(async () => { await view.result.current.history.actions.undo(); });
    expect(view.result.current.items[0].quantity).toBe(1);
    expect(view.result.current.document.getPendingUpdates().size).toBe(0);
    await act(async () => { await view.result.current.history.actions.redo(); });
    await act(async () => { await view.result.current.sync.actions.flushBufferedItemUpdates(); });
    expect(view.result.current.items[0].quantity).toBe(4);
    expect(view.result.current.confirmedItems[0].quantity).toBe(1);
    expect(view.result.current.document.getPendingUpdates().get(first.items[0].id)?.quantity).toBe(4);
  });

  it("restores an attributed draft when the caller supplies uppercase UUIDs", async () => {
    const upperScope = { ...scope, actorId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" };
    writeDocumentAutoSaveDraft(upperScope, [{ id: first.items[0].id, updates: { quantity: 6 } }]);
    const view = renderHook(useEditor, { initialProps: { ...upperScope, reload: 0 } });
    await waitFor(() => expect(view.result.current.items[0]?.quantity).toBe(6));
    expect(view.result.current.confirmedItems[0].quantity).toBe(1);
    expect(view.result.current.document.captureScope().actorId).toBe(upperScope.actorId.toLowerCase());
  });

  it("keeps a preview across a read without turning it into an autosave intention", async () => {
    const view = renderHook(useEditor, { initialProps: { ...scope, reload: 0 } });
    await waitFor(() => expect(view.result.current.items[0]?.quantity).toBe(1));
    act(() => view.result.current.setItems((items) => items.map((item) => ({ ...item, quantity: 7 }))));
    view.rerender({ ...scope, reload: 1 });
    await waitFor(() => expect(io.read).toHaveBeenCalledTimes(2));
    expect(view.result.current.items[0].quantity).toBe(7);
    expect(view.result.current.confirmedItems[0].quantity).toBe(1);
    expect(view.result.current.document.getPendingUpdates().size).toBe(0);
    await act(async () => { await view.result.current.sync.actions.flushBufferedItemUpdates(); });
    expect(io.save).not.toHaveBeenCalled();
  });

  it.each([1, 2] as const)("keeps restored engine %s settings in draft until they are saved or discarded before sending", async (engine) => {
    const incoming = data();
    incoming.version.calc_engine_version = engine;
    io.read.mockResolvedValue(incoming);
    io.status.mockImplementation(async () => ({ ...incoming.version, status: "sent" }));
    const settings = prepareEstimateEditorRead(incoming, false).draft.settings;
    writeDocumentConflictDraft(scope, {
      settings: { ...settings, title: "Restored local title" }, items: [], saved_at: incoming.version.updated_at,
    });
    const view = renderHook(useEditor, { initialProps: { ...scope, reload: 0 } });
    await waitFor(() => expect(view.result.current.sync.state.hasRestorableDraft).toBe(true));
    await waitFor(() => expect(view.result.current.settings).not.toBeNull());
    act(() => view.result.current.sync.actions.restoreConflictDraft());
    expect(view.result.current.settings?.title).toBe("Restored local title");
    expect(view.result.current.savedSettings?.title).toBe(settings.title);
    await act(async () => { await view.result.current.status.actions.requestSend(); });
    await act(async () => { await view.result.current.status.actions.confirmSend(); });
    expect(io.status).not.toHaveBeenCalled();
    expect(io.openSettings).toHaveBeenCalledOnce();
    expect(view.result.current.version?.status).toBe("draft");
    expect(view.result.current.settings?.title).toBe("Restored local title");
    expect(view.result.current.status.state.isSendGatingDialogOpen).toBe(false);
    act(() => view.result.current.document.discardSettings());
    await act(async () => { await view.result.current.status.actions.requestSend(); });
    await act(async () => { await view.result.current.status.actions.confirmSend(); });
    expect(io.status).toHaveBeenCalledOnce();
    expect(view.result.current.version?.status).toBe("sent");
  });

  it("rebases settings and discards to the latest confirmation rather than the first read", async () => {
    const view = renderHook(useEditor, { initialProps: { ...scope, reload: 0 } });
    await waitFor(() => expect(view.result.current.settings).not.toBeNull());
    act(() => view.result.current.setSettings((settings) => settings && ({ ...settings, title: "Local draft" })));
    const incoming = data();
    incoming.version.title = "New server title";
    incoming.version.validite_jours = 60;
    incoming.version.updated_at = "2026-10-28T10:00:00.123458Z";
    io.read.mockResolvedValue(incoming);
    view.rerender({ ...scope, reload: 1 });
    await waitFor(() => expect(view.result.current.savedSettings?.title).toBe("New server title"));
    expect(view.result.current.settings).toMatchObject({ title: "Local draft", validite_jours: 60 });
    act(() => view.result.current.document.discardSettings());
    expect(view.result.current.settings).toMatchObject({ title: "New server title", validite_jours: 60 });
  });

  it("invalidates old imperative ports and a late save after an actor changes", async () => {
    const saving = deferred<EstimateLineSaveReceipt>(); io.save.mockReturnValue(saving.promise);
    const view = renderHook(useEditor, { initialProps: { ...scope, reload: 0 } });
    await waitFor(() => expect(view.result.current.items[0]?.quantity).toBe(1));
    const oldEdit = view.result.current.edit;
    act(() => oldEdit(2));
    let flush!: Promise<unknown>;
    act(() => { flush = view.result.current.sync.actions.flushBufferedItemUpdates(); });
    await waitFor(() => expect(io.save).toHaveBeenCalledOnce());
    view.rerender({ ...scope, actorId: "66666666-6666-4666-8666-666666666666", reload: 0 });
    await waitFor(() => expect(io.read).toHaveBeenCalledTimes(2));
    await act(async () => { saving.resolve(receipt()); await flush; });
    act(() => oldEdit(9));
    expect(view.result.current.confirmedItems[0].quantity).toBe(1);
    expect(view.result.current.items[0].quantity).not.toBe(9);
  });
});
