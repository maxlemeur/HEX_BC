import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { PlanSetCard } from "@/components/takeoff/PlanSetCard";
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


const VERSION_ID = "aaaa1111-2222-4333-8444-555566667777";
const PROJECT_ID = "dddd1111-2222-4333-8444-555566667777";
const SET_ID = "bbbb1111-2222-4333-8444-555566667777";

function makePlanSet(
  overrides: Partial<PlanSetListItem> = {}
): PlanSetListItem {
  return {
    id: SET_ID,
    created_at: "2026-02-25T10:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    tenant_id: "tenant-1",
    project_id: PROJECT_ID,
    estimate_version_id: VERSION_ID,
    name: "Plans Archi",
    description: "Lot 01",
    metadata: {},
    created_by: null,
    file_count: 2,
    total_size_bytes: 0,
    ...overrides,
  };
}

function renderCard(
  planSet = makePlanSet(),
  onDeleted = vi.fn(),
  onFilesChanged = vi.fn(),
  onUpdated = vi.fn()
) {
  return {
    onDeleted,
    onFilesChanged,
    onUpdated,
    ...render(
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <PlanSetCard
          planSet={planSet}
          versionId={VERSION_ID}
          onDeleted={onDeleted}
          onFilesChanged={onFilesChanged}
          onUpdated={onUpdated}
        />
      </SWRConfig>
    ),
  };
}

describe("PlanSetCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows API error when update set fails", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            message: "Nom deja utilise.",
          },
        }),
        {
          status: 409,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderCard();

    await user.click(
      screen.getByRole("button", { name: /Modifier le jeu "Plans Archi"/i })
    );
    const nameInput = screen.getByLabelText("Nom du jeu");
    await user.clear(nameInput);
    await user.type(nameInput, "Set en conflit");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Nom deja utilise.");
    });
  });
});
