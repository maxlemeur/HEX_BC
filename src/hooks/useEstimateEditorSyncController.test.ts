// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import { useEstimateEditorSyncController } from "@/hooks/useEstimateEditorSyncController";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
} from "@/hooks/useEstimateEditorSyncController.types";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import type {
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

const mocks = vi.hoisted(() => ({
  batchEstimateOperations: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
  isEstimateApiError: vi.fn(),
  useAutoSave: vi.fn(),
  scheduleAutoSave: vi.fn(),
  flushAutoSaveNow: vi.fn(),
  useAutoSaveNavigationGuard: vi.fn(),
  useDraftLock: vi.fn(),
  releaseDraftLock: vi.fn(),
  forceUnlockAndAcquireDraftLock: vi.fn(),
  acquireDraftLock: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  batchEstimateOperations: mocks.batchEstimateOperations,
  bulkUpdateEstimateItems: mocks.bulkUpdateEstimateItems,
  isEstimateApiError: mocks.isEstimateApiError,
}));

vi.mock("@/hooks/useAutoSave", () => ({
  isSaveShortcutKey: (event: KeyboardEvent) =>
    event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey),
  useAutoSave: mocks.useAutoSave,
}));

vi.mock("@/hooks/useAutoSaveNavigationGuard", () => ({
  useAutoSaveNavigationGuard: mocks.useAutoSaveNavigationGuard,
}));

vi.mock("@/hooks/useDraftLock", () => ({
  useDraftLock: mocks.useDraftLock,
}));

type ControllerInput = Parameters<typeof useEstimateEditorSyncController>[0];

const AUTO_SAVE_STORAGE_PREFIX = "estimate:edit:autosave-buffer:";
const AUTO_SAVE_PREFERENCE_PREFIX = "estimate:edit:autosave-enabled:v1:";
const CONFLICT_STORAGE_PREFIX = "estimate:edit:conflict-draft:";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function settleDeferredEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function createVersion(
  overrides: Partial<EstimateVersionRow> = {}
): EstimateVersionRow {
  return {
    id: "version-1",
    created_at: "2026-07-15T08:00:00.000Z",
    updated_at: "token-initial",
    tenant_id: "tenant-1",
    project_id: "project-1",
    version_number: 1,
    status: "draft",
    approval_status: "not_required",
    approval_summary: {},
    approval_evaluated_at: null,
    title: "Devis principal",
    exclusions: null,
    date_devis: "2026-07-15",
    validite_jours: 30,
    margin_multiplier: 1.2,
    margin_mode: "fixed",
    currency: "EUR",
    margin_bp: 2000,
    discount_bp: 0,
    discount_mode: "simple",
    discount_steps: [],
    global_coefficient: 1,
    max_section_depth: 4,
    tax_rate_bp: 2000,
    rounding_mode: "none",
    rounding_step_cents: 1,
    total_ht_cents: 1000,
    total_tax_cents: 200,
    total_ttc_cents: 1200,
    rounding_adjustment_cents: 0,
    content_revision: 1,
    seal_hash: null,
    parent_version_id: null,
    variant_label: null,
    calc_engine_version: 1,
    contractor_role: "principal",
    ...overrides,
    calc_snapshot_content_revision:
      overrides.calc_snapshot_content_revision ?? null,
    calc_snapshot_context: overrides.calc_snapshot_context ?? null,
  };
}

function createItem(
  id = "line-1",
  overrides: Partial<EstimateItem> = {}
): EstimateItem {
  return {
    id,
    created_at: "2026-07-15T08:00:00.000Z",
    updated_at: "2026-07-15T08:00:00.000Z",
    tenant_id: "tenant-1",
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    position: 1,
    title: "Ligne initiale",
    aid: null,
    description: null,
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: 0,
    k_mo_atelier: 1,
    labor_role_atelier_id: null,
    h_mo_chantier: 0,
    k_mo_chantier: 1,
    labor_role_chantier_id: null,
    pu_ht_cents: 1000,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    source_provider: null,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: {},
    line_total_ht_cents: 1000,
    line_tax_cents: 200,
    line_total_ttc_cents: 1200,
    ...overrides,
    snapshot_pu_ht_cents: overrides.snapshot_pu_ht_cents ?? null,
    snapshot_fo_ht_cents: overrides.snapshot_fo_ht_cents ?? null,
    snapshot_mo_ht_cents: overrides.snapshot_mo_ht_cents ?? null,
    snapshot_mo_atelier_ht_cents:
      overrides.snapshot_mo_atelier_ht_cents ?? null,
    snapshot_mo_chantier_ht_cents:
      overrides.snapshot_mo_chantier_ht_cents ?? null,
  };
}

function createSettings(
  overrides: Partial<EstimateSettingsState> = {}
): EstimateSettingsState {
  return {
    title: "Devis principal",
    exclusions: "",
    date_devis: "2026-07-15",
    validite_jours: 30,
    currency: "EUR",
    margin_multiplier: 1.2,
    discount_cents: 0,
    tax_rate_bp: 2000,
    rounding_mode: "none",
    rounding_step_cents: 1,
    ...overrides,
  };
}

function createTotals(): EstimateTotals {
  return {
    saleTotalCents: 12_000,
    adjustedTaxCents: 2_400,
    roundedTtcCents: 14_400,
  } as EstimateTotals;
}

function createInput(
  overrides: Partial<ControllerInput> = {}
): ControllerInput {
  const version = createVersion();
  return {
    routeVersionId: version.id,
    activeVersion: version,
    currentUserId: "user-1",
    isViewerReadOnly: false,
    hasPendingSettingsChanges: false,
    isSavingSettings: false,
    savePendingSettings: vi.fn().mockResolvedValue(undefined),
    items: [createItem()],
    settings: createSettings(),
    getVersionSnapshot: vi.fn(() => version),
    getPersistedTotals: vi.fn(() => null),
    replaceItems: vi.fn(),
    applyRestoredDraft: vi.fn(
      (draft: Parameters<ControllerInput["applyRestoredDraft"]>[0]) => ({
        restoredItems: draft.items,
        skippedItemCount: 0,
      })
    ),
    applyVersionFlushResult: vi.fn(),
    setTotalsOutOfSync: vi.fn(),
    clearHistory: vi.fn(),
    reportError: vi.fn(),
    reportNotice: vi.fn(),
    resolveErrorMessage: vi.fn((message: string) => `public:${message}`),
    ...overrides,
  };
}

function createBatchResult(versionId: string, updatedAt: string) {
  return {
    committed: true,
    results: [
      {
        index: 0,
        op: "update",
        status: "success",
        itemId: "line-1",
      },
    ],
    versionToken: {
      id: versionId,
      updated_at: updatedAt,
    },
  };
}

function createApiConflict(message = "La version a ete modifiee.") {
  return {
    __estimateApiError: true,
    name: "EstimateApiError",
    message,
    status: 409,
    details: { current_updated_at: "token-server" },
    code: "VERSION_CONFLICT",
  };
}

function readStoragePayload(storage: Storage, key: string) {
  const raw = storage.getItem(key);
  return raw ? (JSON.parse(raw) as unknown) : null;
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();

  mocks.isEstimateApiError.mockImplementation(
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "__estimateApiError" in error
  );
  mocks.batchEstimateOperations.mockResolvedValue(
    createBatchResult("version-1", "token-batch")
  );
  mocks.bulkUpdateEstimateItems.mockResolvedValue({
    updatedCount: 0,
    versionToken: {
      id: "version-1",
      updated_at: "token-totals",
    },
  });
  mocks.flushAutoSaveNow.mockResolvedValue(undefined);
  mocks.useAutoSave.mockReturnValue({
    status: "idle",
    statusLabel: "À jour",
    isSaving: false,
    isOnline: true,
    lastSavedAt: null,
    flushNow: mocks.flushAutoSaveNow,
    scheduleSave: mocks.scheduleAutoSave,
  });
  mocks.releaseDraftLock.mockResolvedValue(true);
  mocks.forceUnlockAndAcquireDraftLock.mockResolvedValue(true);
  mocks.acquireDraftLock.mockResolvedValue(true);
  mocks.useDraftLock.mockReturnValue({
    holderName: null,
    isOwnedByCurrentUser: true,
    isLockedByOther: false,
    isAcquiring: false,
    isForcingUnlock: false,
    error: null,
    release: mocks.releaseDraftLock,
    forceUnlockAndAcquire: mocks.forceUnlockAndAcquireDraftLock,
    acquire: mocks.acquireDraftLock,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useEstimateEditorSyncController contract", () => {
  it("exposes the public state/actions/meta contract and enables draft autosave", async () => {
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    expect(Object.keys(result.current).sort()).toEqual([
      "actions",
      "meta",
      "state",
    ]);
    expect(Object.keys(result.current.state).sort()).toEqual([
      "autoSaveStatus",
      "autoSaveStatusLabel",
      "conflict",
      "draftLockError",
      "draftLockHolderName",
      "hasPendingBufferedUpdates",
      "hasPendingChanges",
      "hasRestorableDraft",
      "isAutoSaveEnabled",
      "isAutoSaveSaving",
      "isDraftLockAcquiring",
      "isDraftLockOwnedByCurrentUser",
      "isDraftLockedByOther",
      "isForcingDraftUnlock",
      "isReloadingVersion",
      "lastSavedAt",
    ]);
    expect(Object.keys(result.current.actions).sort()).toEqual([
      "clearBufferedItemUpdates",
      "clearConflictDraft",
      "clearConflictState",
      "enqueueItemUpdate",
      "ensureGroupedActionCanProceed",
      "flushBufferedItemUpdates",
      "forceUnlockDraftLock",
      "handleVersionConflict",
      "hasPendingUpdatesNow",
      "isFlushInProgress",
      "markVersionReloadFinished",
      "overlayPendingUpdates",
      "recoverDraftLock",
      "registerVersionConflict",
      "releaseDraftLock",
      "reloadAfterConflict",
      "restoreConflictDraft",
      "retryTotalsSave",
      "saveNow",
      "setAutoSaveEnabled",
      "triggerVersionReload",
    ]);
    expect(Object.keys(result.current.meta).sort()).toEqual([
      "isConflictLocked",
      "isDraftLockPending",
      "isReadOnly",
      "isSaveBlocked",
      "isStatusReadOnly",
      "lockHolderLabel",
      "readOnlyActionErrorMessage",
      "reloadToken",
    ]);
    expect(result.current.state).toMatchObject({
      autoSaveStatus: "idle",
      autoSaveStatusLabel: "À jour",
      isAutoSaveSaving: false,
      isAutoSaveEnabled: true,
      hasPendingBufferedUpdates: false,
      hasPendingChanges: false,
      conflict: null,
      isReloadingVersion: false,
      hasRestorableDraft: false,
    });
    expect(result.current.meta).toMatchObject({
      reloadToken: 0,
      isStatusReadOnly: false,
      isDraftLockPending: false,
      isReadOnly: false,
      isConflictLocked: false,
      isSaveBlocked: false,
    });
    expect(mocks.useAutoSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        enabled: true,
        automaticEnabled: true,
        hasPendingChanges: false,
        debounceMs: AUTOSAVE_DEBOUNCE_MS,
        maxWaitMs: AUTOSAVE_MAX_WAIT_MS,
      })
    );
  });

  it("blocks flushes when the version snapshot is absent or editing is read-only", async () => {
    const missingVersionInput = createInput({
      activeVersion: null,
      getVersionSnapshot: vi.fn(() => null),
    });
    const missingVersion = renderHook(() =>
      useEstimateEditorSyncController(missingVersionInput)
    );

    await settleDeferredEffects();

    act(() => {
      missingVersion.result.current.actions.enqueueItemUpdate("line-1", {
        title: "Modification locale",
      });
    });

    let missingVersionResult: string | undefined;
    await act(async () => {
      missingVersionResult =
        await missingVersion.result.current.actions.flushBufferedItemUpdates();
    });

    expect(missingVersionResult).toBe("blocked");
    expect(mocks.batchEstimateOperations).not.toHaveBeenCalled();
    missingVersion.unmount();
    window.localStorage.clear();

    const readOnlyInput = createInput({ isViewerReadOnly: true });
    const readOnly = renderHook(() =>
      useEstimateEditorSyncController(readOnlyInput)
    );

    await settleDeferredEffects();

    act(() => {
      readOnly.result.current.actions.enqueueItemUpdate("line-1", {
        title: "Modification interdite",
      });
    });

    let readOnlyResult: string | undefined;
    await act(async () => {
      readOnlyResult =
        await readOnly.result.current.actions.flushBufferedItemUpdates();
    });

    expect(readOnlyResult).toBe("blocked");
    expect(readOnly.result.current.meta).toMatchObject({
      isReadOnly: true,
      isSaveBlocked: true,
      readOnlyActionErrorMessage: "Mode consultation active.",
    });
    expect(mocks.batchEstimateOperations).not.toHaveBeenCalled();
  });

  it("persists the user autosave preference and keeps manual saving available", async () => {
    window.localStorage.setItem(
      `${AUTO_SAVE_PREFERENCE_PREFIX}user-1`,
      JSON.stringify({ enabled: false })
    );
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await waitFor(() => {
      expect(result.current.state.isAutoSaveEnabled).toBe(false);
    });
    expect(mocks.useAutoSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        automaticEnabled: false,
        enabled: true,
      })
    );

    act(() => {
      result.current.actions.setAutoSaveEnabled(true);
    });

    expect(result.current.state.isAutoSaveEnabled).toBe(true);
    expect(
      readStoragePayload(
        window.localStorage,
        `${AUTO_SAVE_PREFERENCE_PREFIX}user-1`
      )
    ).toEqual({ enabled: true });

    await act(async () => {
      await result.current.actions.saveNow();
    });
    expect(mocks.flushAutoSaveNow).toHaveBeenCalledTimes(1);
  });

  it("includes unsaved settings in status, navigation guard and Ctrl+S", async () => {
    const savePendingSettings = vi.fn().mockResolvedValue(undefined);
    const input = createInput({
      hasPendingSettingsChanges: true,
      savePendingSettings,
    });
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    expect(result.current.state).toMatchObject({
      autoSaveStatus: "pending",
      autoSaveStatusLabel: "Non sauvegardé",
      hasPendingChanges: true,
    });
    expect(mocks.useAutoSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ enableShortcut: false })
    );
    expect(mocks.useAutoSaveNavigationGuard).toHaveBeenLastCalledWith(
      expect.objectContaining({
        hasPendingChanges: true,
        isSaving: false,
      })
    );

    const shortcutEvent = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(shortcutEvent);
      await Promise.resolve();
    });

    expect(shortcutEvent.defaultPrevented).toBe(true);
    expect(savePendingSettings).toHaveBeenCalledTimes(1);

    let canProceed = true;
    await act(async () => {
      canProceed =
        await result.current.actions.ensureGroupedActionCanProceed(
          "envoyer le chiffrage"
        );
    });
    expect(canProceed).toBe(false);
    expect(input.reportError).toHaveBeenLastCalledWith(
      "Le paramétrage comporte des modifications non enregistrées. Enregistrez-le avant l’action « envoyer le chiffrage »."
    );

    await act(async () => {
      canProceed =
        await result.current.actions.ensureGroupedActionCanProceed(
          "sauvegarder les paramètres",
          { allowPendingSettings: true }
        );
    });
    expect(canProceed).toBe(true);
  });
});

describe("useEstimateEditorSyncController buffered updates", () => {
  it("rehydrates buffered updates from localStorage and overlays the current items", async () => {
    const storageKey = `${AUTO_SAVE_STORAGE_PREFIX}version-1`;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        buffered_updates: [
          {
            id: "line-1",
            updates: { title: "Titre local", quantity: 3 },
          },
        ],
        saved_at: "2026-07-15T09:00:00.000Z",
      })
    );
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await waitFor(() => {
      expect(result.current.state.hasPendingBufferedUpdates).toBe(true);
    });

    expect(input.replaceItems).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "line-1",
        title: "Titre local",
        quantity: 3,
      }),
    ]);
    expect(input.setTotalsOutOfSync).toHaveBeenCalledWith(true);
    expect(input.reportError).toHaveBeenCalledWith(
      "Des modifications locales ont été récupérées. Elles restent en attente de synchronisation."
    );
    expect(result.current.actions.overlayPendingUpdates(input.items)).toEqual([
      expect.objectContaining({ title: "Titre local", quantity: 3 }),
    ]);
  });

  it("merges repeated edits, persists them and schedules autosave", async () => {
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Titre modifie",
      });
      result.current.actions.enqueueItemUpdate("line-1", {
        quantity: 4,
      });
    });

    expect(result.current.state.hasPendingBufferedUpdates).toBe(true);
    expect(result.current.actions.hasPendingUpdatesNow()).toBe(true);
    expect(result.current.actions.overlayPendingUpdates(input.items)).toEqual([
      expect.objectContaining({
        id: "line-1",
        title: "Titre modifie",
        quantity: 4,
      }),
    ]);
    expect(
      readStoragePayload(
        window.localStorage,
        `${AUTO_SAVE_STORAGE_PREFIX}version-1`
      )
    ).toMatchObject({
      buffered_updates: [
        {
          id: "line-1",
          updates: { title: "Titre modifie", quantity: 4 },
        },
      ],
    });
    expect(mocks.scheduleAutoSave).toHaveBeenCalledTimes(2);
  });

  it("ignores a cell commit that repeats the server value, keeps a real edit", async () => {
    const serverItem = createItem();
    const input = createInput({ items: [serverItem] });
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    // Les lignes serveur passent par overlayPendingUpdates au chargement.
    act(() => {
      result.current.actions.overlayPendingUpdates([serverItem]);
    });

    act(() => {
      result.current.actions.enqueueItemUpdate(serverItem.id, {
        title: serverItem.title,
        quantity: serverItem.quantity,
      });
    });

    expect(result.current.state.hasPendingBufferedUpdates).toBe(false);
    expect(mocks.scheduleAutoSave).not.toHaveBeenCalled();
    expect(
      readStoragePayload(
        window.localStorage,
        `${AUTO_SAVE_STORAGE_PREFIX}version-1`
      )
    ).toBeNull();

    act(() => {
      result.current.actions.enqueueItemUpdate(serverItem.id, {
        title: "Titre saisi",
        quantity: serverItem.quantity,
      });
    });

    expect(result.current.state.hasPendingBufferedUpdates).toBe(true);
    expect(mocks.scheduleAutoSave).toHaveBeenCalledTimes(1);
  });

  it("stops re-saving a value the server already acknowledged", async () => {
    const serverItem = createItem();
    const version = createVersion();
    const input = createInput({
      items: [serverItem],
      activeVersion: version,
      getVersionSnapshot: vi.fn(() => version),
    });
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.overlayPendingUpdates([serverItem]);
      result.current.actions.enqueueItemUpdate(serverItem.id, {
        title: "Titre saisi",
      });
    });

    await act(async () => {
      await result.current.actions.flushBufferedItemUpdates();
    });

    expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.actions.enqueueItemUpdate(serverItem.id, {
        title: "Titre saisi",
      });
    });

    expect(result.current.state.hasPendingBufferedUpdates).toBe(false);
    expect(result.current.actions.hasPendingUpdatesNow()).toBe(false);
  });

  it("flushes pending edits when the page is hidden, never when nothing changed", async () => {
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(mocks.flushAutoSaveNow).not.toHaveBeenCalled();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Titre modifie",
      });
    });

    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(mocks.flushAutoSaveNow).toHaveBeenCalledTimes(1);
  });

  it("flushes item operations before totals and applies the final version token", async () => {
    const version = createVersion();
    const totals = createTotals();
    const input = createInput({
      activeVersion: version,
      getVersionSnapshot: vi.fn(() => version),
      getPersistedTotals: vi.fn(() => totals),
    });
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Titre sauvegarde",
      });
    });

    let flushResult: string | undefined;
    await act(async () => {
      flushResult =
        await result.current.actions.flushBufferedItemUpdates();
    });

    expect(flushResult).toBe("saved");
    expect(mocks.batchEstimateOperations).toHaveBeenCalledWith(
      "version-1",
      "token-initial",
      [
        {
          op: "update",
          id: "line-1",
          data: { title: "Titre sauvegarde" },
        },
      ]
    );
    expect(mocks.bulkUpdateEstimateItems).toHaveBeenCalledWith(
      "version-1",
      "token-batch",
      [],
      {
        total_ht_cents: 12_000,
        total_tax_cents: 2_400,
        total_ttc_cents: 14_400,
      }
    );
    expect(
      mocks.batchEstimateOperations.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.bulkUpdateEstimateItems.mock.invocationCallOrder[0]);
    expect(input.applyVersionFlushResult).toHaveBeenCalledWith({
      versionId: "version-1",
      totalsPatch: {
        total_ht_cents: 12_000,
        total_tax_cents: 2_400,
        total_ttc_cents: 14_400,
      },
      updatedAt: "token-totals",
    });
    expect(input.setTotalsOutOfSync).toHaveBeenCalledWith(false);
    expect(input.clearHistory).toHaveBeenCalledTimes(1);
    expect(result.current.state.hasPendingBufferedUpdates).toBe(false);
    expect(result.current.actions.hasPendingUpdatesNow()).toBe(false);
    expect(
      window.localStorage.getItem(`${AUTO_SAVE_STORAGE_PREFIX}version-1`)
    ).toBeNull();
  });

  it("does not replay committed lines when only totals synchronization fails", async () => {
    const totals = createTotals();
    let currentVersion = createVersion();
    const applyVersionFlushResult = vi.fn(
      ({ updatedAt }: { updatedAt: string }) => {
        currentVersion = { ...currentVersion, updated_at: updatedAt };
      }
    );
    mocks.bulkUpdateEstimateItems.mockRejectedValueOnce(
      new Error("Totaux indisponibles")
    );
    const input = createInput({
      activeVersion: currentVersion,
      getVersionSnapshot: vi.fn(() => currentVersion),
      getPersistedTotals: vi.fn(() => totals),
      applyVersionFlushResult,
    });
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Ligne déjà enregistrée",
      });
    });

    let firstResult: string | undefined;
    await act(async () => {
      firstResult =
        await result.current.actions.flushBufferedItemUpdates();
    });

    expect(firstResult).toBe("error");
    expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(1);
    expect(result.current.state.hasPendingBufferedUpdates).toBe(false);
    expect(result.current.state.hasPendingChanges).toBe(true);
    expect(result.current.actions.hasPendingUpdatesNow()).toBe(true);
    expect(applyVersionFlushResult).toHaveBeenLastCalledWith({
      versionId: "version-1",
      totalsPatch: undefined,
      updatedAt: "token-batch",
    });
    expect(
      window.localStorage.getItem(`${AUTO_SAVE_STORAGE_PREFIX}version-1`)
    ).toBeNull();
    expect(input.reportError).toHaveBeenLastCalledWith(
      "Les lignes sont enregistrées, mais les totaux n’ont pas pu être synchronisés. Une nouvelle tentative va être effectuée."
    );

    let retryResult: string | undefined;
    await act(async () => {
      retryResult =
        await result.current.actions.flushBufferedItemUpdates();
    });

    expect(retryResult).toBe("saved");
    expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(1);
    expect(mocks.bulkUpdateEstimateItems).toHaveBeenNthCalledWith(
      2,
      "version-1",
      "token-batch",
      [],
      {
        total_ht_cents: 12_000,
        total_tax_cents: 2_400,
        total_ttc_cents: 14_400,
      }
    );
    expect(result.current.state.hasPendingChanges).toBe(false);
    expect(result.current.actions.hasPendingUpdatesNow()).toBe(false);
  });

  it("reacquires a missing draft lock and retries the buffered save", async () => {
    const lockRequiredError = {
      __estimateApiError: true,
      name: "EstimateApiError",
      message: "Un verrou actif est requis.",
      status: 409,
      details: { lock: null },
      code: "LOCK_REQUIRED",
    };
    mocks.batchEstimateOperations.mockRejectedValueOnce(lockRequiredError);
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        unit_price_ht_cents: 1201,
      });
    });

    let flushResult: string | undefined;
    await act(async () => {
      flushResult =
        await result.current.actions.flushBufferedItemUpdates();
    });

    expect(flushResult).toBe("saved");
    expect(mocks.acquireDraftLock).toHaveBeenCalledTimes(1);
    expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(2);
    expect(input.reportError).not.toHaveBeenCalledWith(lockRequiredError.message);
  });

  it("preserves edits typed while a flush is in flight", async () => {
    const deferredBatch = createDeferred<ReturnType<typeof createBatchResult>>();
    mocks.batchEstimateOperations.mockReturnValueOnce(deferredBatch.promise);
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Titre du premier lot",
      });
    });

    let flushPromise!: Promise<string>;
    act(() => {
      flushPromise = result.current.actions.flushBufferedItemUpdates();
    });
    expect(result.current.actions.isFlushInProgress()).toBe(true);

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Titre saisi pendant le flush",
        quantity: 7,
      });
    });

    await act(async () => {
      deferredBatch.resolve(createBatchResult("version-1", "token-batch"));
      await flushPromise;
    });

    expect(result.current.state.hasPendingBufferedUpdates).toBe(true);
    expect(result.current.actions.hasPendingUpdatesNow()).toBe(true);
    expect(result.current.actions.overlayPendingUpdates(input.items)).toEqual([
      expect.objectContaining({
        title: "Titre saisi pendant le flush",
        quantity: 7,
      }),
    ]);
    expect(
      readStoragePayload(
        window.localStorage,
        `${AUTO_SAVE_STORAGE_PREFIX}version-1`
      )
    ).toMatchObject({
      buffered_updates: [
        {
          id: "line-1",
          updates: {
            title: "Titre saisi pendant le flush",
            quantity: 7,
          },
        },
      ],
    });
  });

  it("refuses a grouped action while a buffered flush is already in flight", async () => {
    const deferredBatch = createDeferred<ReturnType<typeof createBatchResult>>();
    mocks.batchEstimateOperations.mockReturnValueOnce(deferredBatch.promise);
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Titre en cours d'envoi",
      });
    });

    let flushPromise!: Promise<string>;
    act(() => {
      flushPromise = result.current.actions.flushBufferedItemUpdates();
    });
    expect(result.current.actions.isFlushInProgress()).toBe(true);

    let canProceed = true;
    await act(async () => {
      canProceed =
        await result.current.actions.ensureGroupedActionCanProceed(
          "modifier la structure"
        );
    });

    expect(canProceed).toBe(false);
    expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(1);
    expect(input.reportError).toHaveBeenLastCalledWith(
      "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
    );

    await act(async () => {
      deferredBatch.resolve(createBatchResult("version-1", "token-batch"));
      await flushPromise;
    });
  });

  it("requeues failed updates without overwriting newer local edits", async () => {
    mocks.batchEstimateOperations.mockRejectedValueOnce(
      new Error("Reseau indisponible")
    );
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Titre a reessayer",
        quantity: 2,
      });
    });

    let flushResult: string | undefined;
    await act(async () => {
      flushResult =
        await result.current.actions.flushBufferedItemUpdates();
    });

    expect(flushResult).toBe("error");
    expect(result.current.state.hasPendingBufferedUpdates).toBe(true);
    expect(result.current.actions.overlayPendingUpdates(input.items)).toEqual([
      expect.objectContaining({
        title: "Titre a reessayer",
        quantity: 2,
      }),
    ]);
    expect(
      readStoragePayload(
        window.localStorage,
        `${AUTO_SAVE_STORAGE_PREFIX}version-1`
      )
    ).toMatchObject({
      buffered_updates: [
        {
          id: "line-1",
          updates: { title: "Titre a reessayer", quantity: 2 },
        },
      ],
    });
    expect(input.setTotalsOutOfSync).toHaveBeenCalledWith(true);
    expect(input.reportError).toHaveBeenCalledWith(
      "public:Reseau indisponible"
    );
  });
});

describe("useEstimateEditorSyncController conflicts and route changes", () => {
  it("snapshots a VERSION_CONFLICT in sessionStorage, clears local data and reloads", async () => {
    const conflict = createApiConflict();
    mocks.batchEstimateOperations.mockRejectedValueOnce(conflict);
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Edition en conflit",
      });
    });

    let flushResult: string | undefined;
    await act(async () => {
      flushResult =
        await result.current.actions.flushBufferedItemUpdates();
    });

    expect(flushResult).toBe("blocked");
    expect(result.current.state.conflict).toEqual({
      message: "public:La version a ete modifiee.",
      details: conflict.details,
    });
    expect(result.current.state.hasRestorableDraft).toBe(true);
    expect(result.current.state.isReloadingVersion).toBe(true);
    expect(result.current.meta).toMatchObject({
      reloadToken: 1,
      isConflictLocked: true,
      isSaveBlocked: true,
    });
    expect(
      readStoragePayload(
        window.sessionStorage,
        `${CONFLICT_STORAGE_PREFIX}version-1`
      )
    ).toMatchObject({
      settings: input.settings,
      items: input.items,
    });
    expect(
      window.localStorage.getItem(`${AUTO_SAVE_STORAGE_PREFIX}version-1`)
    ).toBeNull();
    expect(result.current.actions.hasPendingUpdatesNow()).toBe(false);
    expect(input.reportError).toHaveBeenCalledWith(
      "public:La version a ete modifiee."
    );
  });

  it("does not lock the editor for an EST384_VERSION_NOT_EMPTY business conflict", async () => {
    const businessConflict = {
      ...createApiConflict("La version 384 contient deja des donnees."),
      code: "EST384_VERSION_NOT_EMPTY",
    };
    mocks.batchEstimateOperations.mockRejectedValueOnce(businessConflict);
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Edition a conserver",
      });
    });

    let flushResult: string | undefined;
    await act(async () => {
      flushResult =
        await result.current.actions.flushBufferedItemUpdates();
    });

    expect(flushResult).toBe("error");
    expect(result.current.state.conflict).toBeNull();
    expect(result.current.meta).toMatchObject({
      reloadToken: 0,
      isConflictLocked: false,
      isSaveBlocked: false,
    });
    expect(result.current.state.hasRestorableDraft).toBe(false);
    expect(result.current.state.hasPendingBufferedUpdates).toBe(true);
    expect(
      window.sessionStorage.getItem(
        `${CONFLICT_STORAGE_PREFIX}version-1`
      )
    ).toBeNull();
  });

  it("restores a conflict draft but retains its session snapshot until save", async () => {
    const draft = {
      settings: createSettings({ title: "Brouillon restaure" }),
      items: [createItem("line-restored", { title: "Ligne restauree" })],
      saved_at: "2026-07-15T09:30:00.000Z",
    };
    const storageKey = `${CONFLICT_STORAGE_PREFIX}version-1`;
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await waitFor(() => {
      expect(result.current.state.hasRestorableDraft).toBe(true);
    });

    act(() => {
      result.current.actions.restoreConflictDraft();
    });

    expect(input.applyRestoredDraft).toHaveBeenCalledWith(draft);
    expect(readStoragePayload(window.sessionStorage, storageKey)).toEqual(draft);
    expect(result.current.state.hasRestorableDraft).toBe(false);
    expect(result.current.state.hasPendingBufferedUpdates).toBe(true);
    expect(input.reportError).toHaveBeenCalledWith(null);
    expect(input.reportNotice).toHaveBeenLastCalledWith(
      "Modifications locales restaurées. Les lignes restent en attente de synchronisation ; enregistrez le paramétrage pour confirmer les réglages."
    );
    expect(
      readStoragePayload(
        window.localStorage,
        `${AUTO_SAVE_STORAGE_PREFIX}version-1`
      )
    ).toMatchObject({
      buffered_updates: [
        {
          id: "line-restored",
          updates: {
            title: "Ligne restauree",
            parent_id: null,
            position: 1,
          },
        },
      ],
    });
  });

  it("warns when a locally restored line no longer exists on the server", async () => {
    const draft = {
      settings: createSettings(),
      items: [createItem("line-deleted")],
      saved_at: "2026-07-15T09:30:00.000Z",
    };
    window.sessionStorage.setItem(
      `${CONFLICT_STORAGE_PREFIX}version-1`,
      JSON.stringify(draft)
    );
    const input = createInput({
      applyRestoredDraft: vi.fn(() => ({
        restoredItems: [],
        skippedItemCount: 1,
      })),
    });
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await waitFor(() => {
      expect(result.current.state.hasRestorableDraft).toBe(true);
    });

    act(() => {
      result.current.actions.restoreConflictDraft();
    });

    expect(input.reportNotice).toHaveBeenLastCalledWith(
      "Les modifications des lignes encore présentes ont été restaurées. Certaines différences de structure n’ont pas été réappliquées afin de préserver les données serveur."
    );
    expect(result.current.state.hasPendingBufferedUpdates).toBe(false);
    expect(
      window.localStorage.getItem(`${AUTO_SAVE_STORAGE_PREFIX}version-1`)
    ).toBeNull();
  });

  it("clears a restorable draft without applying it", async () => {
    const draft = {
      settings: createSettings(),
      items: [createItem()],
      saved_at: "2026-07-15T09:30:00.000Z",
    };
    const storageKey = `${CONFLICT_STORAGE_PREFIX}version-1`;
    window.sessionStorage.setItem(storageKey, JSON.stringify(draft));
    const input = createInput();
    const { result } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await waitFor(() => {
      expect(result.current.state.hasRestorableDraft).toBe(true);
    });

    act(() => {
      result.current.actions.clearConflictDraft();
    });

    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(result.current.state.hasRestorableDraft).toBe(false);
    expect(input.applyRestoredDraft).not.toHaveBeenCalled();
    expect(input.reportNotice).toHaveBeenLastCalledWith(null);
  });

  it("ignores a successful response from the previous route generation", async () => {
    const deferredBatch = createDeferred<ReturnType<typeof createBatchResult>>();
    mocks.batchEstimateOperations.mockReturnValueOnce(deferredBatch.promise);
    const versionOne = createVersion();
    const versionTwo = createVersion({
      id: "version-2",
      version_number: 2,
      updated_at: "token-version-2",
    });
    const sharedCallbacks = createInput();
    const { result, rerender } = renderHook(
      ({ version }: { version: EstimateVersionRow }) =>
        useEstimateEditorSyncController({
          ...sharedCallbacks,
          routeVersionId: version.id,
          activeVersion: version,
          items: [
            createItem("line-1", {
              version_id: version.id,
              title: `Ligne ${version.id}`,
            }),
          ],
          getVersionSnapshot: () => version,
        }),
      { initialProps: { version: versionOne } }
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Edition de la premiere route",
      });
    });

    let flushPromise!: Promise<string>;
    act(() => {
      flushPromise = result.current.actions.flushBufferedItemUpdates();
    });

    rerender({ version: versionTwo });

    let flushResult: string | undefined;
    await act(async () => {
      deferredBatch.resolve(createBatchResult("version-1", "token-old-route"));
      flushResult = await flushPromise;
    });

    expect(flushResult).toBe("saved");
    expect(sharedCallbacks.applyVersionFlushResult).not.toHaveBeenCalled();
    expect(sharedCallbacks.clearHistory).not.toHaveBeenCalled();
    expect(sharedCallbacks.setTotalsOutOfSync).not.toHaveBeenCalledWith(false);
    expect(result.current.meta.reloadToken).toBe(0);
    expect(result.current.state.conflict).toBeNull();
  });

  it("keeps a late conflict snapshot scoped to its original route", async () => {
    const versionOne = createVersion();
    const versionTwo = createVersion({
      id: "version-2",
      version_number: 2,
      updated_at: "token-version-2",
    });
    const sharedCallbacks = createInput();
    const { result, rerender } = renderHook(
      ({ version }: { version: EstimateVersionRow }) =>
        useEstimateEditorSyncController({
          ...sharedCallbacks,
          routeVersionId: version.id,
          activeVersion: version,
          items: [
            createItem(`line-${version.version_number}`, {
              version_id: version.id,
              title: `Ligne ${version.id}`,
            }),
          ],
          settings: createSettings({ title: `Devis ${version.id}` }),
          getVersionSnapshot: () => version,
        }),
      { initialProps: { version: versionOne } }
    );

    await settleDeferredEffects();
    const handleVersionOneConflict =
      result.current.actions.handleVersionConflict;

    rerender({ version: versionTwo });
    await settleDeferredEffects();

    let handled = false;
    act(() => {
      handled = handleVersionOneConflict(createApiConflict(), {
        persistDraft: true,
      });
    });

    expect(handled).toBe(true);
    expect(
      readStoragePayload(
        window.sessionStorage,
        `${CONFLICT_STORAGE_PREFIX}version-1`
      )
    ).toMatchObject({
      settings: { title: "Devis version-1" },
      items: [{ title: "Ligne version-1", version_id: "version-1" }],
    });
    expect(
      window.sessionStorage.getItem(`${CONFLICT_STORAGE_PREFIX}version-2`)
    ).toBeNull();
    expect(result.current.state.conflict).toBeNull();
    expect(result.current.meta.reloadToken).toBe(0);
  });

  it("reloads from the server when another page takes over the draft lock", async () => {
    const version = createVersion();
    const input = createInput({
      activeVersion: version,
      getVersionSnapshot: vi.fn(() => version),
    });
    const { result, rerender } = renderHook(() =>
      useEstimateEditorSyncController(input)
    );

    await settleDeferredEffects();
    expect(result.current.meta.reloadToken).toBe(0);

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Saisie non synchronisee",
      });
    });

    // Un admin force le deverrouillage depuis une autre page.
    mocks.useDraftLock.mockReturnValue({
      holderName: "Bob Dupont",
      isOwnedByCurrentUser: false,
      isLockedByOther: true,
      isAcquiring: false,
      isForcingUnlock: false,
      error: null,
      release: mocks.releaseDraftLock,
      forceUnlockAndAcquire: mocks.forceUnlockAndAcquireDraftLock,
      acquire: mocks.acquireDraftLock,
    });

    await act(async () => {
      rerender();
    });

    expect(result.current.meta.reloadToken).toBe(1);
    expect(result.current.state.conflict).toBeNull();
    expect(result.current.state.isReloadingVersion).toBe(true);
    // Les modifications locales restent en attente, bloquees mais pas perdues.
    expect(result.current.actions.hasPendingUpdatesNow()).toBe(true);
    expect(result.current.meta.isSaveBlocked).toBe(true);

    await act(async () => {
      rerender();
    });
    expect(result.current.meta.reloadToken).toBe(1);
  });

  it("refuses force unlock while the active version does not match the route", async () => {
    const versionOne = createVersion();
    const input = createInput();
    const { result, rerender } = renderHook(
      ({ routeVersionId }: { routeVersionId: string }) =>
        useEstimateEditorSyncController({
          ...input,
          routeVersionId,
          activeVersion: versionOne,
        }),
      { initialProps: { routeVersionId: "version-1" } }
    );

    await settleDeferredEffects();
    rerender({ routeVersionId: "version-2" });

    await act(async () => {
      await result.current.actions.forceUnlockDraftLock();
    });

    expect(mocks.forceUnlockAndAcquireDraftLock).not.toHaveBeenCalled();
    expect(input.reportError).toHaveBeenLastCalledWith(
      "Version de brouillon introuvable."
    );
    expect(result.current.state.isDraftLockedByOther).toBe(false);
  });

  it("preserves newer edits when a previous-route flush fails late", async () => {
    const deferredBatch = createDeferred<ReturnType<typeof createBatchResult>>();
    mocks.batchEstimateOperations.mockReturnValueOnce(deferredBatch.promise);
    const versionOne = createVersion();
    const versionTwo = createVersion({
      id: "version-2",
      version_number: 2,
      updated_at: "token-version-2",
    });
    const sharedCallbacks = createInput();
    const { result, rerender } = renderHook(
      ({ version }: { version: EstimateVersionRow }) =>
        useEstimateEditorSyncController({
          ...sharedCallbacks,
          routeVersionId: version.id,
          activeVersion: version,
          items: [
            createItem("line-1", {
              version_id: version.id,
              title: `Ligne ${version.id}`,
            }),
          ],
          getVersionSnapshot: () => version,
        }),
      { initialProps: { version: versionOne } }
    );

    await settleDeferredEffects();

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Edition envoyee",
        quantity: 2,
      });
    });

    let flushPromise!: Promise<string>;
    act(() => {
      flushPromise = result.current.actions.flushBufferedItemUpdates();
    });

    act(() => {
      result.current.actions.enqueueItemUpdate("line-1", {
        title: "Edition plus recente",
      });
    });
    rerender({ version: versionTwo });

    let flushResult: string | undefined;
    await act(async () => {
      deferredBatch.reject(new Error("Ancienne route indisponible"));
      flushResult = await flushPromise;
    });

    expect(flushResult).toBe("blocked");
    expect(
      readStoragePayload(
        window.localStorage,
        `${AUTO_SAVE_STORAGE_PREFIX}version-1`
      )
    ).toMatchObject({
      buffered_updates: [
        {
          id: "line-1",
          updates: {
            title: "Edition plus recente",
            quantity: 2,
          },
        },
      ],
    });
    expect(sharedCallbacks.reportError).not.toHaveBeenCalledWith(
      "public:Ancienne route indisponible"
    );
    expect(sharedCallbacks.applyVersionFlushResult).not.toHaveBeenCalled();
  });
});
