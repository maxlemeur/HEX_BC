// @vitest-environment jsdom

import { useCallback, useLayoutEffect, useRef } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  fetchEstimateSendGating: vi.fn(),
  updateEstimateStatus: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateSendGating: clientMocks.fetchEstimateSendGating,
  updateEstimateStatus: clientMocks.updateEstimateStatus,
}));

import {
  useEstimateEditorStatusController,
  type EstimateEditorStatusControllerInput,
} from "@/hooks/useEstimateEditorStatusController";
import type {
  EstimateSendGatingResponse,
  EstimateStatus,
} from "@/lib/estimates/client";
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";

type HarnessProps = Pick<
  EstimateEditorStatusControllerInput,
  | "routeVersionId"
  | "isAdmin"
  | "isViewerReadOnly"
  | "isConflictLocked"
  | "isDraftLockPending"
  | "isDraftLockedByOther"
  | "isDraftLockAcquiring"
  | "isForcingDraftUnlock"
> & {
  version: EstimateVersionRow | null;
  preloadGating: boolean;
  gatingReloadToken: number;
};

function createVersion(
  status: EstimateStatus = "draft",
  id = "version-1",
  updatedAt = "token-initial"
) {
  return {
    id,
    status,
    updated_at: updatedAt,
  } as EstimateVersionRow;
}

function createGating(canSend = true): EstimateSendGatingResponse {
  return {
    canSend,
    blockingFlags: canSend
      ? []
      : [
          {
            key: "missing_price",
            severity: "blocking",
            count: 1,
            itemIds: ["line-1"],
            label: "Prix manquant",
            description: "Une ligne doit etre completee.",
          },
        ],
    warningFlags: [],
    stalePriceDays: 30,
    checkedAt: "2026-07-15T10:00:00.000Z",
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function defaultProps(
  overrides: Partial<HarnessProps> = {}
): HarnessProps {
  return {
    routeVersionId: "version-1",
    version: createVersion(),
    preloadGating: false,
    gatingReloadToken: 0,
    isAdmin: false,
    isViewerReadOnly: false,
    isConflictLocked: false,
    isDraftLockPending: false,
    isDraftLockedByOther: false,
    isDraftLockAcquiring: false,
    isForcingDraftUnlock: false,
    ...overrides,
  };
}

function createDependencies() {
  return {
    applyUpdatedVersion: vi.fn(),
    flushBufferedItemUpdates: vi.fn().mockResolvedValue("noop"),
    handleVersionConflict: vi.fn().mockReturnValue(false),
    hasPendingUpdatesNow: vi.fn().mockReturnValue(false),
    isFlushInProgress: vi.fn().mockReturnValue(false),
    refreshTimeline: vi.fn().mockResolvedValue(undefined),
    releaseDraftLock: vi.fn().mockResolvedValue(true),
    resolveErrorMessage: vi.fn((message: string) => `public:${message}`),
  };
}

type HarnessDependencies = ReturnType<typeof createDependencies>;

function useStatusControllerHarness(
  props: HarnessProps,
  dependencies: HarnessDependencies
) {
  const versionRef = useRef(props.version);
  useLayoutEffect(() => {
    versionRef.current = props.version;
  }, [props.version]);
  const getVersionSnapshot = useCallback(() => versionRef.current, []);

  return useEstimateEditorStatusController({
    routeVersionId: props.routeVersionId,
    activeVersion: props.preloadGating ? props.version : null,
    gatingReloadToken: props.gatingReloadToken,
    getVersionSnapshot,
    applyUpdatedVersion: dependencies.applyUpdatedVersion,
    isAdmin: props.isAdmin,
    isViewerReadOnly: props.isViewerReadOnly,
    isConflictLocked: props.isConflictLocked,
    conflictMessage: "Conflit courant.",
    isDraftLockPending: props.isDraftLockPending,
    draftLockPendingMessage: "Verrou en attente.",
    isDraftLockedByOther: props.isDraftLockedByOther,
    draftLockedByOtherMessage: "Verrouille par Alice.",
    isDraftLockAcquiring: props.isDraftLockAcquiring,
    draftLockAcquiringMessage: "Acquisition en cours.",
    isForcingDraftUnlock: props.isForcingDraftUnlock,
    forceUnlockMessage: "Deverrouillage force en cours.",
    viewerReadOnlyMessage: "Consultation seulement.",
    isFlushInProgress: dependencies.isFlushInProgress,
    flushBufferedItemUpdates: dependencies.flushBufferedItemUpdates,
    hasPendingUpdatesNow: dependencies.hasPendingUpdatesNow,
    releaseDraftLock: dependencies.releaseDraftLock,
    handleVersionConflict: dependencies.handleVersionConflict,
    resolveErrorMessage: dependencies.resolveErrorMessage,
    refreshTimeline: dependencies.refreshTimeline,
  });
}

function renderController(
  initialProps = defaultProps(),
  dependencies = createDependencies(),
  onRender?: (
    controller: ReturnType<typeof useEstimateEditorStatusController>
  ) => void
) {
  const rendered = renderHook(
    (props: HarnessProps) => {
      const controller = useStatusControllerHarness(props, dependencies);
      onRender?.(controller);
      return controller;
    },
    { initialProps }
  );
  return { ...rendered, dependencies };
}

beforeEach(() => {
  vi.resetAllMocks();
  clientMocks.fetchEstimateSendGating.mockResolvedValue(createGating());
  clientMocks.updateEstimateStatus.mockImplementation(
    async (versionId: string, status: EstimateStatus) =>
      createVersion(status, versionId, `token-${status}`)
  );
});

afterEach(() => {
  cleanup();
});

describe("useEstimateEditorStatusController send workflow", () => {
  it("flushes before loading gating and opens the dialog", async () => {
    const harness = renderController();

    await act(async () => {
      await harness.result.current.actions.requestSend();
    });

    expect(harness.dependencies.flushBufferedItemUpdates).toHaveBeenCalledTimes(
      1
    );
    expect(clientMocks.fetchEstimateSendGating).toHaveBeenCalledWith(
      "version-1"
    );
    expect(
      harness.dependencies.flushBufferedItemUpdates.mock.invocationCallOrder[0]
    ).toBeLessThan(
      clientMocks.fetchEstimateSendGating.mock.invocationCallOrder[0]
    );
    expect(harness.result.current.state.sendGating).toEqual(createGating());
    expect(harness.result.current.state.isSendGatingDialogOpen).toBe(true);
    expect(harness.result.current.state.isUpdatingStatus).toBe(false);
  });

  it("reflushes and revalidates gating with the latest token before sending", async () => {
    const harness = renderController(
      defaultProps({ isAdmin: true })
    );

    await act(async () => {
      await harness.result.current.actions.requestSend();
    });
    harness.rerender(
      defaultProps({
        isAdmin: true,
        version: createVersion("draft", "version-1", "token-after-edit"),
      })
    );

    await act(async () => {
      await harness.result.current.actions.confirmSend();
    });

    expect(harness.dependencies.flushBufferedItemUpdates).toHaveBeenCalledTimes(
      2
    );
    expect(clientMocks.fetchEstimateSendGating).toHaveBeenCalledTimes(2);
    expect(clientMocks.updateEstimateStatus).toHaveBeenCalledWith(
      "version-1",
      "sent",
      "token-after-edit",
      { force: false }
    );
    expect(harness.dependencies.applyUpdatedVersion).toHaveBeenCalledWith(
      createVersion("sent", "version-1", "token-sent")
    );
    expect(harness.dependencies.releaseDraftLock).toHaveBeenCalledWith({
      keepalive: true,
    });
    expect(harness.dependencies.refreshTimeline).toHaveBeenCalledTimes(1);
    expect(harness.result.current.state.sendGating).toBeNull();
    expect(harness.result.current.state.isSendGatingDialogOpen).toBe(false);
  });

  it("keeps the dialog open when revalidation becomes blocking", async () => {
    clientMocks.fetchEstimateSendGating
      .mockResolvedValueOnce(createGating())
      .mockResolvedValueOnce(createGating(false));
    const harness = renderController();

    await act(async () => {
      await harness.result.current.actions.requestSend();
      await harness.result.current.actions.confirmSend();
    });

    expect(clientMocks.updateEstimateStatus).not.toHaveBeenCalled();
    expect(harness.result.current.state.sendGating).toEqual(
      createGating(false)
    );
    expect(harness.result.current.state.isSendGatingDialogOpen).toBe(true);
    expect(harness.result.current.state.error).toBe(
      "Les preconditions d'envoi ne sont plus remplies."
    );
    expect(harness.result.current.meta.isSendBlockedForCurrentUser).toBe(true);
  });

  it("allows an admin to force a send after a fresh blocking check", async () => {
    clientMocks.fetchEstimateSendGating.mockResolvedValue(createGating(false));
    const harness = renderController(defaultProps({ isAdmin: true }));

    await act(async () => {
      await harness.result.current.actions.requestSend();
      await harness.result.current.actions.confirmSend(true);
    });

    expect(clientMocks.fetchEstimateSendGating).toHaveBeenCalledTimes(2);
    expect(clientMocks.updateEstimateStatus).toHaveBeenCalledWith(
      "version-1",
      "sent",
      "token-initial",
      { force: true }
    );
  });

  it("never lets gating opened for V1 send V2", async () => {
    const harness = renderController();
    await act(async () => {
      await harness.result.current.actions.requestSend();
    });

    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        version: createVersion("draft", "version-2", "token-v2"),
      })
    );
    await act(async () => {
      await harness.result.current.actions.confirmSend();
    });

    expect(clientMocks.updateEstimateStatus).not.toHaveBeenCalled();
    expect(harness.result.current.state.sendGating).toBeNull();
    expect(harness.result.current.state.isSendGatingDialogOpen).toBe(false);
    expect(harness.result.current.state.error).toBe(
      "Veuillez verifier les preconditions d'envoi."
    );
  });
});

describe("useEstimateEditorStatusController route generations", () => {
  it("projects empty gating, dialog, and error on the first V1 to V2 render", async () => {
    clientMocks.fetchEstimateSendGating
      .mockResolvedValueOnce(createGating())
      .mockResolvedValueOnce(createGating(false));
    const renderSnapshots: Array<{
      error: string | null;
      isUpdatingStatus: boolean;
      hasGating: boolean;
      isDialogOpen: boolean;
      phase: string | null;
      phaseLabel: string | null;
    }> = [];
    const harness = renderController(
      defaultProps(),
      createDependencies(),
      (controller) => {
        renderSnapshots.push({
          error: controller.state.error,
          isUpdatingStatus: controller.state.isUpdatingStatus,
          hasGating: controller.state.sendGating !== null,
          isDialogOpen: controller.state.isSendGatingDialogOpen,
          phase: controller.state.sendWorkflowPhase,
          phaseLabel: controller.meta.sendWorkflowPhaseLabel,
        });
      }
    );

    await act(async () => {
      await harness.result.current.actions.requestSend();
      await harness.result.current.actions.confirmSend();
    });
    expect(harness.result.current.state.error).toBe(
      "Les preconditions d'envoi ne sont plus remplies."
    );
    expect(harness.result.current.state.isSendGatingDialogOpen).toBe(true);

    renderSnapshots.length = 0;
    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        version: createVersion("draft", "version-2"),
      })
    );

    expect(renderSnapshots[0]).toEqual({
      error: null,
      isUpdatingStatus: false,
      hasGating: false,
      isDialogOpen: false,
      phase: null,
      phaseLabel: null,
    });
  });

  it("projects an idle phase before the V1 operation reset effect", async () => {
    const flushRequest = createDeferred<"saved">();
    const dependencies = createDependencies();
    dependencies.flushBufferedItemUpdates.mockReturnValueOnce(
      flushRequest.promise
    );
    const renderSnapshots: Array<{
      isUpdatingStatus: boolean;
      phase: string | null;
      phaseLabel: string | null;
    }> = [];
    const harness = renderController(
      defaultProps(),
      dependencies,
      (controller) => {
        renderSnapshots.push({
          isUpdatingStatus: controller.state.isUpdatingStatus,
          phase: controller.state.sendWorkflowPhase,
          phaseLabel: controller.meta.sendWorkflowPhaseLabel,
        });
      }
    );

    let request!: Promise<void>;
    act(() => {
      request = harness.result.current.actions.requestSend();
    });
    await waitFor(() => {
      expect(harness.result.current.state.sendWorkflowPhase).toBe(
        "verification"
      );
    });

    renderSnapshots.length = 0;
    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        version: createVersion("draft", "version-2"),
      })
    );

    expect(renderSnapshots[0]).toEqual({
      isUpdatingStatus: false,
      phase: null,
      phaseLabel: null,
    });

    await act(async () => {
      flushRequest.resolve("saved");
      await request;
    });
  });

  it("ignores a flush completing after the route changes", async () => {
    const deferred = createDeferred<"saved">();
    const dependencies = createDependencies();
    dependencies.flushBufferedItemUpdates.mockReturnValueOnce(deferred.promise);
    const harness = renderController(defaultProps(), dependencies);

    let request!: Promise<void>;
    act(() => {
      request = harness.result.current.actions.requestSend();
    });
    await waitFor(() => {
      expect(dependencies.flushBufferedItemUpdates).toHaveBeenCalledTimes(1);
    });
    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        version: createVersion("draft", "version-2"),
      })
    );

    await act(async () => {
      deferred.resolve("saved");
      await request;
    });

    expect(clientMocks.fetchEstimateSendGating).not.toHaveBeenCalled();
    expect(harness.result.current.state.error).toBeNull();
    expect(harness.result.current.state.isUpdatingStatus).toBe(false);
  });

  it("ignores gating completing after the route changes", async () => {
    const deferred = createDeferred<EstimateSendGatingResponse>();
    clientMocks.fetchEstimateSendGating.mockReturnValueOnce(deferred.promise);
    const harness = renderController();

    let request!: Promise<void>;
    act(() => {
      request = harness.result.current.actions.requestSend();
    });
    await waitFor(() => {
      expect(clientMocks.fetchEstimateSendGating).toHaveBeenCalledTimes(1);
    });
    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        version: createVersion("draft", "version-2"),
      })
    );

    await act(async () => {
      deferred.resolve(createGating());
      await request;
    });

    expect(harness.result.current.state.sendGating).toBeNull();
    expect(harness.result.current.state.isSendGatingDialogOpen).toBe(false);
  });

  it("ignores a status update completing after the route changes", async () => {
    const deferred = createDeferred<EstimateVersionRow>();
    clientMocks.updateEstimateStatus.mockReturnValueOnce(deferred.promise);
    const dependencies = createDependencies();
    const harness = renderController(
      defaultProps({ version: createVersion("sent") }),
      dependencies
    );

    let request!: Promise<void>;
    act(() => {
      request = harness.result.current.actions.changeStatus("accepted");
    });
    await waitFor(() => {
      expect(clientMocks.updateEstimateStatus).toHaveBeenCalledTimes(1);
    });
    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        version: createVersion("sent", "version-2"),
      })
    );

    await act(async () => {
      deferred.resolve(createVersion("accepted", "version-1"));
      await request;
    });

    expect(dependencies.applyUpdatedVersion).not.toHaveBeenCalled();
    expect(dependencies.releaseDraftLock).not.toHaveBeenCalled();
    expect(dependencies.refreshTimeline).not.toHaveBeenCalled();
  });

  it("rejects a response whose version does not match the active route", async () => {
    clientMocks.updateEstimateStatus.mockResolvedValueOnce(
      createVersion("accepted", "version-other")
    );
    const harness = renderController(
      defaultProps({ version: createVersion("sent") })
    );

    await act(async () => {
      await harness.result.current.actions.changeStatus("accepted");
    });

    expect(harness.dependencies.applyUpdatedVersion).not.toHaveBeenCalled();
    expect(harness.result.current.state.error).toBe(
      "Reponse de statut incoherente."
    );
  });
});

describe("useEstimateEditorStatusController gating preload", () => {
  it("preloads gating for the active draft", async () => {
    const gating = createGating(false);
    clientMocks.fetchEstimateSendGating.mockResolvedValueOnce(gating);
    const harness = renderController(defaultProps({ preloadGating: true }));

    await waitFor(() => {
      expect(clientMocks.fetchEstimateSendGating).toHaveBeenCalledWith(
        "version-1"
      );
      expect(harness.result.current.state.sendGating).toEqual(gating);
    });
  });

  it("ignores a preload completing after the active route changes", async () => {
    const firstPreload = createDeferred<EstimateSendGatingResponse>();
    const secondGating = createGating(false);
    clientMocks.fetchEstimateSendGating
      .mockReturnValueOnce(firstPreload.promise)
      .mockResolvedValueOnce(secondGating);
    const harness = renderController(defaultProps({ preloadGating: true }));

    await waitFor(() => {
      expect(clientMocks.fetchEstimateSendGating).toHaveBeenCalledWith(
        "version-1"
      );
    });

    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        version: createVersion("draft", "version-2"),
        preloadGating: true,
      })
    );

    await waitFor(() => {
      expect(clientMocks.fetchEstimateSendGating).toHaveBeenCalledWith(
        "version-2"
      );
      expect(harness.result.current.state.sendGating).toEqual(secondGating);
    });

    await act(async () => {
      firstPreload.resolve(createGating(true));
      await firstPreload.promise;
    });

    expect(harness.result.current.state.sendGating).toEqual(secondGating);
  });

  it("masks stale gating while a new version token is being checked", async () => {
    const initialGating = createGating(false);
    const refreshedGating = createGating(true);
    const refreshRequest = createDeferred<EstimateSendGatingResponse>();
    clientMocks.fetchEstimateSendGating
      .mockResolvedValueOnce(initialGating)
      .mockReturnValueOnce(refreshRequest.promise);
    const harness = renderController(defaultProps({ preloadGating: true }));

    await waitFor(() => {
      expect(harness.result.current.state.sendGating).toEqual(initialGating);
    });

    harness.rerender(
      defaultProps({
        version: createVersion("draft", "version-1", "token-refreshed"),
        preloadGating: true,
      })
    );

    expect(harness.result.current.state.sendGating).toBeNull();

    await act(async () => {
      refreshRequest.resolve(refreshedGating);
      await refreshRequest.promise;
    });

    await waitFor(() => {
      expect(harness.result.current.state.sendGating).toEqual(refreshedGating);
    });
  });
});

describe("useEstimateEditorStatusController transition policy", () => {
  it.each<{
    status: EstimateStatus;
    transitions: EstimateStatus[];
    canSend: boolean;
    canAccept: boolean;
    canArchive: boolean;
  }>([
    {
      status: "draft",
      transitions: ["sent"],
      canSend: true,
      canAccept: false,
      canArchive: false,
    },
    {
      status: "sent",
      transitions: ["accepted", "archived"],
      canSend: false,
      canAccept: true,
      canArchive: true,
    },
    {
      status: "accepted",
      transitions: ["archived"],
      canSend: false,
      canAccept: false,
      canArchive: true,
    },
    {
      status: "archived",
      transitions: [],
      canSend: false,
      canAccept: false,
      canArchive: false,
    },
  ])(
    "exposes the exact $status transition matrix",
    ({ status, transitions, canSend, canAccept, canArchive }) => {
      const harness = renderController(
        defaultProps({ version: createVersion(status) })
      );

      expect(harness.result.current.meta.allowedTransitions).toEqual(
        transitions
      );
      expect(harness.result.current.meta.canSend).toBe(canSend);
      expect(harness.result.current.meta.canAccept).toBe(canAccept);
      expect(harness.result.current.meta.canArchive).toBe(canArchive);
    }
  );

  it("rejects draft to archived before flushing", async () => {
    const harness = renderController();

    await act(async () => {
      await harness.result.current.actions.changeStatus("archived");
    });

    expect(harness.result.current.state.error).toBe(
      "Transition de statut non autorisee."
    );
    expect(harness.dependencies.flushBufferedItemUpdates).not.toHaveBeenCalled();
    expect(clientMocks.updateEstimateStatus).not.toHaveBeenCalled();
  });

  it("does not release a draft lock for a transition between non-draft statuses", async () => {
    const harness = renderController(
      defaultProps({ version: createVersion("sent") })
    );

    await act(async () => {
      await harness.result.current.actions.changeStatus("archived");
    });

    expect(clientMocks.updateEstimateStatus).toHaveBeenCalledWith(
      "version-1",
      "archived",
      "token-initial",
      undefined
    );
    expect(harness.dependencies.releaseDraftLock).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorStatusController disabled transitions", () => {
  it.each<{
    label: string;
    overrides: Partial<HarnessProps>;
    message: string;
  }>([
    {
      label: "viewer",
      overrides: { isViewerReadOnly: true },
      message: "Consultation seulement.",
    },
    {
      label: "conflict",
      overrides: { isConflictLocked: true },
      message: "Conflit courant.",
    },
    {
      label: "pending lock",
      overrides: { isDraftLockPending: true },
      message: "Verrou en attente.",
    },
    {
      label: "other owner lock",
      overrides: { isDraftLockedByOther: true },
      message: "Verrouille par Alice.",
    },
    {
      label: "lock acquisition",
      overrides: { isDraftLockAcquiring: true },
      message: "Acquisition en cours.",
    },
    {
      label: "forced unlock",
      overrides: { isForcingDraftUnlock: true },
      message: "Deverrouillage force en cours.",
    },
  ])("blocks transitions for $label", async ({ overrides, message }) => {
    const harness = renderController(defaultProps(overrides));

    expect(harness.result.current.meta.isStatusActionsDisabled).toBe(true);
    await act(async () => {
      await harness.result.current.actions.requestSend();
    });

    expect(harness.result.current.state.error).toBe(message);
    expect(harness.dependencies.flushBufferedItemUpdates).not.toHaveBeenCalled();
    expect(clientMocks.fetchEstimateSendGating).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorStatusController errors", () => {
  it.each([
    {
      result: "blocked" as const,
      hasPending: false,
      message:
        "Impossible de changer le statut tant que les modifications locales ne sont pas synchronisees.",
    },
    {
      result: "error" as const,
      hasPending: false,
      message:
        "Impossible de synchroniser les modifications avant changement de statut.",
    },
    {
      result: "noop" as const,
      hasPending: true,
      message:
        "Synchronisation des modifications en cours. Reessayez dans quelques secondes.",
    },
  ])(
    "reports a $result flush result without loading gating",
    async ({ result, hasPending, message }) => {
      const dependencies = createDependencies();
      dependencies.flushBufferedItemUpdates.mockResolvedValue(result);
      dependencies.hasPendingUpdatesNow.mockReturnValue(hasPending);
      const harness = renderController(defaultProps(), dependencies);

      await act(async () => {
        await harness.result.current.actions.requestSend();
      });

      expect(harness.result.current.state.error).toBe(message);
      expect(clientMocks.fetchEstimateSendGating).not.toHaveBeenCalled();
    }
  );

  it("does not start another flush while one is already running", async () => {
    const dependencies = createDependencies();
    dependencies.isFlushInProgress.mockReturnValue(true);
    const harness = renderController(defaultProps(), dependencies);

    await act(async () => {
      await harness.result.current.actions.requestSend();
    });

    expect(dependencies.flushBufferedItemUpdates).not.toHaveBeenCalled();
    expect(harness.result.current.state.error).toBe(
      "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
    );
  });

  it("routes a 409 status error through the conflict handler", async () => {
    const conflict = Object.assign(new Error("version conflict"), {
      status: 409,
    });
    clientMocks.updateEstimateStatus.mockRejectedValueOnce(conflict);
    const dependencies = createDependencies();
    dependencies.handleVersionConflict.mockReturnValue(true);
    const harness = renderController(
      defaultProps({ version: createVersion("sent") }),
      dependencies
    );

    await act(async () => {
      await harness.result.current.actions.changeStatus("accepted");
    });

    expect(dependencies.handleVersionConflict).toHaveBeenCalledWith(conflict, {
      persistDraft: true,
    });
    expect(harness.result.current.state.error).toBeNull();
    expect(dependencies.applyUpdatedVersion).not.toHaveBeenCalled();
  });

  it("resolves a gating error for display", async () => {
    clientMocks.fetchEstimateSendGating.mockRejectedValueOnce(
      new Error("gating unavailable")
    );
    const harness = renderController();

    await act(async () => {
      await harness.result.current.actions.requestSend();
    });

    expect(harness.dependencies.handleVersionConflict).toHaveBeenCalled();
    expect(harness.result.current.state.error).toBe(
      "public:gating unavailable"
    );
    expect(harness.result.current.state.isSendGatingDialogOpen).toBe(false);
  });

  it("resolves a generic update error for display", async () => {
    clientMocks.updateEstimateStatus.mockRejectedValueOnce(
      new Error("update unavailable")
    );
    const harness = renderController(
      defaultProps({ version: createVersion("sent") })
    );

    await act(async () => {
      await harness.result.current.actions.changeStatus("accepted");
    });

    expect(harness.result.current.state.error).toBe(
      "public:update unavailable"
    );
    expect(harness.dependencies.applyUpdatedVersion).not.toHaveBeenCalled();
  });
});
