import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanCenter } from "@/components/takeoff/PlanCenter";
import type { PlanSetListItem } from "@/lib/takeoff/types";

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
  createPlanSet,
  fetchPlanSets,
} from "@/lib/takeoff/client";

const VERSION_ID = "aaaa1111-2222-4333-8444-555566667777";
const PROJECT_ID = "dddd1111-2222-4333-8444-555566667777";
const SET_A_ID = "bbbb1111-2222-4333-8444-555566667777";
const SET_B_ID = "cccc1111-2222-4333-8444-555566667777";

function makeSet(
  overrides: Partial<PlanSetListItem> & Pick<PlanSetListItem, "id" | "name">
): PlanSetListItem {
  return {
    created_at: "2026-02-25T10:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    tenant_id: "tenant-1",
    project_id: PROJECT_ID,
    estimate_version_id: VERSION_ID,
    description: null,
    metadata: {},
    created_by: null,
    file_count: 0,
    total_size_bytes: 0,
    ...overrides,
  };
}

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

  it("shows loading skeletons initially", () => {
    vi.mocked(fetchPlanSets).mockReturnValue(new Promise(() => {}));
    renderPlanCenter();
    // Skeletons use animate-pulse
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBe(3);
  });

  it("shows empty state when no sets exist", async () => {
    vi.mocked(fetchPlanSets).mockResolvedValue([]);
    renderPlanCenter();
    await waitFor(() => {
      expect(screen.getByText("Aucun jeu de plans")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: /Creer mon premier jeu de plans/i })
    ).toBeInTheDocument();
  });

  it("renders list of sets with metrics", async () => {
    vi.mocked(fetchPlanSets).mockResolvedValue([
      makeSet({ id: SET_A_ID, name: "Plans Archi", file_count: 5 }),
      makeSet({ id: SET_B_ID, name: "Plans Structure", file_count: 3 }),
    ]);
    renderPlanCenter();
    await waitFor(() => {
      expect(screen.getByText("Plans Archi")).toBeInTheDocument();
    });
    expect(screen.getByText("Plans Structure")).toBeInTheDocument();
    // Metrics bar
    expect(screen.getByText("2")).toBeInTheDocument(); // 2 jeux
    expect(screen.getByText("8")).toBeInTheDocument(); // 8 fichiers au total
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

  it("creates a set via the modal", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPlanSets).mockResolvedValue([]);
    vi.mocked(createPlanSet).mockResolvedValue(
      makeSet({ id: SET_A_ID, name: "Mon jeu" })
    );

    renderPlanCenter();
    await waitFor(() => {
      expect(screen.getByText("Aucun jeu de plans")).toBeInTheDocument();
    });

    // Open modal
    await user.click(
      screen.getByRole("button", { name: /Creer mon premier jeu de plans/i })
    );

    // Fill in form
    const nameInput = screen.getByLabelText("Nom du jeu");
    await user.type(nameInput, "Mon jeu");

    // Submit
    vi.mocked(fetchPlanSets).mockResolvedValue([
      makeSet({ id: SET_A_ID, name: "Mon jeu" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Creer" }));

    await waitFor(() => {
      expect(createPlanSet).toHaveBeenCalledWith({
        estimate_version_id: VERSION_ID,
        name: "Mon jeu",
        description: null,
      });
    });
  });
});
