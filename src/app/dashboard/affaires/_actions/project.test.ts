import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, client, membership } = vi.hoisted(() => {
  const query = {
    update: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn(),
  };
  return {
    query,
    client: { auth: { getUser: vi.fn() }, from: vi.fn() },
    membership: vi.fn(),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => client }));
vi.mock("@/lib/affaires/import-flow-server", () => ({
  getCurrentMembershipOrThrow: membership,
  normalizeNullableText: (value?: string | null) => value?.trim() || null,
}));

import { updateAffaireProjectMetadataAction } from "./project";

const input = { projectId: "11111111-1111-4111-8111-111111111111", projectName: "Chantier" };

describe("affaire site address", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.auth.getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
    client.from.mockReturnValue(query);
    for (const method of [query.update, query.eq, query.select]) method.mockReturnValue(query);
    membership.mockResolvedValue({ role: "engineer", tenant_id: "tenant" });
    query.maybeSingle.mockResolvedValue({ data: { id: input.projectId, name: "Chantier", site_address: "12 rue du Test\nParis" }, error: null });
  });

  it("saves a trimmed multiline address within tenant and owner scope", async () => {
    const result = await updateAffaireProjectMetadataAction({ ...input, siteAddress: " 12 rue du Test\nParis " });
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ site_address: "12 rue du Test\nParis" }));
    expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant");
    expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
    expect(query.eq).toHaveBeenCalledWith("is_archived", false);
    expect(result.siteAddress).toBe("12 rue du Test\nParis");
  });

  it("rejects unauthorized roles", async () => {
    membership.mockResolvedValue({ role: "viewer", tenant_id: "tenant" });
    await expect(updateAffaireProjectMetadataAction({ ...input, siteAddress: "Paris" })).rejects.toThrow("Accès refuse");
    expect(query.update).not.toHaveBeenCalled();
  });
});
