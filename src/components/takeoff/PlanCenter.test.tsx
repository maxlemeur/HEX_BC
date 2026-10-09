import { cleanup,render,screen,waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { PlanCenter } from "@/components/takeoff/PlanCenter";

vi.mock("@/lib/takeoff/client", () => ({
  isTakeoffApiError: (e: unknown) =>
    e instanceof Error && "status" in e,
  fetchPlanSets: vi.fn(),
  createPlanSet: vi.fn(),
  deletePlanSet: vi.fn(),
  fetchPlanFiles: vi.fn(),
  registerPlanFile: vi.fn(),
  uploadFileToSignedUrl: vi.fn(),
  deletePlanFile: vi.fn(),
}));

import {
fetchPlanSets
} from "@/lib/takeoff/client";

const VERSION_ID = "aaaa1111-2222-4333-8444-555566667777";

function renderPlanCenter() {
  return render(
    <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
      <PlanCenter versionId={VERSION_ID} />
    </SWRConfig>
  );
}

describe("PlanCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows error state with retry button", async () => {
    vi.mocked(fetchPlanSets).mockRejectedValue(new Error("Network error"));
    renderPlanCenter();
    await waitFor(() => {
      expect(
        screen.getByText("Impossible de charger les jeux de plans.")
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /Reessayer/i })
    ).toBeInTheDocument();
  });
});
