import { cleanup,render,screen,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import type { AffaireIntakeBriefDraft } from "@/lib/affaires/intake";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockUpdateAffaireBrief = vi.fn();
const mockConfirmAffaireBrief = vi.fn();
const mockResolveAffaireBriefPlanGap = vi.fn();
vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  updateAffaireBrief: (...args: unknown[]) => mockUpdateAffaireBrief(...args),
  confirmAffaireBrief: (...args: unknown[]) => mockConfirmAffaireBrief(...args),
  resolveAffaireBriefPlanGap: (...args: unknown[]) => mockResolveAffaireBriefPlanGap(...args),
}));

const mockToast = {
  push: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => mockToast,
}));

import { BriefDraftCard } from "./BriefDraftCard";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

function makeBriefDraft(overrides?: Partial<AffaireIntakeBriefDraft>): AffaireIntakeBriefDraft {
  return {
    status: "a_confirmer",
    updatedAt: "2026-03-06T09:15:00+01:00",
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

  it("lets a user explicitly mark the plan mention treated without hiding its source", async () => {
    const user = userEvent.setup();
    mockResolveAffaireBriefPlanGap.mockResolvedValue({ changed: true });
    const brief = makeBriefDraft({
      updatedAt: "2026-03-06T09:15:00+01:00",
      missingElements: ["Plans manquants", "CCTP manquant"],
      sources: [{ blockKey: "missing_elements", entryIndex: 0, sourceDocumentId: "doc-1", sourceFileName: "DPGF.pdf", rationale: null }],
    });
    const view = render(<BriefDraftCard projectId={PROJECT_ID} briefDraft={brief} hasPlans />);
    await user.click(screen.getByRole("button", { name: "Marquer les plans comme reçus" }));
    expect(mockResolveAffaireBriefPlanGap).toHaveBeenCalledWith({ projectId: PROJECT_ID, entryIndex: 0, expectedUpdatedAt: brief.updatedAt });
    view.rerender(<BriefDraftCard projectId={PROJECT_ID} briefDraft={{ ...brief, resolvedPlanGapIndexes: [0] }} hasPlans />);
    expect(screen.getByText(/mention historique, plans reçus/)).toBeInTheDocument();
    expect(screen.getByText("1 manquant(s)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Document associé · DPGF.pdf" })).toBeInTheDocument();
    view.rerender(<BriefDraftCard projectId={PROJECT_ID} briefDraft={{ ...brief, resolvedPlanGapIndexes: [0] }} hasPlans={false} />);
    expect(screen.getByText("2 manquant(s)")).toBeInTheDocument();
  });

  it("keeps distinct source links when the same document backs multiple brief entries", () => {
    render(
      <BriefDraftCard
        projectId={PROJECT_ID}
        briefDraft={makeBriefDraft({
          scope: ["Lot 1 - Gros oeuvre", "Lot 2 - Electricite"],
          sources: [
            {
              blockKey: "scope",
              entryIndex: 0,
              sourceDocumentId: "doc-1",
              sourceFileName: "DPGF.pdf",
              rationale: null,
            },
            {
              blockKey: "scope",
              entryIndex: 1,
              sourceDocumentId: "doc-1",
              sourceFileName: "DPGF.pdf",
              rationale: null,
            },
          ],
        })}
      />
    );

    const firstScopeItem = screen.getByText("Lot 1 - Gros oeuvre").closest("li");
    const secondScopeItem = screen.getByText("Lot 2 - Electricite").closest("li");

    expect(firstScopeItem).toBeTruthy();
    expect(secondScopeItem).toBeTruthy();

    expect(
      within(firstScopeItem!).getByRole("link", { name: "Document associé · DPGF.pdf" })
    ).toHaveAttribute(
      "href",
      `/dashboard/affaires/${PROJECT_ID}?intakeDocument=doc-1&briefBlock=scope&briefEntry=0#intake`
    );
    expect(
      within(secondScopeItem!).getByRole("link", { name: "Document associé · DPGF.pdf" })
    ).toHaveAttribute(
      "href",
      `/dashboard/affaires/${PROJECT_ID}?intakeDocument=doc-1&briefBlock=scope&briefEntry=1#intake`
    );
  });

  it("reopens confirmation explicitly when a confirmed brief is edited", async () => {
    mockUpdateAffaireBrief.mockResolvedValueOnce({
      ok: true,
      status: "a_confirmer",
    });
    const user = userEvent.setup();
    render(
      <BriefDraftCard
        projectId={PROJECT_ID}
        briefDraft={makeBriefDraft({
          status: "confirme",
          confirmedAt: "2026-03-06T09:15:00+01:00",
        })}
      />
    );
    const section = getSection();

    await user.click(within(section).getByText("Modifier"));
    expect(
      screen.getByText(/ce brief repassera à valider pour sécuriser le cadrage/i)
    ).toBeInTheDocument();
    expect(
      within(section).getByRole("button", { name: "Enregistrer et revalider" })
    ).toBeInTheDocument();

    const summaryInput = screen.getByDisplayValue("Resume du projet");
    await user.clear(summaryInput);
    await user.type(summaryInput, "Resume revalide");
    await user.click(within(section).getByRole("button", { name: "Enregistrer et revalider" }));

    expect(mockUpdateAffaireBrief).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      summary: "Resume revalide",
      scope: ["Lot 1 - Gros oeuvre", "Lot 2 - Electricite"],
      vigilancePoints: ["Point de vigilance X"],
      assumptions: ["Hypothese A"],
    });
    expect(mockToast.info).toHaveBeenCalledWith({
      title: "Brief mis à jour.",
      description: "Le brief doit être confirmé à nouveau avant la suite du chiffrage.",
    });
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
    await user.click(
      within(section).getByRole("button", { name: "Enregistrer et revalider" })
    );

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

  it("hides edit/confirm buttons when isReadOnly", () => {
    render(
      <BriefDraftCard projectId={PROJECT_ID} briefDraft={makeBriefDraft()} isReadOnly />
    );
    const section = getSection();
    expect(within(section).queryByText("Modifier")).not.toBeInTheDocument();
    expect(within(section).queryByText("Confirmer le brief")).not.toBeInTheDocument();
    expect(
      within(section).queryByText("Validation du brief requise")
    ).not.toBeInTheDocument();
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
});
