import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchMetreDialog } from "./LaunchMetreDialog";

const pushMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: vi.fn(),
  }),
}));

vi.mock("@/components/takeoff/TakeoffUploadForm", () => ({
  TakeoffUploadForm: (props: Record<string, unknown>) => {
    const versionId = typeof props.versionId === "string" ? props.versionId : "";
    const onSubmittingChange =
      typeof props.onSubmittingChange === "function"
        ? (props.onSubmittingChange as (isSubmitting: boolean) => void)
        : null;
    const onSuccess =
      typeof props.onSuccess === "function" ? (props.onSuccess as () => void) : null;

    return (
      <div data-testid="takeoff-upload-form" data-version-id={versionId}>
        <button type="button" onClick={() => onSubmittingChange?.(true)}>
          Start Upload
        </button>
        <button type="button" onClick={() => onSubmittingChange?.(false)}>
          Stop Upload
        </button>
        <button type="button" onClick={() => onSuccess?.()}>
          Trigger Success
        </button>
      </div>
    );
  },
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: "proj-1",
  draftVersionId: "draft-v1" as string | null,
  hasAnyVersion: true,
  plansSummary: { planSetCount: 2, planFileCount: 5 },
  versionLabel: "V3 (brouillon)",
};

describe("LaunchMetreDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders dialog with title 'Analyser les plans'", () => {
    render(<LaunchMetreDialog {...defaultProps} />);
    expect(screen.getByText("Analyser les plans")).toBeInTheDocument();
  });

  it("renders TakeoffUploadForm when draftVersionId is provided", () => {
    render(<LaunchMetreDialog {...defaultProps} />);

    expect(screen.getByTestId("takeoff-upload-form")).toBeInTheDocument();
    expect(screen.getByTestId("takeoff-upload-form")).toHaveAttribute(
      "data-version-id",
      "draft-v1"
    );
  });

  it("shows non-draft message when draftVersionId is null but versions exist", () => {
    render(
      <LaunchMetreDialog
        {...defaultProps}
        draftVersionId={null}
      />
    );

    expect(
      screen.getByText("La version courante n'est pas un brouillon.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Creer une nouvelle version/i })
    ).toHaveAttribute("href", "/dashboard/estimates/new?projectId=proj-1");
  });

  it("shows no-version message when no versions exist", () => {
    render(
      <LaunchMetreDialog
        {...defaultProps}
        draftVersionId={null}
        hasAnyVersion={false}
      />
    );

    expect(
      screen.getByText("Aucune version trouvee.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Creer une premiere version/i })
    ).toHaveAttribute("href", "/dashboard/estimates/new?projectId=proj-1");
  });

  it("does not render content when closed", () => {
    render(<LaunchMetreDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prevents closing while upload is in progress", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <LaunchMetreDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Start Upload" }));

    const closeButton = screen.getByRole("button", { name: /fermer/i });
    expect(closeButton).toBeDisabled();

    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      preventDefault: () => undefined,
    });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows success state with navigation buttons after a successful launch", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <LaunchMetreDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Trigger Success" }));

    // Should NOT auto-close the dialog
    expect(onOpenChange).not.toHaveBeenCalled();

    // Should show success state
    expect(screen.getByText("Analyse lancee avec succes")).toBeInTheDocument();

    // Should show enriched toast
    expect(toastSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Analyse lancee",
        durationMs: 6000,
      })
    );
    expect(toastSuccessMock.mock.calls[0][0].description).toContain("V3 (brouillon)");
    expect(toastSuccessMock.mock.calls[0][0].description).toContain("5 fichier(s)");

    // Should show two navigation buttons
    expect(
      screen.getByRole("button", { name: "Rester sur le hub" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Centre d'activite/i })
    ).toHaveAttribute("href", "/dashboard/affaires/proj-1/takeoff");
  });

  it("closes dialog when 'Rester sur le hub' is clicked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <LaunchMetreDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Trigger Success" }));
    await user.click(screen.getByRole("button", { name: "Rester sur le hub" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("resets the success state when the parent reopens the dialog", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <LaunchMetreDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Trigger Success" }));
    expect(screen.getByText("Analyse lancee avec succes")).toBeInTheDocument();

    rerender(
      <LaunchMetreDialog
        {...defaultProps}
        open={false}
        onOpenChange={onOpenChange}
      />
    );

    rerender(
      <LaunchMetreDialog
        {...defaultProps}
        open
        onOpenChange={onOpenChange}
      />
    );

    expect(screen.queryByText("Analyse lancee avec succes")).not.toBeInTheDocument();
    expect(screen.getByTestId("takeoff-upload-form")).toBeInTheDocument();
  });

  it("renders business-friendly analysis level labels", () => {
    render(<LaunchMetreDialog {...defaultProps} />);

    expect(screen.getByText("Rapide")).toBeInTheDocument();
    expect(screen.getByText("Standard")).toBeInTheDocument();
    expect(screen.getByText("Detaille")).toBeInTheDocument();
  });

  it("has Standard and Detaille levels disabled", () => {
    render(<LaunchMetreDialog {...defaultProps} />);

    const radios = screen.getAllByRole("radio");
    // Rapide is checked and enabled
    expect(radios[0]).toBeChecked();
    expect(radios[0]).not.toBeDisabled();
    // Standard and Detaille are disabled
    expect(radios[1]).toBeDisabled();
    expect(radios[2]).toBeDisabled();
  });

  it("shows '(bientot)' text on disabled analysis levels", () => {
    render(<LaunchMetreDialog {...defaultProps} />);

    const bientotLabels = screen.getAllByText("(bientot)");
    expect(bientotLabels).toHaveLength(2);
  });

  it("displays plan summary info when provided", () => {
    render(<LaunchMetreDialog {...defaultProps} />);

    expect(screen.getByText(/5 fichier\(s\) dans 2 jeu\(x\)/)).toBeInTheDocument();
  });

  it("displays version label with check icon", () => {
    render(<LaunchMetreDialog {...defaultProps} />);

    expect(screen.getByText("V3 (brouillon)")).toBeInTheDocument();
    expect(screen.getByText("Version cible")).toBeInTheDocument();
  });

  it("success state has aria-live region for screen readers", async () => {
    const user = userEvent.setup();

    render(<LaunchMetreDialog {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: "Trigger Success" }));

    const liveRegion = screen.getByText("Analyse lancee avec succes").closest("[aria-live]");
    expect(liveRegion).toHaveAttribute("aria-live", "polite");
  });
});
