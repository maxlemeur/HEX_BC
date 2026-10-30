// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEstimateAiDraftEnabled } from "@/lib/estimates/ai-draft-availability";

vi.mock("@/lib/estimates/ai-draft-availability", () => ({
  isEstimateAiDraftEnabled: vi.fn(),
}));

import {
  useEstimateEditorAiDialogsController,
  type EstimateEditorAiDialogsControllerInput,
} from "@/hooks/useEstimateEditorAiDialogsController";
import type { VersionZeroDraftSummary } from "@/lib/estimates/client";
import type { EstimateVersionRow } from "@/lib/estimates/editor-items";

type HarnessProps = Pick<
  EstimateEditorAiDialogsControllerInput,
  | "actorId"
  | "tenantId"
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

function defaultProps(overrides: Partial<HarnessProps> = {}): HarnessProps {
  return {
    routeVersionId: "version-1",
    actorId: "actor-1",
    tenantId: "tenant-1",
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

beforeEach(() => {
  vi.mocked(isEstimateAiDraftEnabled).mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useEstimateEditorAiDialogsController scope resets", () => {
  it.each(["generated"] as const)(
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

  it("keeps the highlighted ids of a new scope across renders", () => {
    // The editor table receives these ids: a new set on every render redraws every row.
    const harness = renderController(defaultProps());
    const nextScope = defaultProps({ tenantId: "tenant-2" });
    harness.rerender(nextScope);
    const firstIds = harness.result.current.state.highlightedItemIds;

    harness.rerender({ ...nextScope });

    expect(harness.result.current.state.highlightedItemIds).toBe(firstIds);
  });
});
