import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isFeatureEnabled } from "@/lib/feature-flags";

const tenantId = "c0000000-0000-4000-8000-000000000001";
const projectId = "c0000000-0000-4000-8000-000000000002";
const jobId = "c0000000-0000-4000-8000-000000000003";
const url = `http://localhost/api/affaires/${projectId}/takeoff/items/finds`;
vi.mock("@/lib/affaires/access-server", () => ({
  requireAffaireAccess: async () => ({ context: { tenantId, userId: jobId, supabase: {} }, project: { id: projectId } }),
}));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it.each(["GET", "POST"])("refuses %s before creating a privileged client when takeoff is disabled", async method => {
  vi.stubEnv("TAKEOFF_MODULE_FORCE_ENABLED", "0");
  vi.stubEnv("TAKEOFF_MODULE_ENABLED_BY_DEFAULT", "0");
  vi.mocked(isFeatureEnabled).mockResolvedValue(false);
  const ctx = { params: Promise.resolve({ projectId }) };
  const response = method === "GET" ? await GET(new Request(url), ctx) : await POST(new Request(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "dismiss", jobId, index: 0, reason: "outside_scope", intentKey: jobId }),
  }), ctx);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ ok: false, error: { code: "TAKEOFF_MODULE_DISABLED" } });
  expect(isFeatureEnabled).toHaveBeenCalledWith(tenantId, "TAKEOFF_MODULE_ENABLED", { supabase: {} });
  expect(createServiceRoleClient).not.toHaveBeenCalled();
});
