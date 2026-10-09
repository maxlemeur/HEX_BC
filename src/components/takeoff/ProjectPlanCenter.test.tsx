import { act,cleanup,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

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
  PlanSetCard: ({
    planSet,
    launchHref,
    launchLabel,
  }: {
    planSet: { name: string };
    launchHref?: string;
    launchLabel?: string;
  }) => (
    <article>
      {planSet.name}
      {launchHref ? <a href={launchHref}>{launchLabel}</a> : null}
    </article>
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
    vi.useRealTimers();
    cleanup();
  });

  it("explains a slow load instead of leaving an unlabeled skeleton", () => {
    vi.useFakeTimers();
    mockPlanSetsState({ isLoading: true });

    render(<ProjectPlanCenter projectId={PROJECT_ID} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Chargement des jeux de plans"
    );

    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Le chargement prend plus de temps que prévu"
    );
  });
});
