import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
      screen.getByLabelText("Filtrer par severite"),
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

    await user.type(
      screen.getByRole("textbox", { name: "Texte" }),
      "Verifier le phasage chantier"
    );
    await user.click(screen.getByRole("button", { name: "Ajouter au registre" }));

    await waitFor(() => {
      expect(mockCreateAffaireRegisterEntryAction).toHaveBeenCalledWith({
        projectId: "11111111-1111-4111-8111-111111111111",
        versionId: "22222222-2222-4222-8222-222222222222",
        kind: "assumption",
        text: "Verifier le phasage chantier",
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

  it("supports open -> clarify_with_client -> open -> validated transitions", async () => {
    const user = userEvent.setup();
    const projectId = "11111111-1111-4111-8111-111111111111";
    const versionId = "22222222-2222-4222-8222-222222222222";
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

    await user.click(screen.getByRole("button", { name: "A clarifier avec client" }));
    await user.type(
      screen.getByRole("textbox", { name: "Commentaire de trace (facultatif)" }),
      "A confirmer avec le client."
    );
    await user.click(
      screen.getByRole("button", { name: "Confirmer la clarification client" })
    );

    await waitFor(() => {
      expect(mockUpdateAffaireRegisterEntryStatusAction).toHaveBeenCalledWith({
        projectId,
        versionId,
        entryId: "entry-1",
        status: "clarify_with_client",
        comment: "A confirmer avec le client.",
      });
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

    await user.click(screen.getByRole("button", { name: "Rouvrir" }));
    await user.click(screen.getByRole("button", { name: "Confirmer la reouverture" }));

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

    await user.click(screen.getByRole("button", { name: "Valider" }));
    await user.click(screen.getByRole("button", { name: "Confirmer la validation" }));

    await waitFor(() => {
      expect(mockUpdateAffaireRegisterEntryStatusAction).toHaveBeenCalledWith({
        projectId,
        versionId,
        entryId: "entry-1",
        status: "validated",
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

    await user.type(screen.getByRole("textbox", { name: "Texte" }), "Verifier le lot");
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
    expect(screen.getByText("Historique recent du registre")).toBeInTheDocument();
    expect(screen.getByText("Statut modifie")).toBeInTheDocument();
    expect(screen.getByText("Attendre le retour du client.")).toBeInTheDocument();
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
      screen.getByText("Aucun point ne correspond a ces filtres.")
    ).toBeInTheDocument();
    expect(screen.getByText(/Vue paginee sur une tranche du registre/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Revenir au debut" })
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
    expect(screen.getByText("Recuperation des points ouverts, avec historique recent et filtres disponibles.")).toBeInTheDocument();
  });
});
