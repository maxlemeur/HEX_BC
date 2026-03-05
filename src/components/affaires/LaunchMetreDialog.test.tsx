import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchMetreDialog } from "./LaunchMetreDialog";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/components/takeoff/TakeoffUploadForm", () => ({
  TakeoffUploadForm: (props: Record<string, unknown>) => (
    <div data-testid="takeoff-upload-form" data-version-id={props.versionId} />
  ),
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
});
