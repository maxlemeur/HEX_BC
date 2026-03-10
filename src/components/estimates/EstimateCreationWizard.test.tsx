import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  wizardStep1Schema,
  wizardStep2Schema,
  wizardStep3Schema,
} from "@/lib/estimates/schemas";

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
// 1. Wizard step schemas - pure validation
// =========================================================================

describe("wizardStep1Schema", () => {
  it("rejects empty projectName", () => {
    const result = wizardStep1Schema.safeParse({
      projectName: "",
      clientName: null,
      reference: null,
      title: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only projectName", () => {
    const result = wizardStep1Schema.safeParse({
      projectName: "   ",
      clientName: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid projectName with optional fields null", () => {
    const result = wizardStep1Schema.safeParse({
      projectName: "Mon Projet",
      clientName: null,
      reference: null,
      title: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid data with all optional fields", () => {
    const result = wizardStep1Schema.safeParse({
      projectName: "Projet Alpha",
      clientName: "Client X",
      reference: "REF-001",
      title: "Version initiale",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectName).toBe("Projet Alpha");
      expect(result.data.clientName).toBe("Client X");
    }
  });

  it("trims projectName", () => {
    const result = wizardStep1Schema.safeParse({
      projectName: "  Projet B  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.projectName).toBe("Projet B");
    }
  });

  it("transforms empty optional strings to null", () => {
    const result = wizardStep1Schema.safeParse({
      projectName: "P",
      clientName: "",
      reference: "  ",
      title: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientName).toBeNull();
      expect(result.data.reference).toBeNull();
    }
  });
});

describe("wizardStep2Schema", () => {
  const validStep2 = {
    dateDevis: "2026-03-15",
    validiteJours: 30,
    marginMode: "fixed" as const,
    taxRateBp: 2000,
    roundingMode: "none" as const,
  };

  it("accepts valid data", () => {
    const result = wizardStep2Schema.safeParse(validStep2);
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      dateDevis: "15/03/2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-existent date", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      dateDevis: "2026-02-30",
    });
    expect(result.success).toBe(false);
  });

  it("rejects validiteJours <= 0", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      validiteJours: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer validiteJours", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      validiteJours: 30.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects taxRateBp > 10000", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      taxRateBp: 10001,
    });
    expect(result.success).toBe(false);
  });

  it("rejects taxRateBp < 0", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      taxRateBp: -1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts taxRateBp at boundaries 0 and 10000", () => {
    expect(
      wizardStep2Schema.safeParse({ ...validStep2, taxRateBp: 0 }).success,
    ).toBe(true);
    expect(
      wizardStep2Schema.safeParse({ ...validStep2, taxRateBp: 10000 }).success,
    ).toBe(true);
  });

  it("rejects invalid marginMode", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      marginMode: "custom",
    });
    expect(result.success).toBe(false);
  });

  it("accepts tiered marginMode", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      marginMode: "tiered",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional marginBp", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      marginBp: 1500,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional roundingStepCents", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      roundingMode: "nearest",
      roundingStepCents: 100,
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional currency", () => {
    const result = wizardStep2Schema.safeParse({
      ...validStep2,
      currency: "EUR",
    });
    expect(result.success).toBe(true);
  });
});

describe("wizardStep3Schema", () => {
  it("accepts blank creationMode without template", () => {
    const result = wizardStep3Schema.safeParse({
      creationMode: "blank",
    });
    expect(result.success).toBe(true);
  });

  it("accepts template mode with valid UUID", () => {
    const result = wizardStep3Schema.safeParse({
      creationMode: "template",
      selectedTemplateId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects template mode without selectedTemplateId", () => {
    const result = wizardStep3Schema.safeParse({
      creationMode: "template",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.issues.map((i) => i.message);
      expect(msgs).toContain("Veuillez selectionner un template.");
    }
  });

  it("rejects template mode with invalid UUID", () => {
    const result = wizardStep3Schema.safeParse({
      creationMode: "template",
      selectedTemplateId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid creationMode", () => {
    const result = wizardStep3Schema.safeParse({
      creationMode: "import",
    });
    expect(result.success).toBe(false);
  });

  it("ignores selectedTemplateId for blank mode", () => {
    const result = wizardStep3Schema.safeParse({
      creationMode: "blank",
      selectedTemplateId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });
});

// =========================================================================
// 2. EstimateCreationWizard component tests
// =========================================================================

describe("EstimateCreationWizard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("renders step 1 by default with project name input", () => {
    setup();

    // "Projet" appears in both the step indicator and the step heading
    expect(screen.getAllByText("Projet").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Informations projet")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nom du projet/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Client/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Reference/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Titre de la version/)).toBeInTheDocument();
  });

  it("shows validation error when trying to proceed without project name", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    expect(screen.getByText("Champ obligatoire.")).toBeInTheDocument();
  });

  it("navigates to step 2 after filling project name", async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText(/Nom du projet/), "Test Project");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    expect(screen.getByText("Marge, TVA, arrondi")).toBeInTheDocument();
    expect(screen.getByLabelText(/Date devis/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Validité/)).toBeInTheDocument();
  });

  it("preserves data when navigating back from step 2", async () => {
    const { user } = setup();

    await user.type(
      screen.getByLabelText(/Nom du projet/),
      "My Important Project",
    );
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    // Now on step 2 - go back
    await user.click(screen.getByRole("button", { name: /Retour/ }));

    // Check project name is preserved
    const input = screen.getByLabelText(/Nom du projet/) as HTMLInputElement;
    expect(input.value).toBe("My Important Project");
  });

  it("shows quick create button on non-last steps", () => {
    setup();

    expect(
      screen.getByRole("button", { name: /Créer directement/ }),
    ).toBeInTheDocument();
  });

  it("shows margin tiers table when tiered mode selected", async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText(/Nom du projet/), "Project Tiers");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    // Now on step 2 - click "Marge par tranche"
    await user.click(
      screen.getByRole("button", { name: /Marge par tranche/ }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Tranches de marge/)).toBeInTheDocument();
      expect(screen.getByText("Seuil")).toBeInTheDocument();
      expect(screen.getByText("Multiplicateur")).toBeInTheDocument();
      expect(screen.getByText("x1.60")).toBeInTheDocument();
      expect(screen.getByText("x1.45")).toBeInTheDocument();
    });
  });

  it("does not show margin tiers table in fixed mode", async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText(/Nom du projet/), "Project Fixed");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    // Default is "fixed" - no tiers table
    expect(screen.queryByText(/Tranches de marge/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Marge fixe/ }),
    ).toBeInTheDocument();
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

  it("navigates through all 3 steps", async () => {
    const { user } = setup();

    // Step 1
    await user.type(screen.getByLabelText(/Nom du projet/), "Full Flow");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    // Step 2
    expect(screen.getByLabelText(/Date devis/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    // Step 3
    expect(screen.getByText("Récapitulatif")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Créer le chiffrage/ }),
    ).toBeInTheDocument();
    // Quick create should not appear on last step
    expect(
      screen.queryByRole("button", { name: /Créer directement/ }),
    ).not.toBeInTheDocument();
  });

  it("shows project family selector on step 2 and carries it to summary", async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText(/Nom du projet/), "Flow famille");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    const familySelect = screen.getByLabelText(/Famille de projet/) as HTMLSelectElement;
    await user.selectOptions(familySelect, "Travaux neufs");
    expect(familySelect.value).toBe("Travaux neufs");

    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    expect(screen.getByText("Famille de projet")).toBeInTheDocument();
    expect(screen.getByText("Travaux neufs")).toBeInTheDocument();
  });

  it("auto-selects linked DPGF source mode on existing project", async () => {
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
    const { user } = setup(vi.fn(), {
      projectId: "22222222-2222-4222-8222-222222222222",
    });

    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/Source detectee: HEX-DPGF.xlsx/),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /DPGF source a importer/ }),
    ).toBeEnabled();
    expect(
      screen.getByText("La version sera creee avec les lignes du DPGF source lie."),
    ).toBeInTheDocument();
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
      screen.getByText(/Aucun modele disponible actuellement/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Créer le chiffrage/ }));

    await waitFor(() => {
      expect(vi.mocked(createEstimate)).toHaveBeenCalled();
    });
    expect(
      screen.queryByText("Veuillez selectionner un template."),
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

  it("injects linked DPGF creationMode into createEstimate payload", async () => {
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
    const { user, onCreated } = setup(vi.fn(), {
      projectId: "22222222-2222-4222-8222-222222222222",
    });

    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await user.click(screen.getByRole("button", { name: /Créer le chiffrage/ }));

    await waitFor(() => {
      expect(vi.mocked(createEstimate)).toHaveBeenCalledWith(
        expect.objectContaining({
          creationMode: "linkedDpgfSource",
        }),
      );
      expect(onCreated).toHaveBeenCalledWith("version-abc-123");
    });
  });

  it("imports linked DPGF source when template mode is selected", async () => {
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

    const { user, onCreated } = setup(vi.fn(), {
      projectId: "22222222-2222-4222-8222-222222222222",
    });

    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await user.click(screen.getByRole("button", { name: /Suivant/ }));
    await waitFor(() => {
      expect(
        screen.getByText(/Source detectee: HEX-DPGF.xlsx/),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Depuis un modèle/ }));
    await user.selectOptions(
      screen.getByLabelText(/Template \(10 plus recents\)/),
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
      expect(onCreated).toHaveBeenCalledWith("version-tpl-123");
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
        screen.getByText(/Source detectee: HEX-DPGF.xlsx/),
      ).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Depuis un modèle/ }));
    await user.selectOptions(
      screen.getByLabelText(/Template \(10 plus recents\)/),
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
          "Le chiffrage a ete cree, mais le DPGF source n'a pas pu etre importe: Import temporairement indisponible.",
      });
    });
  });

  it("keeps accented labels for validity and summary copy", async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText(/Nom du projet/), "Flow accents");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    expect(screen.getByLabelText(/Validité/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Validite/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    expect(screen.getByText("Récapitulatif")).toBeInTheDocument();
    expect(screen.queryByText("Recapitulatif")).not.toBeInTheDocument();
  });

  it("shows Retour button only from step 2 onwards", async () => {
    const { user } = setup();

    // Step 1 - no back button
    expect(
      screen.queryByRole("button", { name: /Retour/ }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/Nom du projet/), "BackTest");
    await user.click(screen.getByRole("button", { name: /Suivant/ }));

    // Step 2 - back button exists
    expect(
      screen.getByRole("button", { name: /Retour/ }),
    ).toBeInTheDocument();
  });

  it("displays step indicator with correct labels", () => {
    setup();

    const nav = screen.getByRole("navigation", {
      name: /Étapes de création/,
    });
    expect(within(nav).getByText("Projet")).toBeInTheDocument();
    expect(within(nav).getByText("Paramètres")).toBeInTheDocument();
    expect(within(nav).getByText("Import")).toBeInTheDocument();
  });
});
