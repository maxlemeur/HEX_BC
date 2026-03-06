import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  afterEach(() => {
    cleanup();
  });

  it("reuses the existing import plan set for the project", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([EXISTING_PLAN_SET]);

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

    expect(fetchPlanSetsForProjectMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(createPlanSetMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("plan-upload-zone")).toHaveTextContent(
      EXISTING_PLAN_SET.id
    );
  });

  it("creates the default import plan set when none exists yet", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([]);
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

    expect(screen.getByTestId("plan-upload-zone")).toHaveTextContent(
      CREATED_PLAN_SET.id
    );
  });

  it("refreshes the uploaded counter from server data after completion", async () => {
    fetchPlanSetsForProjectMock.mockResolvedValue([EXISTING_PLAN_SET]);
    fetchPlanFilesMock.mockResolvedValue([
      {
        id: "file-1",
        created_at: "2026-03-06T09:00:00.000Z",
        updated_at: "2026-03-06T09:00:00.000Z",
        tenant_id: "tenant-1",
        plan_set_id: EXISTING_PLAN_SET.id,
        file_path: "plans/a.pdf",
        file_name: "a.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1000,
        page_count: null,
        file_hash: null,
        metadata: {},
        created_by: null,
      },
      {
        id: "file-2",
        created_at: "2026-03-06T09:10:00.000Z",
        updated_at: "2026-03-06T09:10:00.000Z",
        tenant_id: "tenant-1",
        plan_set_id: EXISTING_PLAN_SET.id,
        file_path: "plans/b.pdf",
        file_name: "b.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1500,
        page_count: null,
        file_hash: null,
        metadata: {},
        created_by: null,
      },
      {
        id: "file-3",
        created_at: "2026-03-06T09:20:00.000Z",
        updated_at: "2026-03-06T09:20:00.000Z",
        tenant_id: "tenant-1",
        plan_set_id: EXISTING_PLAN_SET.id,
        file_path: "plans/c.pdf",
        file_name: "c.pdf",
        file_type: "application/pdf",
        file_size_bytes: 1700,
        page_count: null,
        file_hash: null,
        metadata: {},
        created_by: null,
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

    fireEvent.click(screen.getByRole("button", { name: "Terminer upload" }));

    await waitFor(() => {
      expect(fetchPlanFilesMock).toHaveBeenCalledWith(EXISTING_PLAN_SET.id);
    });

    expect(screen.getByText(/2 fichiers uploades/i)).toBeInTheDocument();
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
