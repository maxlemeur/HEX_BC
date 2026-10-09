import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const {
  createPlanSetMock,
  fetchPlanFilesMock,
  fetchPlanSetsForProjectMock,
} = vi.hoisted(() => ({
  createPlanSetMock: vi.fn(),
  fetchPlanFilesMock: vi.fn(),
  fetchPlanSetsForProjectMock: vi.fn(),
}));

vi.mock("@/lib/takeoff/client", () => ({
  createPlanSet: createPlanSetMock,
  fetchPlanFiles: fetchPlanFilesMock,
  fetchPlanSetsForProject: fetchPlanSetsForProjectMock,
}));

const useTakeoffAutoProposeDismissedMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useTakeoffAutoProposeDismissed", () => ({
  useTakeoffAutoProposeDismissed: useTakeoffAutoProposeDismissedMock,
}));

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchTakeoffFromPlanSet: vi.fn(),
}));

vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/components/takeoff/PlanFileUploadZone", () => ({
  PlanFileUploadZone: ({
    setId,
    onUploadsComplete,
    onUploadActivityChange,
  }: {
    setId: string;
    onUploadsComplete: (summary: { uploadedCount: number; uploadedSizeBytes: number }) => void;
    onUploadActivityChange?: (isActive: boolean) => void;
  }) => (
    <div>
      <div data-testid="plan-upload-zone">{setId}</div>
      <button type="button" onClick={() => onUploadActivityChange?.(true)}>
        Demarrer upload
      </button>
      <button
        type="button"
        onClick={() => {
          onUploadActivityChange?.(false);
          onUploadsComplete({ uploadedCount: 2, uploadedSizeBytes: 3200 });
        }}
      >
        Terminer upload
      </button>
    </div>
  ),
}));

import { PlansStep } from "@/components/affaires/PlansStep";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

const EXISTING_PLAN_SET = {
  id: "plan-set-existing",
  created_at: "2026-03-06T09:00:00.000Z",
  updated_at: "2026-03-06T10:00:00.000Z",
  tenant_id: "tenant-1",
  project_id: PROJECT_ID,
  estimate_version_id: VERSION_ID,
  name: "Plans import",
  description: null,
  metadata: {},
  created_by: null,
  file_count: 1,
  total_size_bytes: 1000,
};

const CREATED_PLAN_SET = {
  ...EXISTING_PLAN_SET,
  id: "plan-set-created",
  file_count: 0,
  total_size_bytes: 0,
};

describe("PlansStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPlanFilesMock.mockResolvedValue([]);
    useTakeoffAutoProposeDismissedMock.mockReturnValue({
      dismissed: false,
      temporarilyDismissed: false,
      dismissPermanently: vi.fn(),
      dismissTemporarily: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("prefers a version-scoped marked import set over a newer project-scoped one", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([
      {
        ...EXISTING_PLAN_SET,
        id: "plan-set-version-scoped",
        updated_at: "2026-03-06T10:00:00.000Z",
        metadata: {
          source: "import-flow",
          default_import_plan_set: true,
        },
      },
      {
        ...EXISTING_PLAN_SET,
        id: "plan-set-project-scoped",
        estimate_version_id: null,
        updated_at: "2026-03-06T11:00:00.000Z",
        metadata: {
          source: "affaire-intake",
          default_import_plan_set: true,
        },
      },
    ]);

    render(
      <PlansStep
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
        onSkip={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Plans import")).toBeInTheDocument();
    });

    expect(createPlanSetMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("plan-upload-zone")).toHaveTextContent(
      "plan-set-version-scoped"
    );
  });

  it("keeps a local fallback counter when the refresh fails", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([EXISTING_PLAN_SET]);
    fetchPlanFilesMock.mockRejectedValue(new Error("fetch failed"));

    render(
      <PlansStep
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
        onSkip={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Plans import")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Terminer upload" }));

    await waitFor(() => {
      expect(screen.getByText(/2 fichiers uploades/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Le compteur affiche une estimation locale.*section Plans/i)
    ).toBeInTheDocument();
  });

  it("creates a canonical import set when duplicate named sets already exist", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([
      EXISTING_PLAN_SET,
      {
        ...EXISTING_PLAN_SET,
        id: "plan-set-duplicate",
        updated_at: "2026-03-06T11:00:00.000Z",
      },
    ]);
    createPlanSetMock.mockResolvedValue(CREATED_PLAN_SET);

    render(
      <PlansStep
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
        onSkip={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(createPlanSetMock).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        estimate_version_id: VERSION_ID,
        name: "Plans import",
        metadata: {
          source: "import-flow",
          default_import_plan_set: true,
        },
      });
    });
  });

  it("retries preparing the plan set after an initial loading error", async () => {
    fetchPlanSetsForProjectMock
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce([]);
    createPlanSetMock.mockResolvedValue(CREATED_PLAN_SET);

    render(
      <PlansStep
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
        onSkip={vi.fn()}
        onContinue={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("temporary failure");
    });

    fireEvent.click(screen.getByRole("button", { name: "Reessayer" }));

    await waitFor(() => {
      expect(createPlanSetMock).toHaveBeenCalledWith({
        project_id: PROJECT_ID,
        estimate_version_id: VERSION_ID,
        name: "Plans import",
        metadata: {
          source: "import-flow",
          default_import_plan_set: true,
        },
      });
    });

    expect(screen.getByTestId("plan-upload-zone")).toHaveTextContent(
      CREATED_PLAN_SET.id
    );
  });
});
