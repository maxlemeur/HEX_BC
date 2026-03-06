import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  confirmUnifiedImportFlowMock,
  mockPush,
  mockRefresh,
  useImportFlowMock,
  useUiModeMock,
} = vi.hoisted(() => ({
  confirmUnifiedImportFlowMock: vi.fn(),
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  useImportFlowMock: vi.fn(),
  useUiModeMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

vi.mock("next/dynamic", async () => {
  const React = await vi.importActual<typeof import("react")>("react");

  return {
    default: (loader: () => Promise<{ default: React.ComponentType<unknown> }>) =>
      function MockDynamicComponent(props: Record<string, unknown>) {
        const [ResolvedComponent, setResolvedComponent] =
          React.useState<React.ComponentType<Record<string, unknown>> | null>(null);

        React.useEffect(() => {
          let active = true;

          void loader().then((mod) => {
            if (!active) {
              return;
            }

            setResolvedComponent(() => mod.default as React.ComponentType<Record<string, unknown>>);
          });

          return () => {
            active = false;
          };
        }, []);

        return ResolvedComponent ? <ResolvedComponent {...props} /> : null;
      },
  };
});

vi.mock("@/hooks/useImportFlow", () => ({
  useImportFlow: useImportFlowMock,
}));

vi.mock("@/hooks/useUiMode", () => ({
  useUiMode: useUiModeMock,
}));

vi.mock("@/app/dashboard/affaires/_actions/import-flow", () => ({
  confirmUnifiedImportFlow: confirmUnifiedImportFlowMock,
}));

vi.mock("@/components/mappings/ColumnMapper", () => ({
  ColumnMapper: () => <div>Column mapper</div>,
}));

vi.mock("@/components/mappings/DataPreview", () => ({
  DataPreview: () => <div>Data preview</div>,
}));

vi.mock("@/components/affaires/PlansStep", () => ({
  PlansStep: ({
    onSkip,
    onContinue,
  }: {
    onSkip: () => void;
    onContinue: () => void;
    showSuccessBanner?: boolean;
  }) => (
    <div>
      <p>Plans step</p>
      <button type="button" onClick={onSkip}>
        Passer cette etape
      </button>
      <button type="button" onClick={onContinue}>
        Terminer l&apos;import
      </button>
    </div>
  ),
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

async function advanceToConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Suivant : Apercu/i }));
  await user.click(
    await screen.findByRole("button", { name: /Suivant : Confirmation/i })
  );
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
      vi.fn(async (_input, init) => {
        const body =
          init?.body && typeof init.body === "string"
            ? (JSON.parse(init.body) as { action?: string })
            : null;

        if (body?.action === "preview") {
          return jsonResponse({
            ok: true,
            data: {
              source_columns: ["designation"],
              validation: {
                is_valid: true,
                missing_required_fields: [],
                duplicate_target_assignments: [],
                mapped_sources_count: 1,
                mapped_targets_count: 1,
              },
              rows: [],
              duplicates: {
                total_groups: 0,
                total_rows_impacted: 0,
              },
            },
          });
        }

        return jsonResponse({
          ok: true,
          data: {
            source_columns: ["reference", "designation"],
            sample_values: {
              reference: ["A-001"],
              designation: ["Poste 1"],
            },
            suggestions: {
              reference: "hex_code",
              designation: "designation",
            },
            confidence_by_source: {
              reference: "high",
              designation: "high",
            },
            template_exact_match: null,
            auto_validation: {
              can_auto_validate: false,
            },
          },
        });
      }),
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

  it("opens the plans step after confirmation when takeoff is enabled", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    confirmUnifiedImportFlowMock.mockResolvedValue({
      mode: "version_created",
      importId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      mappingId: "33333333-3333-4333-8333-333333333333",
      versionId: "44444444-4444-4444-8444-444444444444",
      redirectTo: "/dashboard/estimates/44444444-4444-4444-8444-444444444444/edit",
      stats: {
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        insertedRows: 1,
        skippedRows: 0,
      },
    });

    render(
      <UnifiedImportFlow
        projectId="22222222-2222-4222-8222-222222222222"
        takeoffEnabled
        onComplete={onComplete}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Suivant : Apercu/i })
      ).toBeInTheDocument();
    });

    await advanceToConfirmation(user);
    await user.click(
      await screen.findByRole("button", { name: /Creer le chiffrage/i })
    );

    await waitFor(() => {
      expect(screen.getByText("Plans step")).toBeInTheDocument();
    });

    expect(mockPush).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Terminer l.import/i }));

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "version_created",
        versionId: "44444444-4444-4444-8444-444444444444",
      })
    );
  });

  it("skipping plans step redirects to the estimate editor", async () => {
    const user = userEvent.setup();

    confirmUnifiedImportFlowMock.mockResolvedValue({
      mode: "version_created",
      importId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      mappingId: "33333333-3333-4333-8333-333333333333",
      versionId: "44444444-4444-4444-8444-444444444444",
      redirectTo: "/dashboard/estimates/44444444-4444-4444-8444-444444444444/edit",
      stats: {
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        insertedRows: 1,
        skippedRows: 0,
      },
    });

    render(
      <UnifiedImportFlow
        projectId="22222222-2222-4222-8222-222222222222"
        takeoffEnabled
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Suivant : Apercu/i })
      ).toBeInTheDocument();
    });

    await advanceToConfirmation(user);
    await user.click(
      await screen.findByRole("button", { name: /Creer le chiffrage/i })
    );

    await waitFor(() => {
      expect(screen.getByText("Plans step")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Passer cette etape/i }));

    expect(mockPush).toHaveBeenCalledWith(
      "/dashboard/estimates/44444444-4444-4444-8444-444444444444/edit"
    );
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("redirects directly to the hub when takeoff is disabled", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    confirmUnifiedImportFlowMock.mockResolvedValue({
      mode: "version_created",
      importId: "11111111-1111-4111-8111-111111111111",
      projectId: "22222222-2222-4222-8222-222222222222",
      mappingId: "33333333-3333-4333-8333-333333333333",
      versionId: "44444444-4444-4444-8444-444444444444",
      redirectTo: "/dashboard/affaires/22222222-2222-4222-8222-222222222222",
      stats: {
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        insertedRows: 1,
        skippedRows: 0,
      },
    });

    render(
      <UnifiedImportFlow
        projectId="22222222-2222-4222-8222-222222222222"
        onComplete={onComplete}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Suivant : Apercu/i })
      ).toBeInTheDocument();
    });

    await advanceToConfirmation(user);
    await user.click(
      await screen.findByRole("button", { name: /Creer le chiffrage/i })
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(
        "/dashboard/affaires/22222222-2222-4222-8222-222222222222"
      );
    });

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Plans step")).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
