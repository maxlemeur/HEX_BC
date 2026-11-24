import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

import { hasLocalChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { processAffaireIntakeAnalysisLaunch } from "@/lib/affaires/intake-analysis-server";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { recoverIntakeAnalysisLaunch } from "./intake-launch-recovery";

vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ isLocalChatGptEnabled: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ hasLocalChatGptStore: vi.fn() }));
vi.mock("@/lib/affaires/intake-analysis-server", () => ({ processAffaireIntakeAnalysisLaunch: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createOptionalServiceRoleClient: vi.fn() }));

const paid = [{ id: "other-mac", created_by: "other", tenant_id: "tenant" },
  { id: "exhausted", created_by: "payer", tenant_id: "tenant" }, { id: "due", created_by: "payer", tenant_id: "tenant" }];
const unpaid = [{ id: "no-reading", created_by: "member", tenant_id: "tenant" }];

beforeEach(() => {
  vi.resetAllMocks();
  const service = createClient("http://127.0.0.1:54321", "fixture", {
    global: { fetch: async (input) => {
      const url = new URL(String(input));
      const hosted = url.searchParams.getAll("or").includes("(launch_read_scans.eq.false,created_by.is.null)");
      const rows = hosted ? unpaid : paid;
      return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
    } },
  });
  vi.mocked(createOptionalServiceRoleClient).mockReturnValue(service as ReturnType<typeof createOptionalServiceRoleClient>);
  vi.mocked(hasLocalChatGptStore).mockImplementation(async owner => owner.userId === "payer");
  vi.mocked(processAffaireIntakeAnalysisLaunch).mockImplementation(async id => id === "exhausted" ? null : id);
});

it("leaves launches that require a personal plan for the Mac during hosted recovery", async () => {
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(false);
  expect(await recoverIntakeAnalysisLaunch()).toBe("no-reading");
  expect(processAffaireIntakeAnalysisLaunch).toHaveBeenCalledExactlyOnceWith("no-reading");
  expect(hasLocalChatGptStore).not.toHaveBeenCalled();
});

it("skips another Mac and reaches the second due launch when the first claim retires an exhausted launch", async () => {
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(true);
  expect(await recoverIntakeAnalysisLaunch()).toBe("due");
  expect(vi.mocked(processAffaireIntakeAnalysisLaunch).mock.calls.map(([id]) => id)).toEqual(["exhausted", "due"]);
});
