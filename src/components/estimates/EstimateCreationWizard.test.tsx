import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: function MockLink({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) {
    return <a href={href}>{children}</a>;
  },
}));

vi.mock("@/lib/estimates/client", () => ({
  createEstimate: vi.fn().mockResolvedValue("version-abc-123"),
  fetchEstimateTemplates: vi.fn().mockResolvedValue([]),
  fetchAffaireLinkedDpgfSource: vi.fn().mockResolvedValue(null),
  importLinkedDpgfSource: vi.fn().mockResolvedValue({
    sourceImportId: "11111111-1111-4111-8111-111111111111",
    targetVersionId: "version-tpl-123",
    createdSectionId: "33333333-3333-4333-8333-333333333333",
    createdLineIds: [],
    importedLinesCount: 0,
    skippedLinesCount: 0,
    totals: {
      totalHtCents: 0,
      totalTaxCents: 0,
      totalTtcCents: 0,
    },
    versionToken: null,
  }),
  instantiateEstimateFromTemplate: vi
    .fn()
    .mockResolvedValue({ versionId: "version-tpl-123" }),
}));

vi.mock("@/lib/estimates/margin-tiers", () => ({
  getMarginTiers: vi.fn().mockReturnValue([
    { id: "t1", threshold_cents: 0, multiplier: 1.6, position: 0 },
    { id: "t2", threshold_cents: 10_000_000, multiplier: 1.45, position: 1 },
  ]),
}));

vi.mock("@/lib/money", () => ({
  SUPPORTED_ESTIMATE_CURRENCIES: ["EUR", "USD", "GBP"],
  formatEUR: (cents: number) => `${(cents / 100).toFixed(2)} EUR`,
  formatCurrency: (cents: number, currency: string) => `${(cents / 100).toFixed(2)} ${currency}`,
}));

// Lazy-import after mocks are wired
import { EstimateCreationWizard } from "@/components/estimates/EstimateCreationWizard";
import {
  createEstimate,
  fetchAffaireLinkedDpgfSource,
  fetchEstimateTemplates,
  importLinkedDpgfSource,
  instantiateEstimateFromTemplate,
} from "@/lib/estimates/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setup(
  onCreated = vi.fn(),
  options: { projectId?: string } = {}
) {
  const user = userEvent.setup();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const result = render(
    <EstimateCreationWizard
      onCreated={onCreated}
      projectId={options.projectId}
    />,
    {
      container,
    }
  );
  return { user, onCreated, ...result };
}

// =========================================================================
// EstimateCreationWizard component tests
// =========================================================================

describe("EstimateCreationWizard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps quick create disabled after success to prevent duplicate creation", async () => {
    const { user, onCreated } = setup();

    await user.type(screen.getByLabelText(/Nom du projet/), "Quick create");

    const quickCreateButton = screen.getByRole("button", {
      name: /Créer directement/,
    });
    await user.click(quickCreateButton);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith("version-abc-123");
    });
    expect(quickCreateButton).toBeDisabled();

    await user.click(quickCreateButton);
    expect(vi.mocked(createEstimate)).toHaveBeenCalledTimes(1);
  });

  it("keeps decimal typing stable in numeric step-2 fields", async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText(/Nom du projet/), "Project Numbers");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    const marginInput = screen.getByLabelText(/Marge \(%\)/);
    await user.type(marginInput, "12.5");
    expect((marginInput as HTMLInputElement).value).toBe("12.5");

    const taxInput = screen.getByLabelText(/TVA \(%\)/);
    await user.clear(taxInput);
    await user.type(taxInput, "5.5");
    expect((taxInput as HTMLInputElement).value).toBe("5.5");
  });

  it("falls back to blank creation and disables template mode when list is empty", async () => {
    localStorage.setItem(
      "est-wizard-draft",
      JSON.stringify({
        projectName: "Flow sans template",
        creationMode: "template",
      }),
    );

    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Depuis un modèle/ }),
      ).toBeDisabled();
    });
    expect(
      screen.getByText(/Aucun modèle disponible actuellement/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Créer le chiffrage/ }));

    await waitFor(() => {
      expect(vi.mocked(createEstimate)).toHaveBeenCalled();
    });
    expect(
      screen.queryByText("Veuillez sélectionner un template."),
    ).not.toBeInTheDocument();
  });

  it("injects project family note into createEstimate payload", async () => {
    const { user, onCreated } = setup();

    await user.type(screen.getByLabelText(/Nom du projet/), "Flow payload");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await user.selectOptions(screen.getByLabelText(/Famille de projet/), "Maintenance");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await user.click(screen.getByRole("button", { name: /Créer le chiffrage/ }));

    await waitFor(() => {
      expect(vi.mocked(createEstimate)).toHaveBeenCalledWith(
        expect.objectContaining({
          projectNotes: "Famille Achat: Maintenance",
        }),
      );
      expect(onCreated).toHaveBeenCalledWith("version-abc-123");
    });
  });

  it("continues to created version when linked DPGF import fails after template creation", async () => {
    vi.mocked(fetchEstimateTemplates).mockResolvedValueOnce([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Template A",
        description: null,
        sourceVersionId: null,
        createdBy: null,
        createdAt: "2026-03-05T09:00:00.000Z",
        updatedAt: "2026-03-05T09:00:00.000Z",
        itemCount: 4,
      },
    ]);
    vi.mocked(fetchAffaireLinkedDpgfSource).mockResolvedValueOnce({
      importId: "11111111-1111-4111-8111-111111111111",
      filename: "HEX-DPGF.xlsx",
      sourceFormat: "xlsx",
      importStatus: "completed",
      mappingStatus: "mapped",
      importedAt: "2026-03-05T08:00:00.000Z",
      mappingUpdatedAt: "2026-03-05T08:15:00.000Z",
      parseMode: "strict",
      rowCount: 171,
      mappedRowCount: 171,
    });
    vi.mocked(importLinkedDpgfSource).mockRejectedValueOnce(
      new Error("Import temporairement indisponible."),
    );

    const { user, onCreated } = setup(vi.fn(), {
      projectId: "22222222-2222-4222-8222-222222222222",
    });

    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await waitFor(() => {
      expect(
        screen.getByText(/Source détectée : HEX-DPGF.xlsx/),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Depuis un modèle/ }));
    await user.selectOptions(
      screen.getByLabelText(/Modèle \(10 plus récents\)/),
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    await user.click(screen.getByRole("button", { name: /Créer le chiffrage/ }));

    await waitFor(() => {
      expect(vi.mocked(instantiateEstimateFromTemplate)).toHaveBeenCalledWith(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        expect.objectContaining({
          projectId: "22222222-2222-4222-8222-222222222222",
        }),
      );
      expect(vi.mocked(importLinkedDpgfSource)).toHaveBeenCalledWith("version-tpl-123");
      expect(onCreated).toHaveBeenCalledWith("version-tpl-123", {
        linkedDpgfImportWarning:
          "Le chiffrage a été créé, mais le DPGF source n'a pas pu être importé : Import temporairement indisponible.",
      });
    });
  });
});
