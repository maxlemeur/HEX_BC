import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CostingWorkbookImportReport } from "@/lib/catalogue/costing-workbook-contract";

import { CostingWorkbookImport } from "./CostingWorkbookImport";

/**
 * Failure modes, written before the code (TI-690, lot 1: the office imports its costing workbook into
 * catalogue drafts from the catalogue page). The workbook rows are invented; the network is the only stub.
 *  1. Something is written before the office has seen what the import will do: the first request after
 *     choosing a file is not a preview (`confirm: false`), or the preview's counts are not said in words.
 *  2. Confirming sends `confirm: true` more than once, or other rows than the previewed ones; the import can be
 *     started again while a request is running.
 *  3. With nothing new to import, the import button stays enabled (an empty import that says « terminé »).
 *  4. A file without the « All_data » sheet is posted anyway, or the refusal does not name the sheet.
 *  5. A refusal (422 format, 403 rights) or a network failure is lost, shown outside the page, or clears the
 *     chosen file so that the office must choose it again to retry.
 *  6. Returning to the import page shows the previous file, preview or result; an answer that arrives after the
 *     page was left fills the new one.
 *  7. After the import the catalogue list is not refreshed, or there is no way to reach the drafts.
 *  8. (added with the route's contract, after the first version of the workflow) An import that stopped half-way
 *     (COSTING_WORKBOOK_IMPORT_INCOMPLETE) keeps offering the stale preview's count, does not refresh the list
 *     although drafts were created, or gives no way to import what is left.
 *  9. (found by review) A refusal that carries a sentence of the server (a 409 « un article vient d’être
 *     ajouté », a 500 that says what failed) is replaced by a generic « erreur 409 »; after a 409 on the
 *     confirmation, the stale preview is still offered instead of a new one.
 */

const SHEET_ROWS = [
  ["ID", "Caractéristique", "Matériau", "Type_ligne"],
  ["Tub.X4so.20", "Tube", "Inox 304L soudé", "Art"],
];

function report(overrides: Partial<CostingWorkbookImportReport> = {}): CostingWorkbookImportReport {
  return {
    confirmed: false,
    articles: 2621,
    new_articles: 1842,
    already_in_catalogue: 779,
    without_supply_type: 31,
    supplier_references_not_imported: 613,
    issues: [
      { row: 7, reference: "Rob.V.15", message: "Unité absente : « u » retenue." },
      { row: 9, reference: null, message: "Ligne sans référence (colonne ID) : ignorée." },
    ],
    issue_count: 57,
    sections: 40,
    ...overrides,
  };
}

function workbookFile(name: string, sheets: Record<string, unknown[][]>) {
  const book = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const bytes = XLSX.write(book, { bookType: name.endsWith(".xlsm") ? "xlsm" : "xlsx", type: "array" }) as ArrayBuffer;
  const file = new File([bytes], name);
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(bytes) });
  return file;
}

const costingWorkbook = () => workbookFile("bible-chiffrage.xlsm", { Sommaire: [["Bible"]], All_data: SHEET_ROWS });

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}
const success = (data: CostingWorkbookImportReport) => respond(200, { ok: true, data });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

// The accessible name keeps the narrow no-break space that French puts between thousands.
const IMPORT_1842 = `Importer ${(1842).toLocaleString("fr-FR")} brouillons`;

const fetchMock = vi.fn<typeof fetch>();
function sentBodies() {
  return fetchMock.mock.calls.map(([url, init]) => {
    expect(url).toBe("/api/catalogue/workbook-import");
    expect(init?.method).toBe("POST");
    return JSON.parse(String(init?.body)) as { rows: unknown[][]; confirm: boolean };
  });
}

function renderImport() {
  const props = {
    catalogueHref: "/dashboard/products?size=100",
    draftsHref: "/dashboard/products?catalogue_status=draft&size=100",
    onImported: vi.fn(),
    onImportRecorded: vi.fn(),
  };
  const view = render(<CostingWorkbookImport {...props} />);
  return { ...view, props };
}

const fileInput = () => screen.getByLabelText("Fichier Excel") as HTMLInputElement;
const importPage = () => screen.getByRole("region", { name: "Importer le classeur de chiffrage" });

describe("CostingWorkbookImport", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("previews the import before any write and says its counts in words (1)", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => success(report()));
    renderImport();

    await user.upload(fileInput(), costingWorkbook());

    const preview = await within(importPage()).findByRole("region", { name: "Aperçu de l’import" });
    expect(sentBodies()).toEqual([{ rows: SHEET_ROWS, confirm: false }]);
    for (const sentence of [
      "1 842 nouveaux articles en brouillon",
      "779 déjà au catalogue (inchangés)",
      "31 sans type de fourniture",
      "613 références fournisseur à traiter séparément.",
    ]) {
      expect(within(preview).getByText(sentence)).toBeInTheDocument();
    }
    await user.click(within(preview).getByRole("button", { name: "Remarques sur le classeur" }));
    for (const sentence of [
      "57 remarques sur le classeur",
      "Ligne 7 · Rob.V.15 : Unité absente : « u » retenue.",
      "Ligne 9 : Ligne sans référence (colonne ID) : ignorée.",
      "Les 2 premières sur 57.",
    ]) {
      expect(within(preview).getByText(sentence)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: IMPORT_1842 })).toBeEnabled();
  });

  it("confirms once with confirm: true and the previewed rows, then refreshes the list and offers the drafts (2, 7)", async () => {
    const user = userEvent.setup();
    const confirmation = deferred<Response>();
    fetchMock
      .mockImplementationOnce(() => success(report()))
      .mockImplementationOnce(() => confirmation.promise);
    const { props } = renderImport();

    await user.upload(fileInput(), costingWorkbook());
    const importButton = await screen.findByRole("button", { name: IMPORT_1842 });
    await user.click(importButton);
    await user.click(importButton);

    expect(within(importPage()).getByText("Création des brouillons…")).toBeInTheDocument();
    expect(importButton).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Changer de fichier Excel" })).toBeDisabled();
    // The file's name travels with the confirmation only: the import is recorded under it.
    expect(sentBodies()).toEqual([
      { rows: SHEET_ROWS, confirm: false },
      { rows: SHEET_ROWS, confirm: true, source_name: "bible-chiffrage.xlsm" },
    ]);
    expect(props.onImported).not.toHaveBeenCalled();

    await act(async () => {
      confirmation.resolve(new Response(JSON.stringify({ ok: true, data: report({ confirmed: true }) }), { status: 200 }));
    });

    expect(await within(importPage()).findByText("Import terminé : 1 842 brouillons créés.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(props.onImported).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: IMPORT_1842 })).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Voir les brouillons" })).toHaveAttribute("href", props.draftsHref);
  });

  it("keeps the import button disabled when nothing is new, and says so (3)", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => success(report({
      new_articles: 0, already_in_catalogue: 2621, without_supply_type: 0, supplier_references_not_imported: 0,
      issues: [], issue_count: 0,
    })));
    renderImport();

    await user.upload(fileInput(), costingWorkbook());

    expect(await within(importPage()).findByText("Aucun nouvel article en brouillon")).toBeInTheDocument();
    expect(within(importPage()).getByText("2 621 déjà au catalogue (inchangés)")).toBeInTheDocument();
    expect(within(importPage()).queryByText(/pas reprises? : elles? le sera/)).not.toBeInTheDocument();
    const importButton = screen.getByRole("button", { name: "Importer 0 brouillon" });
    expect(importButton).toBeDisabled();
    await user.click(importButton);
    expect(sentBodies()).toEqual([{ rows: SHEET_ROWS, confirm: false }]);
  });

  it("refuses a workbook without the All_data sheet before any request, naming the sheet (4)", async () => {
    const user = userEvent.setup();
    renderImport();

    await user.upload(fileInput(), workbookFile("autre-classeur.xlsx", { Feuil1: SHEET_ROWS }));

    expect(await within(importPage()).findByRole("alert")).toHaveTextContent(
      "Ce classeur n’a pas d’onglet « All_data ». Choisissez le classeur de chiffrage.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(importPage()).queryByRole("region", { name: "Aperçu de l’import" })).not.toBeInTheDocument();
  });

  it.each([
    [422, { ok: false, error: { code: "COSTING_WORKBOOK_FORMAT", message: "Ce fichier n’a pas les colonnes du classeur de chiffrage (onglet « All_data ») : Type_ligne manquantes." } },
      "Ce fichier n’a pas les colonnes du classeur de chiffrage (onglet « All_data ») : Type_ligne manquantes."],
    [403, { ok: false, error: { code: "FORBIDDEN", message: "La gestion du catalogue est réservée aux administrateurs." } },
      "La gestion du catalogue est réservée aux administrateurs."],
    [403, { ok: false }, "L’import du classeur est réservé aux administrateurs et aux ingénieurs."],
    [500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Impossible de lire les articles du catalogue." } },
      "Impossible de lire les articles du catalogue."],
    [500, { ok: false }, "L’import n’a pas abouti (erreur 500). Réessayez dans un instant."],
    // The schema's « Payload invalide. » says nothing to the office: the dialog's own sentence instead.
    [400, { ok: false, error: { code: "VALIDATION_ERROR", message: "Payload invalide." } },
      "Le serveur a refusé le contenu de l’onglet « All_data »."],
  ])("shows the %i refusal's sentence on the import page and keeps the chosen file (5, 9)", async (status, body, sentence) => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => respond(status, body));
    renderImport();

    await user.upload(fileInput(), costingWorkbook());

    expect(await within(importPage()).findByRole("alert")).toHaveTextContent(sentence);
    expect(fileInput().files?.[0]?.name).toBe("bible-chiffrage.xlsm");
  });

  it("says when the server did not answer, and retries with the same file without choosing it again (5)", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")))
      .mockImplementationOnce(() => success(report()));
    renderImport();

    await user.upload(fileInput(), costingWorkbook());
    expect(await within(importPage()).findByRole("alert")).toHaveTextContent(
      "Le serveur n’a pas répondu. Vérifiez la connexion, puis réessayez.",
    );

    await user.click(within(importPage()).getByRole("button", { name: "Réessayer" }));

    expect(await within(importPage()).findByText("1 842 nouveaux articles en brouillon")).toBeInTheDocument();
    expect(within(importPage()).queryByRole("alert")).not.toBeInTheDocument();
    expect(sentBodies()).toEqual([{ rows: SHEET_ROWS, confirm: false }, { rows: SHEET_ROWS, confirm: false }]);
  });

  it("keeps the preview and the import button after a refused confirmation (5)", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockImplementationOnce(() => success(report()))
      .mockImplementationOnce(() => respond(403, { ok: false, error: { message: "La gestion du catalogue est réservée aux administrateurs." } }));
    const { props } = renderImport();

    await user.upload(fileInput(), costingWorkbook());
    await user.click(await screen.findByRole("button", { name: IMPORT_1842 }));

    expect(await within(importPage()).findByRole("alert")).toHaveTextContent("La gestion du catalogue est réservée aux administrateurs.");
    expect(within(importPage()).getByText("1 842 nouveaux articles en brouillon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: IMPORT_1842 })).toBeEnabled();
    expect(props.onImported).not.toHaveBeenCalled();
  });

  it("after an import stopped half-way, refreshes the list, drops the stale preview and previews what is left (8)", async () => {
    const user = userEvent.setup();
    const stopped = "L’import s’est arrêté : 500 brouillons créés sur 1 842, avec 120 références fournisseurs. "
      + "Relancez l’import du même classeur : il ne crée que les articles qui manquent encore au catalogue.";
    fetchMock
      .mockImplementationOnce(() => success(report()))
      .mockImplementationOnce(() => respond(500, {
        ok: false,
        error: { code: "COSTING_WORKBOOK_IMPORT_INCOMPLETE", message: stopped, details: { report: report({ confirmed: true, new_articles: 500 }) } },
      }))
      .mockImplementationOnce(() => success(report({ new_articles: 1342, already_in_catalogue: 1279 })));
    const { props } = renderImport();

    await user.upload(fileInput(), costingWorkbook());
    await user.click(await screen.findByRole("button", { name: IMPORT_1842 }));

    expect(await within(importPage()).findByRole("alert")).toHaveTextContent(stopped);
    expect(props.onImported).toHaveBeenCalledTimes(1);
    expect(props.onImportRecorded).toHaveBeenCalledTimes(1);
    expect(within(importPage()).queryByText("1 842 nouveaux articles en brouillon")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: IMPORT_1842 })).not.toBeInTheDocument();

    await user.click(within(importPage()).getByRole("button", { name: "Réessayer" }));

    expect(await within(importPage()).findByText("1 342 nouveaux articles en brouillon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Importer ${(1342).toLocaleString("fr-FR")} brouillons` })).toBeEnabled();
    expect(sentBodies().map((body) => body.confirm)).toEqual([false, true, false]);
  });

  it("after a 409 on the confirmation, shows the server's sentence and previews again instead of the stale preview (9)", async () => {
    const user = userEvent.setup();
    const conflict = "Un article de ce classeur vient d’être ajouté au catalogue : relancez l’import pour reprendre les articles qui manquent.";
    fetchMock
      .mockImplementationOnce(() => success(report()))
      .mockImplementationOnce(() => respond(409, { ok: false, error: { code: "CONFLICT", message: conflict } }))
      .mockImplementationOnce(() => success(report({ new_articles: 1841, already_in_catalogue: 780 })));
    const { props } = renderImport();

    await user.upload(fileInput(), costingWorkbook());
    await user.click(await screen.findByRole("button", { name: IMPORT_1842 }));

    expect(await within(importPage()).findByRole("alert")).toHaveTextContent(conflict);
    expect(within(importPage()).queryByText(/erreur 409/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: IMPORT_1842 })).not.toBeInTheDocument();
    expect(props.onImported).toHaveBeenCalledTimes(1);

    await user.click(within(importPage()).getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("button", { name: `Importer ${(1841).toLocaleString("fr-FR")} brouillons` })).toBeEnabled();
    expect(sentBodies().map((body) => body.confirm)).toEqual([false, true, false]);
  });

  it("starts clean when reopened and ignores a late preview after leaving (6)", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => success(report()));
    const { rerender, props } = renderImport();

    await user.upload(fileInput(), costingWorkbook());
    expect(await within(importPage()).findByText("1 842 nouveaux articles en brouillon")).toBeInTheDocument();

    rerender(<></>);
    rerender(<CostingWorkbookImport {...props} />);
    expect(within(importPage()).queryByText("1 842 nouveaux articles en brouillon")).not.toBeInTheDocument();
    expect(fileInput().value).toBe("");

    const late = deferred<Response>();
    fetchMock.mockImplementationOnce(() => late.promise);
    await user.upload(fileInput(), costingWorkbook());
    expect(await within(importPage()).findByText("Comparaison avec le catalogue…")).toBeInTheDocument();
    rerender(<></>);
    rerender(<CostingWorkbookImport {...props} />);
    await act(async () => {
      late.resolve(new Response(JSON.stringify({ ok: true, data: report() }), { status: 200 }));
    });
    expect(within(importPage()).queryByText("1 842 nouveaux articles en brouillon")).not.toBeInTheDocument();
    expect(within(importPage()).queryByText("Comparaison avec le catalogue…")).not.toBeInTheDocument();
  });
});
