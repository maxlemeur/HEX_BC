import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchEstimateAssemblies, fetchEstimateAssembly, fetchEstimateAssemblyOptions, updateEstimateAssembly } from "@/lib/estimates/assemblies-client";
import { isEstimateApiError } from "@/lib/estimates/client-errors";
import { generateEstimateLineExplanation } from "@/lib/estimates/explanations-client";
import { reorderEstimateItems } from "@/lib/estimates/items-client";
import { importLinkedDpgfSource } from "@/lib/estimates/linked-dpgf-client";
import { toggleEstimateOutlierDismissedFlag } from "@/lib/estimates/outlier-dismissals-client";
import { previewEstimatePriceReuse } from "@/lib/estimates/price-reuse-client";
import { createEstimatePurchaseOrderDrafts } from "@/lib/estimates/purchase-order-drafts-client";
import { createEstimateCategory } from "@/lib/estimates/reference-data-client";
import { duplicateEstimateSection } from "@/lib/estimates/section-copy-client";
import { generateEstimateStructureDraft } from "@/lib/estimates/structure-drafts-client";
import { trackEstimateSuggestionCorrections } from "@/lib/estimates/suggestion-learning-client";
import { fetchEstimateTemplate, fetchEstimateTemplates, updateEstimateTemplate } from "@/lib/estimates/templates-client";
import { createEstimate } from "@/lib/estimates/version-creation-client";
import { generateVersionZeroDraft } from "@/lib/estimates/version-zero-drafts-client";

// What the browser clients of the estimates send to fetch for a JSON write, one call per module, and how the template
// and ouvrage libraries build their list address and read their lists. Version ids are not UUIDs on purpose: the draft
// lock session header is only added to /api/estimates/<uuid> paths and is pinned elsewhere.

const JSON_HEADERS = { "Content-Type": "application/json" };
const ai = { provider: "openai", model: "m" };
const write = (method: string, body: unknown) =>
  ({ credentials: "same-origin", method, headers: JSON_HEADERS, body: JSON.stringify(body) });

type Case = { name: string; run: () => Promise<unknown>; path: string; init: Record<string, unknown> };

const cases: Case[] = [
  {
    name: "suggestion-learning-client", run: () => trackEstimateSuggestionCorrections("v1", { corrections: [] } as never),
    path: "/api/estimates/v1/suggestion-learning", init: write("POST", { corrections: [] }),
  },
  {
    name: "reference-data-client", run: () => createEstimateCategory("v1", { name: "Cat", color: "#fff", position: 1 }),
    path: "/api/estimates/v1/categories", init: write("POST", { name: "Cat", color: "#fff", position: 1 }),
  },
  {
    name: "section-copy-client", run: () => duplicateEstimateSection("v1", "s1", { targetVersionId: "v2" }),
    path: "/api/estimates/v1/sections/s1/duplicate", init: write("POST", { targetVersionId: "v2" }),
  },
  {
    name: "outlier-dismissals-client",
    run: () => toggleEstimateOutlierDismissedFlag("v1", { itemId: "i1", flagKey: "k", dismissed: true } as never),
    path: "/api/estimates/v1/outliers", init: write("POST", { item_id: "i1", flag_key: "k", dismissed: true }),
  },
  {
    name: "explanations-client", run: () => generateEstimateLineExplanation("v1", "l1", { mode: "x" } as never),
    path: "/api/estimates/v1/lines/l1/explanation",
    init: { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ mode: "x" }) },
  },
  {
    name: "purchase-order-drafts-client",
    run: () => createEstimatePurchaseOrderDrafts("v1", {
      idempotencyKey: "k", reviewedLines: [{ itemId: "i", reviewFingerprint: "f" }],
      groups: [{ supplierId: "s", deliverySiteId: "d", deliverySiteUpdatedAt: "t", itemIds: ["i"] }],
    } as never),
    path: "/api/estimates/v1/purchase-order-drafts",
    init: write("POST", {
      idempotency_key: "k", reviewed_lines: [{ item_id: "i", review_fingerprint: "f" }],
      groups: [{ supplier_id: "s", delivery_site_id: "d", delivery_site_updated_at: "t", item_ids: ["i"], expected_delivery_date: null, notes: null }],
    }),
  },
  {
    name: "version-creation-client", run: () => createEstimate({ projectId: "p1" } as never),
    path: "/api/estimates", init: write("POST", { version: {}, project_id: "p1" }),
  },
  {
    name: "price-reuse-client", run: () => previewEstimatePriceReuse("v1", "v0"),
    path: "/api/estimates/v1/price-reuse/preview", init: write("POST", { reference_version_id: "v0" }),
  },
  {
    name: "linked-dpgf-client", run: () => importLinkedDpgfSource("v1", { sectionTitle: "T" }),
    path: "/api/estimates/v1/import-linked-dpgf", init: write("POST", { sectionTitle: "T" }),
  },
  {
    name: "templates-client", run: () => updateEstimateTemplate("t1", { name: "N" }),
    path: "/api/estimates/templates/t1", init: write("PATCH", { name: "N" }),
  },
  {
    name: "version-zero-drafts-client", run: () => generateVersionZeroDraft("v1", { ai } as never),
    path: "/api/estimates/v1/version-zero-drafts", init: write("POST", { briefId: null, selectedLots: [], ai }),
  },
  {
    name: "items-client", run: () => reorderEstimateItems("v1", null, ["a", "b"]),
    path: "/api/estimates/v1/items/reorder", init: write("POST", { parent_id: null, ordered_ids: ["a", "b"] }),
  },
  {
    name: "assemblies-client", run: () => updateEstimateAssembly("a1", { name: "N", description: undefined }),
    path: "/api/estimates/assemblies/a1", init: write("PATCH", { name: "N", description: null }),
  },
  {
    name: "structure-drafts-client", run: () => generateEstimateStructureDraft("v1", { ai } as never),
    path: "/api/estimates/v1/structure-drafts", init: write("POST", { strategy: "hybrid", ai }),
  },
];

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("estimates browser clients JSON requests", () => {
  const fetchMock = vi.fn<(path: string, init: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(cases)("$name sends its path and JSON request init", async (entry) => {
    fetchMock.mockResolvedValue(respond(422, { ok: false, error: { message: "Refus", code: "CODE" } }));
    const error = await entry.run().then(() => null, (failure: unknown) => failure);
    expect(isEstimateApiError(error)).toBe(true);
    expect(error).toMatchObject({ message: "Refus", status: 422, code: "CODE" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe(entry.path);
    expect(init).toStrictEqual(entry.init);
  });

  const summary = (id: string) => ({ id, name: `Nom ${id}`, created_at: "2026-01-01", updated_at: "2026-01-02" });

  describe.each([
    { name: "templates", list: fetchEstimateTemplates, base: "/api/estimates/templates", key: "templates" },
    { name: "assemblies", list: fetchEstimateAssemblies, base: "/api/estimates/assemblies", key: "assemblies" },
  ])("the $name library list", ({ list, base, key }) => {
    it.each([
      [undefined, base],
      [{}, base],
      [{ search: "   " }, base],
      [{ search: "  mur béton ", limit: 12.7, order: "oldest" as const }, `${base}?search=mur+b%C3%A9ton&limit=12&order=oldest`],
      [{ limit: 0, order: "recent" as const }, `${base}?order=recent`],
      [{ limit: -3 }, base],
      [{ limit: Number.NaN }, base],
      [{ limit: Number.POSITIVE_INFINITY }, base],
      [{ limit: 0.5 }, `${base}?limit=0`],
    ])("reads %j at its address", async (options, path) => {
      fetchMock.mockResolvedValue(respond(200, { ok: true, data: { [key]: [] } }));
      await list(options);
      expect(fetchMock.mock.calls[0]).toStrictEqual([path, { credentials: "same-origin", method: "GET" }]);
    });

    it.each([
      [{ ok: true, data: { [key]: [summary("a"), { id: "b" }, null, 3, summary("c")], items: [summary("x")] } }, ["a", "c"]],
      [{ ok: true, data: { [key]: "none", items: [summary("x"), summary("y")] } }, ["x", "y"]],
      [{ ok: true, data: { items: [summary("x")] } }, ["x"]],
      [{ [key]: [summary("d")] }, ["d"]],
      [{ ok: true, data: { other: [summary("x")] } }, []],
      [{ ok: true, data: [summary("x")] }, []],
      [{ ok: true, data: "text" }, []],
      [null, []],
    ])("reads the list of %j", async (body, ids) => {
      fetchMock.mockResolvedValue(respond(200, body));
      expect((await list()).map((entry) => entry.id)).toEqual(ids);
    });
  });

  it("keeps only the records among the items of a template", async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, data: { template: { ...summary("t"), items: [{ id: "i1" }, 2, null, "x", { id: "i2" }] } } }));
    expect((await fetchEstimateTemplate("t")).items).toEqual([{ id: "i1" }, { id: "i2" }]);
    fetchMock.mockResolvedValue(respond(200, { ok: true, data: { template: summary("t"), items: "none" } }));
    expect((await fetchEstimateTemplate("t")).items).toEqual([]);
  });

  it("keeps only the records among the items and members of an ouvrage", async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, data: {
      assembly: { ...summary("a"), items: [{ id: "i1" }, 2, null] }, members: [{ id: "m1" }, "x", { id: "m2" }],
    } }));
    const detail = await fetchEstimateAssembly("a");
    expect(detail.items).toEqual([{ id: "i1" }]);
    expect(detail.members).toEqual([{ id: "m1" }, { id: "m2" }]);
  });

  it("reads the options of the ouvrages", async () => {
    fetchMock.mockResolvedValue(respond(200, { ok: true, data: {
      assemblies: [summary("a"), null], labor_roles: [{ id: "r1" }, 1], supply_types: "none",
    } }));
    const options = await fetchEstimateAssemblyOptions();
    expect(fetchMock.mock.calls[0]).toStrictEqual(["/api/estimates/assemblies?limit=100", { credentials: "same-origin", method: "GET" }]);
    expect(options.assemblies.map((entry) => entry.id)).toEqual(["a"]);
    expect(options.laborRoles).toEqual([{ id: "r1" }]);
    expect(options.supplyTypes).toEqual([]);
  });
});
