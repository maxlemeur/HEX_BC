import { cleanup,render,screen,waitFor } from "@testing-library/react";
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
  launchPreparedTakeoffFromPlanSetAction: vi.fn(),
  launchPreparedTakeoffFromSourceVersionPlanSetAction: vi.fn(),
}));

vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/components/takeoff/PlanFileUploadZone", () => ({
  PlanFileUploadZone: ({ setId }: { setId: string }) => (
    <div data-testid="plan-upload-zone">{setId}</div>
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
  estimate_version_id: null,
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
  it("prefers the project-scoped set over historical version sets", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([
      {
        ...EXISTING_PLAN_SET,
        id: "plan-set-version-scoped",
        estimate_version_id: VERSION_ID,
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
      "plan-set-project-scoped"
    );
  });

  it("creates an affair-wide set when only a historical version set exists", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([
      { ...EXISTING_PLAN_SET, estimate_version_id: VERSION_ID, metadata: { source: "import-flow", default_import_plan_set: true } },
      { ...EXISTING_PLAN_SET, id: "older", estimate_version_id: "33333333-3333-4333-8333-333333333333", metadata: { source: "import-flow", default_import_plan_set: true } },
    ]);
    createPlanSetMock.mockResolvedValue(CREATED_PLAN_SET);
    render(<PlansStep projectId={PROJECT_ID} versionId={VERSION_ID} onSkip={vi.fn()} onContinue={vi.fn()} />);
    expect(await screen.findByTestId("plan-upload-zone")).toHaveTextContent("plan-set-created");
    expect(createPlanSetMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the populated set when an earlier duplicate left an empty set", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([
      { ...EXISTING_PLAN_SET, id: "populated", metadata: { source: "import-flow", default_import_plan_set: true } },
      { ...CREATED_PLAN_SET, id: "empty", updated_at: "2026-03-06T11:00:00.000Z", metadata: { source: "import-flow", default_import_plan_set: true } },
    ]);
    render(<PlansStep projectId={PROJECT_ID} versionId={VERSION_ID} onSkip={vi.fn()} onContinue={vi.fn()} />);
    expect(await screen.findByTestId("plan-upload-zone")).toHaveTextContent("populated");
    expect(createPlanSetMock).not.toHaveBeenCalled();
  });
});
