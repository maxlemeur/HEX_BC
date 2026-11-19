import { describe, expect, it, vi } from "vitest";

import { ApiKeyError } from "@/lib/ai/access/api-key-errors";
import { conflict } from "@/lib/http/api-response";

// Review round 2, item I: a refused key-paid launch (stale page, ceiling) is answered with no-store, like the key routes.

vi.mock("@/lib/takeoff/lab/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/takeoff/lab/server")>()),
  requireTakeoffLabWrite: async () => ({ owner: { userId: "user-1", tenantId: "tenant-1" }, email: null }),
}));
const refusal = vi.hoisted(() => ({ error: null as unknown }));
vi.mock("@/lib/takeoff/lab/runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/takeoff/lab/runs")>()),
  executeLabRun: async () => { throw refusal.error; },
}));

const { POST } = await import("@/app/api/admin/takeoff/lab/runs/route");

const body = { documentId: "army-chatgpt-plan", campaign: "c", taskId: "extraction-niveau-c", crop: null, prompt: "p", image: null,
  configs: [{ provider: "api_key", apiProvider: "openai", model: "gpt-6.1-terra", reasoningEffort: null, connectionId: "8c3e2b1a-4d5f-4a6b-9c7d-0e1f2a3b4c5d" }] };

describe("POST /api/admin/takeoff/lab/runs", () => {
  it("answers a refused key-paid launch with no-store", async () => {
    for (const code of ["AI_KEY_PAGE_STALE", "AI_KEY_CEILING"] as const) {
      refusal.error = conflict(new ApiKeyError(code).message, undefined, code);
      const response = await POST(new Request("http://127.0.0.1:3000/api/admin/takeoff/lab/runs", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect([response.status, (await response.json()).error.code, response.headers.get("cache-control")]).toEqual([409, code, "no-store"]);
    }
  });
});
