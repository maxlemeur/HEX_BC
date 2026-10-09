import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const mockRefresh = vi.fn();
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
const mockSubmitEstimateForReviewAction = vi.fn();
const mockUpdateEstimateReviewCorrectionItemStatusAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/app/dashboard/_actions/estimate-approval", () => ({
  submitEstimateForReviewAction: (...args: unknown[]) =>
    mockSubmitEstimateForReviewAction(...args),
  decideEstimateApprovalAction: vi.fn(),
  updateEstimateReviewCorrectionItemStatusAction: (...args: unknown[]) =>
    mockUpdateEstimateReviewCorrectionItemStatusAction(...args),
}));

import { EstimateApprovalActions } from "@/components/estimates/EstimateApprovalActions";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";

function buildSummary(
  overrides: Partial<EstimateApprovalSummary> = {}
): EstimateApprovalSummary {
  return {
    approvalStatus: "required",
    requiresApproval: true,
    evaluatedAt: "2026-03-06T09:00:00.000Z",
    reasons: [
      {
        ruleId: "rule-1",
        label: "Seuil montant HT",
        signalKey: "total_ht_cents",
        thresholdValue: 100000,
        actualValue: 150000,
        sourceState: "ready",
        message: "Montant HT au-dessus du seuil de validation.",
        action: "require_approval",
        approvalStatus: "missing",
        approvalId: null,
        approvalCreatedAt: null,
        approvalDecidedAt: null,
      },
    ],
    latestDecision: null,
    unavailableSignals: [],
    permissions: {
      canPrepareRequest: true,
      canRequest: true,
      canDecide: false,
    },
    activeCycle: null,
    reviewHistory: [],
    availableReviewers: [
      {
        userId: "reviewer-1",
        fullName: "Nadia Martin",
        workEmail: "nadia@example.com",
      },
    ],
    submissionReadiness: {
      blockers: [],
      alerts: [
        {
          id: "warning-1",
          label: "Couverture DPGF minimum",
          message: "Une partie de la couverture reste a confirmer.",
        },
      ],
    },
    correctionChecklist: null,
    changesSinceLastCycle: null,
    commentTargets: {
      project: {
        scopeType: "project",
        scopeId: null,
        label: "Affaire test",
      },
      lots: [],
      lines: [],
      exceptions: [],
      hypotheses: [],
      approvalRules: [
        {
          scopeType: "approval_rule",
          scopeId: "rule-1",
          label: "Seuil montant HT",
        },
      ],
    },
    ...overrides,
  };
}

function buildSubmissionOverview(
  overrides: Partial<Parameters<typeof EstimateApprovalActions>[0]["submissionOverview"]> = {}
) {
  return {
    coveragePercent: 82,
    exceptionCount: 3,
    openQuestionsCount: 1,
    openAssumptionCount: 1,
    openMissingPieceCount: 0,
    clarifyWithClientCount: 1,
    marginPercent: 11.2,
    ...overrides,
  };
}

describe("EstimateApprovalActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/dashboard/affaires/project-1");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the correction checklist and keeps resubmission locked until all items are treated", async () => {
    const user = userEvent.setup();
    mockUpdateEstimateReviewCorrectionItemStatusAction.mockResolvedValue({
      itemId: "corr-1",
      status: "corrected",
      treatedAt: "2026-03-06T10:00:00.000Z",
    });

    render(
      <EstimateApprovalActions
        versionId="version-1"
        projectId="project-1"
        summary={buildSummary({
          reasons: [],
          permissions: {
            canPrepareRequest: true,
            canRequest: false,
            canDecide: false,
          },
          correctionChecklist: {
            sourceCycleId: "cycle-1",
            sourceCycleNumber: 1,
            decisionAt: "2026-03-06T09:00:00.000Z",
            totalCount: 1,
            pendingCount: 1,
            correctedCount: 0,
            toDiscussCount: 0,
            allTreated: false,
            canResubmit: false,
            items: [
              {
                id: "corr-1",
                sourceCommentId: "comment-1",
                scopeType: "line",
                scopeId: "line-1",
                scopeLabel: "1.1 - Alimentation TGBT",
                comment: "Mettre a jour l'hypothese de quantite.",
                status: "pending",
                href: "/dashboard/estimates/version-1/edit?focusItemId=line-1",
                lastTreatedAt: null,
                lastTreatedBy: null,
                lastTreatedByName: null,
                lastTreatmentNote: null,
                history: [],
              },
            ],
          },
        })}
        submissionOverview={buildSubmissionOverview()}
      />
    );

    expect(screen.getByText("Checklist de correction")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir la cible" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-1/edit?focusItemId=line-1"
    );

    await user.click(screen.getByRole("button", { name: "Marquer corrige" }));

    await waitFor(() => {
      expect(mockUpdateEstimateReviewCorrectionItemStatusAction).toHaveBeenCalledWith({
        versionId: "version-1",
        projectId: "project-1",
        itemId: "corr-1",
        status: "corrected",
      });
    });

    await user.click(screen.getByRole("button", { name: "Resoumettre" }));

    expect(screen.getByRole("button", { name: "Confirmer la resoumission" })).toBeDisabled();
    expect(
      screen.getByText("Traitez tous les items de correction avant de resoumettre.")
    ).toBeInTheDocument();
  });

  it("renders actionable fallbacks when submission metrics are unavailable", async () => {
    const user = userEvent.setup();

    render(
      <EstimateApprovalActions
        versionId="version-1"
        projectId="project-1"
        summary={buildSummary()}
        submissionOverview={buildSubmissionOverview({
          coveragePercent: null,
          exceptionCount: null,
          openAssumptionCount: null,
          openMissingPieceCount: null,
          clarifyWithClientCount: null,
          marginPercent: null,
        })}
      />
    );

    await user.click(screen.getByRole("button", { name: "Soumettre a validation" }));

    const takeoffLinks = screen.getAllByRole("link", { name: "Ouvrir Plans & metres" });
    expect(takeoffLinks).toHaveLength(2);
    expect(takeoffLinks[0]).toHaveAttribute("href", "/dashboard/affaires/project-1/takeoff");
    expect(
      screen.getByRole("link", { name: "Ouvrir le registre" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1?registerStatus=open");
    expect(screen.getByRole("link", { name: "Ouvrir le devis" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-1/edit"
    );
  });
});
