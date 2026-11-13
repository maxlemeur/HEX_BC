import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/version-owner-access", () => ({ getOwnedEstimateVersion: vi.fn() }));
vi.mock("@/lib/estimates/read-all-items-server", () => ({ readAllEstimateItems: vi.fn(), assertEstimateVersionUnchanged: vi.fn() }));

import { loadEstimateReading } from "@/lib/assistant/estimate-reading-server";
import { AssistantToolError } from "@/lib/assistant/loop";
import { conflict, notFound } from "@/lib/estimates/errors";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import type { AuthenticatedContext } from "@/lib/estimates/server-context";
import { getOwnedEstimateVersion } from "@/lib/estimates/version-owner-access";

// A client that fails the test if anything is read through it.
const from = vi.fn(() => { throw new Error("the estimate must not be read"); });
const context = { supabase: { from }, userId: "user-1", tenantId: "tenant-1", tenantRole: "engineer" } as unknown as AuthenticatedContext;

/** An issued version as the estimate_versions row reads, behind the one query the reading makes. */
const issued = {
  id: "v-1", tenant_id: "tenant-1", project_id: "conversation-affaire", status: "sent", calc_engine_version: 3,
  version_number: 1, variant_label: null, title: "Chaufferie", content_revision: 7, updated_at: "2026-11-12T10:00:00Z",
  total_ht_cents: 95_000, total_tax_cents: 19_000, total_ttc_cents: 114_000, gross_ht_cents: 100_000,
  discount_applied_cents: 5_000, commercial_rounding_cents: 0, sale_coefficient_fo: 1.25, sale_coefficient_mo: 1.4,
};
function contextReading(version: typeof issued) {
  const query = { select: () => query, eq: () => query, single: async () => ({ data: version, error: null }) };
  return { ...context, supabase: { from: vi.fn(() => query) } } as unknown as AuthenticatedContext;
}

describe("estimate read by the assistant", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("refuses an estimate of another affaire before reading any of it, even one the member may open", async () => {
    vi.mocked(getOwnedEstimateVersion).mockResolvedValue({
      version: { id: "v-1", tenant_id: "tenant-1", status: "draft", estimate_projects: null },
      project: { id: "another-affaire", tenant_id: "tenant-1", user_id: "user-1" },
    });
    const read = loadEstimateReading(context, { versionId: "v-1", projectId: "conversation-affaire" });
    await expect(read).rejects.toBeInstanceOf(AssistantToolError);
    await expect(read).rejects.toThrow("n’appartient pas à l’affaire de cette conversation");
    expect(from).not.toHaveBeenCalled();
    expect(readAllEstimateItems).not.toHaveBeenCalled();
  });

  it("answers an estimate the member may not open like a missing one, without saying which", async () => {
    vi.mocked(getOwnedEstimateVersion).mockRejectedValue(notFound("Version de chiffrage introuvable."));
    const read = loadEstimateReading(context, { versionId: "v-2", projectId: "conversation-affaire" });
    await expect(read).rejects.toBeInstanceOf(AssistantToolError);
    await expect(read).rejects.toThrow("introuvable ou vous n’y avez pas accès");
    expect(from).not.toHaveBeenCalled();
  });

  describe("an estimate edited while it is read", () => {
    beforeEach(() => {
      vi.mocked(getOwnedEstimateVersion).mockResolvedValue({
        version: { id: "v-1", tenant_id: "tenant-1", status: "sent", estimate_projects: null },
        project: { id: "conversation-affaire", tenant_id: "tenant-1", user_id: "user-1" },
      });
      vi.mocked(readAllEstimateItems).mockResolvedValue([]);
    });

    it("gives the reading once the version is checked to be the one that was read", async () => {
      vi.mocked(assertEstimateVersionUnchanged).mockResolvedValue(undefined);
      const reading = await loadEstimateReading(contextReading(issued), { versionId: "v-1", projectId: "conversation-affaire" });
      expect(reading.totals.totalHtCents).toBe(95_000);
      expect(assertEstimateVersionUnchanged).toHaveBeenCalledWith(expect.objectContaining({ version: issued }));
    });

    it("gives no amount when lines were read across two revisions, and asks to read again", async () => {
      vi.mocked(assertEstimateVersionUnchanged).mockRejectedValue(conflict("Version modifiée ailleurs", undefined, "VERSION_CONFLICT"));
      const read = loadEstimateReading(contextReading(issued), { versionId: "v-1", projectId: "conversation-affaire" });
      await expect(read).rejects.toBeInstanceOf(AssistantToolError);
      await expect(read).rejects.toThrow("modifié pendant la lecture");
    });
  });
});
