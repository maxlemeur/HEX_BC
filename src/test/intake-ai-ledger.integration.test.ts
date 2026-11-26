import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { launchAffaireIntakeAnalysis, readAffaireIntakeAiOptions } from "@/app/dashboard/affaires/_actions/intake";
import { readIntakeAiBatch } from "@/lib/affaires/intake-ai-server";
import { INTAKE_AI_BUDGET_STOP } from "@/lib/affaires/intake-ai-settings";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { E2E_SECRET_STORE } from "@/lib/ai/access/secret-store";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recoverIntakeAnalysisLaunch } from "@/lib/workflows/intake-launch-recovery";
import type { Database } from "@/types/database";
import { assertLoopbackSupabaseUrl } from "./local-supabase-ci";

const deferred: Array<() => Promise<void>> = [];
let session: SupabaseClient<Database>;
vi.mock("next/server", () => ({ after: (run: () => Promise<void>) => deferred.push(run) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3163" }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => session }));

it.runIf(process.env.MERGEONE_TEST_INTAKE_AI_LEDGER === "1")(
  "resumes a persisted key-funded launch and refuses a generation that would exceed its remaining budget",
  async () => {
    expect(process.env.RLS_E2E_EPHEMERAL).toBe("1");
    expect(process.env.RLS_E2E_LOCAL).toBe("1");
    const backend = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    assertLoopbackSupabaseUrl(backend);
    const cwd = process.cwd();
    const directory = await mkdtemp(path.join(tmpdir(), "mergeone-intake-ai-ledger-"));
    const model = "gpt-6.2-sol";
    const effort = "high";
    // 260,000 input and 12,000 output tokens cost 0.64 USD in Standard.
    // The next preflight costs up to 1.35 USD in input alone, before output.
    const afterFirstGeneration = 1_360_000_000;
    const generation: Array<{ model: string; reasoning: { effort: string } }> = [];
    const counts: Array<{ model: string; reasoning: { effort: string } }> = [];
    const fetchLocal = globalThis.fetch;
    const secretMemory = new Map<string, string>();
    let launchId: string;
    let resumedBalance: number | undefined;

    try {
      process.chdir(directory); // Keep both private store directories inside this fixture.
      vi.stubEnv("CI", "");
      vi.stubEnv("VERCEL", "");
      vi.stubEnv("E2E_ARMY", "1");
      vi.stubEnv("MERGEONE_CHATGPT_LOCAL", "1");
      vi.stubEnv("MERGEONE_INTAKE_DECISIONS", "0");
      vi.stubEnv("PORT", "3163");
      (globalThis as Record<symbol, unknown>)[E2E_SECRET_STORE] = {
        kind: "e2e-memory", placeLabel: "Trousseau fictif",
        read: (service: string, account: string) => secretMemory.get(`${service}:${account}`) ?? null,
        write: (service: string, account: string, value: string) => secretMemory.set(`${service}:${account}`, value),
        remove: (service: string, account: string) => secretMemory.delete(`${service}:${account}`),
      };

      const service = createServiceRoleClient();
      const projectId = randomUUID();
      const uploadId = randomUUID();
      const email = `intake-${randomUUID()}@example.test`;
      const password = randomUUID();
      const scope = { projectId, tenantId: "", payerId: "" };
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin === new URL(backend).origin) return fetchLocal(input, init);
        if (url.origin !== "https://api.openai.com") throw new Error("Unexpected network origin in intake fixture");
        if (url.pathname === "/v1/models") return Response.json({ data: [{ id: model }] });
        if (url.pathname === "/v1/responses/input_tokens") {
          counts.push(JSON.parse(String(init?.body)));
          if (counts.length === 2) {
            // The first generation settled. Expire the lease between preflight and
            // reservation of the next document to simulate a worker interruption.
            const expired = await service.from("affaire_intake_uploads").update({
              processing_lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
            }).eq("id", launchId);
            expect(expired.error).toBeNull();
          }
          if (counts.length === 3) {
            resumedBalance = (await readIntakeAiBatch(service, launchId, scope))?.remaining_nano_usd;
            return Response.json({ input_tokens: 270_000 });
          }
          return Response.json({ input_tokens: 260_000 });
        }
        if (url.pathname === "/v1/responses") {
          generation.push(JSON.parse(String(init?.body)));
          return Response.json({
            status: "completed", model, service_tier: "default",
            usage: { input_tokens: 260_000, output_tokens: 12_000, total_tokens: 272_000 },
            output: [{ type: "message", content: [{ type: "output_text",
              text: JSON.stringify({ documentKind: "cctp", confidence: 0.98, issues: [] }) }] }],
          });
        }
        throw new Error("Unexpected provider route in intake fixture");
      });

      const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
      expect(created.error).toBeNull();
      scope.payerId = created.data.user!.id;
      session = createClient(backend, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
      expect((await session.auth.signInWithPassword({ email, password })).error).toBeNull();
      const membership = await service.from("tenant_memberships").select("tenant_id")
        .eq("user_id", scope.payerId).eq("is_default", true).single();
      expect(membership.error).toBeNull();
      scope.tenantId = membership.data!.tenant_id;
      expect((await service.from("estimate_projects").insert({
        id: projectId, tenant_id: scope.tenantId, user_id: scope.payerId, name: "Rénovation fictive de la médiathèque",
      })).error).toBeNull();
      expect((await service.from("affaire_intake_uploads").insert({
        id: uploadId, project_id: projectId, created_by: scope.payerId, status: "deposited",
      })).error).toBeNull();
      const documentIds = [randomUUID(), randomUUID()];
      for (const [index, id] of documentIds.entries()) {
        const fileName = `piece-fictive-${index + 1}.txt`;
        const source = `Prescriptions fictives concernant le lot ${index + 1} de la médiathèque.`;
        const storagePath = `${scope.tenantId}/${projectId}/${uploadId}/${fileName}`;
        expect((await service.storage.from("affaire-intake").upload(storagePath, source, { contentType: "text/plain" })).error).toBeNull();
        expect((await service.from("affaire_intake_documents").insert({
          id, upload_id: uploadId, project_id: projectId, tenant_id: scope.tenantId,
          file_name: fileName, storage_path: storagePath, mime_type: "text/plain", size_bytes: Buffer.byteLength(source),
          created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          upload_status: "uploaded", classification_status: "awaiting_launch",
        })).error).toBeNull();
      }

      const owner = { tenantId: scope.tenantId, userId: scope.payerId };
      const api = openAiApiKeyAccess();
      const saved = await api.save(owner, { key: `sk-proj-${"fictionalLedger".repeat(4)}` });
      if (saved.outcome !== "saved" || saved.state.status !== "saved") throw new Error("Fictional fixture key was not saved");
      const { connectionId, version } = saved.state.connection;
      await api.saveAnalysisPreferences(owner, { billingSource: "personal_api_key", apiModel: model, apiReasoningEffort: effort }, connectionId);
      expect(await readAffaireIntakeAiOptions(projectId)).toMatchObject({ defaultSource: "personal_api_key", keyConnectionId: connectionId });
      await expect(launchAffaireIntakeAnalysis(projectId, {
        source: "personal_api_key", model, effort, expectedConnectionId: connectionId,
      })).resolves.toEqual({ message: "Analyse du dossier lancée." });
      const queued = await service.from("affaire_intake_uploads").select("id").eq("project_id", projectId).eq("status", "launch_queued").single();
      expect(queued.error).toBeNull();
      launchId = queued.data!.id;
      const selection = { source: "personal_api_key", connection: { id: connectionId, version }, preferences: { model, reasoningEffort: effort } };
      expect(await readIntakeAiBatch(service, launchId, scope)).toMatchObject({
        selection, remaining_nano_usd: 2_000_000_000,
      });
      const legacyClaim = await service.rpc("claim_affaire_intake_analysis_launch", { p_upload_id: launchId, p_lease_token: randomUUID() });
      expect(legacyClaim).toMatchObject({ data: [], error: null });
      expect(deferred).toHaveLength(1);
      await deferred[0]();
      expect(await readIntakeAiBatch(service, launchId, scope)).toMatchObject({ remaining_nano_usd: afterFirstGeneration });
      expect(generation).toMatchObject([{ model, reasoning: { effort } }]);
      const receipt = await service.from("affaire_intake_events").select("after_payload")
        .eq("document_id", documentIds[0]).eq("event_type", "document.classified").single();
      expect(receipt).toMatchObject({
        data: { after_payload: { ai: { source: "personal_api_key", model, reasoningEffort: effort } } }, error: null,
      });

      // A profile change between attempts cannot alter this accepted launch.
      await api.saveAnalysisPreferences(owner, {
        billingSource: "chatgpt_plan", apiModel: model, apiReasoningEffort: "low",
      }, connectionId);
      await expect(recoverIntakeAnalysisLaunch()).resolves.toBe(launchId);
      expect(resumedBalance).toBe(afterFirstGeneration);
      expect(await readIntakeAiBatch(service, launchId, scope)).toMatchObject({
        selection, remaining_nano_usd: afterFirstGeneration, budget_stop_message: INTAKE_AI_BUDGET_STOP,
      });
      const stopped = await service.from("affaire_intake_uploads").select("status, attempt_count, last_error").eq("id", launchId).single();
      expect(stopped).toMatchObject({ data: { status: "failed", attempt_count: 2, last_error: INTAKE_AI_BUDGET_STOP }, error: null });
      expect(counts).toHaveLength(3);
      expect(counts[2]).toMatchObject({ model, reasoning: { effort } });
      expect(generation).toHaveLength(1);
      const documents = await service.from("affaire_intake_documents").select("id, document_kind").in("id", documentIds).order("created_at");
      expect(documents).toMatchObject({ data: [{ id: documentIds[0], document_kind: "cctp" }, { id: documentIds[1], document_kind: "a_classer" }], error: null });
    } finally {
      process.chdir(cwd);
      delete (globalThis as Record<symbol, unknown>)[E2E_SECRET_STORE];
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
