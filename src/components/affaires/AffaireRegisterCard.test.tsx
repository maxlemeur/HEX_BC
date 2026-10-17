import { cleanup,render,screen,waitFor,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const mockReplace = vi.fn();
const mockRefresh = vi.fn();
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
const mockContinueAffaireRegisterWithHypothesisAction = vi.fn();
const mockCreateAffaireRegisterEntryAction = vi.fn();
const mockFetchAffaireRegisterReviewExportAction = vi.fn();
const mockRequestAffaireRegisterRevalidationAction = vi.fn();
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

vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/app/dashboard/affaires/_actions/register", () => ({
  continueAffaireRegisterWithHypothesisAction: (...args: unknown[]) =>
    mockContinueAffaireRegisterWithHypothesisAction(...args),
  createAffaireRegisterEntryAction: (...args: unknown[]) =>
    mockCreateAffaireRegisterEntryAction(...args),
  fetchAffaireRegisterReviewExportAction: (...args: unknown[]) =>
    mockFetchAffaireRegisterReviewExportAction(...args),
  requestAffaireRegisterRevalidationAction: (...args: unknown[]) =>
    mockRequestAffaireRegisterRevalidationAction(...args),
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
    mockContinueAffaireRegisterWithHypothesisAction.mockResolvedValue({
      ok: true,
      entry: {
        ...buildRegisterPage().items[0],
        kind: "missing_piece",
        continuationDecision: {
          status: "accepted_with_hypothesis",
          comment: "Budget provisoire maintenu.",
          decidedAt: "2026-03-06T09:20:00.000Z",
          decidedByUserId: "user-1",
        },
      },
    });
    mockRequestAffaireRegisterRevalidationAction.mockResolvedValue({
      ok: true,
      entry: {
        ...buildRegisterPage().items[0],
        status: "open",
        revalidationRequest: {
          status: "required",
          requestedAt: "2026-03-06T09:30:00.000Z",
          requestedByUserId: "user-1",
          previousStatus: "validated",
          cause: "addendum_received",
          triggerDocumentId: null,
          triggerFileName: "additif-cfo.pdf",
          impactedStages: ["document_review", "submission_readiness"],
          comment: "Revoir le lot CFO apres additif.",
        },
      },
    });
    mockFetchAffaireRegisterReviewExportAction.mockResolvedValue({
      generatedAt: "2026-03-14T11:00:00.000Z",
      projectId: "11111111-1111-4111-8111-111111111111",
      projectLabel: "Affaire test",
      projectReference: "AFF-TEST",
      clientName: "Client test",
      versionId: "22222222-2222-4222-8222-222222222222",
      capabilities: {
        explicitExclusions: "supported",
        supportedEntryKinds: ["assumption", "missing_piece"],
      },
      summary: {
        rowCount: 2,
        criticalCount: 0,
        blockingCount: 0,
        clarificationCount: 0,
        revalidationCount: 0,
        hypothesisCount: 1,
        exclusionCount: 1,
        missingPieceCount: 0,
      },
      groups: [],
      reviewNote: "Revue interne registre - Affaire test\n",
      csvFilename: "registre-revue-aff-test.csv",
      csvContent: "section;type\n",
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

  it("requests a targeted revalidation from a resolved entry", async () => {
    const user = userEvent.setup({ delay: null });
    const projectId = "11111111-1111-4111-8111-111111111111";
    const versionId = "22222222-2222-4222-8222-222222222222";

    render(
      <AffaireRegisterCard
        projectId={projectId}
        versionId={versionId}
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-resolved",
              kind: "missing_piece",
              text: "Le lot CFO etait considere comme boucle.",
              status: "validated",
              severity: "critical",
              code: "missing_dpgf",
              sourceFileName: "dpgf-cfo.pdf",
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openQuestionsCount: 0,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 0,
          openAssumptionCount: 0,
          openMissingPieceCount: 0,
        })}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Demander une revalidation/i }));

    expect(screen.getByText("Ce que cela change")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Utilisez cette action quand un additif ou une pièce critique reçue tardivement rouvre ce point. La revalidation reste ciblee sur les étapes declarees."
      )
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Cause de revalidation")).toHaveValue("addendum_received");
    expect(
      screen.getByLabelText("Pièce ou additif déclenchant (facultatif)")
    ).toHaveValue("");

    await user.selectOptions(screen.getByLabelText("Cause de revalidation"), "late_critical_piece");
    await user.clear(
      screen.getByLabelText("Pièce ou additif déclenchant (facultatif)")
    );
    // Pasted, not typed: one re-render of the card per key passed the 5 s
    // default on loaded CI runners (17/10/2026). The payload is what counts.
    await user.paste("additif-cfo.pdf");
    await user.click(
      screen.getByRole("textbox", { name: "Consigne de reprise (facultative)" })
    );
    await user.paste("Relancer uniquement la revue documentaire et la readiness.");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Confirmer la revalidation/i,
      })
    );

    await waitFor(() => {
      expect(mockRequestAffaireRegisterRevalidationAction).toHaveBeenCalledWith({
        projectId,
        versionId,
        entryId: "entry-resolved",
        cause: "late_critical_piece",
        impactedStages: ["document_review", "submission_readiness"],
        triggerDocumentId: null,
        triggerFileName: "additif-cfo.pdf",
        comment: "Relancer uniquement la revue documentaire et la readiness.",
      });
    });
    expect(mockUpdateAffaireRegisterEntryStatusAction).not.toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: "entry-resolved",
      })
    );
    expect(mockToast.success).toHaveBeenCalledWith({
      title: "Revalidation tracee",
      description:
        "La reouverture ciblee a été enregistrée sans reset global du dossier.",
    });
  });

  it("defaults missing CCTP revalidations to document review without copying the original source file", async () => {
    const user = userEvent.setup();
    const projectId = "11111111-1111-4111-8111-111111111111";
    const versionId = "22222222-2222-4222-8222-222222222222";

    render(
      <AffaireRegisterCard
        projectId={projectId}
        versionId={versionId}
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-cctp",
              kind: "missing_piece",
              text: "Le CCTP du lot CFO etait considere comme recu.",
              status: "validated",
              severity: "warning",
              code: "missing_cctp",
              sourceFileName: "cctp-cfo-initial.pdf",
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openQuestionsCount: 0,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 0,
          openAssumptionCount: 0,
          openMissingPieceCount: 0,
        })}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Demander une revalidation/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Confirmer la revalidation/i,
      })
    );

    await waitFor(() => {
      expect(mockRequestAffaireRegisterRevalidationAction).toHaveBeenCalledWith({
        projectId,
        versionId,
        entryId: "entry-cctp",
        cause: "addendum_received",
        impactedStages: ["document_review", "submission_readiness"],
        triggerDocumentId: null,
        triggerFileName: null,
        comment: null,
      });
    });
  });

  it("defaults exception-scoped revalidations to exceptions review", async () => {
    const user = userEvent.setup();
    const projectId = "11111111-1111-4111-8111-111111111111";
    const versionId = "22222222-2222-4222-8222-222222222222";

    render(
      <AffaireRegisterCard
        projectId={projectId}
        versionId={versionId}
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-exception-revalidation",
              kind: "assumption",
              text: "La variante SSI avait ete cloturee apres arbitrage.",
              status: "validated",
              severity: "warning",
              scopeType: "exception",
              scopeRef: "EX-09",
              scopeLabel: "Variante SSI hall principal",
              sourceFileName: null,
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openQuestionsCount: 0,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 0,
          openAssumptionCount: 0,
          openMissingPieceCount: 0,
        })}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Demander une revalidation/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /Confirmer la revalidation/i,
      })
    );

    await waitFor(() => {
      expect(mockRequestAffaireRegisterRevalidationAction).toHaveBeenCalledWith({
        projectId,
        versionId,
        entryId: "entry-exception-revalidation",
        cause: "addendum_received",
        impactedStages: ["exceptions_review", "submission_readiness"],
        triggerDocumentId: null,
        triggerFileName: null,
        comment: null,
      });
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

  it("surfaces continued-under-hypothesis state on missing-piece cards after refresh", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-missing-piece-continued",
              kind: "missing_piece",
              text: "Le CCTP CFO reste manquant pour verifier les quantites finales.",
              severity: "critical",
              sourceFileName: "brief-client.pdf",
              continuationDecision: {
                status: "accepted_with_hypothesis",
                hypothesisEntryId: "33333333-3333-4333-8333-333333333333",
                hypothesisText:
                  "Continuation acceptee sans CCTP CFO. Hypothese documentaire a confirmer avant remise.",
                acceptedAt: "2026-03-06T09:20:00.000Z",
                acceptedByUserId: "11111111-1111-4111-8111-111111111111",
                comment: "Budget provisoire maintenu jusqu'a reception du CCTP.",
              },
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openQuestionsCount: 1,
          criticalOpenCount: 1,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 0,
          openAssumptionCount: 0,
          openMissingPieceCount: 1,
        })}
        timelineEvents={buildTimelineEvents()}
      />
    );

    expect(screen.getByText("Ouverte · continuation sous hypothèse")).toBeInTheDocument();
    expect(screen.getByText("Continuation acceptée sous hypothèse")).toBeInTheDocument();
    expect(screen.getByText("Hypothèse active")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Continuation acceptee sans CCTP CFO. Hypothese documentaire a confirmer avant remise."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continuer avec hypothèse/i })).not.toBeInTheDocument();
  });

  it("distinguishes true submission blockers from client follow-ups and links to the exact slice", async () => {
    const user = userEvent.setup();

    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-missing-piece",
              kind: "missing_piece",
              text: "Le DPGF principal reste manquant.",
              severity: "critical",
              status: "open",
              sourceFileName: "dpgf-a.xlsx",
              businessImpact: [
                "affects_hub_readiness",
                "blocks_submission",
                "affects_structure_generation",
              ],
            },
            {
              ...buildRegisterPage().items[0],
              id: "entry-client-follow-up",
              kind: "assumption",
              text: "Le phasage doit etre confirme avec le client.",
              severity: "warning",
              status: "clarify_with_client",
              businessImpact: ["affects_hub_readiness", "requires_client_answer"],
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          criticalOpenCount: 1,
          clarifyWithClientCount: 1,
          openQuestionsCount: 1,
          nonCriticalOpenCount: 0,
          openAssumptionCount: 0,
          openMissingPieceCount: 1,
        })}
        timelineEvents={buildTimelineEvents()}
      />
    );

    expect(screen.getByText("Bloque la remise")).toBeInTheDocument();
    expect(screen.getByText("Réponse client attendue")).toBeInTheDocument();
    expect(
      screen.getByText("Ce point bloque la remise tant qu'il reste ouvert.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Pour debloquer: ajouter la pièce attendue ou requalifier ce manque.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("La suite dépend encore d'un retour client explicite.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Voir les pièces manquantes" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/dashboard/affaires/project-1?registerStatus=open&registerSeverity=critical&registerKind=missing_piece",
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
    expect(
      screen.getByText("Une nouvelle revue ciblee est requise avant remise.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Blocages actifs: 0 critiques ouvertes · 0 clarifications client · 1 revalidation requise.")
    ).toBeInTheDocument();
    expect(screen.getByText("Ouverte · revalidation requise")).toBeInTheDocument();
    expect(screen.getByText("Trace de revalidation")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cause : Additif reçu · Étapes à revoir : Readiness pré-remise · Pièce déclenchante : additif-cfo.pdf"
      )
    ).toBeInTheDocument();
  });

  it("links hidden revalidation blockers back to the revalidation slice", async () => {
    const user = userEvent.setup();

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
          openQuestionsCount: 0,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 0,
          revalidationRequired: true,
          revalidationRequiredCount: 2,
          revalidationBlocksSubmission: true,
          revalidationImpactedStages: ["submission_readiness"],
        })}
        timelineEvents={[]}
      />
    );

    expect(screen.getByRole("button", { name: "Voir les revalidations" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Voir les revalidations" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/dashboard/affaires/project-1?registerRevalidation=required",
        { scroll: false }
      );
    });
  });

  it("clears the revalidation filter when switching back to standard blockers", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams("registerRevalidation=required");

    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          filters: {
            status: null,
            severity: null,
            kind: null,
            revalidationRequired: true,
            cursor: null,
            focusEntryId: null,
          },
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          criticalOpenCount: 1,
          clarifyWithClientCount: 1,
          revalidationRequired: true,
          revalidationRequiredCount: 1,
          revalidationBlocksSubmission: true,
        })}
        timelineEvents={buildTimelineEvents()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Voir les critiques" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        "/dashboard/affaires/project-1?registerStatus=open&registerSeverity=critical",
        { scroll: false }
      );
    });
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

  it("keeps the hidden-blocker hint when only revalidation rows are visible", () => {
    render(
      <AffaireRegisterCard
        projectId="11111111-1111-4111-8111-111111111111"
        versionId="22222222-2222-4222-8222-222222222222"
        registerPage={buildRegisterPage({
          items: [
            {
              ...buildRegisterPage().items[0],
              id: "entry-revalidation-critical",
              text: "Le DPGF relance une revue critique.",
              severity: "critical",
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
            {
              ...buildRegisterPage().items[0],
              id: "entry-revalidation-warning-1",
              text: "Le lot CFO doit etre revu apres additif.",
              severity: "warning",
              status: "open",
              revalidationRequest: {
                status: "required",
                requestedAt: "2026-03-06T10:01:00.000Z",
                requestedByUserId: null,
                previousStatus: "validated",
                cause: "addendum_received",
                triggerDocumentId: null,
                triggerFileName: "additif-cfo.pdf",
                impactedStages: ["submission_readiness"],
                comment: null,
              },
            },
            {
              ...buildRegisterPage().items[0],
              id: "entry-revalidation-warning-2",
              text: "La variante SSI doit etre rejouee.",
              severity: "warning",
              status: "open",
              revalidationRequest: {
                status: "required",
                requestedAt: "2026-03-06T10:02:00.000Z",
                requestedByUserId: null,
                previousStatus: "validated",
                cause: "late_critical_piece",
                triggerDocumentId: null,
                triggerFileName: "note-ssi.pdf",
                impactedStages: ["submission_readiness"],
                comment: null,
              },
            },
          ],
        })}
        scopeOptions={{ lots: [], lines: [] }}
        summary={buildRegisterSummary({
          openQuestionsCount: 0,
          criticalOpenCount: 1,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 0,
          revalidationRequired: true,
          revalidationRequiredCount: 3,
          revalidationBlocksSubmission: true,
          revalidationImpactedStages: ["submission_readiness"],
        })}
        timelineEvents={[]}
      />
    );

    expect(
      screen.getByText(
        "D'autres points bloquants existent sur cette vue ou une autre tranche du registre."
      )
    ).toBeInTheDocument();
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
