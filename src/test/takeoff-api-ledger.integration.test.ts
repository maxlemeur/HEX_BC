import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { expect, it, vi } from "vitest";
import { launchPreparedTakeoffFromPlanSetAction } from "@/app/dashboard/affaires/_actions/takeoff";
import { confirmTakeoffPreparationAction, loadTakeoffExecutionPreviewAction } from "@/app/dashboard/affaires/_actions/takeoff-preparation";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { E2E_SECRET_STORE } from "@/lib/ai/access/secret-store";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";
import { loadTakeoffPreparation, saveTakeoffPreparation } from "@/lib/takeoff/preparation-server";
import { confirmedPreparationFixture } from "@/lib/takeoff/preparation.test-utils";
import type { Database } from "@/types/database";
import { assertLoopbackSupabaseUrl } from "./local-supabase-ci";

let session: SupabaseClient<Database>;
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3163" }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => session }));

it.runIf(process.env.MERGEONE_TEST_TAKEOFF_API_LEDGER === "1").each(["before commit", "after commit"] as const)(
  "replays the known PDF settlement after a fault %s and refuses the next chunk at the sealed ceiling",
  async (fault) => {
    expect(process.env.RLS_E2E_EPHEMERAL).toBe("1");
    expect(process.env.RLS_E2E_LOCAL).toBe("1");
    const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    assertLoopbackSupabaseUrl(backend);
    const cwd = process.cwd();
    const directory = await mkdtemp(path.join(tmpdir(), "mergeone-takeoff-api-"));
    const model = "gpt-6.2-sol";
    const effort = "high";
    const secretMemory = new Map<string, string>();
    const fetchLocal = globalThis.fetch;
    const calls: string[] = [];
    const settlements: { body: string; sentAt: number }[] = [];
    const scopes = globalThis as Record<symbol, unknown>;
    let jobId: string;
    function ledger() {
      const probe = "select bound_nano_usd, actual_nano_usd from private.takeoff_api_calls where job_id = '" + jobId + "'";
      return execFileSync(process.env.E2E_ARMY_LOCAL_PSQL!, [
        "-X", "-At", "-d", process.env.E2E_ARMY_LOCAL_DB_URL!, "-c", probe,
      ], { encoding: "utf8" }).trim();
    }
    try {
      process.chdir(directory);
      vi.stubEnv("CI", "");
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("E2E_ARMY", "1");
      vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1");
      vi.stubEnv("MERGEONE_TAKEOFF_VECTORS", "0");
      vi.stubEnv("MERGEONE_TAKEOFF_DECISIONS", "0");
      vi.stubEnv("TAKEOFF_MODULE_FORCE_ENABLED", "1");
      vi.stubEnv("TAKEOFF_LEVEL_C_MAX_COST_CENTS", "100");
      vi.stubEnv("PORT", "3163");
      scopes[E2E_SECRET_STORE] = {
        kind: "e2e-memory", placeLabel: "Trousseau fictif",
        read: (service: string, account: string) => secretMemory.get(`${service}:${account}`) ?? null,
        write: (service: string, account: string, value: string) => secretMemory.set(`${service}:${account}`, value),
        remove: (service: string, account: string) => secretMemory.delete(`${service}:${account}`),
      };
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === new URL(backend).origin) {
          if (!url.pathname.endsWith("/rpc/settle_takeoff_api_call")) return fetchLocal(input, init);
          settlements.push({ body: String(init?.body), sentAt: performance.now() });
          if (settlements.length === 3) return fetchLocal(input, init);
          if (settlements.length === 1 && fault === "after commit") {
            const committed = await fetchLocal(input, init);
            expect(await committed.json()).toBe(true);
            expect(ledger()).toMatch(/^\d+\|310000000$/);
          } else if (fault === "before commit") {
            expect(ledger()).toMatch(/^\d+\|$/);
          }
          return Response.json({ message: "Fictional lost settlement response" }, { status: 503 });
        }
        if (url.origin !== "https://api.openai.com") throw new Error("Unexpected network origin in takeoff fixture");
        if (url.pathname === "/v1/models") return Response.json({ data: [{ id: model }] });
        const payload = JSON.parse(String(init?.body));
        expect(payload).toMatchObject({ model, reasoning: { effort } });
        calls.push(url.pathname);
        if (url.pathname === "/v1/responses/input_tokens") return Response.json({ input_tokens: 160_000 });
        if (url.pathname !== "/v1/responses") throw new Error("Unexpected fixture provider path");
        expect(ledger()).toMatch(/^\d+\|$/);
        return Response.json({ status: "completed", model, service_tier: "default",
          usage: { input_tokens: 150_000, output_tokens: 1_000, total_tokens: 151_000 },
          output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
            confidence: 0.95, warnings: [], items: [{ designation: "Lavabo fictif", quantity: 2, unit: "u",
              source_page: 1, evidence: "Repère F-01", confidence: 0.95 }],
            metadata: { level: "C", prompt_version: "fixture", schema_version: "v1", file_type: "application/pdf" },
          }) }] }],
        });
      });

      const service = createServiceRoleClient();
      const email = `takeoff-${randomUUID()}@example.test`;
      const password = randomUUID();
      const user = await service.auth.admin.createUser({ email, password, email_confirm: true });
      expect(user.error).toBeNull();
      const userId = user.data.user!.id;
      session = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await session.auth.signInWithPassword({ email, password })).error).toBeNull();
      const membership = await service.from("tenant_memberships").select("tenant_id").eq("user_id", userId).eq("is_default", true).single();
      expect(membership.error).toBeNull();
      const tenantId = membership.data!.tenant_id;
      const owner = { userId, tenantId };
      const projectId = randomUUID();
      const versionId = randomUUID();
      const planSetId = randomUUID();
      const fileId = randomUUID();
      const fileName = "ecole-fictive.pdf";
      const filePath = `${tenantId}/${planSetId}/${fileId}/${fileName}`;
      const pdf = await PDFDocument.create();
      for (let index = 0; index < 16; index += 1) pdf.addPage();
      const bytes = Buffer.from(await pdf.save());
      expect((await service.from("estimate_projects").insert({
        id: projectId, tenant_id: tenantId, user_id: userId, name: "École fictive",
      })).error).toBeNull();
      expect((await service.from("estimate_versions").insert({
        id: versionId, tenant_id: tenantId, project_id: projectId, version_number: 1, status: "draft", title: "Métré de l’école fictive",
      })).error).toBeNull();
      expect((await service.from("plan_sets").insert({
        id: planSetId, tenant_id: tenantId, project_id: projectId, estimate_version_id: versionId, name: "Plans fictifs",
      })).error).toBeNull();
      expect((await service.storage.from("plan-files").upload(filePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
      expect((await service.from("plan_files").insert({
        id: fileId, tenant_id: tenantId, plan_set_id: planSetId, file_name: fileName,
        file_path: filePath, file_type: "application/pdf", file_size_bytes: bytes.length, page_count: 16,
      })).error).toBeNull();

      const api = openAiApiKeyAccess();
      const saved = await api.save(owner, { key: `sk-proj-${"fictionalTakeoff".repeat(4)}` });
      if (saved.outcome !== "saved" || saved.state.status !== "saved") throw new Error("Fictional key was not saved");
      const { connectionId } = saved.state.connection;
      await api.saveAnalysisPreferences(owner, { billingSource: "personal_api_key", apiModel: model, apiReasoningEffort: "medium" }, connectionId);
      const paymentChoice = { model, effort, expectedConnectionId: connectionId, expectedMaxCostCents: 100 };
      const preview = await loadTakeoffExecutionPreviewAction({ projectId, paymentChoice });
      expect(preview).toMatchObject({ ok: true, data: { model, reasoningEffort: effort } });
      await expect(loadTakeoffExecutionPreviewAction({ projectId, paymentChoice: { ...paymentChoice, expectedConnectionId: randomUUID() } }))
        .resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining("connexion OpenAI a changé") } });
      await expect(loadTakeoffExecutionPreviewAction({ projectId, paymentChoice: { ...paymentChoice, model: "modele-fictif-inconnu" } }))
        .resolves.toMatchObject({ ok: false, error: { message: expect.stringContaining("Ce modèle") } });
      if (!preview.ok) throw new Error(preview.error.message);

      const opened = await loadTakeoffPreparation(projectId, planSetId);
      const fixture = confirmedPreparationFixture().preparation;
      const draft = { ...opened.draft, objective: fixture.objective, objective_confirmed: true,
        scope: fixture.scope, conventions: fixture.conventions, destination: {
          kind: "estimate_review" as const, estimate_version_id: versionId, reviewer: null, confirmed: true,
        } };
      draft.sources = draft.sources.map((source) => ({ ...source, active: true, confirmed: true }));
      const review = await saveTakeoffPreparation({ projectId, draft, expectedRevision: null });
      vi.stubEnv("TAKEOFF_LEVEL_C_MAX_COST_CENTS", "200");
      await expect(confirmTakeoffPreparationAction({ projectId, expectedRevision: review.revision!, paymentChoice,
        expectedExecutionFingerprint: preview.data.fingerprint })).resolves.toMatchObject({ ok: false, error: {
        code: "TAKEOFF_PAYMENT_SETTINGS_CHANGED", reloadSettings: true,
      } });
      expect(execFileSync(process.env.E2E_ARMY_LOCAL_PSQL!, ["-X", "-At", "-d", process.env.E2E_ARMY_LOCAL_DB_URL!, "-c",
        `select count(*) from private.takeoff_api_mandates where project_id = '${projectId}'`], { encoding: "utf8" }).trim()).toBe("0");
      vi.stubEnv("TAKEOFF_LEVEL_C_MAX_COST_CENTS", "100");
      const confirmed = await confirmTakeoffPreparationAction({ projectId, expectedRevision: review.revision!, paymentChoice,
        expectedExecutionFingerprint: preview.data.fingerprint });
      if (!confirmed.ok) throw new Error(confirmed.error.message);

      const launched = await launchPreparedTakeoffFromPlanSetAction({ projectId, planSetId, versionId, level: "C", provider: "chatgpt",
        preparationRevision: confirmed.data.revision!, paymentChoice });
      if (!launched.ok) throw new Error(launched.error.message);
      jobId = launched.data.jobId;
      const outcome = await processTakeoffJobAttempt(jobId, { correlationId: randomUUID(), trigger: "create" });
      expect(outcome).toMatchObject({ status: "failed_terminal", error_code: "TAKEOFF_REQUEST_BUDGET_EXHAUSTED" });
      expect(calls).toEqual(["/v1/responses/input_tokens", "/v1/responses", "/v1/responses/input_tokens"]);
      expect(settlements).toHaveLength(3);
      expect(settlements.map(({ body }) => body)).toEqual(Array<string>(3).fill(settlements[0].body));
      expect(settlements[1].sentAt - settlements[0].sentAt).toBeGreaterThanOrEqual(450);
      expect(settlements[2].sentAt - settlements[1].sentAt).toBeGreaterThanOrEqual(950);
      expect(JSON.parse(settlements[0].body)).toMatchObject({ p_cost: 310000000, p_tokens: 151000 });
      expect(ledger()).toMatch(/^\d+\|310000000$/);
      const account = await api.state(owner);
      expect(account.analysisPreferences?.apiReasoningEffort).toBe("medium");
    } finally {
      delete scopes[E2E_SECRET_STORE];
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      process.chdir(cwd);
      await rm(directory, { recursive: true, force: true });
    }
  },
  60_000,
);
