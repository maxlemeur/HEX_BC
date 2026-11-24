import { beforeEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

import { hasLocalChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { getLocalChatGptCredential, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { processAffaireIntakeAnalysisLaunch } from "@/lib/affaires/intake-analysis-server";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { hostCanReadIntakeScans } from "@/lib/affaires/intake-payer-server";
import { recoverIntakeAnalysisLaunch } from "./intake-launch-recovery";

vi.mock("@/lib/ai/chatgpt-local-auth", () => ({ isLocalChatGptEnabled: vi.fn(), getLocalChatGptCredential: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ hasLocalChatGptStore: vi.fn() }));
vi.mock("@/lib/affaires/intake-analysis-server", () => ({ processAffaireIntakeAnalysisLaunch: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createOptionalServiceRoleClient: vi.fn() }));

let retired: string[];
const paid = [{ id: "other-mac", created_by: "other", tenant_id: "tenant" },
  { id: "exhausted", created_by: "payer", tenant_id: "tenant" }, { id: "due", created_by: "payer", tenant_id: "tenant" }];
const unpaid = [{ id: "no-reading", created_by: "member", tenant_id: "tenant" }];

beforeEach(() => {
  vi.resetAllMocks();
  retired = [];
  const service = createClient("http://127.0.0.1:54321", "fixture", {
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/rpc/intake_payer_can_write")) return Response.json(true);
      if (url.pathname.endsWith("/rpc/stop_affaire_intake_analysis")) {
        const { p_upload_id } = JSON.parse(String(init?.body));
        retired.push(p_upload_id);
        return Response.json(p_upload_id === "due" ? "connection_unavailable" : null);
      }
      const hosted = url.searchParams.getAll("or").includes("(launch_read_scans.eq.false,created_by.is.null)");
      const rows = hosted ? unpaid : paid;
      return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
    } },
  });
  vi.mocked(createOptionalServiceRoleClient).mockReturnValue(service as ReturnType<typeof createOptionalServiceRoleClient>);
  vi.mocked(hasLocalChatGptStore).mockImplementation(async owner => owner.userId === "payer");
  vi.mocked(getLocalChatGptCredential).mockImplementation(async owner => owner.userId === "payer"
    ? { model: "fictional", profileId: "selected", accessToken: "fictional", authorizationId: "selected-auth", reasoningEffort: null } : null);
  vi.mocked(processAffaireIntakeAnalysisLaunch).mockImplementation(async id => id === "exhausted" ? null : id);
});

it("records no scan reading at the press when the selected account cannot refresh its connection", async () => {
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(true);
  vi.mocked(getLocalChatGptCredential).mockRejectedValue(new Error("Fictional refresh refused"));
  expect(await hostCanReadIntakeScans({ userId: "payer", tenantId: "tenant" })).toBe(false);
});

it("leaves launches that require a personal plan for the Mac during hosted recovery", async () => {
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(false);
  expect(await recoverIntakeAnalysisLaunch()).toBe("no-reading");
  expect(processAffaireIntakeAnalysisLaunch).toHaveBeenCalledExactlyOnceWith("no-reading", null);
  expect(hasLocalChatGptStore).not.toHaveBeenCalled();
});

it("skips another Mac and reaches the second due launch when the first claim retires an exhausted launch", async () => {
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(true);
  expect(await recoverIntakeAnalysisLaunch()).toBe("due");
  expect(vi.mocked(processAffaireIntakeAnalysisLaunch).mock.calls.map(([id]) => id)).toEqual(["exhausted", "due"]);
});

it("a signed-out Mac leaves the same member’s launch for the Mac with its authorised profile", async () => {
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(true);
  vi.mocked(getLocalChatGptCredential).mockResolvedValue(null);
  await recoverIntakeAnalysisLaunch();
  expect(vi.mocked(processAffaireIntakeAnalysisLaunch).mock.calls.flat()).not.toContain("due");
  expect(retired).toContain("due");
});

it("the hosted sweep retires an overdue reading when neither Mac has the connection", async () => {
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(false);
  await recoverIntakeAnalysisLaunch();
  expect(retired).toContain("due");
  expect(vi.mocked(processAffaireIntakeAnalysisLaunch).mock.calls.flat()).not.toContain("due");
});
