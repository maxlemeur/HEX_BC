import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("LaunchMetreDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders TakeoffUploadForm when draftVersionId is provided", () => {
    render(
      <LaunchMetreDialog
        open
        onOpenChange={vi.fn()}
        projectId="proj-1"
        draftVersionId="draft-v1"
        hasAnyVersion
      />
    );

    expect(screen.getByTestId("takeoff-upload-form")).toBeInTheDocument();
    expect(screen.getByTestId("takeoff-upload-form")).toHaveAttribute(
      "data-version-id",
      "draft-v1"
    );
  });

  it("shows non-draft message when draftVersionId is null but versions exist", () => {
    render(
      <LaunchMetreDialog
        open
        onOpenChange={vi.fn()}
        projectId="proj-1"
        draftVersionId={null}
        hasAnyVersion
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
        open
        onOpenChange={vi.fn()}
        projectId="proj-1"
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
    render(
      <LaunchMetreDialog
        open={false}
        onOpenChange={vi.fn()}
        projectId="proj-1"
        draftVersionId="draft-v1"
        hasAnyVersion
      />
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prevents closing while upload is in progress", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <LaunchMetreDialog
        open
        onOpenChange={onOpenChange}
        projectId="proj-1"
        draftVersionId="draft-v1"
        hasAnyVersion
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

  it("closes and redirects after a successful launch", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <LaunchMetreDialog
        open
        onOpenChange={onOpenChange}
        projectId="proj-1"
        draftVersionId="draft-v1"
        hasAnyVersion
      />
    );

    await user.click(screen.getByRole("button", { name: "Trigger Success" }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: "Extraction lancee",
      description: "Redirection vers les extractions...",
    });
    expect(pushMock).toHaveBeenCalledWith("/dashboard/affaires/proj-1/takeoff");
  });
});
