import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
};
const mockSubmitEstimateForReviewAction = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/app/dashboard/_actions/estimate-approval", () => ({
  submitEstimateForReviewAction: (...args: unknown[]) =>
    mockSubmitEstimateForReviewAction(...args),
  decideEstimateApprovalAction: vi.fn(),
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
    commentTargets: {
      project: {
        scopeType: "project",
        scopeId: null,
        label: "Affaire test",
      },
      lots: [],
      lines: [],
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

describe("EstimateApprovalActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders blockers in the submission panel and disables confirmation", async () => {
    const user = userEvent.setup();

    render(
      <EstimateApprovalActions
        versionId="version-1"
        projectId="project-1"
        summary={buildSummary({
          submissionReadiness: {
            blockers: [
              {
                id: "blocker-1",
                label: "Marge minimum",
                message: "La marge est en dessous du minimum autorise.",
              },
            ],
            alerts: [],
          },
        })}
        submissionOverview={{
          coveragePercent: 82,
          exceptionCount: 3,
          openQuestionsCount: 1,
          marginPercent: 11.2,
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Soumettre a validation" }));

    expect(screen.getByText("La marge est en dessous du minimum autorise.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirmer la soumission" })
    ).toBeDisabled();
  });

  it("submits the version with reviewer and context message", async () => {
    const user = userEvent.setup();
    mockSubmitEstimateForReviewAction.mockResolvedValue({
      cycle: {
        id: "cycle-1",
        cycleNumber: 1,
        requestedAt: "2026-03-06T09:10:00.000Z",
        submissionMessage: "Verifier en priorite les exceptions CFO.",
        assignedReviewer: {
          userId: "reviewer-1",
          fullName: "Nadia Martin",
          workEmail: "nadia@example.com",
        },
      },
      requestedApprovalCount: 1,
      requestedRuleIds: ["rule-1"],
    });

    render(
      <EstimateApprovalActions
        versionId="version-1"
        projectId="project-1"
        summary={buildSummary()}
        submissionOverview={{
          coveragePercent: 82,
          exceptionCount: 3,
          openQuestionsCount: 1,
          marginPercent: 11.2,
        }}
      />
    );

    await user.click(screen.getByRole("button", { name: "Soumettre a validation" }));
    await user.type(
      screen.getByLabelText(/Message de contexte/i),
      "Verifier en priorite les exceptions CFO."
    );
    await user.click(screen.getByRole("button", { name: "Confirmer la soumission" }));

    await waitFor(() => {
      expect(mockSubmitEstimateForReviewAction).toHaveBeenCalledWith({
        versionId: "version-1",
        projectId: "project-1",
        ruleIds: ["rule-1"],
        submissionMessage: "Verifier en priorite les exceptions CFO.",
        assignedReviewerUserId: "reviewer-1",
      });
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalled();
  });
});
