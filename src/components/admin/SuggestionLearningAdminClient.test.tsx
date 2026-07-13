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
    const title = screen.getByRole("heading", {
      name: "Apprentissage des suggestions",
    });
    expect(title.closest(".page-header")).toHaveClass("flex-col", "sm:flex-row");
    expect(screen.getByRole("button", { name: "Actualiser" })).toHaveClass(
      "w-full",
      "sm:w-auto"
    );

    fireEvent.click(screen.getByRole("button", { name: "Purger" }));

    expect(confirmMock).toHaveBeenCalledWith(
      "Supprimer définitivement les corrections apprises de plus de 12 mois ? Cette action est irréversible."
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mutateLearningMock).not.toHaveBeenCalled();
  });

  it("purges only after explicit confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const purgeResult = {
      ...LEARNING_STATE,
      deleted_count: 2,
      retention_months: 12,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: purgeResult,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SuggestionLearningAdminClient tenantId="tenant-1" />);
    await waitFor(() => {
      expect(screen.getByDisplayValue("12")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Purger" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/suggestion-learning/purge",
        expect.objectContaining({ method: "POST" })
      );
    });
    expect(mutateLearningMock).toHaveBeenCalledWith(purgeResult, {
      revalidate: false,
    });
    expect(
      await screen.findByText("2 correction(s) purgée(s).")
    ).toBeInTheDocument();
  });
});
