import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
const mockCreateAffaireRegisterEntryAction = vi.fn();
const mockUpdateAffaireRegisterEntryStatusAction = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  usePathname: () => "/dashboard/affaires/project-1",
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/app/dashboard/affaires/_actions/register", () => ({
  createAffaireRegisterEntryAction: (...args: unknown[]) =>
    mockCreateAffaireRegisterEntryAction(...args),
  updateAffaireRegisterEntryStatusAction: (...args: unknown[]) =>
    mockUpdateAffaireRegisterEntryStatusAction(...args),
}));

import { AffaireRegisterCard } from "@/components/affaires/AffaireRegisterCard";
import type {
  AffaireRegisterPageResult,
  AffaireRegisterSummary,
  AffaireRegisterTimelineEvent,
} from "@/lib/affaires/register";

function buildRegisterPage(
  overrides: Partial<AffaireRegisterPageResult> = {}
): AffaireRegisterPageResult {
  return {
    items: [
      {
        id: "entry-1",
        kind: "assumption",
        code: null,
        text: "Le phasage reste a confirmer.",
        severity: "warning",
        status: "open",
        originKind: "manual",
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: "Affaire test",
        versionId: null,
        sourceDocumentId: null,
        sourceFileName: "note-client.pdf",
        createdBy: null,
        createdByName: null,
        updatedBy: null,
        updatedByName: "Nadia Martin",
        createdAt: "2026-03-06T09:00:00.000Z",
        updatedAt: "2026-03-06T09:10:00.000Z",
        history: [],
      },
    ],
    nextCursor: null,
    summary: buildRegisterSummary(),
    timeline: buildTimelineEvents(),
    filters: {
      status: null,
      severity: null,
      kind: null,
      revalidationRequired: false,
      cursor: null,
      focusEntryId: null,
    },
    ...overrides,
  };
}

function buildRegisterSummary(
  overrides: Partial<AffaireRegisterSummary> = {}
): AffaireRegisterSummary {
  return {
    openQuestionsCount: 2,
    criticalOpenCount: 0,
    nonCriticalOpenCount: 1,
    clarifyWithClientCount: 1,
    openAssumptionCount: 1,
    openMissingPieceCount: 0,
    ...overrides,
  };
}

function buildTimelineEvents(
  overrides: Partial<AffaireRegisterTimelineEvent>[] = []
): AffaireRegisterTimelineEvent[] {
  return [
    {
      id: "evt-1",
      entryId: "entry-1",
      eventType: "status_changed",
      entryKind: "assumption",
      entryText: "Le phasage reste a confirmer.",
      scopeLabel: "Affaire test",
      actorUserId: "user-1",
      actorUserName: "Nadia Martin",
      comment: "Attendre le retour du client.",
      beforeStatus: "open",
      afterStatus: "clarify_with_client",
      createdAt: "2026-03-06T09:15:00.000Z",
      ...overrides[0],
    },
  ];
}

describe("AffaireRegisterCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockCreateAffaireRegisterEntryAction.mockResolvedValue({
      ok: true,
      entry: buildRegisterPage().items[0],
    });
    mockUpdateAffaireRegisterEntryStatusAction.mockResolvedValue({
      ok: true,
      entry: {
        ...buildRegisterPage().items[0],
        status: "validated",
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("updates deep-linkable filters through the URL", async () => {
    const user = userEvent.setup();

    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage()}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.selectOptions(
      screen.getByLabelText("Filtrer par sévérité"),
      "critical"
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/dashboard/affaires/project-1?registerSeverity=critical",
        { scroll: false }
      );
    });
  });

  it("creates a manual register entry from the hub form", async () => {
    const user = userEvent.setup();

    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({ items: [] })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Ajouter un point/ }));
    await user.type(
      screen.getByRole("textbox", { name: "Texte" }),
      "Vérifier le phasage chantier"
    );
    await user.click(screen.getByRole("button", { name: "Ajouter au registre" }));

    await waitFor(() => {
      expect(mockCreateAffaireRegisterEntryAction).toHaveBeenCalledWith({
        projectId: "11111111-1111-4111-8111-111111111111",
        versionId: "22222222-2222-4222-8222-222222222222",
        kind: "assumption",
        text: "Vérifier le phasage chantier",
        severity: "warning",
        scopeType: "project",
        scopeId: null,
        scopeRef: null,
        scopeLabel: null,
        sourceFileName: null,
      });
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("supports open -> clarify_with_client -> open -> validated transitions with explicit action copy", async () => {
    const user = userEvent.setup();
    const projectId = "11111111-1111-4111-8111-111111111111";
    const versionId = "22222222-2222-4222-8222-222222222222";
    mockUpdateAffaireRegisterEntryStatusAction
      .mockResolvedValueOnce({
        ok: true,
        entry: {
          ...buildRegisterPage().items[0],
          status: "clarify_with_client",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        entry: {
          ...buildRegisterPage().items[0],
          status: "open",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        entry: {
          ...buildRegisterPage().items[0],
          status: "validated",
        },
      });
    const { rerender } = render(
      <AffaireRegisterCard
        projectId={projectId}
        versionId={versionId}
        registerPage={buildRegisterPage()}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Demander un retour client/i }));
    expect(screen.getByText("Ce que cela change")).toBeInTheDocument();
    expect(
      screen.getByText("Le point remontera dans les clarifications client du registre.")
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Message de suivi (facultatif)" }),
      "À confirmer avec le client."
    );
    await user.click(
      screen.getByRole("button", { name: /Confirmer l'attente client/i })
    );

    await waitFor(() => {
      expect(mockUpdateAffaireRegisterEntryStatusAction).toHaveBeenCalledWith({
        projectId,
        versionId,
        entryId: "entry-1",
        status: "clarify_with_client",
        comment: "À confirmer avec le client.",
      });
    });

    expect(mockToast.success).toHaveBeenCalledWith({
      title: "Retour client demandé",
      description: "Le point remonte désormais dans les clarifications client.",
    });

    rerender(
      <AffaireRegisterCard
        projectId={projectId}
        versionId={versionId}
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              status: "clarify_with_client",
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Reprendre en interne/i }));
    await user.click(screen.getByRole("button", { name: /Confirmer la réouverture/i }));

    await waitFor(() => {
      expect(mockUpdateAffaireRegisterEntryStatusAction).toHaveBeenCalledWith({
        projectId,
        versionId,
        entryId: "entry-1",
        status: "open",
        comment: null,
      });
    });

    rerender(
      <AffaireRegisterCard
        projectId={projectId}
        versionId={versionId}
        registerPage={buildRegisterPage()}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Marquer comme traité/i }));
    expect(
      screen.getByText("Le point quitte les éléments ouverts du registre.")
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Marquer comme traité/i,
      })
    );

    await waitFor(() => {
      expect(mockUpdateAffaireRegisterEntryStatusAction).toHaveBeenCalledWith({
        projectId,
        versionId,
        entryId: "entry-1",
        status: "validated",
        comment: null,
      });
    });
    expect(mockToast.success).toHaveBeenCalledWith({
      title: "Point traité",
      description: "La résolution a été enregistrée dans le registre.",
    });
  });

  it("shows a fallback when the selected version has no lot or line scope", async () => {
    const user = userEvent.setup();

    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({ items: [] })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={[]}
      />
    );

    await user.click(screen.getByRole("button", { name: /Ajouter un point/ }));
    await user.type(screen.getByRole("textbox", { name: "Texte" }), "Vérifier le lot");
    await user.selectOptions(screen.getByLabelText("Scope"), "line");

    expect(
      screen.getByText("Aucune ligne disponible sur la version courante.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Ajouter au registre" })
    ).toBeDisabled();
  });

  it("renders the register summary and recent audit timeline", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage()}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={buildTimelineEvents()}
      />
    );

    expect(screen.getByText("Points ouverts")).toBeInTheDocument();
    expect(screen.getByText("À traiter avant remise")).toBeInTheDocument();
    expect(screen.getByText("Hypotheses ouvertes")).toBeInTheDocument();
    expect(screen.getByText("Contexte métier")).toBeInTheDocument();
    expect(screen.getByText("Ce point concerne toute l'affaire Affaire test.")).toBeInTheDocument();
    expect(screen.getByText("Décision à prendre")).toBeInTheDocument();
    expect(
      screen.getByText("Le point reste actif. Choisissez maintenant comment le traiter.")
    ).toBeInTheDocument();
    expect(screen.getByText("Historique récent du registre")).toBeInTheDocument();
    expect(screen.getByText("Statut modifie")).toBeInTheDocument();
    expect(screen.getByText("Attendre le retour du client.")).toBeInTheDocument();
  });

  it("renders business context tags for line and exception register entries", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-line",
              text: "Le poste reste a aligner avec la DPGF.",
              originKind: "system",
              scopeType: "line",
              scopeRef: "L-120",
              scopeLabel: "Armoire TGBT Hall",
              sourceFileName: "dpgf-cfo.xlsx",
            },
            {
              ...buildRegisterPage().items[0],
              id: "entry-exception",
              text: "L'exception SSI reste a arbitrer.",
              originKind: "manual",
              scopeType: "exception",
              scopeRef: "EX-04",
              scopeLabel: "Variante SSI hall principal",
              sourceFileName: null,
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openQuestionsCount: 2,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 2,
          clarifyWithClientCount: 0,
          openAssumptionCount: 2,
          openMissingPieceCount: 0,
        })}
        timelineEvents={[]}
      />
    );

    const lineCard = screen.getByText("Le poste reste a aligner avec la DPGF.").closest("article");
    const exceptionCard = screen
      .getByText("L'exception SSI reste a arbitrer.")
      .closest("article");

    expect(lineCard).not.toBeNull();
    expect(exceptionCard).not.toBeNull();

    expect(
      within(lineCard as HTMLElement).getByText(
        "Ce point concerne la ligne L-120 · Armoire TGBT Hall."
      )
    ).toBeInTheDocument();
    expect(
      within(lineCard as HTMLElement).getByText((_, element) =>
        element?.textContent === "Pièce liée · dpgf-cfo.xlsx"
      )
    ).toBeInTheDocument();
    expect(
      within(lineCard as HTMLElement).getByText((_, element) =>
        element?.textContent === "Créé via · Systeme"
      )
    ).toBeInTheDocument();

    expect(
      within(exceptionCard as HTMLElement).getByText(
        "Ce point concerne l'exception EX-04 · Variante SSI hall principal."
      )
    ).toBeInTheDocument();
    expect(
      within(exceptionCard as HTMLElement).getByText((_, element) =>
        element?.textContent === "Exception · EX-04 · Variante SSI hall principal"
      )
    ).toBeInTheDocument();
  });

  it("filters directly to missing-piece traces from the summary cards", async () => {
    const user = userEvent.setup();

    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage()}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openAssumptionCount: 1,
          openMissingPieceCount: 2,
        })}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Pieces manquantes suivies/i }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/dashboard/affaires/project-1?registerStatus=open&registerKind=missing_piece",
        { scroll: false }
      );
    });
  });

  it("surfaces visible submission blockers and lets the user jump to critical items", async () => {
    const user = userEvent.setup();

    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-critical",
              text: "Le DPGF principal n'est pas arbitré.",
              severity: "critical",
              status: "open",
              scopeType: "project",
              scopeLabel: "Affaire test",
              sourceFileName: "dpgf-a.xlsx",
            },
            {
              ...buildRegisterPage().items[0],
              id: "entry-client",
              text: "Variante à confirmer avec le client.",
              severity: "warning",
              status: "clarify_with_client",
              scopeType: "lot",
              scopeLabel: "Lot CFO",
              sourceFileName: "note-client.pdf",
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          criticalOpenCount: 1,
          clarifyWithClientCount: 1,
          openQuestionsCount: 1,
          nonCriticalOpenCount: 0,
        })}
        timelineEvents={buildTimelineEvents()}
      />
    );

    expect(screen.getByText("À traiter avant remise")).toBeInTheDocument();
    expect(screen.getAllByText("Le DPGF principal n'est pas arbitré.").length).toBeGreaterThan(0);
    expect(screen.getByText("Retour client requis avant envoi.")).toBeInTheDocument();
    expect(screen.getByText("Point critique ouvert à arbitrer avant remise.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Voir les critiques" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/dashboard/affaires/project-1?registerStatus=open&registerSeverity=critical",
        { scroll: false }
      );
    });
  });

  it("keeps revalidation blockers visible even without critical-open or client-clarification counts", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-revalidation",
              text: "Le nouvel additif impose une reprise ciblee.",
              severity: "warning",
              status: "open",
              revalidationRequest: {
                status: "required",
                requestedAt: "2026-03-06T10:00:00.000Z",
                requestedByUserId: null,
                previousStatus: "validated",
                cause: "addendum_received",
                triggerDocumentId: null,
                triggerFileName: "additif-cfo.pdf",
                impactedStages: ["submission_readiness"],
                comment: null,
              },
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openQuestionsCount: 1,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 1,
          clarifyWithClientCount: 0,
          revalidationRequired: true,
          revalidationRequiredCount: 1,
          revalidationBlocksSubmission: true,
          revalidationImpactedStages: ["submission_readiness"],
        })}
        timelineEvents={[]}
      />
    );

    expect(screen.getByText("À traiter avant remise")).toBeInTheDocument();
    expect(screen.getByText("Revalidation ciblee requise avant remise.")).toBeInTheDocument();
    expect(
      screen.getByText("Blocages actifs: 0 critiques ouvertes · 0 clarifications client · 1 revalidation requise.")
    ).toBeInTheDocument();
  });

  it("keeps submission blockers visible even when the current slice does not contain them", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [],
          filters: {
            status: "validated",
            severity: null,
            kind: null,
            revalidationRequired: false,
            cursor: null,
            focusEntryId: null,
          },
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          criticalOpenCount: 2,
          clarifyWithClientCount: 1,
          openQuestionsCount: 2,
          nonCriticalOpenCount: 0,
        })}
        timelineEvents={[]}
      />
    );

    expect(screen.getByText("À traiter avant remise")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Ces points bloquants ne sont pas visibles dans la vue courante. Utilisez les filtres pour les traiter en priorité."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voir les clarifications client" })).toBeInTheDocument();
  });

  it("prioritizes critical client clarifications ahead of warning ones in the preview", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-warning-1",
              text: "Clarification warning 1",
              severity: "warning",
              status: "clarify_with_client",
              updatedAt: "2026-03-06T09:13:00.000Z",
            },
            {
              ...buildRegisterPage().items[0],
              id: "entry-warning-2",
              text: "Clarification warning 2",
              severity: "warning",
              status: "clarify_with_client",
              updatedAt: "2026-03-06T09:12:00.000Z",
            },
            {
              ...buildRegisterPage().items[0],
              id: "entry-warning-3",
              text: "Clarification warning 3",
              severity: "warning",
              status: "clarify_with_client",
              updatedAt: "2026-03-06T09:11:00.000Z",
            },
            {
              ...buildRegisterPage().items[0],
              id: "entry-critical-client",
              text: "Clarification critique client",
              severity: "critical",
              status: "clarify_with_client",
              updatedAt: "2026-03-06T09:10:00.000Z",
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openQuestionsCount: 0,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 4,
          criticalClarifyWithClientCount: 1,
        })}
        timelineEvents={[]}
      />
    );

    const blockerPanel = screen
      .getByRole("heading", { name: "À traiter avant remise" })
      .closest("section");

    expect(blockerPanel).not.toBeNull();
    expect(
      within(blockerPanel as HTMLElement).getByText("Clarification critique client")
    ).toBeInTheDocument();
    expect(
      within(blockerPanel as HTMLElement).queryByText("Clarification warning 3")
    ).not.toBeInTheDocument();
  });

  it("shows a clearer filtered empty state and pagination guidance", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [],
          nextCursor: "cursor-2",
          filters: {
            status: "open",
            severity: null,
            kind: null,
            revalidationRequired: false,
            cursor: "cursor-1",
            focusEntryId: null,
          },
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={[]}
      />
    );

    expect(
      screen.getByText("Aucun point ne correspond à ces filtres.")
    ).toBeInTheDocument();
    expect(screen.getByText(/Vue paginée sur une tranche du registre/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Revenir au début" })
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Charger les points suivants" })
    ).toBeEnabled();
  });

  it("shows a loading message and local summary fallback when data is pending", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={null}
        scopeOptions={{ lots: [], lines: [] }}
      />
    );

    expect(screen.getByText("Chargement du registre…")).toBeInTheDocument();
    expect(screen.getByText("Points ouverts")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Récupération des points ouverts, avec historique récent et filtres disponibles."
      )
    ).toBeInTheDocument();
  });

  it("hides mutations when the card is read-only", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage()}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary()}
        timelineEvents={buildTimelineEvents()}
        isReadOnly
      />
    );

    expect(screen.getByText("Consultation uniquement")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter un point" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Marquer comme traité/i })
    ).not.toBeInTheDocument();
  });
});
