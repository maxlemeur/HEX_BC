import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchPreparedTakeoffFromPlanSetAction: vi.fn(),
  launchPreparedTakeoffFromSourceVersionPlanSetAction: vi.fn(),
}));

vi.mock("@/components/feedback/toast-provider", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/components/takeoff/PlanFileUploadZone", () => ({
  PlanFileUploadZone: ({ setId, onUploadsComplete }: { setId: string; onUploadsComplete?: (summary: { uploadedCount: number; uploadedSizeBytes: number }) => void }) => (
    <div data-testid="plan-upload-zone">
      {setId}
      <button type="button" onClick={() => onUploadsComplete?.({ uploadedCount: 1, uploadedSizeBytes: 2048 })}>Envoi terminé</button>
    </div>
  ),
}));

const { launchDialogMock } = vi.hoisted(() => ({ launchDialogMock: vi.fn() }));
vi.mock("@/components/affaires/LaunchMetreDialog", () => ({
  LaunchMetreDialog: (props: { open: boolean }) => {
    launchDialogMock(props);
    return props.open ? <div role="dialog" aria-label="Préparer le métré" /> : null;
  },
}));

vi.mock("@/components/navigation/NavigationFeedback", () => ({
  NavigationLink: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) =>
    <a href={href} className={className}>{children}</a>,
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

  // After the plans of the import are sent: before the automatic start is active, the step launches on the draft the
  // import just created and the plan set that received the files, as it always did; once active (or when the activation
  // could not be read), it leads to the affaire's takeoff zone and launches nothing.
  describe("after the plans are sent", () => {
    const PLAN_FILE = { id: "plan-file-1", file_name: "Plan RDC.pdf", file_type: "application/pdf", page_count: 1, file_size_bytes: 2048 };
    async function sendPlans(takeoffLaunchActive: boolean | null) {
      fetchPlanSetsForProjectMock.mockResolvedValue([{ ...EXISTING_PLAN_SET, file_count: 0, total_size_bytes: 0,
        metadata: { source: "import-flow", default_import_plan_set: true } }]);
      fetchPlanFilesMock.mockResolvedValue([PLAN_FILE]);
      render(<PlansStep projectId={PROJECT_ID} versionId={VERSION_ID} onSkip={vi.fn()} onContinue={vi.fn()}
        takeoffLaunchActive={takeoffLaunchActive} />);
      await userEvent.setup().click(await screen.findByRole("button", { name: "Envoi terminé" }));
      await screen.findByText(/1 fichier uploade/);
    }

    it("launches on the import's own draft and plan set before the automatic start is active", async () => {
      await sendPlans(false);
      await userEvent.setup().click(screen.getByRole("button", { name: "Préparer le métré" }));
      expect(screen.getByRole("dialog", { name: "Préparer le métré" })).toBeInTheDocument();
      const props = launchDialogMock.mock.lastCall?.[0] as Record<string, unknown>;
      expect(props).toMatchObject({
        open: true, projectId: PROJECT_ID,
        currentVersion: { id: VERSION_ID, status: "draft", versionNumber: 0 },
        availableVersions: [{ id: VERSION_ID, versionNumber: 0 }],
        availablePlanSets: [{ id: EXISTING_PLAN_SET.id, name: "Plans import", fileCount: 1 }],
        initialPlanSetId: EXISTING_PLAN_SET.id,
        plansContext: expect.objectContaining({ defaultPlanSetId: EXISTING_PLAN_SET.id, defaultPlanSetFileCount: 1 }),
      });
      // A launch on that draft: never the mode of a request, never a copy of another version.
      expect(props.launchMode).toBeUndefined();
      expect(screen.queryByRole("link", { name: "Voir l’état du métré" })).not.toBeInTheDocument();
    });

    it.each([["once the automatic start is active", true], ["when the activation could not be read", null]] as const)(
      "leads to the affaire's takeoff zone and launches nothing %s", async (_case, active) => {
        await sendPlans(active);
        expect(screen.getByRole("link", { name: "Voir l’état du métré" })).toHaveAttribute("href",
          `/dashboard/affaires/${PROJECT_ID}?view=overview#metre`);
        expect(screen.queryByRole("button", { name: "Préparer le métré" })).not.toBeInTheDocument();
      });
  });
});
