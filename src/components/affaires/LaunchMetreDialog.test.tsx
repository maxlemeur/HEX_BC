import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchMetreDialog } from "./LaunchMetreDialog";

const launchTakeoffFromPlanSetMock = vi.hoisted(() => vi.fn());
const duplicateEstimateVersionMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchTakeoffFromPlanSet: launchTakeoffFromPlanSetMock,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/estimates/client", () => ({
  duplicateEstimateVersion: duplicateEstimateVersionMock,
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: "proj-1",
  currentVersion: {
    id: "draft-v1",
    status: "draft",
    versionNumber: 3,
  },
  plansContext: {
    defaultPlanSetId: "plan-set-1",
    defaultPlanSetName: "Plans import",
    defaultPlanSetFileCount: 5,
    launchRecommendation: {
      documentClass: "tabular_pdf" as const,
      recommendedLevel: "B" as const,
      compatibleLevels: ["B", "C"] as Array<"B" | "C">,
      recommendationStrength: "high" as const,
      warningCode: null,
      warningMessage: null,
      signals: {
        mimeType: "application/pdf",
        extension: "pdf",
        fileCount: 5,
        totalPageCount: 2,
        matchedTableHints: ["dpgf"],
        matchedPlanHints: [],
      },
    },
  },
};

describe("LaunchMetreDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders contextual launch information", () => {
    render(<LaunchMetreDialog {...defaultProps} />);

    expect(screen.getByText("Analyser les plans")).toBeInTheDocument();
    expect(screen.getByText("Plans import")).toBeInTheDocument();
    expect(screen.getByText("V3 (brouillon)")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Rapide" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Detaille" })).toBeInTheDocument();
  });

  it("does not render content when closed", () => {
    render(<LaunchMetreDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("launches directly on the draft version", async () => {
    const user = userEvent.setup();
    launchTakeoffFromPlanSetMock.mockResolvedValue({ jobId: "job-1" });

    render(<LaunchMetreDialog {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: "Analyser maintenant" }));

    await waitFor(() => {
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        planSetId: "plan-set-1",
        versionId: "draft-v1",
        level: "B",
      });
    });

    expect(toastSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Analyse lancee",
        durationMs: 6000,
      }),
    );
    expect(screen.getByText("Analyse lancee avec succes")).toBeInTheDocument();
  });

  it("creates a draft first when the current version is not a draft", async () => {
    const user = userEvent.setup();
    duplicateEstimateVersionMock.mockResolvedValue("draft-v2");
    launchTakeoffFromPlanSetMock.mockResolvedValue({ jobId: "job-1" });

    render(
      <LaunchMetreDialog
        {...defaultProps}
        currentVersion={{
          id: "version-sent",
          status: "sent",
          versionNumber: 4,
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Creer un brouillon et analyser" }),
    );

    await waitFor(() => {
      expect(duplicateEstimateVersionMock).toHaveBeenCalledWith("version-sent");
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith({
        projectId: "proj-1",
        planSetId: "plan-set-1",
        versionId: "draft-v2",
        level: "B",
      });
    });
  });

  it("reuses the duplicated draft when retrying after a launch failure", async () => {
    const user = userEvent.setup();
    duplicateEstimateVersionMock.mockResolvedValue("draft-v2");
    launchTakeoffFromPlanSetMock
      .mockRejectedValueOnce(new Error("launch failed"))
      .mockResolvedValueOnce({ jobId: "job-2" });

    render(
      <LaunchMetreDialog
        {...defaultProps}
        currentVersion={{
          id: "version-sent",
          status: "sent",
          versionNumber: 4,
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Creer un brouillon et analyser" }),
    );

    await waitFor(() => {
      expect(screen.getByText("launch failed")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Creer un brouillon et analyser" }),
    );

    await waitFor(() => {
      expect(launchTakeoffFromPlanSetMock).toHaveBeenNthCalledWith(2, {
        projectId: "proj-1",
        planSetId: "plan-set-1",
        versionId: "draft-v2",
        level: "B",
      });
    });

    expect(duplicateEstimateVersionMock).toHaveBeenCalledTimes(1);
  });

  it("shows a create-version CTA when no version exists", () => {
    render(
      <LaunchMetreDialog
        {...defaultProps}
        currentVersion={null}
      />,
    );

    expect(screen.getByText(/Creez d'abord une premiere version/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Creer une premiere version/i }),
    ).toHaveAttribute("href", "/dashboard/estimates/new?projectId=proj-1");
  });
});
