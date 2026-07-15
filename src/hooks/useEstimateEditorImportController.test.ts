// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  applyEstimateStructureDraft: vi.fn(),
  fetchEstimateEditorData: vi.fn(),
  importEstimateSections: vi.fn(),
  importLinkedDpgfSource: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  applyEstimateStructureDraft: clientMocks.applyEstimateStructureDraft,
  fetchEstimateEditorData: clientMocks.fetchEstimateEditorData,
  importEstimateSections: clientMocks.importEstimateSections,
  importLinkedDpgfSource: clientMocks.importLinkedDpgfSource,
}));

import {
  useEstimateEditorImportController,
  type EstimateEditorImportControllerInput,
} from "@/hooks/useEstimateEditorImportController";
import type {
  AffaireLinkedDpgfSource,
  ApplyEstimateStructureDraftResult,
  ImportEstimateSectionsPayload,
  ImportEstimateSectionsResult,
  ImportLinkedDpgfSourceResult,
} from "@/lib/estimates/client";
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";

type LinkedSourceLoader = NonNullable<
  EstimateEditorImportControllerInput["loadLinkedDpgfSource"]
>;
type AutosaveBarrier =
  EstimateEditorImportControllerInput["ensureGroupedActionCanProceed"];
type VersionConflictHandler =
  EstimateEditorImportControllerInput["handleVersionConflict"];

const IMPORT_INPUT: ImportEstimateSectionsPayload = {
  sourceVersionId: "source-version",
  sectionIds: ["section-source"],
  mode: "append",
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createVersion(
  id = "version-1",
  projectId = "project-1",
  status: EstimateVersionRow["status"] = "draft"
) {
  return {
    id,
    project_id: projectId,
    status,
    updated_at: `token-${id}`,
  } as EstimateVersionRow;
}

function createLinkedSource(
  importId = "import-1",
  overrides: Partial<NonNullable<AffaireLinkedDpgfSource>> = {}
): NonNullable<AffaireLinkedDpgfSource> {
  return {
    importId,
    filename: `${importId}.xlsx`,
    sourceFormat: "xlsx",
    importStatus: "completed",
    mappingStatus: "completed",
    importedAt: "2026-07-15T08:00:00.000Z",
    mappingUpdatedAt: "2026-07-15T08:05:00.000Z",
    parseMode: "tabular",
    rowCount: 12,
    mappedRowCount: 10,
    ...overrides,
  };
}

function createImportResult(
  overrides: Partial<ImportEstimateSectionsResult> = {}
): ImportEstimateSectionsResult {
  return {
    sourceVersionId: "source-version",
    targetVersionId: "version-1",
    mode: "append",
    importedSectionsCount: 2,
    importedLinesCount: 5,
    createdSectionIds: ["section-1", "section-2"],
    createdLineIds: ["line-1"],
    versionToken: {
      id: "version-1",
      updated_at: "token-imported",
    },
    ...overrides,
  };
}

function createStructureResult(
  overrides: Partial<ApplyEstimateStructureDraftResult> = {}
): ApplyEstimateStructureDraftResult {
  return {
    draftId: "draft-1",
    versionId: "version-1",
    mode: "create_empty",
    createdCount: 3,
    mergedCount: 1,
    skippedCount: 2,
    createdItemIds: ["section-created"],
    mergedItemIds: ["section-merged"],
    versionToken: {
      id: "version-1",
      updated_at: "token-structure",
    },
    ...overrides,
  };
}

function createDpgfImportResult(
  overrides: Partial<ImportLinkedDpgfSourceResult> = {}
): ImportLinkedDpgfSourceResult {
  return {
    sourceImportId: "import-1",
    targetVersionId: "version-1",
    createdSectionId: "section-dpgf",
    createdLineIds: ["line-dpgf"],
    importedLinesCount: 1,
    skippedLinesCount: 0,
    totals: {
      totalHtCents: 1000,
      totalTaxCents: 200,
      totalTtcCents: 1200,
    },
    versionToken: {
      id: "version-1",
      updated_at: "token-dpgf",
    },
    ...overrides,
  };
}

function createHarness(options: {
  version?: EstimateVersionRow;
  isMutationBlocked?: boolean;
  ensureGroupedActionCanProceed?: AutosaveBarrier;
  handleVersionConflict?: VersionConflictHandler;
  loadLinkedDpgfSource?: LinkedSourceLoader;
  autoOpenStructureDraft?: boolean;
  reloadItems?: () => Promise<void>;
} = {}) {
  let version = options.version ?? createVersion();
  const ensureGroupedActionCanProceed =
    options.ensureGroupedActionCanProceed ??
    vi.fn<AutosaveBarrier>().mockResolvedValue(true);
  const handleVersionConflict =
    options.handleVersionConflict ??
    vi.fn<VersionConflictHandler>().mockReturnValue(false);
  const loadLinkedDpgfSource =
    options.loadLinkedDpgfSource ??
    vi.fn<LinkedSourceLoader>(async () => createLinkedSource());
  const applyVersionToken = vi.fn();
  const reportError = vi.fn();
  const setTotalsOutOfSync = vi.fn();
  const reloadedVersionIds: string[] = [];
  const reloadItems = vi.fn(
    options.reloadItems ??
      (async () => {
        reloadedVersionIds.push(version.id);
      })
  );
  const getVersionSnapshot = vi.fn(() => version);

  const rendered = renderHook(
    ({
      routeVersionId,
      activeVersion,
      isMutationBlocked,
    }: {
      routeVersionId: string;
      activeVersion: EstimateVersionRow;
      isMutationBlocked: boolean;
    }) =>
      useEstimateEditorImportController({
        routeVersionId,
        activeVersion,
        autoOpenStructureDraft: options.autoOpenStructureDraft,
        isMutationBlocked,
        mutationBlockedMessage: "Mutation interdite.",
        getVersionSnapshot,
        ensureGroupedActionCanProceed,
        applyVersionToken,
        handleVersionConflict,
        reloadItems,
        setTotalsOutOfSync,
        reportError,
        resolveErrorMessage: (message) => `public:${message}`,
        loadLinkedDpgfSource,
      }),
    {
      initialProps: {
        routeVersionId: version.id,
        activeVersion: version,
        isMutationBlocked: options.isMutationBlocked ?? false,
      },
    }
  );

  const changeRoute = (
    versionId: string,
    projectId: string,
    status: EstimateVersionRow["status"] = "draft"
  ) => {
    version = createVersion(versionId, projectId, status);
    rendered.rerender({
      routeVersionId: versionId,
      activeVersion: version,
      isMutationBlocked: options.isMutationBlocked ?? false,
    });
  };

  return {
    ...rendered,
    applyVersionToken,
    changeRoute,
    ensureGroupedActionCanProceed,
    getVersion: () => version,
    handleVersionConflict,
    loadLinkedDpgfSource,
    reloadedVersionIds,
    reloadItems,
    reportError,
    setTotalsOutOfSync,
  };
}

async function captureRejection(action: () => Promise<unknown>) {
  let caught: unknown;
  await act(async () => {
    try {
      await action();
    } catch (error) {
      caught = error;
    }
  });
  return caught;
}

beforeEach(() => {
  vi.resetAllMocks();
  clientMocks.fetchEstimateEditorData.mockImplementation(
    async (versionId: string) => ({
      version: createVersion(versionId),
    })
  );
  clientMocks.importEstimateSections.mockResolvedValue(createImportResult());
  clientMocks.applyEstimateStructureDraft.mockResolvedValue(
    createStructureResult()
  );
  clientMocks.importLinkedDpgfSource.mockResolvedValue(
    createDpgfImportResult()
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useEstimateEditorImportController", () => {
  it("loads the linked DPGF source and exposes the state/actions/meta contract", async () => {
    const source = createLinkedSource();
    const loadLinkedDpgfSource = vi.fn<LinkedSourceLoader>(async () => source);
    const harness = createHarness({ loadLinkedDpgfSource });

    await waitFor(() => {
      expect(harness.result.current.state.linkedDpgfSource).toEqual(source);
      expect(harness.result.current.state.isLoadingLinkedDpgfSource).toBe(
        false
      );
    });

    expect(loadLinkedDpgfSource).toHaveBeenCalledWith(
      "project-1",
      expect.any(AbortSignal)
    );
    expect(harness.result.current.actions).toEqual(
      expect.objectContaining({
        refreshLinkedDpgfSource: expect.any(Function),
        importLinkedDpgfSource: expect.any(Function),
        openImportFromEstimateDialog: expect.any(Function),
        confirmImportFromEstimate: expect.any(Function),
        openEstimateStructureDraftDialog: expect.any(Function),
        applyEstimateStructureDraft: expect.any(Function),
      })
    );
    expect(harness.result.current.meta).toEqual({
      hasLinkedDpgfSource: true,
      isImportDpgfSourceDisabled: false,
      isMutationInProgress: false,
    });
  });

  it("aborts the old source request and keeps the latest version result", async () => {
    const firstRequest = createDeferred<AffaireLinkedDpgfSource>();
    const secondRequest = createDeferred<AffaireLinkedDpgfSource>();
    let firstSignal: AbortSignal | null = null;
    const loadLinkedDpgfSource = vi.fn<LinkedSourceLoader>(
      (projectId, signal) => {
        if (projectId === "project-1") {
          firstSignal = signal;
          return firstRequest.promise;
        }
        return secondRequest.promise;
      }
    );
    const harness = createHarness({ loadLinkedDpgfSource });

    await waitFor(() => {
      expect(firstSignal).not.toBeNull();
    });

    harness.changeRoute("version-2", "project-2");
    expect(harness.result.current.state.linkedDpgfSource).toBeNull();
    expect(harness.result.current.state.linkedDpgfSourceError).toBeNull();
    expect(harness.result.current.state.isLoadingLinkedDpgfSource).toBe(true);
    await waitFor(() => {
      expect(loadLinkedDpgfSource).toHaveBeenLastCalledWith(
        "project-2",
        expect.any(AbortSignal)
      );
      expect((firstSignal as AbortSignal | null)?.aborted).toBe(true);
    });

    const latestSource = createLinkedSource("import-2");
    await act(async () => {
      secondRequest.resolve(latestSource);
      await secondRequest.promise;
    });
    await waitFor(() => {
      expect(harness.result.current.state.linkedDpgfSource).toEqual(
        latestSource
      );
    });

    await act(async () => {
      firstRequest.resolve(createLinkedSource("import-stale"));
      await firstRequest.promise;
    });
    expect(harness.result.current.state.linkedDpgfSource).toEqual(latestSource);
  });

  it("opens one structural dialog at a time and resets dialogs and summary on route change", async () => {
    const harness = createHarness();
    await waitFor(() => {
      expect(harness.result.current.meta.hasLinkedDpgfSource).toBe(true);
    });

    let importOpened = false;
    act(() => {
      importOpened =
        harness.result.current.actions.openImportFromEstimateDialog();
    });
    expect(importOpened).toBe(true);
    expect(
      harness.result.current.state.isImportFromEstimateDialogOpen
    ).toBe(true);

    await act(async () => {
      await harness.result.current.actions.confirmImportFromEstimate(
        IMPORT_INPUT
      );
    });
    expect(harness.result.current.state.importSummaryMessage).toBe(
      "2 section(s) et 5 ligne(s) importees."
    );

    harness.changeRoute("version-2", "project-2");
    expect(
      harness.result.current.state.isImportFromEstimateDialogOpen
    ).toBe(false);
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(false);
    expect(harness.result.current.state.importSummaryMessage).toBeNull();
    expect(harness.result.current.state.activeMutation).toBeNull();
    await waitFor(() => {
      expect(
        harness.result.current.state.isImportFromEstimateDialogOpen
      ).toBe(false);
      expect(
        harness.result.current.state.isEstimateStructureDraftDialogOpen
      ).toBe(false);
      expect(harness.result.current.state.importSummaryMessage).toBeNull();
      expect(harness.result.current.state.activeMutation).toBeNull();
    });

    harness.changeRoute("version-1", "project-1");
    expect(
      harness.result.current.state.isImportFromEstimateDialogOpen
    ).toBe(false);
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(false);
    expect(harness.result.current.state.importSummaryMessage).toBeNull();
    expect(harness.result.current.state.activeMutation).toBeNull();

    harness.changeRoute("version-2", "project-2");

    let structureOpened = false;
    act(() => {
      structureOpened =
        harness.result.current.actions.openEstimateStructureDraftDialog();
    });
    expect(structureOpened).toBe(true);
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(true);
    expect(
      harness.result.current.state.isImportFromEstimateDialogOpen
    ).toBe(false);
  });

  it("auto-opens a draft structure dialog once per active route scope", () => {
    const harness = createHarness({ autoOpenStructureDraft: true });

    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(true);

    act(() => {
      harness.result.current.actions.closeEstimateStructureDraftDialog();
    });
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(false);

    harness.rerender({
      routeVersionId: "version-1",
      activeVersion: harness.getVersion(),
      isMutationBlocked: false,
    });
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(false);

    harness.changeRoute("version-2", "project-2");
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(true);

    harness.changeRoute("version-3", "project-3", "sent");
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(false);

    harness.rerender({
      routeVersionId: "version-4",
      activeVersion: createVersion("version-3", "project-3", "draft"),
      isMutationBlocked: false,
    });
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(false);
  });

  it("stops mutations when the autosave barrier is blocked or errors", async () => {
    const ensureGroupedActionCanProceed = vi
      .fn<AutosaveBarrier>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("flush failed"));
    const harness = createHarness({ ensureGroupedActionCanProceed });

    const blockedError = await captureRejection(() =>
      harness.result.current.actions.confirmImportFromEstimate(IMPORT_INPUT)
    );
    expect(blockedError).toBeInstanceOf(Error);
    expect(clientMocks.importEstimateSections).not.toHaveBeenCalled();

    const flushError = await captureRejection(() =>
      harness.result.current.actions.applyEstimateStructureDraft("draft-1", {
        mode: "create_empty",
        selectedRootNodeIds: ["node-1"],
      })
    );
    expect(flushError).toEqual(new Error("flush failed"));
    expect(clientMocks.applyEstimateStructureDraft).not.toHaveBeenCalled();
    expect(harness.handleVersionConflict).toHaveBeenCalledWith(
      flushError,
      { persistDraft: true }
    );
    expect(harness.reportError).toHaveBeenCalledWith("public:flush failed");
  });

  it("returns false when structural dialogs cannot be opened", () => {
    const harness = createHarness({ isMutationBlocked: true });
    let importOpened = true;
    let structureOpened = true;

    act(() => {
      importOpened =
        harness.result.current.actions.openImportFromEstimateDialog();
      structureOpened =
        harness.result.current.actions.openEstimateStructureDraftDialog();
    });

    expect(importOpened).toBe(false);
    expect(structureOpened).toBe(false);
    expect(
      harness.result.current.state.isImportFromEstimateDialogOpen
    ).toBe(false);
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(false);
  });

  it("does not start a mutation if the route changes during the autosave barrier", async () => {
    const barrier = createDeferred<boolean>();
    const ensureGroupedActionCanProceed = vi.fn<AutosaveBarrier>(
      () => barrier.promise
    );
    const harness = createHarness({ ensureGroupedActionCanProceed });

    let operation!: Promise<unknown>;
    act(() => {
      operation = harness.result.current.actions
        .confirmImportFromEstimate(IMPORT_INPUT)
        .catch((error: unknown) => error);
    });
    await waitFor(() => {
      expect(ensureGroupedActionCanProceed).toHaveBeenCalledTimes(1);
    });

    harness.changeRoute("version-2", "project-2");
    await act(async () => {
      barrier.resolve(true);
      await operation;
    });

    expect(clientMocks.importEstimateSections).not.toHaveBeenCalled();
    expect(harness.reloadItems).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalled();
  });

  it("ignores a structural mutation result returned after the source route changed", async () => {
    const structureRequest =
      createDeferred<ApplyEstimateStructureDraftResult>();
    clientMocks.applyEstimateStructureDraft.mockReturnValue(
      structureRequest.promise
    );
    const harness = createHarness();

    let operation!: Promise<unknown>;
    act(() => {
      operation = harness.result.current.actions
        .applyEstimateStructureDraft("draft-1", {
          mode: "create_empty",
          selectedRootNodeIds: ["node-1"],
        })
        .catch((error: unknown) => error);
    });
    await waitFor(() => {
      expect(clientMocks.applyEstimateStructureDraft).toHaveBeenCalledWith(
        "version-1",
        "draft-1",
        {
          mode: "create_empty",
          selectedRootNodeIds: ["node-1"],
        }
      );
    });

    harness.changeRoute("version-2", "project-2");
    await act(async () => {
      structureRequest.resolve(createStructureResult());
      await operation;
    });

    expect(harness.reloadItems).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalled();
    expect(harness.result.current.state.importSummaryMessage).toBeNull();
  });

  it("does not resurrect a V1 mutation after a V1 to V2 to V1 round trip", async () => {
    const structureRequest =
      createDeferred<ApplyEstimateStructureDraftResult>();
    clientMocks.applyEstimateStructureDraft.mockReturnValue(
      structureRequest.promise
    );
    const harness = createHarness();

    let operation!: Promise<unknown>;
    act(() => {
      operation = harness.result.current.actions
        .applyEstimateStructureDraft("draft-1", {
          mode: "create_empty",
          selectedRootNodeIds: ["node-1"],
        })
        .catch((error: unknown) => error);
    });
    await waitFor(() => {
      expect(harness.result.current.state.activeMutation).toBe(
        "structure-draft"
      );
      expect(clientMocks.applyEstimateStructureDraft).toHaveBeenCalledTimes(1);
    });

    harness.changeRoute("version-2", "project-2");
    harness.changeRoute("version-1", "project-1");

    expect(harness.result.current.state.activeMutation).toBeNull();
    expect(
      harness.result.current.state.isImportFromEstimateDialogOpen
    ).toBe(false);
    expect(
      harness.result.current.state.isEstimateStructureDraftDialogOpen
    ).toBe(false);
    expect(harness.result.current.state.importSummaryMessage).toBeNull();

    await act(async () => {
      structureRequest.resolve(createStructureResult());
      await operation;
    });

    expect(harness.reloadItems).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.result.current.state.activeMutation).toBeNull();
    expect(harness.result.current.state.importSummaryMessage).toBeNull();
  });

  it("delegates a 409 to the canonical conflict handler without a second error", async () => {
    const conflict = Object.assign(new Error("version conflict"), {
      status: 409,
    });
    clientMocks.importEstimateSections.mockRejectedValue(conflict);
    const handleVersionConflict =
      vi.fn<VersionConflictHandler>().mockReturnValue(true);
    const harness = createHarness({ handleVersionConflict });

    const caught = await captureRejection(() =>
      harness.result.current.actions.confirmImportFromEstimate(IMPORT_INPUT)
    );

    expect(caught).toBe(conflict);
    expect(handleVersionConflict).toHaveBeenCalledWith(conflict, {
      persistDraft: true,
    });
    expect(harness.reloadItems).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(
      harness.reportError.mock.calls.filter(
        ([message]) => typeof message === "string"
      )
    ).toEqual([]);
  });

  it("reloads and applies the token only for a successful source-version import", async () => {
    const result = createImportResult();
    clientMocks.importEstimateSections.mockResolvedValue(result);
    const harness = createHarness();

    await act(async () => {
      await harness.result.current.actions.confirmImportFromEstimate(
        IMPORT_INPUT
      );
    });

    expect(harness.ensureGroupedActionCanProceed).toHaveBeenCalledWith(
      "importer les sections du devis"
    );
    expect(clientMocks.importEstimateSections).toHaveBeenCalledWith(
      "version-1",
      IMPORT_INPUT
    );
    expect(harness.reloadedVersionIds).toEqual(["version-1"]);
    expect(harness.setTotalsOutOfSync).toHaveBeenCalledWith(false);
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-imported");
    expect(clientMocks.fetchEstimateEditorData).not.toHaveBeenCalled();
    expect(harness.result.current.state.importSummaryMessage).toBe(
      "2 section(s) et 5 ligne(s) importees."
    );
  });

  it("does not advance the token when the post-import item reload fails", async () => {
    const reloadError = new Error("items reload failed");
    clientMocks.importEstimateSections.mockResolvedValue(createImportResult());
    const harness = createHarness({
      reloadItems: vi.fn().mockRejectedValue(reloadError),
    });

    const caught = await captureRejection(() =>
      harness.result.current.actions.confirmImportFromEstimate(IMPORT_INPUT)
    );

    expect(caught).toBe(reloadError);
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalled();
    expect(harness.result.current.state.importSummaryMessage).toBeNull();
    expect(harness.reportError).toHaveBeenCalledWith(
      "public:items reload failed"
    );
  });

  it("does not apply a fallback token to a new route after a linked DPGF import", async () => {
    const tokenRefresh = createDeferred<{
      version: EstimateVersionRow;
    }>();
    clientMocks.importLinkedDpgfSource.mockResolvedValue(
      createDpgfImportResult({ versionToken: null })
    );
    clientMocks.fetchEstimateEditorData.mockReturnValue(tokenRefresh.promise);
    const harness = createHarness();
    await waitFor(() => {
      expect(harness.result.current.meta.hasLinkedDpgfSource).toBe(true);
    });

    let operation!: Promise<void>;
    act(() => {
      operation = harness.result.current.actions.importLinkedDpgfSource();
    });
    await waitFor(() => {
      expect(clientMocks.fetchEstimateEditorData).toHaveBeenCalledWith(
        "version-1"
      );
    });

    harness.changeRoute("version-2", "project-2");
    await act(async () => {
      tokenRefresh.resolve({
        version: createVersion("version-1", "project-1"),
      });
      await operation;
    });

    expect(harness.reloadedVersionIds).toEqual(["version-1"]);
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.result.current.state.importSummaryMessage).toBeNull();
    expect(harness.result.current.state.isImportingDpgfSource).toBe(false);
  });
});
