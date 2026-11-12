import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/version-owner-access", () => ({ getOwnedEstimateVersion: vi.fn() }));
vi.mock("@/lib/estimates/read-all-items-server", () => ({ readAllEstimateItems: vi.fn() }));

import { loadEstimateReading } from "@/lib/assistant/estimate-reading-server";
import { AssistantToolError } from "@/lib/assistant/loop";
import { notFound } from "@/lib/estimates/errors";
import { readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import type { AuthenticatedContext } from "@/lib/estimates/server-context";
import { getOwnedEstimateVersion } from "@/lib/estimates/version-owner-access";

// A client that fails the test if anything is read through it.
const from = vi.fn(() => { throw new Error("the estimate must not be read"); });
const context = { supabase: { from }, userId: "user-1", tenantId: "tenant-1", tenantRole: "engineer" } as unknown as AuthenticatedContext;

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
});
