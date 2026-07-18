import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedContextMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: getAuthenticatedContextMock,
}));

import {
  listEstimateAssemblyLibraryPage,
  sanitizeAssemblyLibrarySearch,
  setEstimateAssemblyFavorite,
} from "@/lib/estimates/assembly-library";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSEMBLY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createContext(rpc: ReturnType<typeof vi.fn>) {
  getAuthenticatedContextMock.mockResolvedValue({
    tenantId: TENANT_ID,
    userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    tenantRole: "admin",
    supabase: { rpc },
  });
}

function createAssemblyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSEMBLY_ID,
    created_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T01:00:00.000Z",
    name: "Mur BA13",
    description: "Cloison acoustique",
    reference_code: "CLO-BA13-048",
    unit: "m²",
    pricing_source: "manual",
    stored_ds_cents: 10_500,
    indicative_target_price_cents: 15_000,
    avg_output_rate: "8.5",
    avg_time_hours: "1.25",
    source_metadata: { source: "manual" },
    item_count: "3",
    component_names: ["Plaque BA13", "Rail", "Pose"],
    material_cost_cents: "7000",
    labor_cost_cents: "3000",
    equipment_cost_cents: "250",
    subcontract_cost_cents: "0",
    calculated_ds_cents: "10250",
    pose_only_cents: "3250",
    supplied_installed_cents: "15000",
    stored_ds_delta_cents: "250",
    is_favorite: true,
    favorite_position: "0",
    usage_count: "12",
    last_used_at: "2026-07-17T12:00:00.000Z",
    near_duplicate_count: "2",
    total_count: "51",
    ...overrides,
  };
}

describe("estimate assembly library service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes wildcard punctuation without losing searchable words", () => {
    expect(sanitizeAssemblyLibrarySearch("  tube_% inox\\ DN50  ")).toBe(
      "tube inox DN50"
    );
  });

  it("queries a stable server page and exposes comparable costs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [createAssemblyRow()],
      error: null,
    });
    createContext(rpc);

    const result = await listEstimateAssemblyLibraryPage({
      search: "BA13_%",
      filter: "favorites",
      sort: "usage",
      direction: "desc",
      page: 2,
      pageSize: 25,
    });

    expect(rpc).toHaveBeenCalledWith("estimate_assemblies_page", {
      p_tenant_id: TENANT_ID,
      p_q: "BA13",
      p_filter: "favorites",
      p_sort: "usage",
      p_dir: "desc",
      p_page: 2,
      p_size: 25,
    });
    expect(result.pagination).toEqual({
      page: 2,
      page_size: 25,
      total_items: 51,
      total_pages: 3,
    });
    expect(result.assemblies[0]).toEqual(
      expect.objectContaining({
        id: ASSEMBLY_ID,
        reference_code: "CLO-BA13-048",
        ds_cents: 10_250,
        stored_ds_cents: 10_500,
        stored_ds_delta_cents: 250,
        material_cost_cents: 7_000,
        labor_cost_cents: 3_000,
        pose_only_cents: 3_250,
        supplied_installed_cents: 15_000,
        is_favorite: true,
        usage_count: 12,
        near_duplicate_count: 2,
      })
    );
  });

  it("probes page one only when a non-first page is empty", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [createAssemblyRow({ total_count: "26" })],
        error: null,
      });
    createContext(rpc);

    const result = await listEstimateAssemblyLibraryPage({
      search: "",
      filter: "all",
      sort: "recent",
      direction: "desc",
      page: 3,
      pageSize: 25,
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "estimate_assemblies_page",
      expect.objectContaining({ p_page: 1 })
    );
    expect(result.pagination).toEqual(
      expect.objectContaining({ total_items: 26, total_pages: 2 })
    );
  });

  it("updates favorites inside the authenticated tenant", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          assembly_id: ASSEMBLY_ID,
          is_favorite: true,
          favorite_position: 4,
          usage_count: 7,
          last_used_at: null,
        },
      ],
      error: null,
    });
    createContext(rpc);

    await expect(
      setEstimateAssemblyFavorite(ASSEMBLY_ID, true)
    ).resolves.toEqual({
      assembly_id: ASSEMBLY_ID,
      is_favorite: true,
      favorite_position: 4,
      usage_count: 7,
      last_used_at: null,
    });
    expect(rpc).toHaveBeenCalledWith("set_estimate_assembly_favorite", {
      p_tenant_id: TENANT_ID,
      p_assembly_id: ASSEMBLY_ID,
      p_favorite: true,
    });
  });
});

