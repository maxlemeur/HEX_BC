import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/components/approvals/ApprovalQueueStateActions", () => ({
  ApprovalQueueStateActions: function MockApprovalQueueStateActions() {
    return (
      <button type="button" data-testid="triage-actions">
        Trier
      </button>
    );
  },
}));

import { ApprovalQueueCard } from "@/components/approvals/ApprovalQueueCard";
import type { ApprovalQueueItem } from "@/lib/approvals/server";

const BASE_ITEM: ApprovalQueueItem = {
  projectId: "project-1",
  versionId: "version-1",
  cycleId: "cycle-1",
  projectName: "Affaire alpha",
  clientName: "Client test",
  versionLabel: "V3",
  amountHtCents: 120000,
  marginBp: 1450,
  riskScore: 77,
  exceptionCount: 3,
  requestAgeLabel: "il y a 2 jours",
  requestedAt: "2026-03-05T09:00:00.000Z",
  submissionMessage: null,
  commentCount: 0,
  exceptionGroups: [
    { key: "missing_proofs", label: "Preuves manquantes", count: 2 },
  ],
  visualState: "new",
  reviewerState: null,
  latestJobId: "job-1",
  syntheticAlerts: [
    {
      alertKey: "project-1:version-1:generic",
      projectId: "project-1",
      projectName: "Affaire alpha",
      versionId: "version-1",
      jobId: "job-1",
      latestJobId: "job-1",
      level: "critical",
      label: "Montant eleve avec preuves a consolider",
      reasons: ["2 preuves manquantes."],
      status: "to_process",
      alertIds: ["alert-1"],
      lotLabels: [],
    },
  ],
};

describe("ApprovalQueueCard", () => {
  it("deep-links to the supported validation review params", () => {
    render(<ApprovalQueueCard item={BASE_ITEM} />);

    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-1&from=approval&reviewMode=validation&view=dpgf&dpgfView=exceptions_only"
    );
  });

  it("keeps triage actions outside the card content link", () => {
    const { container } = render(<ApprovalQueueCard item={BASE_ITEM} />);

    expect(container.querySelector("article")).toBeTruthy();
    expect(within(container).getByTestId("triage-actions").closest("a")).toBeNull();
    expect(container.querySelector("a button")).toBeNull();
  });

  it("allows long project names to wrap without horizontal overflow", () => {
    const { container } = render(
      <ApprovalQueueCard
        item={{
          ...BASE_ITEM,
          projectName: "Restructuration hydraulique du centre hospitalier intercommunal",
        }}
      />
    );

    const title = within(container).getByRole("heading", { level: 3 });
    expect(title).toHaveClass("line-clamp-2", "break-words");
    expect(title).not.toHaveClass("truncate");
  });

  it("falls back to the synthetic alert job when the RPC latest job is missing", () => {
    const { container } = render(
      <ApprovalQueueCard
        item={{
          ...BASE_ITEM,
          latestJobId: null,
          syntheticAlerts: [
            {
              ...BASE_ITEM.syntheticAlerts[0],
              jobId: "job-2",
              latestJobId: null,
            },
          ],
        }}
      />
    );

    expect(within(container).getByRole("link")).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1/takeoff/job-2/review?versionId=version-1&from=approval&reviewMode=validation&view=dpgf&dpgfView=exceptions_only"
    );
  });

  it("falls back to the affaire hub when no exception review job can be resolved", () => {
    const { container } = render(
      <ApprovalQueueCard
        item={{
          ...BASE_ITEM,
          latestJobId: null,
          syntheticAlerts: [],
        }}
      />
    );

    expect(within(container).getByRole("link")).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1"
    );
  });

  it("shows the first synthetic alert summary when present", () => {
    render(<ApprovalQueueCard item={BASE_ITEM} />);

    expect(
      screen.getAllByText("Montant eleve avec preuves a consolider").length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("2 preuves manquantes.").length).toBeGreaterThan(0);
  });
});
