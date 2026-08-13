import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlanSetCard } from "@/components/takeoff/PlanSetCard";
import type { PlanFileListItem, PlanSetListItem } from "@/lib/takeoff/types";

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
  deletePlanFile,
  deletePlanSet,
  fetchPlanFiles,
} from "@/lib/takeoff/client";

const VERSION_ID = "aaaa1111-2222-4333-8444-555566667777";
const PROJECT_ID = "dddd1111-2222-4333-8444-555566667777";
const SET_ID = "bbbb1111-2222-4333-8444-555566667777";
const FILE_ID = "cccc1111-2222-4333-8444-555566667777";

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

function makePlanFile(
  overrides: Partial<PlanFileListItem> = {}
): PlanFileListItem {
  return {
    id: FILE_ID,
    created_at: "2026-02-25T10:00:00.000Z",
    updated_at: "2026-02-25T10:00:00.000Z",
    tenant_id: "tenant-1",
    plan_set_id: SET_ID,
    file_path: "path/to/file.pdf",
    file_name: "plan-01.pdf",
    file_type: "application/pdf",
    file_size_bytes: 2_500_000,
    page_count: 12,
    file_hash: null,
    metadata: {},
    created_by: null,
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

/** Get the accordion toggle button (the one with aria-expanded). */
function getToggleButton() {
  const buttons = screen.getAllByRole("button");
  const toggle = buttons.find((btn) => btn.hasAttribute("aria-expanded"));
  if (!toggle) throw new Error("Toggle button not found");
  return toggle;
}

describe("PlanSetCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders set name and file count", () => {
    renderCard();
    expect(screen.getByText("Plans Archi")).toBeInTheDocument();
    expect(screen.getAllByText("2 plans")).toHaveLength(2);
  });

  it("shows description when present", () => {
    renderCard();
    expect(screen.getByText("Lot 01")).toBeInTheDocument();
  });

  it("expands to show files on click", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPlanFiles).mockResolvedValue([makePlanFile()]);

    renderCard();

    const toggle = getToggleButton();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await waitFor(() => {
      expect(screen.getByText("plan-01.pdf")).toBeInTheDocument();
    });
  });

  it("collapses on second click", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPlanFiles).mockResolvedValue([]);

    renderCard();

    const toggle = getToggleButton();
    await user.click(toggle); // expand
    await user.click(toggle); // collapse

    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows delete set confirmation modal", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    vi.mocked(deletePlanSet).mockResolvedValue({
      deleted: true,
      plan_set_id: SET_ID,
    });

    renderCard(makePlanSet(), onDeleted);

    // Click delete icon
    const deleteBtn = screen.getByRole("button", {
      name: /Supprimer le jeu "Plans Archi"/i,
    });
    await user.click(deleteBtn);

    // Confirm modal appears
    expect(
      screen.getByText(/Etes-vous sur de vouloir supprimer/i)
    ).toBeInTheDocument();

    // Confirm deletion
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(deletePlanSet).toHaveBeenCalledWith(SET_ID);
    });

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it("updates a plan set from the inline edit form", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            plan_set: makePlanSet({
              name: "Plans Archi v2",
              description: "Lot 01 - revision",
            }),
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { onUpdated } = renderCard();

    await user.click(
      screen.getByRole("button", { name: /Modifier le jeu "Plans Archi"/i })
    );

    const nameInput = screen.getByLabelText("Nom du jeu");
    await user.clear(nameInput);
    await user.type(nameInput, "Plans Archi v2");

    const descriptionInput = screen.getByLabelText("Description (optionnel)");
    await user.clear(descriptionInput);
    await user.type(descriptionInput, "Lot 01 - revision");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/takeoff/plan-sets/${encodeURIComponent(SET_ID)}`,
        expect.objectContaining({
          method: "PATCH",
        })
      );
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit).toBeDefined();
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      name: "Plans Archi v2",
      description: "Lot 01 - revision",
    });

    await waitFor(() => {
      expect(onUpdated).toHaveBeenCalledTimes(1);
    });
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

  it("shows delete file confirmation modal", async () => {
    const user = userEvent.setup();
    const onFilesChanged = vi.fn();
    vi.mocked(fetchPlanFiles).mockResolvedValue([makePlanFile()]);
    vi.mocked(deletePlanFile).mockResolvedValue({
      deleted: true,
      plan_set_id: SET_ID,
      file_id: FILE_ID,
    });

    renderCard(makePlanSet(), vi.fn(), onFilesChanged);

    // Expand card
    await user.click(getToggleButton());

    await waitFor(() => {
      expect(screen.getByText("plan-01.pdf")).toBeInTheDocument();
    });

    // Click delete file
    const deleteFileBtn = screen.getByRole("button", {
      name: /Supprimer plan-01.pdf/i,
    });
    await user.click(deleteFileBtn);

    // Confirm modal
    expect(
      screen.getByText(/Etes-vous sur de vouloir supprimer ce fichier/i)
    ).toBeInTheDocument();

    // Confirm
    vi.mocked(fetchPlanFiles).mockResolvedValue([]);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => {
      expect(deletePlanFile).toHaveBeenCalledWith(SET_ID, FILE_ID);
    });

    await waitFor(() => {
      expect(onFilesChanged).toHaveBeenCalled();
    });
  });

  it("shows extraction link when files exist", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPlanFiles).mockResolvedValue([makePlanFile()]);

    renderCard();

    await user.click(getToggleButton());

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: /Lancer l'extraction/i })
      ).toBeInTheDocument();
    });
  });

  it("links a project plan set directly to the canonical launch flow", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchPlanFiles).mockResolvedValue([makePlanFile()]);

    render(
      <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
        <PlanSetCard
          planSet={makePlanSet({ estimate_version_id: null })}
          versionId={null}
          launchHref={`/dashboard/affaires/${PROJECT_ID}/takeoff?launch=1&launchPlanSet=${SET_ID}`}
          launchLabel="Analyser ce jeu"
          onDeleted={vi.fn()}
          onFilesChanged={vi.fn()}
          onUpdated={vi.fn()}
        />
      </SWRConfig>,
    );

    await user.click(getToggleButton());

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Analyser ce jeu" }),
      ).toHaveAttribute(
        "href",
        `/dashboard/affaires/${PROJECT_ID}/takeoff?launch=1&launchPlanSet=${SET_ID}`,
      );
    });
  });
});
