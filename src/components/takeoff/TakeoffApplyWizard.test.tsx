import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateItemsForVersion: vi.fn(),
}));

vi.mock("@/lib/takeoff/client", () => ({
  previewTakeoffConversion: vi.fn(),
}));

import { TakeoffApplyWizard } from "@/components/takeoff/TakeoffApplyWizard";
import { fetchEstimateItemsForVersion } from "@/lib/estimates/client";
import { previewTakeoffConversion } from "@/lib/takeoff/client";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";

const PREVIEW_RESPONSE = {
  job_id: JOB_ID,
  strategy: "append" as const,
  target_section_id: null,
  summary: {
    total_count: 1,
    included_count: 1,
    transformed_count: 1,
    overridden_count: 0,
    excluded_by_mapping_count: 0,
    assembly_insertions_count: 0,
  },
  items: [
    {
      item_id: ITEM_ID,
      source_order: 0,
      rule_id: "44444444-4444-4444-8444-444444444444",
      rule_name: "Rule set_price",
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 420,
      },
      applied_by: "rule" as const,
      original: {
        designation: "Tube PVC",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: null,
        assembly_id: null,
      },
      transformed: {
        designation: "Tube PVC",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: 420,
        assembly_id: null,
      },
    },
  ],
};

function makePreviewResponse(
  summaryOverrides: Partial<typeof PREVIEW_RESPONSE.summary> = {}
) {
  return {
    ...PREVIEW_RESPONSE,
    summary: {
      ...PREVIEW_RESPONSE.summary,
      ...summaryOverrides,
    },
  };
}

function makeItem(
  id: string,
  designation: string,
  overrides: Partial<TakeoffJobItem> = {}
): TakeoffJobItem {
  return {
    id,
    designation,
    quantity: 1,
    unit: "u",
    confidence: 0.9,
    evidence: "Repère A3 sur le plan",
    source_file_name: "plan.pdf",
    source_page: 1,
    metadata: {},
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T10:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    ...overrides,
  };
}

/** Navigate the wizard to step 4 (recap / guard panel) */
async function advanceToStep4() {
  // Step 1 → 2
  fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
  // Step 2 → 3
  fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

  // Wait for preview to load (step 3)
  await waitFor(() => {
    expect(previewTakeoffConversion).toHaveBeenCalled();
  });

  // Step 3 → 4
  fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
}

describe("TakeoffApplyWizard", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([
      {
        id: SECTION_ID,
        parent_id: null,
        item_type: "section",
        position: 1,
        title: "Section A",
      },
    ] as never);
    vi.mocked(previewTakeoffConversion).mockResolvedValue(PREVIEW_RESPONSE);
  });

  it("loads preview and submits overrides", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        targetVersionLabel="V1"
        includedCount={1}
        excludedCount={0}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={onConfirm}
      />
    );

    await waitFor(() => {
      expect(fetchEstimateItemsForVersion).toHaveBeenCalledWith(VERSION_ID);
      expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID);
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(previewTakeoffConversion).toHaveBeenCalledWith(
        JOB_ID,
        expect.objectContaining({
          strategy: "append",
          target_section_id: SECTION_ID,
        })
      );
    });

    const select = screen.getByDisplayValue("Regle auto") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "set_price" } });

    const priceInput = screen.getByDisplayValue("420") as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "990" } });

    fireEvent.click(screen.getByRole("button", { name: "Recalculer la preview" }));

    await waitFor(() => {
      expect(previewTakeoffConversion).toHaveBeenLastCalledWith(
        JOB_ID,
        expect.objectContaining({
          overrides: [
            {
              item_id: ITEM_ID,
              action: "set_price",
              action_params: {
                unit_price_cents: 990,
              },
            },
          ],
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'application" }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: "append",
          targetSectionId: SECTION_ID,
          overrides: [
            {
              item_id: ITEM_ID,
              action: "set_price",
              action_params: {
                unit_price_cents: 990,
              },
            },
          ],
        })
      );
    });
  });

  it("blocks apply until a parent section exists", async () => {
    vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([]);

    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        includedCount={1}
        excludedCount={0}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Creez d'abord un lot ou un chapitre/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Section cible")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });

  it("keeps the active step visible on mobile and hides the technical version id", async () => {
    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        targetVersionLabel="V1"
        includedCount={1}
        excludedCount={0}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(fetchEstimateItemsForVersion).toHaveBeenCalledWith(VERSION_ID);
    });

    expect(screen.queryByText(VERSION_ID)).not.toBeInTheDocument();

    const body = screen.getByTestId("takeoff-apply-wizard-body");
    body.scrollTop = 240;
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(body.scrollTop).toBe(0);
    });

    body.scrollTop = 240;
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(previewTakeoffConversion).toHaveBeenCalled();
      expect(body.scrollTop).toBe(0);
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(screen.getByText("Confirmation finale")).toBeInTheDocument();
    });
    expect(screen.getByText("Version cible : V1 (brouillon)")).toBeInTheDocument();
    expect(screen.queryByText(VERSION_ID)).not.toBeInTheDocument();
  });

  it("shows explicit strategy impact and provenance before confirmation", async () => {
    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        includedCount={1}
        excludedCount={0}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        items={[makeItem(ITEM_ID, "Tube PVC", { source_file_name: "plans-rdc.pdf", source_page: 7 })]}
        sourceFileName="plans-rdc.pdf"
      />
    );

    await waitFor(() => {
      expect(fetchEstimateItemsForVersion).toHaveBeenCalledWith(VERSION_ID);
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("radio", { name: /Fusionner avec l'existant/i }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(screen.getByText("Preview d'impact")).toBeDefined();
    });

    expect(screen.getByText("Fusionner avec l'existant")).toBeDefined();
    expect(screen.getByText("Source du metre :")).toBeDefined();
    expect(screen.getAllByText("plans-rdc.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("page 7")).toBeDefined();
    expect(screen.getAllByText("Hors mapping").length).toBeGreaterThan(0);
  });

  it("uses the refreshed override count without double-counting manual changes", async () => {
    vi.mocked(previewTakeoffConversion)
      .mockResolvedValueOnce(PREVIEW_RESPONSE)
      .mockResolvedValueOnce(makePreviewResponse({ overridden_count: 1 }));

    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        includedCount={1}
        excludedCount={0}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(fetchEstimateItemsForVersion).toHaveBeenCalledWith(VERSION_ID);
    });

    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(screen.getByText("Preview d'impact")).toBeDefined();
    });

    const select = screen.getByDisplayValue("Regle auto") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "set_price" } });

    fireEvent.click(screen.getByRole("button", { name: "Recalculer la preview" }));

    await waitFor(() => {
      expect(previewTakeoffConversion).toHaveBeenCalledTimes(2);
    });

    const overrideCard = screen
      .getByText("ajustements humains avant confirmation")
      .closest("div");
    expect(overrideCard).not.toBeNull();
    expect(within(overrideCard as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(within(overrideCard as HTMLElement).queryByText("2")).not.toBeInTheDocument();
  });

  it("requires a fresh preview after an override changes", async () => {
    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        includedCount={1}
        excludedCount={0}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Section cible")).toHaveValue(SECTION_ID);
    });
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();
    });

    fireEvent.change(screen.getByDisplayValue("Regle auto"), {
      target: { value: "set_price" },
    });

    expect(screen.getByText(/Les ajustements ont change/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Recalculer la preview" }));

    await waitFor(() => {
      expect(screen.queryByText(/Les ajustements ont change/i)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Suivant" })).toBeEnabled();
    });
  });

  it("includes mapping-based exclusions in the final recap", async () => {
    vi.mocked(previewTakeoffConversion).mockResolvedValue(
      makePreviewResponse({ excluded_by_mapping_count: 2 })
    );

    render(
      <TakeoffApplyWizard
        open
        jobId={JOB_ID}
        versionId={VERSION_ID}
        includedCount={1}
        excludedCount={1}
        isSubmitting={false}
        submitError={null}
        onOpenChange={() => undefined}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await waitFor(() => {
      expect(fetchEstimateItemsForVersion).toHaveBeenCalledWith(VERSION_ID);
    });

    await advanceToStep4();

    const excludedCard = screen.getByText("laissés hors application").closest("div");
    expect(excludedCard).not.toBeNull();
    expect(within(excludedCard as HTMLElement).getByText("3")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // TKF-025 Guard Panel tests
  // ---------------------------------------------------------------------------

  describe("Guard Panel (TKF-025)", () => {
    const BLOCKED_ITEMS: TakeoffJobItem[] = [
      makeItem("blocked-1", "Cloison BA13 ep.72", { confidence: 0.23, is_verified: false }),
      makeItem("blocked-2", "Faux-plafond 60x60", { confidence: 0.41, is_verified: false }),
      makeItem("ok-1", "Peinture acrylique", { confidence: 0.92, is_verified: false }),
    ];

    const MEDIUM_ITEMS: TakeoffJobItem[] = [
      makeItem("medium-1", "Enduit platre", { confidence: 0.65, is_verified: false }),
      makeItem("medium-2", "Cloison placo", { confidence: 0.72, is_verified: false }),
      makeItem("ok-1", "Peinture acrylique", { confidence: 0.92, is_verified: false }),
    ];

    const ALL_VERIFIED_ITEMS: TakeoffJobItem[] = [
      makeItem("a", "Item verified A", { confidence: 0.2, is_verified: true }),
      makeItem("b", "Item verified B", { confidence: 0.9, is_verified: false }),
    ];

    function renderWizardWithGuard(options: {
      items: TakeoffJobItem[];
      jobLevel?: string;
      isAdmin?: boolean;
      onReturnToReview?: () => void;
      reviewHref?: string;
      onConfirm?: (payload: unknown) => Promise<void>;
    }) {
      const onConfirm = options.onConfirm ?? vi.fn().mockResolvedValue(undefined);

      return render(
        <TakeoffApplyWizard
          open
          jobId={JOB_ID}
          versionId={VERSION_ID}
          includedCount={options.items.filter((i) => !i.is_excluded).length}
          excludedCount={options.items.filter((i) => i.is_excluded).length}
          isSubmitting={false}
          submitError={null}
          onOpenChange={() => undefined}
          onConfirm={onConfirm as never}
          items={options.items}
          jobLevel={options.jobLevel ?? "C"}
          isAdmin={options.isAdmin ?? false}
          onReturnToReview={options.onReturnToReview}
          reviewHref={options.reviewHref}
        />
      );
    }

    it("shows guard panel when Level C job has unverified low-confidence items", async () => {
      renderWizardWithGuard({ items: BLOCKED_ITEMS });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      // Guard panel banner should be visible
      expect(screen.getByText(/Preuves à compléter/)).toBeInTheDocument();
      expect(screen.getByText(/2 items sont bloqués/)).toBeInTheDocument();

      // Blocked items should appear in the table
      expect(screen.getByText("Cloison BA13 ep.72")).toBeInTheDocument();
      expect(screen.getByText("Faux-plafond 60x60")).toBeInTheDocument();
      expect(screen.getByText("23%")).toBeInTheDocument();
      expect(screen.getByText("41%")).toBeInTheDocument();

      // Confirm button should be disabled
      const confirmButton = screen.getByRole("button", { name: "Confirmer l'application" });
      expect(confirmButton).toBeDisabled();
    });

    it("does not expose bulk or per-item verification shortcuts", async () => {
      renderWizardWithGuard({ items: BLOCKED_ITEMS, reviewHref: "/review" });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      expect(screen.queryByRole("button", { name: /Tout vérifier/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /^Vérifier$/i })).toBeNull();
      expect(
        screen.getByRole("link", { name: /Ouvrir la revue des preuves/i })
      ).toHaveAttribute("href", "/review");
    });

    it("returns to the evidence review through the provided action", async () => {
      const onReturnToReview = vi.fn();
      renderWizardWithGuard({ items: BLOCKED_ITEMS, onReturnToReview });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      fireEvent.click(screen.getByRole("button", { name: /Retour à la revue/i }));
      expect(onReturnToReview).toHaveBeenCalledTimes(1);
    });

    it("confirm button enables when all blocked items become verified", async () => {
      // Start with all items verified → guard passes
      renderWizardWithGuard({ items: ALL_VERIFIED_ITEMS });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      // Guard panel should NOT be visible
      expect(screen.queryByText(/Preuves à compléter/)).not.toBeInTheDocument();

      // Confirm button should be enabled
      const confirmButton = screen.getByRole("button", { name: "Confirmer l'application" });
      expect(confirmButton).toBeEnabled();
    });

    it("does not show guard panel for Level A/B jobs", async () => {
      renderWizardWithGuard({
        items: BLOCKED_ITEMS,
        jobLevel: "A",
      });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      // No guard panel
      expect(screen.queryByText(/Preuves à compléter/)).not.toBeInTheDocument();

      // Recap should be shown directly
      expect(screen.getByText("Récapitulatif")).toBeInTheDocument();

      // Confirm should be enabled
      const confirmButton = screen.getByRole("button", { name: "Confirmer l'application" });
      expect(confirmButton).toBeEnabled();
    });

    it("admin override section visible only for admins", async () => {
      // Render as non-admin
      const { unmount } = renderWizardWithGuard({
        items: BLOCKED_ITEMS,
        isAdmin: false,
      });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      // Override section should NOT be visible
      expect(screen.queryByText(/Dérogation administrateur/)).not.toBeInTheDocument();

      unmount();
      vi.clearAllMocks();
      vi.mocked(fetchEstimateItemsForVersion).mockResolvedValue([
        {
          id: "55555555-5555-4555-8555-555555555555",
          parent_id: null,
          item_type: "section",
          position: 1,
          title: "Section A",
        },
      ] as never);
      vi.mocked(previewTakeoffConversion).mockResolvedValue(PREVIEW_RESPONSE);

      // Render as admin
      renderWizardWithGuard({
        items: BLOCKED_ITEMS,
        isAdmin: true,
      });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      // Override section SHOULD be visible
      expect(screen.getByText(/Dérogation administrateur/)).toBeInTheDocument();
    });

    it("admin override requires justification text (min 10 chars)", async () => {
      renderWizardWithGuard({
        items: BLOCKED_ITEMS,
        isAdmin: true,
      });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      const overrideButton = screen.getByRole("button", {
        name: /Appliquer avec dérogation/,
      });
      const justificationInput = screen.getByRole("textbox", {
        name: /Justification de la dérogation/,
      });

      // Button disabled with empty justification
      expect(overrideButton).toBeDisabled();

      // Short justification — still disabled
      fireEvent.change(justificationInput, { target: { value: "Too short" } });
      expect(overrideButton).toBeDisabled();

      // Valid justification (>= 10 chars)
      fireEvent.change(justificationInput, {
        target: { value: "Projet urgent valide par la direction" },
      });
      expect(overrideButton).toBeEnabled();
    });

    it("admin override calls onConfirm with override fields", async () => {
      const onConfirm = vi.fn().mockResolvedValue(undefined);
      renderWizardWithGuard({
        items: BLOCKED_ITEMS,
        isAdmin: true,
        onConfirm,
      });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      const justificationInput = screen.getByRole("textbox", {
        name: /Justification de la dérogation/,
      });
      fireEvent.change(justificationInput, {
        target: { value: "Projet urgent valide par la direction" },
      });

      const overrideButton = screen.getByRole("button", {
        name: /Appliquer avec dérogation/,
      });
      fireEvent.click(overrideButton);

      await waitFor(() => {
        expect(onConfirm).toHaveBeenCalledWith(
          expect.objectContaining({
            override: true,
            overrideJustification: "Projet urgent valide par la direction",
          })
        );
      });
    });

    it("shows medium confidence warning as non-blocking", async () => {
      renderWizardWithGuard({ items: MEDIUM_ITEMS });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      // No blocking guard panel (medium items are above threshold)
      expect(screen.queryByText(/Preuves à compléter/)).not.toBeInTheDocument();

      // Medium warning should be visible
      expect(screen.getByText(/Confiance moyenne \(non bloquante\)/)).toBeInTheDocument();
      expect(screen.getByText(/2 items ont un score/)).toBeInTheDocument();

      // Confirm should be enabled (medium is not blocking)
      const confirmButton = screen.getByRole("button", { name: "Confirmer l'application" });
      expect(confirmButton).toBeEnabled();
    });

    it("keeps the impact summary visible while guard items are blocked", async () => {
      const mixedItems = [
        makeItem("verified-1", "Item OK", { confidence: 0.1, is_verified: true }),
        makeItem("blocked-1", "Item blocked", { confidence: 0.2, is_verified: false }),
        makeItem("high-1", "Item high", { confidence: 0.95, is_verified: true }),
      ];

      renderWizardWithGuard({ items: mixedItems });

      await waitFor(() => {
        expect(fetchEstimateItemsForVersion).toHaveBeenCalled();
      });

      await advanceToStep4();

      expect(screen.getByText("Impact avant dérogation")).toBeInTheDocument();
      expect(screen.getByText("Items retenus")).toBeInTheDocument();
      expect(screen.getByText("Récapitulatif")).toBeInTheDocument();
      expect(screen.queryByText(/vérifiés/)).toBeNull();
    });
  });
});
