// @vitest-environment jsdom

import { act,cleanup,renderHook,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  applyEstimateStructureDraft: vi.fn(),
  fetchEstimateEditorData: vi.fn(),
  fetchAffaireLinkedDpgfSource: vi.fn(),
  importEstimateSections: vi.fn(),
  importLinkedDpgfSource: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  applyEstimateStructureDraft: clientMocks.applyEstimateStructureDraft,
  fetchEstimateEditorData: clientMocks.fetchEstimateEditorData,
  fetchAffaireLinkedDpgfSource: clientMocks.fetchAffaireLinkedDpgfSource,
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
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

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
  document?: EstimateEditorDocument;
  version?: EstimateVersionRow;
  isMutationBlocked?: boolean;
  ensureGroupedActionCanProceed?: AutosaveBarrier;
  handleVersionConflict?: VersionConflictHandler;
  loadLinkedDpgfSource?: LinkedSourceLoader;
  autoOpenStructureDraft?: boolean;
  reloadItems?: () => Promise<void>;
  useDefaultLoader?: boolean;
} = {}) {
  let version = options.version ?? createVersion();
  const ensureGroupedActionCanProceed =
    options.ensureGroupedActionCanProceed ??
    vi.fn<AutosaveBarrier>().mockResolvedValue(true);
  const handleVersionConflict =
    options.handleVersionConflict ??
    vi.fn<VersionConflictHandler>().mockReturnValue(false);
  const loadLinkedDpgfSource = options.useDefaultLoader ? undefined :
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
        document: options.document,
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
    changeIdentity: (actorId: string, tenantId: string) => {
      if (!options.document) throw new Error("Document required for an identity change.");
      options.document.changeScope({ actorId, tenantId, versionId: version.id });
      version = { ...version, tenant_id: tenantId };
      options.document.setConfirmedVersion({ ...version, estimate_projects: null });
      rendered.rerender({
        routeVersionId: version.id, activeVersion: version,
        isMutationBlocked: options.isMutationBlocked ?? false,
      });
    },
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
  clientMocks.fetchAffaireLinkedDpgfSource.mockResolvedValue(createLinkedSource());
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

describe("import controller document identity", () => {
  const tenantA = "22222222-2222-4222-8222-222222222222";
  const tenantB = "77777777-7777-4777-8777-777777777777";

  function connected(options: Parameters<typeof createHarness>[0] = {}) {
    const version = { ...createEstimateEditorResponseFixture().version,
      id: "version-1", project_id: "project-1", tenant_id: tenantA };
    const document = new EstimateEditorDocument({ actorId: "actor-a", tenantId: tenantA, versionId: version.id });
    document.setConfirmedVersion(version);
    return { ...createHarness({ ...options, document, version }), document };
  }

  it.each([
    ["actor", "actor-b", tenantA],
    ["tenant", "actor-a", tenantB],
  ])("aborts the old source and hides old UI when the %s changes on the same version", async (_kind, actorId, tenantId) => {
    const first = createDeferred<AffaireLinkedDpgfSource>();
    const second = createDeferred<AffaireLinkedDpgfSource>();
    const signals: AbortSignal[] = [];
    const loadLinkedDpgfSource = vi.fn<LinkedSourceLoader>((_projectId, signal) => {
      signals.push(signal);
      return signals.length === 1 ? first.promise : second.promise;
    });
    const harness = connected({ loadLinkedDpgfSource });
    await waitFor(() => expect(loadLinkedDpgfSource).toHaveBeenCalledTimes(1));
    act(() => { harness.result.current.actions.openImportFromEstimateDialog(); });
    expect(harness.result.current.state.isImportFromEstimateDialogOpen).toBe(true);
    act(() => harness.changeIdentity(actorId, tenantId));
    expect(harness.result.current.state.linkedDpgfSource).toBeNull();
    expect(harness.result.current.state.isImportFromEstimateDialogOpen).toBe(false);
    expect(harness.result.current.state.isEstimateStructureDraftDialogOpen).toBe(false);
    expect(harness.result.current.state.importSummaryMessage).toBeNull();
    await waitFor(() => {
      expect(signals[0].aborted).toBe(true);
      expect(loadLinkedDpgfSource).toHaveBeenCalledTimes(2);
    });
    const source = createLinkedSource("current-source");
    await act(async () => { second.resolve(source); await second.promise; });
    await act(async () => { first.resolve(createLinkedSource("old-source")); await first.promise; });
    expect(harness.result.current.state.linkedDpgfSource).toEqual(source);
  });

  it("allows the new actor's mutation while ignoring the prior in-flight result, reload and token", async () => {
    const first = createDeferred<ImportEstimateSectionsResult>();
    clientMocks.importEstimateSections.mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(createImportResult({ importedSectionsCount: 3, versionToken: { id: "version-1", updated_at: "token-b" } }));
    const harness = connected();
    let oldOperation!: Promise<unknown>;
    act(() => { oldOperation = harness.result.current.actions.confirmImportFromEstimate(IMPORT_INPUT).catch((error: unknown) => error); });
    await waitFor(() => expect(clientMocks.importEstimateSections).toHaveBeenCalledTimes(1));
    act(() => harness.changeIdentity("actor-b", tenantB));
    expect(harness.result.current.state.activeMutation).toBeNull();
    await act(async () => harness.result.current.actions.confirmImportFromEstimate(IMPORT_INPUT));
    expect(clientMocks.importEstimateSections).toHaveBeenCalledTimes(2);
    expect(harness.reloadItems).toHaveBeenCalledTimes(1);
    expect(harness.applyVersionToken).toHaveBeenCalledExactlyOnceWith("token-b");
    const newSummary = harness.result.current.state.importSummaryMessage;
    await act(async () => { first.resolve(createImportResult()); await oldOperation; });
    expect(harness.reloadItems).toHaveBeenCalledTimes(1);
    expect(harness.applyVersionToken).toHaveBeenCalledExactlyOnceWith("token-b");
    expect(harness.result.current.state.importSummaryMessage).toBe(newSummary);
    expect(harness.result.current.state.activeMutation).toBeNull();
  });

  it("rejects old actions after an actor A to B to A cycle before source loads, dialogs or writes", async () => {
    const loader = vi.fn<LinkedSourceLoader>().mockResolvedValue(createLinkedSource());
    const harness = connected({ loadLinkedDpgfSource: loader });
    await waitFor(() => expect(harness.result.current.meta.hasLinkedDpgfSource).toBe(true));
    const old = harness.result.current.actions;
    act(() => harness.changeIdentity("actor-b", tenantB));
    act(() => harness.changeIdentity("actor-a", tenantA));
    await waitFor(() => expect(harness.result.current.meta.hasLinkedDpgfSource).toBe(true));
    const loadsBefore = loader.mock.calls.length;
    act(() => {
      expect(old.openImportFromEstimateDialog()).toBe(false);
      expect(old.openEstimateStructureDraftDialog()).toBe(false);
    });
    await captureRejection(() => old.confirmImportFromEstimate(IMPORT_INPUT));
    await captureRejection(() => old.applyEstimateStructureDraft("draft-1", { mode: "create_empty", selectedRootNodeIds: ["node-1"] }));
    await captureRejection(() => old.importLinkedDpgfSource());
    await captureRejection(() => old.refreshLinkedDpgfSource());
    expect(loader).toHaveBeenCalledTimes(loadsBefore);
    expect(harness.ensureGroupedActionCanProceed).not.toHaveBeenCalled();
    expect(clientMocks.importEstimateSections).not.toHaveBeenCalled();
    expect(clientMocks.applyEstimateStructureDraft).not.toHaveBeenCalled();
    expect(clientMocks.importLinkedDpgfSource).not.toHaveBeenCalled();
    expect(harness.reloadItems).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
  });

  it("does not apply a fallback token after the actor changes during that read", async () => {
    const fallback = createDeferred<{ version: EstimateVersionRow }>();
    clientMocks.importEstimateSections.mockResolvedValue(createImportResult({ versionToken: null }));
    clientMocks.fetchEstimateEditorData.mockReturnValueOnce(fallback.promise);
    const harness = connected();
    let operation!: Promise<unknown>;
    act(() => { operation = harness.result.current.actions.confirmImportFromEstimate(IMPORT_INPUT).catch((error: unknown) => error); });
    await waitFor(() => expect(clientMocks.fetchEstimateEditorData).toHaveBeenCalledTimes(1));
    expect(harness.reloadItems).toHaveBeenCalledTimes(1);
    act(() => harness.changeIdentity("actor-b", tenantB));
    await act(async () => { fallback.resolve({ version: createVersion() }); await operation; });
    expect(harness.reloadItems).toHaveBeenCalledTimes(1);
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.result.current.state.importSummaryMessage).toBeNull();
  });

  it("passes the request signal to the shared default loader and aborts it on identity change", async () => {
    const pending = createDeferred<AffaireLinkedDpgfSource>();
    clientMocks.fetchAffaireLinkedDpgfSource.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(null);
    const harness = connected({ useDefaultLoader: true });
    await waitFor(() => expect(clientMocks.fetchAffaireLinkedDpgfSource).toHaveBeenCalledWith("project-1", { signal: expect.any(AbortSignal) }));
    const signal = clientMocks.fetchAffaireLinkedDpgfSource.mock.calls[0][1].signal as AbortSignal;
    act(() => harness.changeIdentity("actor-b", tenantB));
    expect(signal.aborted).toBe(true);
    await act(async () => { pending.resolve(createLinkedSource("old-source")); await pending.promise; });
    expect(harness.result.current.state.linkedDpgfSource).toBeNull();
  });
});

it("waits for the draft lease before auto-opening structure and consumes an explicit close", () => {
  const harness = createHarness({ autoOpenStructureDraft: true, isMutationBlocked: true });
  const version = harness.getVersion();
  expect(harness.result.current.state.isEstimateStructureDraftDialogOpen).toBe(false);
  harness.rerender({ routeVersionId: version.id, activeVersion: version, isMutationBlocked: false });
  expect(harness.result.current.state.isEstimateStructureDraftDialogOpen).toBe(true);
  act(() => { harness.result.current.actions.closeEstimateStructureDraftDialog(); });
  expect(harness.result.current.state.isEstimateStructureDraftDialogOpen).toBe(false);
  harness.rerender({ routeVersionId: version.id, activeVersion: version, isMutationBlocked: true });
  harness.rerender({ routeVersionId: version.id, activeVersion: version, isMutationBlocked: false });
  expect(harness.result.current.state.isEstimateStructureDraftDialogOpen).toBe(false);
});
