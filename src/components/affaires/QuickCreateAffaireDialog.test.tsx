import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { quickCreateAffaireMock, useUiModeMock } = vi.hoisted(() => ({
  quickCreateAffaireMock: vi.fn(),
  useUiModeMock: vi.fn(),
}));

vi.mock("@/app/dashboard/affaires/_actions/quick-create-affaire", () => ({
  quickCreateAffaire: quickCreateAffaireMock,
}));

vi.mock("@/hooks/useUiMode", () => ({
  useUiMode: useUiModeMock,
}));

import { QuickCreateAffaireDialog } from "@/components/affaires/QuickCreateAffaireDialog";

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function buildMappingsUrl(importId: string) {
  const params = new URLSearchParams({
    import_id: importId,
    limit: "1",
  });

  return `/api/mappings?${params.toString()}`;
}

describe("QuickCreateAffaireDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiModeMock.mockReturnValue({
      mode: "expert",
      setMode: vi.fn(),
      isExpert: true,
      isSimplified: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("exposes only completed, unlinked and mapping-ready imports", async () => {
    const readyImportId = "11111111-1111-4111-8111-111111111111";
    const notMappedImportId = "22222222-2222-4222-8222-222222222222";

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);

      if (url === "/api/imports") {
        return jsonResponse({
          ok: true,
          data: [
            {
              id: readyImportId,
              filename: "ready.xlsx",
              status: "completed",
              project_id: null,
              row_count: 12,
            },
            {
              id: notMappedImportId,
              filename: "not-mapped.xlsx",
              status: "completed",
              project_id: null,
              row_count: 9,
            },
            {
              id: "33333333-3333-4333-8333-333333333333",
              filename: "already-linked.xlsx",
              status: "completed",
              project_id: "44444444-4444-4444-8444-444444444444",
              row_count: 4,
            },
          ],
        });
      }

      if (url === buildMappingsUrl(readyImportId)) {
        return jsonResponse({
          ok: true,
          data: {
            mappings: [{ id: "mapping-1" }],
          },
        });
      }

      if (url === buildMappingsUrl(notMappedImportId)) {
        return jsonResponse({
          ok: true,
          data: {
            mappings: [],
          },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <QuickCreateAffaireDialog
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await user.click(screen.getByText("Import DPGF (optionnel)"));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "ready.xlsx (12 lignes)" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("option", { name: /not-mapped.xlsx/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /already-linked.xlsx/i })).not.toBeInTheDocument();
  });

  it("blocks submit when selected import is no longer mapping-ready", async () => {
    const importId = "55555555-5555-4555-8555-555555555555";
    let mappingChecks = 0;

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);

      if (url === "/api/imports") {
        return jsonResponse({
          ok: true,
          data: [
            {
              id: importId,
              filename: "stale.xlsx",
              status: "completed",
              project_id: null,
              row_count: 6,
            },
          ],
        });
      }

      if (url === buildMappingsUrl(importId)) {
        mappingChecks += 1;
        if (mappingChecks === 1) {
          return jsonResponse({
            ok: true,
            data: {
              mappings: [{ id: "mapping-1" }],
            },
          });
        }

        return jsonResponse({
          ok: true,
          data: {
            mappings: [],
          },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(
      <QuickCreateAffaireDialog
        open={true}
        onOpenChange={vi.fn()}
      />
    );

    await user.click(screen.getByText("Import DPGF (optionnel)"));

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "stale.xlsx (6 lignes)" })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText("Nom du projet *"), "Affaire test");
    await user.selectOptions(screen.getByLabelText("Import disponible"), importId);
    await user.click(screen.getByRole("button", { name: "Creer l'affaire" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Cet import n['’]est pas pret pour la creation rapide\. Finalisez le mapping puis reessayez\./i
      );
    });

    expect(quickCreateAffaireMock).not.toHaveBeenCalled();
  });
});
