import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mutateFeatureFlagsMock,
  mutateLearningMock,
  swrMock,
} = vi.hoisted(() => ({
  mutateFeatureFlagsMock: vi.fn(),
  mutateLearningMock: vi.fn(),
  swrMock: vi.fn(),
}));

vi.mock("swr", () => ({
  default: swrMock,
}));

import { SuggestionLearningAdminClient } from "@/app/dashboard/admin/suggestion-learning/SuggestionLearningAdminClient";

const LEARNING_STATE = {
  config: {
    enabled: true,
    threshold: 3,
    retention_months: 12,
  },
  proposals: [],
  by_rule_id: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  swrMock.mockImplementation((key: unknown) =>
    Array.isArray(key)
      ? {
          data: {
            tenant_id: "tenant-1",
            flags: [],
          },
          error: null,
          isLoading: false,
          isValidating: false,
          mutate: mutateFeatureFlagsMock,
        }
      : {
          data: LEARNING_STATE,
          error: null,
          isLoading: false,
          isValidating: false,
          mutate: mutateLearningMock,
        }
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SuggestionLearningAdminClient purge confirmation", () => {
  it("cancels the purge without calling the API", async () => {
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(<SuggestionLearningAdminClient tenantId="tenant-1" />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("12")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Apprentissage des suggestions",
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actualiser" })).toHaveClass(
      "w-full",
      "sm:w-auto"
    );

    fireEvent.click(screen.getByRole("button", { name: "Purger" }));

    // Outside the ConfirmProvider, useConfirm falls back to window.confirm(title).
    expect(confirmMock).toHaveBeenCalledWith(
      "Supprimer définitivement les corrections apprises de plus de 12 mois ?"
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mutateLearningMock).not.toHaveBeenCalled();
  });
});
