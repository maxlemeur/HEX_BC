import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

import type { AffaireIntakeBriefDraft } from "@/lib/affaires/intake";
import { COCKPIT_OPEN_SURFACE_EVENT } from "@/lib/cockpit/events";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockUpdateAffaireBrief = vi.fn();
const mockConfirmAffaireBrief = vi.fn();
vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  updateAffaireBrief: (...args: unknown[]) => mockUpdateAffaireBrief(...args),
  confirmAffaireBrief: (...args: unknown[]) => mockConfirmAffaireBrief(...args),
}));

const mockToast = {
  push: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => mockToast,
}));

import { BriefDraftCard } from "./BriefDraftCard";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

function makeBriefDraft(overrides?: Partial<AffaireIntakeBriefDraft>): AffaireIntakeBriefDraft {
  return {
    status: "a_confirmer",
    summary: "Resume du projet",
    projectObject: "Construction d'un batiment",
    scope: ["Lot 1 - Gros oeuvre", "Lot 2 - Electricite"],
    lots: ["GO", "ELEC"],
    receivedPieces: ["DPGF.pdf", "Plans.pdf"],
    assumptions: ["Hypothese A"],
    vigilancePoints: ["Point de vigilance X"],
    missingElements: ["CCTP manquant"],
    sources: [
      {
        blockKey: "scope",
        entryIndex: 0,
        sourceDocumentId: "doc-1",
        sourceFileName: "DPGF.pdf",
        rationale: null,
      },
    ],
    uploadId: "upload-1",
    lastGeneratedAt: "2026-03-01T10:00:00+01:00",
    confirmedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateAffaireBrief.mockResolvedValue({});
  mockConfirmAffaireBrief.mockResolvedValue({});
});

function getSection() {
  return screen.getByRole("region", { name: "Brief affaire" });
}

describe("BriefDraftCard", () => {
  it("renders empty state when briefDraft is null", () => {
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={null} />);
    expect(within(getSection()).getByText("Aucun brief genere")).toBeInTheDocument();
  });

  it("renders all 8 block headings", () => {
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();
    expect(within(section).getByText("Objet du projet")).toBeInTheDocument();
    expect(within(section).getByText("Perimetre detecte")).toBeInTheDocument();
    expect(within(section).getByText("Lots concernes")).toBeInTheDocument();
    expect(within(section).getByText("Pieces recues")).toBeInTheDocument();
    expect(within(section).getByText("Hypotheses initiales")).toBeInTheDocument();
    expect(within(section).getByText("Points de vigilance")).toBeInTheDocument();
    expect(within(section).getByText("Elements manquants")).toBeInTheDocument();
    expect(within(section).getByText("Synthese")).toBeInTheDocument();
  });

  it("displays content of blocks", () => {
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();
    expect(within(section).getByText("Construction d'un batiment")).toBeInTheDocument();
    expect(within(section).getByText("Lot 1 - Gros oeuvre")).toBeInTheDocument();
    expect(within(section).getByText("Lot 2 - Electricite")).toBeInTheDocument();
    expect(within(section).getByText("Resume du projet")).toBeInTheDocument();
    expect(within(section).getByText("Hypothese A")).toBeInTheDocument();
    expect(within(section).getByText("Point de vigilance X")).toBeInTheDocument();
    expect(within(section).getByText("CCTP manquant")).toBeInTheDocument();
  });

  it("shows 'A confirmer' badge when status is a_confirmer", () => {
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();
    const badges = within(section).getAllByText("A confirmer");
    expect(badges.length).toBeGreaterThanOrEqual(1);
    expect(badges[0].closest("[data-variant='warning']")).toBeTruthy();
  });

  it("shows 'Confirme' badge when status is confirme", () => {
    render(
      <BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft({ status: "confirme" })} />
    );
    const section = getSection();
    expect(within(section).getByText("Confirme")).toBeInTheDocument();
  });

  it("displays source annotations", () => {
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    // The source annotation for scope item 0 should show "DPGF.pdf"
    const scopeItem = screen.getByText("Lot 1 - Gros oeuvre").closest("li");
    expect(scopeItem).toBeTruthy();
    const sourceLink = within(scopeItem!).getByRole("link", { name: "DPGF.pdf" });
    expect(sourceLink).toHaveAttribute(
      "href",
      `/dashboard/affaires/${PROJECT_ID}?intakeDocument=doc-1#intake`
    );
  });

  it("displays source annotations for paragraph blocks", () => {
    render(
      <BriefDraftCard
        projectId={PROJECT_ID}
        briefDraft={makeBriefDraft({
          sources: [
            {
              blockKey: "summary",
              entryIndex: 0,
              sourceDocumentId: "11111111-1111-4111-8111-111111111111",
              sourceFileName: "Synthese-source.pdf",
              rationale: null,
            },
            {
              blockKey: "project_object",
              entryIndex: 0,
              sourceDocumentId: "22222222-2222-4222-8222-222222222222",
              sourceFileName: "Objet-source.pdf",
              rationale: null,
            },
          ],
        })}
      />
    );
    const section = getSection();
    expect(
      within(section).getByRole("link", { name: "Synthese-source.pdf" })
    ).toHaveAttribute(
      "href",
      `/dashboard/affaires/${PROJECT_ID}?intakeDocument=11111111-1111-4111-8111-111111111111#intake`
    );
    expect(
      within(section).getByRole("link", { name: "Objet-source.pdf" })
    ).toHaveAttribute(
      "href",
      `/dashboard/affaires/${PROJECT_ID}?intakeDocument=22222222-2222-4222-8222-222222222222#intake`
    );
  });

  it("enters and cancels edit mode", async () => {
    const user = userEvent.setup();
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();

    await user.click(within(section).getByText("Modifier"));

    // Editable fields should now have inputs
    expect(screen.getByDisplayValue("Resume du projet")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Lot 1 - Gros oeuvre")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Hypothese A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Point de vigilance X")).toBeInTheDocument();

    // Cancel
    await user.click(within(section).getByText("Annuler"));
    expect(screen.queryByDisplayValue("Resume du projet")).not.toBeInTheDocument();
    expect(within(section).getByText("Resume du projet")).toBeInTheDocument();
  });

  it("saves edited brief", async () => {
    const user = userEvent.setup();
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();

    await user.click(within(section).getByText("Modifier"));

    const summaryInput = screen.getByDisplayValue("Resume du projet");
    await user.clear(summaryInput);
    await user.type(summaryInput, "Nouveau resume");

    await user.click(within(section).getByText("Enregistrer"));

    expect(mockUpdateAffaireBrief).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      summary: "Nouveau resume",
      scope: ["Lot 1 - Gros oeuvre", "Lot 2 - Electricite"],
      vigilancePoints: ["Point de vigilance X"],
      assumptions: ["Hypothese A"],
    });
    expect(mockToast.success).toHaveBeenCalledWith({ title: "Brief mis a jour." });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("skips no-op saves for confirmed briefs", async () => {
    const user = userEvent.setup();
    render(
      <BriefDraftCard
        projectId={PROJECT_ID}
        briefDraft={makeBriefDraft({ status: "confirme" })}
      />
    );
    const section = getSection();

    await user.click(within(section).getByText("Modifier"));
    await user.click(within(section).getByText("Enregistrer"));

    expect(mockUpdateAffaireBrief).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Resume du projet")).not.toBeInTheDocument();
  });

  it("shows inline error on save failure and stays in edit mode", async () => {
    mockUpdateAffaireBrief.mockRejectedValueOnce(new Error("Erreur serveur"));
    const user = userEvent.setup();
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();

    await user.click(within(section).getByText("Modifier"));
    const summaryInput = screen.getByDisplayValue("Resume du projet");
    await user.clear(summaryInput);
    await user.type(summaryInput, "Resume en erreur");
    await user.click(within(section).getByText("Enregistrer"));

    expect(await screen.findByText("Erreur serveur")).toBeInTheDocument();
    // Still in edit mode
    expect(screen.getByDisplayValue("Resume en erreur")).toBeInTheDocument();
  });

  it("opens the confirmation panel when the cockpit requests brief-confirm", async () => {
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);

    document.dispatchEvent(
      new CustomEvent(COCKPIT_OPEN_SURFACE_EVENT, {
        detail: {
          projectId: PROJECT_ID,
          actionId: "confirm-brief",
          surfaceId: "brief-confirm",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Confirmer ce brief ?")).toBeInTheDocument();
    });
  });

  it("confirms brief via confirmation dialog and shows toast", async () => {
    const user = userEvent.setup();
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();

    await user.click(within(section).getByText("Confirmer le brief"));
    // Confirmation dialog should appear
    expect(within(section).getByText("Confirmer ce brief ?")).toBeInTheDocument();
    await user.click(within(section).getByText("Oui, confirmer"));

    expect(mockConfirmAffaireBrief).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    expect(mockToast.success).toHaveBeenCalledWith({ title: "Brief confirme." });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("shows toast error on confirm failure", async () => {
    mockConfirmAffaireBrief.mockRejectedValueOnce(new Error("Pas autorise"));
    const user = userEvent.setup();
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();

    await user.click(within(section).getByText("Confirmer le brief"));
    await user.click(within(section).getByText("Oui, confirmer"));

    expect(mockToast.error).toHaveBeenCalledWith({
      title: "Erreur",
      description: "Pas autorise",
    });
  });

  it("can cancel the confirmation dialog", async () => {
    const user = userEvent.setup();
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();

    await user.click(within(section).getByText("Confirmer le brief"));
    expect(within(section).getByText("Confirmer ce brief ?")).toBeInTheDocument();

    await user.click(within(section).getByText("Annuler"));
    expect(within(section).queryByText("Confirmer ce brief ?")).not.toBeInTheDocument();
    expect(mockConfirmAffaireBrief).not.toHaveBeenCalled();
  });

  it("hides edit/confirm buttons when isReadOnly", () => {
    render(
      <BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} isReadOnly />
    );
    const section = getSection();
    expect(within(section).queryByText("Modifier")).not.toBeInTheDocument();
    expect(within(section).queryByText("Confirmer le brief")).not.toBeInTheDocument();
  });

  it("adds and removes list items", async () => {
    const user = userEvent.setup();
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();

    await user.click(within(section).getByText("Modifier"));

    // Find scope "Ajouter" buttons - click the first one to add an item
    const addButtons = within(section).getAllByText("+ Ajouter");
    await user.click(addButtons[0]); // scope list

    // Remove the first scope item
    const removeBtn = within(section).getByLabelText("Supprimer: Lot 1 - Gros oeuvre");
    await user.click(removeBtn);

    expect(screen.queryByDisplayValue("Lot 1 - Gros oeuvre")).not.toBeInTheDocument();
  });

  it("enforces max 12 items in editable lists", async () => {
    const fullScope = Array.from({ length: 12 }, (_, i) => `Item ${i + 1}`);
    const user = userEvent.setup();
    render(
      <BriefDraftCard
        projectId={PROJECT_ID}
        briefDraft={makeBriefDraft({ scope: fullScope })}
      />
    );
    const section = getSection();

    await user.click(within(section).getByText("Modifier"));

    // With 12 items in scope, there should be fewer "+ Ajouter" buttons
    // (vigilancePoints=1 item, assumptions=1 item have room, but scope=12 is full)
    const addButtons = within(section).getAllByText("+ Ajouter");
    // scope shouldn't have one, but vigilancePoints and assumptions should = 2
    expect(addButtons).toHaveLength(2);
  });

  it("has proper aria attributes", () => {
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();
    expect(section).toBeInTheDocument();

    // aria-live region exists
    const liveRegion = section.querySelector("[aria-live='polite']");
    expect(liveRegion).toBeInTheDocument();
  });

  it("shows executive summary banner with counts", () => {
    render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} />);
    const section = getSection();
    expect(within(section).getByText("2 pieces")).toBeInTheDocument();
    expect(within(section).getByText("1 hypotheses")).toBeInTheDocument();
    expect(within(section).getByText("1 vigilance")).toBeInTheDocument();
    expect(within(section).getByText("1 manquant(s)")).toBeInTheDocument();
  });

  it("shows 'Dossier complet' when no missing elements", () => {
    render(
      <BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft({ missingElements: [] })} />
    );
    const section = getSection();
    expect(within(section).getByText("Dossier complet")).toBeInTheDocument();
  });

  it("shows placeholder for empty list blocks", () => {
    render(
      <BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft({ lots: [] })} />
    );
    const section = getSection();
    expect(within(section).getByText("Aucun element detecte")).toBeInTheDocument();
  });

  it("does not show confirm button when status is confirme", () => {
    render(
      <BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft({ status: "confirme" })} />
    );
    const section = getSection();
    expect(within(section).queryByText("Confirmer le brief")).not.toBeInTheDocument();
  });
});
