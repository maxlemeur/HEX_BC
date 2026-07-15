// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useEstimateEditorAiDialogsController,
  type EstimateEditorAiDialogsControllerInput,
} from "@/hooks/useEstimateEditorAiDialogsController";
import type { VersionZeroDraftSummary } from "@/lib/estimates/client";
import type {
  EditorEstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

type HarnessProps = Pick<
  EstimateEditorAiDialogsControllerInput,
  | "routeVersionId"
  | "activeVersion"
  | "items"
  | "isMutationBlocked"
  | "mutationBlockedMessage"
  | "ensureMutationCanProceed"
  | "highlightDurationMs"
>;

function createVersion(id = "version-1") {
  return {
    id,
    project_id: `project-${id}`,
  } as Pick<EstimateVersionRow, "id" | "project_id">;
}

function createItem(
  id: string,
  overrides: Partial<EditorEstimateItem> = {}
): EditorEstimateItem {
  return {
    id,
    version_id: "version-1",
    parent_id: null,
    item_type: "section",
    position: 1,
    title: id,
    ...overrides,
  } as EditorEstimateItem;
}

function createSummary(
  versionId = "version-1",
  overrides: Partial<VersionZeroDraftSummary> = {}
): VersionZeroDraftSummary {
  return {
    versionId,
    projectId: `project-${versionId}`,
    hasConfirmedBrief: true,
    confirmedBriefId: "brief-1",
    isVersionEmpty: true,
    canGenerate: true,
    availableLots: ["Lot A"],
    activeDraft: null,
    ...overrides,
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

function defaultProps(overrides: Partial<HarnessProps> = {}): HarnessProps {
  return {
    routeVersionId: "version-1",
    activeVersion: createVersion(),
    items: [],
    isMutationBlocked: false,
    mutationBlockedMessage: "Mutation interdite.",
    ensureMutationCanProceed: vi.fn().mockResolvedValue(true),
    highlightDurationMs: 5_000,
    ...overrides,
  };
}

function createDependencies() {
  return {
    invalidateAfterMutation: vi.fn().mockResolvedValue(undefined),
    refreshVersionZeroSummary: vi
      .fn()
      .mockResolvedValue(createSummary()),
    reportError: vi.fn(),
    resolveErrorMessage: vi.fn((message: string) => `public:${message}`),
  };
}

function renderController(
  initialProps = defaultProps(),
  dependencies = createDependencies(),
  onRender?: (
    controller: ReturnType<typeof useEstimateEditorAiDialogsController>
  ) => void
) {
  const rendered = renderHook(
    (props: HarnessProps) => {
      const controller = useEstimateEditorAiDialogsController({
        ...props,
        reportError: dependencies.reportError,
        resolveErrorMessage: dependencies.resolveErrorMessage,
        refreshVersionZeroSummary:
          dependencies.refreshVersionZeroSummary,
        invalidateAfterMutation: dependencies.invalidateAfterMutation,
      });
      onRender?.(controller);
      return controller;
    },
    { initialProps }
  );
  return { ...rendered, dependencies };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useEstimateEditorAiDialogsController hierarchy", () => {
  it("builds paths and hierarchy levels from section ancestry", () => {
    const items = [
      createItem("root", { title: "Lot racine", position: 1 }),
      createItem("child", {
        parent_id: "root",
        title: "Sous-lot",
        position: 1,
      }),
      createItem("grandchild", {
        parent_id: "child",
        title: "Niveau trois",
        position: 1,
      }),
      createItem("line", {
        item_type: "line",
        parent_id: "grandchild",
      }),
      createItem("other-version", { version_id: "version-2" }),
    ];
    const harness = renderController(defaultProps({ items }));

    expect(harness.result.current.meta.existingSections).toEqual([
      {
        id: "root",
        path: "Lot racine",
        hierarchyLevel: 1,
        parentId: null,
        title: "Lot racine",
      },
      {
        id: "child",
        path: "Lot racine > Sous-lot",
        hierarchyLevel: 2,
        parentId: "root",
        title: "Sous-lot",
      },
      {
        id: "grandchild",
        path: "Lot racine > Sous-lot > Niveau trois",
        hierarchyLevel: 3,
        parentId: "child",
        title: "Niveau trois",
      },
    ]);

    act(() => {
      harness.result.current.actions.openGeneratedOuvrageDialog();
    });
    expect(
      harness.result.current.meta.generatedOuvrageDialogProps
        ?.existingSections
    ).toEqual(harness.result.current.meta.existingSections);
  });

  it("terminates safely when section parents form a cycle", () => {
    const harness = renderController(
      defaultProps({
        items: [
          createItem("section-a", { parent_id: "section-b" }),
          createItem("section-b", { parent_id: "section-a" }),
        ],
      })
    );

    expect(harness.result.current.meta.existingSections).toHaveLength(2);
    expect(
      harness.result.current.meta.existingSections.map(
        ({ hierarchyLevel }) => hierarchyLevel
      )
    ).toEqual([2, 2]);
  });
});

describe("useEstimateEditorAiDialogsController scope resets", () => {
  it.each(["generated", "version-zero"] as const)(
    "projects empty %s dialog state on the first V1 to V2 render",
    (dialogKind) => {
      const renderSnapshots: Array<{
        generatedOpen: boolean;
        versionZeroOpen: boolean;
        hasSummary: boolean;
        highlightedCount: number;
        hasGeneratedProps: boolean;
        hasVersionZeroProps: boolean;
      }> = [];
      const harness = renderController(
        defaultProps(),
        createDependencies(),
        (controller) => {
          renderSnapshots.push({
            generatedOpen:
              controller.state.isGeneratedOuvrageDialogOpen,
            versionZeroOpen: controller.state.isVersionZeroDialogOpen,
            hasSummary: controller.state.versionZeroSummary !== null,
            highlightedCount: controller.state.highlightedItemIds.size,
            hasGeneratedProps:
              controller.meta.generatedOuvrageDialogProps !== null,
            hasVersionZeroProps:
              controller.meta.versionZeroDraftDialogProps !== null,
          });
        }
      );

      act(() => {
        harness.result.current.actions.hydrateVersionZeroSummary(
          "version-1",
          createSummary()
        );
        harness.result.current.actions.highlightItems(["line-1"]);
        if (dialogKind === "generated") {
          harness.result.current.actions.openGeneratedOuvrageDialog();
        } else {
          harness.result.current.actions.openVersionZeroDialog();
        }
      });

      renderSnapshots.length = 0;
      harness.rerender(
        defaultProps({
          routeVersionId: "version-2",
          activeVersion: createVersion("version-2"),
        })
      );

      expect(renderSnapshots[0]).toEqual({
        generatedOpen: false,
        versionZeroOpen: false,
        hasSummary: false,
        highlightedCount: 0,
        hasGeneratedProps: false,
        hasVersionZeroProps: false,
      });
    }
  );

  it.each([
    {
      label: "route",
      nextProps: defaultProps({
        routeVersionId: "version-2",
        activeVersion: createVersion("version-2"),
      }),
    },
    {
      label: "active version",
      nextProps: defaultProps({ activeVersion: createVersion("version-2") }),
    },
  ])("resets dialog, summary, and highlights on $label change", ({ nextProps }) => {
    const harness = renderController();

    act(() => {
      harness.result.current.actions.hydrateVersionZeroSummary(
        "version-1",
        createSummary()
      );
      harness.result.current.actions.openVersionZeroDialog();
      harness.result.current.actions.highlightItems(["line-1", "line-2"]);
    });
    expect(harness.result.current.state.isVersionZeroDialogOpen).toBe(true);
    expect(harness.result.current.state.highlightedItemIds.size).toBe(2);

    harness.rerender(nextProps);

    expect(harness.result.current.state.isGeneratedOuvrageDialogOpen).toBe(
      false
    );
    expect(harness.result.current.state.isVersionZeroDialogOpen).toBe(false);
    expect(harness.result.current.state.versionZeroSummary).toBeNull();
    expect(harness.result.current.state.highlightedItemIds.size).toBe(0);
    expect(
      harness.result.current.meta.generatedOuvrageDialogProps
    ).toBeNull();
    expect(harness.result.current.meta.versionZeroDraftDialogProps).toBeNull();
  });

  it("ignores a V0 refresh completing after navigation", async () => {
    const deferred = createDeferred<VersionZeroDraftSummary | null>();
    const dependencies = createDependencies();
    dependencies.refreshVersionZeroSummary.mockReturnValueOnce(
      deferred.promise
    );
    const harness = renderController(defaultProps(), dependencies);

    act(() => {
      harness.result.current.actions.hydrateVersionZeroSummary(
        "version-1",
        createSummary()
      );
      harness.result.current.actions.openVersionZeroDialog();
    });
    let closeRequest!: Promise<void>;
    act(() => {
      closeRequest =
        harness.result.current.actions.closeVersionZeroDialog();
    });
    await waitFor(() => {
      expect(dependencies.refreshVersionZeroSummary).toHaveBeenCalledWith(
        "version-1"
      );
    });

    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        activeVersion: createVersion("version-2"),
      })
    );
    await act(async () => {
      deferred.resolve(createSummary("version-1", { canGenerate: false }));
      await closeRequest;
    });

    expect(harness.result.current.state.versionZeroSummary).toBeNull();
    expect(dependencies.reportError).not.toHaveBeenCalledWith(
      "Resume V0 incoherent avec la version active."
    );
  });

  it("ignores an old generated-dialog callback after navigation", () => {
    const harness = renderController();
    act(() => {
      harness.result.current.actions.openGeneratedOuvrageDialog();
    });
    const oldOnClose =
      harness.result.current.meta.generatedOuvrageDialogProps?.onClose;
    if (!oldOnClose) {
      throw new Error("Expected generated ouvrage dialog props.");
    }

    harness.rerender(
      defaultProps({
        routeVersionId: "version-2",
        activeVersion: createVersion("version-2"),
      })
    );
    act(() => {
      oldOnClose({ insertedCount: 2 });
    });

    expect(
      harness.dependencies.invalidateAfterMutation
    ).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorAiDialogsController callbacks", () => {
  it("closes generated ouvrages and explicitly invalidates after insertion", async () => {
    const harness = renderController();
    act(() => {
      harness.result.current.actions.openGeneratedOuvrageDialog();
    });

    await act(async () => {
      await harness.result.current.actions.closeGeneratedOuvrageDialog({
        insertedCount: 2,
      });
    });

    expect(harness.result.current.state.isGeneratedOuvrageDialogOpen).toBe(
      false
    );
    expect(
      harness.dependencies.invalidateAfterMutation
    ).toHaveBeenCalledWith({
      versionId: "version-1",
      source: "generated-ouvrage",
    });
  });

  it("refreshes V0 summary and explicitly invalidates after materialization", async () => {
    const refreshedSummary = createSummary("version-1", {
      canGenerate: false,
      isVersionEmpty: false,
    });
    const dependencies = createDependencies();
    dependencies.refreshVersionZeroSummary.mockResolvedValueOnce(
      refreshedSummary
    );
    const harness = renderController(defaultProps(), dependencies);
    act(() => {
      harness.result.current.actions.openVersionZeroDialog();
    });

    await act(async () => {
      await harness.result.current.actions.closeVersionZeroDialog({
        materialized: true,
      });
    });

    expect(harness.result.current.state.isVersionZeroDialogOpen).toBe(false);
    expect(harness.result.current.state.versionZeroSummary).toEqual(
      refreshedSummary
    );
    expect(dependencies.refreshVersionZeroSummary).toHaveBeenCalledWith(
      "version-1"
    );
    expect(dependencies.invalidateAfterMutation).toHaveBeenCalledWith({
      versionId: "version-1",
      source: "version-zero",
    });
  });

  it("closes without invalidating when generated ouvrages inserted nothing", async () => {
    const harness = renderController();
    act(() => {
      harness.result.current.actions.openGeneratedOuvrageDialog();
    });

    await act(async () => {
      await harness.result.current.actions.closeGeneratedOuvrageDialog();
    });

    expect(
      harness.dependencies.invalidateAfterMutation
    ).not.toHaveBeenCalled();
    expect(harness.result.current.state.isGeneratedOuvrageDialogOpen).toBe(
      false
    );
  });

  it("hydrates and auto-opens an eligible V0 summary", () => {
    const harness = renderController();

    act(() => {
      harness.result.current.actions.hydrateVersionZeroSummary(
        "version-1",
        createSummary(),
        { autoOpen: true }
      );
    });

    expect(harness.result.current.state.versionZeroSummary).toEqual(
      createSummary()
    );
    expect(harness.result.current.state.isVersionZeroDialogOpen).toBe(true);
    expect(harness.result.current.meta.versionZeroDraftDialogProps).toEqual(
      expect.objectContaining({
        isOpen: true,
        versionId: "version-1",
      })
    );
  });

  it("blocks opening both dialogs when mutations are disabled", () => {
    const harness = renderController(
      defaultProps({ isMutationBlocked: true })
    );

    let generatedOpened = true;
    let versionZeroOpened = true;
    act(() => {
      generatedOpened =
        harness.result.current.actions.openGeneratedOuvrageDialog();
      versionZeroOpened =
        harness.result.current.actions.openVersionZeroDialog();
    });

    expect(generatedOpened).toBe(false);
    expect(versionZeroOpened).toBe(false);
    expect(harness.dependencies.reportError).toHaveBeenCalledWith(
      "Mutation interdite."
    );
    expect(harness.result.current.state.isGeneratedOuvrageDialogOpen).toBe(
      false
    );
    expect(harness.result.current.state.isVersionZeroDialogOpen).toBe(false);
  });

  it.each(["generated", "version-zero"] as const)(
    "propagates live mutation guards to an open %s dialog",
    (dialogKind) => {
      const ensureMutationCanProceed = vi.fn().mockResolvedValue(true);
      const initialProps = defaultProps({ ensureMutationCanProceed });
      const harness = renderController(initialProps);

      act(() => {
        if (dialogKind === "generated") {
          harness.result.current.actions.openGeneratedOuvrageDialog();
        } else {
          harness.result.current.actions.openVersionZeroDialog();
        }
      });

      harness.rerender({
        ...initialProps,
        isMutationBlocked: true,
        mutationBlockedMessage: "Conflit de version.",
      });

      const dialogProps =
        dialogKind === "generated"
          ? harness.result.current.meta.generatedOuvrageDialogProps
          : harness.result.current.meta.versionZeroDraftDialogProps;
      expect(dialogProps).toEqual(
        expect.objectContaining({
          isMutationBlocked: true,
          mutationBlockedMessage: "Conflit de version.",
          ensureMutationCanProceed,
        })
      );
    }
  );

  it("returns successful opens and dismisses both dialogs without invalidation", () => {
    const harness = renderController();
    let opened = false;

    act(() => {
      harness.result.current.actions.hydrateVersionZeroSummary(
        "version-1",
        createSummary()
      );
      harness.result.current.actions.highlightItems(["line-1"]);
      opened = harness.result.current.actions.openGeneratedOuvrageDialog();
    });
    expect(opened).toBe(true);
    expect(harness.result.current.state.isGeneratedOuvrageDialogOpen).toBe(
      true
    );

    act(() => {
      harness.result.current.actions.dismissDialogs();
    });
    expect(harness.result.current.state.isGeneratedOuvrageDialogOpen).toBe(
      false
    );
    expect(harness.result.current.state.isVersionZeroDialogOpen).toBe(false);
    expect(harness.result.current.state.versionZeroSummary).toEqual(
      createSummary()
    );
    expect(harness.result.current.state.highlightedItemIds).toEqual(
      new Set(["line-1"])
    );
    expect(
      harness.dependencies.invalidateAfterMutation
    ).not.toHaveBeenCalled();
    expect(
      harness.dependencies.refreshVersionZeroSummary
    ).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorAiDialogsController highlights", () => {
  it("deduplicates, clears explicitly, and expires highlighted ids", () => {
    vi.useFakeTimers();
    const harness = renderController(
      defaultProps({ highlightDurationMs: 100 })
    );

    act(() => {
      harness.result.current.actions.highlightItems([
        "line-1",
        "line-1",
        "line-2",
      ]);
    });
    expect([...harness.result.current.state.highlightedItemIds]).toEqual([
      "line-1",
      "line-2",
    ]);

    act(() => {
      harness.result.current.actions.clearHighlightedItems();
    });
    expect(harness.result.current.state.highlightedItemIds.size).toBe(0);

    act(() => {
      harness.result.current.actions.highlightItems(["line-3"]);
      vi.advanceTimersByTime(100);
    });
    expect(harness.result.current.state.highlightedItemIds.size).toBe(0);
  });
});
