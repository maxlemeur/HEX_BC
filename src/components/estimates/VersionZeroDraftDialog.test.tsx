import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  VersionZeroDraftSummary,
  VersionZeroReview,
} from "@/lib/estimates/client";

const mockFetchVersionZeroReview = vi.fn();
const mockGenerateVersionZeroDraft = vi.fn();
const mockMaterializeVersionZeroDraft = vi.fn();
const mockReviewVersionZeroLine = vi.fn();

vi.mock("@/lib/estimates/client", () => ({
  fetchVersionZeroReview: (...args: unknown[]) =>
    mockFetchVersionZeroReview(...args),
  generateVersionZeroDraft: (...args: unknown[]) =>
    mockGenerateVersionZeroDraft(...args),
  materializeVersionZeroDraft: (...args: unknown[]) =>
    mockMaterializeVersionZeroDraft(...args),
  reviewVersionZeroLine: (...args: unknown[]) =>
    mockReviewVersionZeroLine(...args),
}));

import {
  VersionZeroDraftDialog,
  type VersionZeroDraftDialogProps,
} from "./VersionZeroDraftDialog";

function createSummary(activeDraft = false): VersionZeroDraftSummary {
  return {
    versionId: "version-1",
    projectId: "project-1",
    hasConfirmedBrief: true,
    confirmedBriefId: "brief-1",
    isVersionEmpty: true,
    canGenerate: !activeDraft,
    availableLots: ["Lot A"],
    activeDraft: activeDraft
      ? {
          id: "draft-1",
          status: "ready_for_version",
          createdAt: "2026-07-15T00:00:00.000Z",
          materializedAt: null,
          selectedLots: ["Lot A"],
          counts: {
            lots: 1,
            lines: 1,
            pending: 0,
            accepted: 1,
            edited: 0,
            rejected: 0,
            missingLots: 0,
            partialLots: 0,
            lowConfidenceLines: 0,
          },
          summaryText: "Brouillon pret.",
          state: "active",
        }
      : null,
  };
}

function createReview(): VersionZeroReview {
  return {
    draft: {
      id: "draft-1",
      versionId: "version-1",
      projectId: "project-1",
      briefId: "brief-1",
      status: "ready_for_version",
      createdAt: "2026-07-15T00:00:00.000Z",
      updatedAt: "2026-07-15T00:00:00.000Z",
      materializedAt: null,
      selectedLots: ["Lot A"],
      summaryText: "Brouillon pret.",
      generationMetadata: {},
      counts: {
        lots: 1,
        lines: 1,
        pending: 0,
        accepted: 1,
        edited: 0,
        rejected: 0,
        missingLots: 0,
        partialLots: 0,
        lowConfidenceLines: 0,
      },
    },
    lots: [
      {
        id: "lot-1",
        key: "lot-a",
        label: "Lot A",
        order: 1,
        status: "generated",
        confidence: 0.9,
        provenance: ["Brief confirme"],
        facts: [],
        hypotheses: [],
        inferences: [],
        missingSignals: [],
        riskSignals: [],
        lines: [
          {
            id: "line-1",
            lotId: "lot-1",
            order: 1,
            reviewStatus: "accepted",
            confidence: 0.9,
            confidenceLabel: "elevee",
            proposed: {
              title: "Mur en beton",
              description: null,
              quantity: 10,
              unit: "m2",
            },
            edited: {
              title: null,
              description: null,
              quantity: null,
              unit: null,
            },
            effective: {
              title: "Mur en beton",
              description: null,
              quantity: 10,
              unit: "m2",
            },
            provenance: ["Brief confirme"],
            facts: [],
            hypotheses: [],
            inferences: [],
            missingSignals: [],
            riskSignals: [],
            materializedEstimateItemId: null,
          },
        ],
      },
    ],
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

function createProps(
  overrides: Partial<VersionZeroDraftDialogProps> = {}
): VersionZeroDraftDialogProps {
  return {
    isOpen: true,
    versionId: "version-1",
    summary: createSummary(),
    isMutationBlocked: false,
    mutationBlockedMessage: "Mutation interdite.",
    ensureMutationCanProceed: vi.fn().mockResolvedValue(true),
    onClose: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("VersionZeroDraftDialog mutation guards", () => {
  it("does not emit close while a generation write is pending", async () => {
    const generation = createDeferred<VersionZeroReview>();
    const onClose = vi.fn();
    mockGenerateVersionZeroDraft.mockReturnValueOnce(generation.promise);
    render(<VersionZeroDraftDialog {...createProps({ onClose })} />);
    const user = userEvent.setup();

    const generateButton = await screen.findByRole("button", {
      name: "Générer V0",
    });
    await waitFor(() => expect(generateButton).toBeEnabled());
    await user.click(generateButton);
    await waitFor(() => {
      expect(mockGenerateVersionZeroDraft).toHaveBeenCalledTimes(1);
    });

    const closeButton = screen.getByRole("button", { name: "Fermer" });
    expect(closeButton).toBeDisabled();
    await user.click(closeButton);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      generation.resolve(createReview());
      await generation.promise;
    });
    await waitFor(() => expect(closeButton).toBeEnabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not materialize when the async mutation barrier refuses", async () => {
    const ensureMutationCanProceed = vi.fn().mockResolvedValue(false);
    mockFetchVersionZeroReview.mockResolvedValueOnce(createReview());
    render(
      <VersionZeroDraftDialog
        {...createProps({
          summary: createSummary(true),
          ensureMutationCanProceed,
        })}
      />
    );
    const user = userEvent.setup();

    const materializeButton = await screen.findByRole("button", {
      name: "Materialiser dans le devis",
    });
    await waitFor(() => expect(materializeButton).toBeEnabled());
    await user.click(materializeButton);

    await waitFor(() => {
      expect(ensureMutationCanProceed).toHaveBeenCalledWith(
        "materialiser la version zero"
      );
      expect(materializeButton).toBeEnabled();
    });
    expect(mockMaterializeVersionZeroDraft).not.toHaveBeenCalled();
  });

  it("rechecks the mutation block after the materialization barrier", async () => {
    const barrier = createDeferred<boolean>();
    const ensureMutationCanProceed = vi.fn().mockReturnValue(barrier.promise);
    const summary = createSummary(true);
    const props = createProps({ summary, ensureMutationCanProceed });
    mockFetchVersionZeroReview.mockResolvedValueOnce(createReview());
    const { rerender } = render(
      <VersionZeroDraftDialog {...props} />
    );
    const user = userEvent.setup();

    const materializeButton = await screen.findByRole("button", {
      name: "Materialiser dans le devis",
    });
    await waitFor(() => expect(materializeButton).toBeEnabled());
    await user.click(materializeButton);
    await waitFor(() => {
      expect(ensureMutationCanProceed).toHaveBeenCalledTimes(1);
    });

    rerender(
      <VersionZeroDraftDialog
        {...props}
        isMutationBlocked
        mutationBlockedMessage="Conflit de version."
      />
    );
    await act(async () => {
      barrier.resolve(true);
      await barrier.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Conflit de version."
      );
    });
    expect(mockMaterializeVersionZeroDraft).not.toHaveBeenCalled();
    expect(materializeButton).toBeDisabled();
  });

  it("disables every visible write action while mutations are blocked", async () => {
    mockFetchVersionZeroReview.mockResolvedValueOnce(createReview());
    const props = createProps({
      summary: createSummary(true),
      isMutationBlocked: true,
      mutationBlockedMessage: "Lecture seule.",
    });
    const { rerender } = render(<VersionZeroDraftDialog {...props} />);

    expect(
      await screen.findByRole("button", { name: "Accepter" })
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rejeter" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Valider l'edition" })
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Materialiser dans le devis" })
    ).toBeDisabled();

    rerender(
      <VersionZeroDraftDialog
        {...props}
        summary={createSummary(false)}
      />
    );
    expect(
      await screen.findByRole("button", { name: "Générer V0" })
    ).toBeDisabled();
    expect(mockGenerateVersionZeroDraft).not.toHaveBeenCalled();
    expect(mockReviewVersionZeroLine).not.toHaveBeenCalled();
    expect(mockMaterializeVersionZeroDraft).not.toHaveBeenCalled();
  });
});
