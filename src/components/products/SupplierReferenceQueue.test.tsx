import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PendingSupplierReference } from "@/lib/catalogue/import-review-contract";

import { SupplierReferenceQueue } from "./SupplierReferenceQueue";

/**
 * Failure modes of checking imported supplier references together (TI-711), written before the code. Suppliers
 * and articles are invented; the network is the only stub.
 *  1. The office must still open each article to check its reference: a selection, or every reference of a
 *     filter, cannot be validated in one act.
 *  2. « Valider toutes » validates more than the filter on screen, or without the office confirming.
 *  3. A reference the member may not check can be selected; what the server left in wait is not said.
 *  4. Withdrawing discards codes without a confirmation.
 *  5. The list of one import shows the others.
 */

const BATCH = "b0000000-0000-4000-8000-000000000001";
const reference = (index: number, extra: Partial<PendingSupplierReference> = {}): PendingSupplierReference => ({
  id: `50000000-0000-4000-8000-00000000000${index}`, product_id: `90000000-0000-4000-8000-00000000000${index}`,
  product_reference: `TUBE-${index}`, product_designation: `Tube de démonstration ${index}`, supplier_id: "s1", supplier_name: "Comptoir Atlas",
  supplier_sku: `AT-${index}`, product_url: null, created_at: "2026-11-25T10:00:00.000Z", import_batch_id: BATCH, can_review: true, ...extra,
});

type Sent = { url: string; method: string; body: Record<string, unknown> | null };
const sent: Sent[] = [];
let pending: PendingSupplierReference[] = [];
const matches = (filter: { supplier_id?: string; import_batch_id?: string; q?: string }) => pending.filter((item) =>
  (!filter.supplier_id || item.supplier_id === filter.supplier_id)
  && (!filter.import_batch_id || item.import_batch_id === filter.import_batch_id)
  && (!filter.q || item.supplier_sku?.toLowerCase().includes(filter.q.toLowerCase())));
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
  sent.push({ url, method, body });
  const answer = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: { "content-type": "application/json" } }));
  if (url === "/api/suppliers") return answer({ items: [{ id: "s1", name: "Comptoir Atlas" }, { id: "s2", name: "Dépôt Boréal" }] });
  if (method === "POST") {
    const matching = matches((body?.filter ?? {}) as Parameters<typeof matches>[0]);
    if (body?.filter && body.expected_count !== matching.length) {
      return Promise.resolve(Response.json({ ok: false, error: {
        code: "CONFLICT", message: "La liste des références à vérifier a changé. Actualisez-la avant de confirmer à nouveau.",
      } }, { status: 409 }));
    }
    const ids = (body?.ids as string[] | undefined) ?? matching.filter((item) => item.can_review).map((item) => item.id);
    pending = pending.filter((item) => !ids.includes(item.id));
    return answer({ reviewed: ids.length, skipped: body?.ids ? 0 : matching.length - ids.length });
  }
  const params = new URL(url, "http://localhost").searchParams;
  const items = matches(Object.fromEntries(params));
  const page = Number(params.get("page") ?? 1);
  const size = Number(params.get("size") ?? 50);
  return answer({
    items: items.slice((page - 1) * size, page * size),
    pagination: { page, size, totalItems: items.length, totalPages: Math.ceil(items.length / size) },
  });
});

const reviews = () => sent.filter((call) => call.method === "POST").map((call) => call.body);
const lists = () => sent.filter((call) => call.method === "GET" && call.url.startsWith("/api/catalogue/supplier-references"));

function renderQueue(initialImportBatchId: string | null = null) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <SupplierReferenceQueue initialImportBatchId={initialImportBatchId} />
    </SWRConfig>,
  );
}

describe("SupplierReferenceQueue", () => {
  beforeEach(() => {
    sent.length = 0;
    pending = [reference(1), reference(2), reference(3, { can_review: false, supplier_sku: "BO-3", supplier_name: "Dépôt Boréal", supplier_id: "s2" })];
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("validates a selection in one act, and never a reference the member may not check (1, 3)", async () => {
    const user = userEvent.setup();
    renderQueue();
    const table = within(await screen.findByRole("table", { name: "Références fournisseur à vérifier" }));
    expect(table.getByRole("checkbox", { name: "Sélectionner BO-3 de Dépôt Boréal pour TUBE-3" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Valider la sélection" })).toBeDisabled();

    await user.click(table.getByRole("checkbox", { name: "Sélectionner les références de cette page" }));
    await user.click(screen.getByRole("button", { name: "Valider la sélection" }));

    await waitFor(() => expect(reviews()).toEqual([{ action: "validate", ids: [reference(1).id, reference(2).id] }]));
    expect(await screen.findByText("2 références validées.")).toBeVisible();
    await waitFor(() => expect(screen.getByText("1 référence à vérifier")).toBeVisible());
  });

  it("validates every reference of the filter on screen, after a confirmation, and says what was left (2, 3)", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    renderQueue();
    await screen.findByRole("table", { name: "Références fournisseur à vérifier" });
    pending = pending.map((item) => item.can_review ? item : { ...item, supplier_id: "s1" });
    await user.selectOptions(screen.getByLabelText("Fournisseur"), "Comptoir Atlas");
    await waitFor(() => expect(lists().at(-1)?.url).toContain("supplier_id=s1"));

    await user.click(screen.getByRole("button", { name: "Valider les 3 références" }));
    expect(confirm).toHaveBeenCalledWith("Valider 3 références ?");
    expect(reviews()).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Valider les 3 références" }));
    await waitFor(() => expect(reviews()).toEqual([{ action: "validate", filter: { supplier_id: "s1" }, expected_count: 3 }]));
    expect(await screen.findByText(/^2 références validées\. 1 sur 3 laissée en attente/)).toBeVisible();
  });

  it("withdraws a selection only once confirmed (4)", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderQueue();
    const table = within(await screen.findByRole("table", { name: "Références fournisseur à vérifier" }));
    await user.click(table.getByRole("checkbox", { name: "Sélectionner AT-2 de Comptoir Atlas pour TUBE-2" }));
    await user.click(screen.getByRole("button", { name: "Retirer la sélection" }));

    expect(window.confirm).toHaveBeenCalledWith("Retirer 1 référence ?");
    await waitFor(() => expect(reviews()).toEqual([{ action: "withdraw", ids: [reference(2).id] }]));
    expect(await screen.findByText("1 référence retirée.")).toBeVisible();
  });

  it("cannot confirm the old count during a wider filter fetch or before typed search resolves", async () => {
    const user = userEvent.setup();
    pending.push(reference(4, { import_batch_id: null }));
    let resume!: () => void;
    const waiting = new Promise<void>((resolve) => { resume = resolve; });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/catalogue/supplier-references?") && !url.includes("import_batch_id")) await waiting;
      return fetchMock(input, init);
    }));
    renderQueue(BATCH);
    await screen.findByRole("button", { name: "Valider les 3 références" });
    await user.click(screen.getByRole("button", { name: "Voir tous les imports" }));
    const stale = screen.queryByRole("button", { name: "Valider les 3 références" });
    if (stale) expect(stale).toBeDisabled();
    await act(async () => resume());
    expect(await screen.findByRole("button", { name: "Valider les 4 références" })).toBeEnabled();
    await user.type(screen.getByLabelText("Référence fournisseur"), "AT-1");
    expect(screen.getByRole("button", { name: "Valider les 4 références" })).toBeDisabled();
    expect(reviews()).toEqual([]);
  });

  it("refreshes when a new reference arrives during confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockImplementation(() => {
      pending.push(reference(4));
      return true;
    });
    renderQueue();
    await user.click(await screen.findByRole("button", { name: "Valider les 3 références" }));
    expect(await screen.findByText(/La liste des références à vérifier a changé/)).toBeVisible();
    expect(await screen.findByRole("button", { name: "Valider les 4 références" })).toBeEnabled();
    expect(reviews()).toEqual([{ action: "validate", filter: {}, expected_count: 3 }]);
    expect(pending).toHaveLength(4);
  });

  it("goes back to the last page that holds references once a review has emptied the one on screen", async () => {
    const user = userEvent.setup();
    pending = Array.from({ length: 51 }, (_, index) => reference(1, {
      id: `50000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, product_reference: `TUBE-${index + 1}`, supplier_sku: `AT-${index + 1}`,
    }));
    renderQueue();
    await screen.findByRole("table", { name: "Références fournisseur à vérifier" });
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    const table = within(await screen.findByRole("table", { name: "Références fournisseur à vérifier" }));
    await user.click(await table.findByRole("checkbox", { name: "Sélectionner AT-51 de Comptoir Atlas pour TUBE-51" }));
    await user.click(screen.getByRole("button", { name: "Valider la sélection" }));

    expect(await screen.findByText("1 référence validée.")).toBeVisible();
    expect(await screen.findByText("1 / 1")).toBeVisible();
    expect(await screen.findByRole("checkbox", { name: "Sélectionner AT-50 de Comptoir Atlas pour TUBE-50" })).toBeVisible();
  });

  it("opens on the references of one import, and widens to all on request (5)", async () => {
    const user = userEvent.setup();
    renderQueue(BATCH);
    await screen.findByRole("table", { name: "Références fournisseur à vérifier" });
    expect(lists()[0].url).toContain(`import_batch_id=${BATCH}`);

    await user.click(screen.getByRole("button", { name: "Voir tous les imports" }));
    await waitFor(() => expect(lists().at(-1)?.url).not.toContain("import_batch_id"));
    expect(screen.queryByRole("button", { name: "Voir tous les imports" })).not.toBeInTheDocument();
  });
});
