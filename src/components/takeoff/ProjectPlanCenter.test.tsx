import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const useSWRMock = vi.hoisted(() => vi.fn());

vi.mock("swr", () => ({
  default: useSWRMock,
}));

vi.mock(
  "@/app/dashboard/affaires/[projectId]/plans/_actions/plan-sets",
  () => ({
    createPlanSetAction: vi.fn(),
    deletePlanSetAction: vi.fn(),
  })
);

vi.mock("@/components/takeoff/PlanSetCard", () => ({
  PlanSetCard: ({ planSet }: { planSet: { name: string } }) => (
    <article>{planSet.name}</article>
  ),
}));

vi.mock("@/components/takeoff/PlanSetFormModal", () => ({
  PlanSetFormModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Nouveau jeu de plans</div> : null,
}));

vi.mock("@/lib/takeoff/client", () => ({
  fetchPlanSetsForProject: vi.fn(),
  isTakeoffApiError: () => false,
}));

import { ProjectPlanCenter } from "@/components/takeoff/ProjectPlanCenter";
import type { PlanSetListItem } from "@/lib/takeoff/types";

const PROJECT_ID = "project-1";

const PLAN_SET: PlanSetListItem = {
  id: "plan-set-1",
  created_at: "2026-07-10T08:00:00.000Z",
  updated_at: "2026-07-10T08:00:00.000Z",
  tenant_id: "tenant-1",
  project_id: PROJECT_ID,
  estimate_version_id: null,
  name: "Plans architecte",
  description: null,
  metadata: {},
  created_by: null,
  file_count: 2,
  total_size_bytes: 2048,
};

function mockPlanSetsState(input: {
  data?: PlanSetListItem[];
  error?: unknown;
  isLoading?: boolean;
}) {
  useSWRMock.mockReturnValue({
    data: input.data,
    error: input.error,
    isLoading: input.isLoading ?? false,
    mutate: vi.fn(),
  });
}

describe("ProjectPlanCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders one creation action in the empty state", async () => {
    const user = userEvent.setup();
    mockPlanSetsState({ data: [] });

    render(<ProjectPlanCenter projectId={PROJECT_ID} />);

    expect(
      screen.getByText(/regroupe vos fichiers PDF pour le métré/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/commencez par en créer un/i)).toBeInTheDocument();

    const creationActions = screen.getAllByRole("button", {
      name: /créer.*jeu de plans/i,
    });
    expect(creationActions).toHaveLength(1);
    expect(creationActions[0]).toHaveAccessibleName(
      "Créer mon premier jeu de plans"
    );

    await user.click(creationActions[0]);
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Nouveau jeu de plans"
    );
  });

  it("uses compact mobile spacing and a full-width empty-state action", () => {
    mockPlanSetsState({ data: [] });

    render(<ProjectPlanCenter projectId={PROJECT_ID} />);

    const creationAction = screen.getByRole("button", {
      name: "Créer mon premier jeu de plans",
    });
    expect(creationAction).toHaveClass("w-full", "sm:w-auto");
    expect(creationAction.closest(".dashboard-card")).toHaveClass(
      "px-4",
      "py-10",
      "sm:px-6",
      "sm:py-16"
    );
  });

  it("keeps one responsive creation action when plan sets already exist", () => {
    mockPlanSetsState({ data: [PLAN_SET] });

    render(<ProjectPlanCenter projectId={PROJECT_ID} />);

    const creationAction = screen.getByRole("button", {
      name: "Créer un jeu de plans",
    });
    expect(creationAction).toHaveClass("w-full", "sm:w-auto");
    expect(
      screen.queryByRole("button", {
        name: "Créer mon premier jeu de plans",
      })
    ).not.toBeInTheDocument();
    expect(screen.getByText("Plans architecte")).toBeInTheDocument();
  });

  it("renders the accented retry action in the error state", () => {
    mockPlanSetsState({ error: new Error("network") });

    render(<ProjectPlanCenter projectId={PROJECT_ID} />);

    expect(
      screen.getByRole("button", { name: "Réessayer" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /créer.*jeu de plans/i })
    ).not.toBeInTheDocument();
  });
});
