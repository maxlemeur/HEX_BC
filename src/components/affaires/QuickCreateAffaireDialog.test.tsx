import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { quickCreateAffaireMock, routerPushMock, useImportFlowMock, useUiModeMock } = vi.hoisted(() => ({
  quickCreateAffaireMock: vi.fn(),
  routerPushMock: vi.fn(),
  useImportFlowMock: vi.fn(),
  useUiModeMock: vi.fn(),
}));

vi.mock("@/app/dashboard/affaires/_actions/quick-create-affaire", () => ({
  quickCreateAffaire: quickCreateAffaireMock,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("@/hooks/useImportFlow", () => ({
  useImportFlow: useImportFlowMock,
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
    useImportFlowMock.mockReturnValue({
      imports: [],
      importFile: vi.fn().mockResolvedValue(false),
      lastImportId: null,
    });
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
    await user.click(screen.getByRole("button", { name: "Import existant" }));

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
    await user.click(screen.getByRole("button", { name: "Import existant" }));

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

  it("handles upload-flow redirect without unhandled rejection by pushing route", async () => {
    const importId = "66666666-6666-4666-8666-666666666666";
    const importFileMock = vi.fn().mockResolvedValue(true);
    useImportFlowMock.mockReturnValue({
      imports: [{ id: importId, status: "parsed" }],
      importFile: importFileMock,
      lastImportId: importId,
    });
    useUiModeMock.mockReturnValue({
      mode: "simplified",
      setMode: vi.fn(),
      isExpert: false,
      isSimplified: true,
    });

    const redirectError = new Error("NEXT_REDIRECT");
    (redirectError as Error & { digest?: string }).digest =
      "NEXT_REDIRECT;replace;/dashboard/affaires/created?created=1;false";
    quickCreateAffaireMock.mockRejectedValue(redirectError);

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/mappings") {
        return jsonResponse({
          data: {
            suggestions: { designation: "description" },
            auto_validation: { can_auto_validate: true },
          },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const unhandledRejections: unknown[] = [];
    const unhandledHandler = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
      event.preventDefault();
    };
    window.addEventListener("unhandledrejection", unhandledHandler);

    try {
      const user = userEvent.setup();
      render(
        <QuickCreateAffaireDialog
          open={true}
          onOpenChange={vi.fn()}
        />
      );

      const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");
      expect(fileInput).not.toBeNull();
      await user.upload(
        fileInput!,
        new File(["designation;quantite\nposte;1"], "dpgf.csv", { type: "text/csv" }),
      );
      await user.type(screen.getByLabelText("Nom du projet *"), "Affaire redirect");
      await user.click(screen.getByRole("button", { name: "Creer l'affaire" }));

      await waitFor(() => {
        expect(routerPushMock).toHaveBeenCalledWith(
          "/dashboard/affaires/created?created=1",
        );
      });
      expect(unhandledRejections).toEqual([]);
    } finally {
      window.removeEventListener("unhandledrejection", unhandledHandler);
    }
  });

  it("keeps uploaded import linked in low-confidence upload flow", async () => {
    const importId = "67676767-6767-4676-8676-676767676767";
    const importFileMock = vi.fn().mockResolvedValue(true);
    quickCreateAffaireMock.mockResolvedValue(undefined);
    useImportFlowMock.mockReturnValue({
      imports: [{ id: importId, status: "parsed" }],
      importFile: importFileMock,
      lastImportId: importId,
    });
    useUiModeMock.mockReturnValue({
      mode: "simplified",
      setMode: vi.fn(),
      isExpert: false,
      isSimplified: true,
    });

    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === "/api/mappings") {
        return jsonResponse({
          data: {
            suggestions: {},
            auto_validation: { can_auto_validate: false },
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

    const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).not.toBeNull();
    await user.upload(
      fileInput!,
      new File(["designation;quantite\nposte;1"], "dpgf.csv", { type: "text/csv" }),
    );
    await user.type(screen.getByLabelText("Nom du projet *"), "Affaire faible confiance");
    await user.click(screen.getByRole("button", { name: "Creer l'affaire" }));

    await waitFor(() => {
      expect(quickCreateAffaireMock).toHaveBeenCalledWith(
        expect.objectContaining({
          importId: null,
          linkImportId: importId,
        }),
      );
    });
  });

  it("fails fast when parsing import cannot be found after upload", async () => {
    const realSetTimeout = window.setTimeout;
    const setTimeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation(
      ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const delay = timeout === 12000 ? 1 : timeout;
        return realSetTimeout(handler, delay, ...args);
      }) as typeof window.setTimeout,
    );

    try {
      const importId = "77777777-7777-4777-8777-777777777777";
      const importFileMock = vi.fn().mockResolvedValue(true);
      useImportFlowMock.mockReturnValue({
        imports: [],
        importFile: importFileMock,
        lastImportId: importId,
      });
      useUiModeMock.mockReturnValue({
        mode: "simplified",
        setMode: vi.fn(),
        isExpert: false,
        isSimplified: true,
      });

      render(
        <QuickCreateAffaireDialog
          open={true}
          onOpenChange={vi.fn()}
        />
      );

      const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");
      expect(fileInput).not.toBeNull();
      fireEvent.change(fileInput!, {
        target: {
          files: [
            new File(["designation;quantite\nposte;1"], "dpgf.csv", {
              type: "text/csv",
            }),
          ],
        },
      });
      fireEvent.change(screen.getByLabelText("Nom du projet *"), {
        target: { value: "Affaire timeout" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Creer l'affaire" }));

      await waitFor(() => {
        expect(screen.getByText("Analyse du fichier\u2026")).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(
          /Import introuvable apres l['’]upload\. Veuillez reessayer\./i,
        );
      });
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("does not close on Escape while busy during upload", async () => {
    const neverResolvingImport = new Promise<boolean>(() => undefined);
    const importFileMock = vi.fn().mockReturnValue(neverResolvingImport);
    const onOpenChange = vi.fn();

    useImportFlowMock.mockReturnValue({
      imports: [],
      importFile: importFileMock,
      lastImportId: null,
    });
    useUiModeMock.mockReturnValue({
      mode: "simplified",
      setMode: vi.fn(),
      isExpert: false,
      isSimplified: true,
    });

    render(
      <QuickCreateAffaireDialog
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const fileInput = document.querySelector<HTMLInputElement>("input[type='file']");
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput!, {
      target: {
        files: [
          new File(["designation;quantite\nposte;1"], "dpgf.csv", {
            type: "text/csv",
          }),
        ],
      },
    });
    fireEvent.change(screen.getByLabelText("Nom du projet *"), {
      target: { value: "Affaire busy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Creer l'affaire" }));

    await waitFor(() => {
      expect(importFileMock).toHaveBeenCalledTimes(1);
    });

    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
