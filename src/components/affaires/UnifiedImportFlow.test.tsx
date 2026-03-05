import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useImportFlowMock, useUiModeMock } = vi.hoisted(() => ({
  useImportFlowMock: vi.fn(),
  useUiModeMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockDynamicComponent() {
      return null;
    },
}));

vi.mock("@/hooks/useImportFlow", () => ({
  useImportFlow: useImportFlowMock,
}));

vi.mock("@/hooks/useUiMode", () => ({
  useUiMode: useUiModeMock,
}));

import { UnifiedImportFlow } from "@/components/affaires/UnifiedImportFlow";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("UnifiedImportFlow", () => {
  let currentLastImportId: string | null;

  beforeEach(() => {
    vi.clearAllMocks();
    currentLastImportId = "11111111-1111-4111-8111-111111111111";
    const imports = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        status: "completed",
        fileName: "dpgf.csv",
        rowsCount: 10,
        createdAt: "2026-03-05T08:00:00.000Z",
        mode: "server",
      },
    ];
    const importFile = vi.fn().mockResolvedValue(true);
    const refreshImports = vi.fn();

    useUiModeMock.mockReturnValue({
      mode: "expert",
      setMode: vi.fn(),
      isExpert: true,
      isSimplified: false,
    });

    useImportFlowMock.mockImplementation(() => ({
      imports,
      isLoadingImports: false,
      isRefreshing: false,
      isSubmitting: false,
      uploadProgress: null,
      isPolling: false,
      loadError: null,
      submitError: null,
      workerError: null,
      modeMessage: null,
      lastMode: "server",
      lastImportId: currentLastImportId,
      maxClientParseSizeBytes: 5 * 1024 * 1024,
      importFile,
      refreshImports,
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ok: true,
          data: {
            source_columns: ["designation"],
            sample_values: {
              designation: ["Poste 1"],
            },
            suggestions: {
              designation: "designation",
            },
            confidence_by_source: {
              designation: "high",
            },
            template_exact_match: null,
            auto_validation: {
              can_auto_validate: false,
            },
          },
        }),
      ),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps cancel confirmation active after returning to upload", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <UnifiedImportFlow
        projectId="22222222-2222-4222-8222-222222222222"
        onCancel={onCancel}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Retour" }).length,
      ).toBeGreaterThan(0);
    });

    // Simulate a completed import already attached to the flow; returning to upload should not auto-advance.
    currentLastImportId = null;
    await user.click(screen.getAllByRole("button", { name: "Retour" })[0]);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Annuler" }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await waitFor(() => {
      expect(screen.getByText("Annuler l'import ?")).toBeInTheDocument();
    });
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Annuler l'import" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
