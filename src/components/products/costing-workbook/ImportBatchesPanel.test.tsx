import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogueImportBatch, CatalogueImportBatchPage } from "@/lib/catalogue/import-review-contract";

const role = vi.hoisted(() => ({ current: "admin" as "admin" | "engineer" }));
vi.mock("@/lib/auth/user-context", () => ({
  useOptionalUserContext: () => ({ profile: { tenant_role: role.current } }),
}));

import { ImportBatchesPanel } from "./ImportBatchesPanel";

/**
 * Failure modes of the recent imports of the costing workbook (TI-711), written before the code.
 *  1. The drafts of an import can only be validated one by one; or an engineer is offered a validation the
 *     database reserves to administrators.
 *  2. An import cannot be undone, is undone without a confirmation, or by a member who may not.
 *  3. What the server left out (incomplete drafts, articles kept) is not said.
 *  4. An undone import still offers its actions; the list is not read again after an import.
 */

const batch = (extra: Partial<CatalogueImportBatch>): CatalogueImportBatch => ({
  id: "b0000000-0000-4000-8000-000000000001", kind: "workbook_articles", source_name: "bible-chiffrage.xlsm",
  created_at: "2026-11-25T10:00:00.000Z", undo_started_at: null, undone_at: null, total: 12, open: 10, can_undo: true, ...extra,
});
const REFERENCES = "b0000000-0000-4000-8000-000000000002";

type Sent = { url: string; method: string; body: unknown };
const sent: Sent[] = [];
let batches: CatalogueImportBatch[] = [];
let olderPage: CatalogueImportBatchPage | null;
const CURSOR = "2026-11-25T10:00:00.123456+00:00,b0000000-0000-4000-8000-000000000001";
const OLDER = "b0000000-0000-4000-8000-000000000005";
const OLDER_URL = `/api/catalogue/import-batches?${new URLSearchParams({ cursor: CURSOR })}`;
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  sent.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
  const answer = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "content-type": "application/json" } }));
  if (url === "/api/products/bulk") return answer({ action: "validate", validated: 8, incomplete: 2, skipped: 1 });
  if (url.endsWith("/undo")) return answer({ deleted: 9, kept: 1 });
  if (url === OLDER_URL) return answer(olderPage);
  return answer({ items: batches, next_cursor: olderPage ? CURSOR : null });
});
const posts = () => sent.filter((call) => call.method === "POST");

function renderPanel(refreshKey = 0) {
  const onChanged = vi.fn();
  const view = render(<ImportBatchesPanel refreshKey={refreshKey} draftsHref="/dashboard/products?catalogue_status=draft" onChanged={onChanged} />);
  return { ...view, onChanged };
}

describe("ImportBatchesPanel", () => {
  beforeEach(() => {
    sent.length = 0;
    role.current = "admin";
    olderPage = null;
    batches = [
      batch({}),
      batch({ id: REFERENCES, kind: "workbook_supplier_references", total: 40, open: 35 }),
      batch({ id: "b0000000-0000-4000-8000-000000000003", undone_at: "2026-11-24T10:00:00.000Z", total: 0, open: 0 }),
    ];
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates the complete drafts of an import together, and says how many stay to complete (1, 3)", async () => {
    const user = userEvent.setup();
    const { onChanged } = renderPanel();
    const [articles, references, undone] = within(await screen.findByRole("list", { name: "Imports récents" })).getAllByRole("listitem");
    expect(articles).toHaveTextContent("bible-chiffrage.xlsm · 12 articles, dont 10 encore en brouillon");
    expect(within(references).getByRole("link", { name: "Vérifier les références" }))
      .toHaveAttribute("href", `/dashboard/products/supplier-references?import_batch_id=${REFERENCES}`);
    // An undone import is history: nothing left to do on it (4).
    expect(within(undone).queryByRole("button")).not.toBeInTheDocument();

    await user.click(within(articles).getByRole("button", { name: "Valider les brouillons complets" }));
    await waitFor(() => expect(posts()).toEqual([{ url: "/api/products/bulk", method: "POST", body: { action: "validate", import_batch_id: batch({}).id } }]));
    expect(await screen.findByText("8 brouillons validés. 2 brouillons incomplets à compléter. 1 article ignoré.")).toBeVisible();
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The list is read again: the counts on screen are the server's.
    await waitFor(() => expect(sent.filter((call) => call.url === "/api/catalogue/import-batches")).toHaveLength(2));
  });

  it("undoes an import only once confirmed, and says what was kept (2, 3)", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    renderPanel();
    const [articles] = within(await screen.findByRole("list", { name: "Imports récents" })).getAllByRole("listitem");

    await user.click(within(articles).getByRole("button", { name: "Annuler l’import" }));
    expect(confirm).toHaveBeenCalledWith("Annuler cet import d’articles ?");
    expect(posts()).toEqual([]);

    await user.click(within(articles).getByRole("button", { name: "Annuler l’import" }));
    await waitFor(() => expect(posts().map((call) => call.url)).toEqual([`/api/catalogue/import-batches/${batch({}).id}/undo`]));
    expect(await screen.findByText("Import annulé : 9 brouillons supprimés. 1 conservé.")).toBeVisible();
  });

  it("offers to finish an interrupted undo even when all its articles have been deleted", async () => {
    batches = [batch({ undo_started_at: "2026-11-25T11:00:00.000Z", total: 0, open: 0 })];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText("Annulation en cours")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Annuler l’import" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(posts().map((call) => call.url)).toEqual([`/api/catalogue/import-batches/${batch({}).id}/undo`]));
  });

  it("offers an engineer neither the validation nor an undo that is not theirs (1, 2)", async () => {
    role.current = "engineer";
    batches = [batch({ can_undo: false })];
    renderPanel();
    const [articles] = within(await screen.findByRole("list", { name: "Imports récents" })).getAllByRole("listitem");
    expect(within(articles).getByRole("link", { name: "Voir les brouillons" })).toBeVisible();
    expect(within(articles).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("La validation des brouillons est réservée aux administrateurs.")).toBeVisible();
  });

  it("appends older imports and keeps them available after an action", async () => {
    const user = userEvent.setup();
    olderPage = { items: [batch({ id: OLDER, source_name: "classeur-ancien.xlsx" })], next_cursor: null };
    renderPanel();
    const more = await screen.findByRole("button", { name: "Afficher les imports plus anciens" });
    await user.click(more);

    const list = within(screen.getByRole("list", { name: "Imports récents" }));
    const rows = list.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("bible-chiffrage.xlsm");
    expect(rows[3]).toHaveTextContent("classeur-ancien.xlsx");
    expect(more).not.toBeInTheDocument();
    await user.click(within(rows[3]).getByRole("button", { name: "Valider les brouillons complets" }));
    expect(posts()).toEqual([{ url: "/api/products/bulk", method: "POST", body: { action: "validate", import_batch_id: OLDER } }]);
    await waitFor(() => expect(sent.filter((call) => call.url === OLDER_URL)).toHaveLength(2));
    expect(list.getAllByRole("listitem")[3]).toHaveTextContent("classeur-ancien.xlsx");
  });

  it("reads the list again after an import, and shows nothing without imports (4)", async () => {
    batches = [];
    const { rerender, container } = renderPanel(0);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();

    batches = [batch({})];
    rerender(<ImportBatchesPanel refreshKey={1} draftsHref="/dashboard/products?catalogue_status=draft" onChanged={vi.fn()} />);
    expect(await screen.findByRole("list", { name: "Imports récents" })).toBeVisible();
  });
});
