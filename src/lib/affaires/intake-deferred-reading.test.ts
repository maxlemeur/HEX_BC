import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { expect, it, vi } from "vitest";
import { scheduleIntakeTranscriptionAfterRetry } from "./intake-transcription-server";
import { callLocalChatGptStructured } from "@/lib/ai/chatgpt-local-inference";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const { afterResponse } = vi.hoisted(() => ({ afterResponse: vi.fn<(job: () => Promise<void>) => void>() }));
vi.mock("next/server", () => ({ after: afterResponse }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: () => true,
  getLocalChatGptCredential: async () => ({ model: "fixture" }),
}));
vi.mock("@/lib/ai/chatgpt-local-inference", () => ({
  assertLocalChatGptOverride: async () => ({ model: "fixture" }),
  callLocalChatGptStructured: vi.fn(),
  LocalChatGptOverrideUnavailableError: class extends Error {},
}));

it.each([0, 1])("a deferred retry sends exactly %i pages when its caller loses the dossier", async allowedPages => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  const bytes = Uint8Array.from(await pdf.save()).buffer;
  const owner = { userId: "retry-caller", tenantId: "tenant" };
  const sent: string[] = [];
  let writeAllowed = true;
  const updatedAt = new Date(Date.now() - 6 * 60_000).toISOString();
  let version = updatedAt;
  let released = false;
  const service = createClient("http://127.0.0.1:54321", "fictional", { global: { fetch: async (input, init) => {
    const endpoint = new URL(String(input)).pathname.split("/").at(-1);
    if (endpoint === "intake_payer_can_write") {
      expect(JSON.parse(String(init?.body))).toEqual({ p_user_id: owner.userId, p_tenant_id: owner.tenantId, p_project_id: "affaire" });
      return Response.json(writeAllowed);
    }
    if (endpoint === "affaire_intake_document_transcriptions") return Response.json(null);
    if (endpoint === "affaire_intake_documents") {
      expect(new URL(String(input)).searchParams.get("updated_at")).toBe(`eq.${version}`);
      if (init?.method === "PATCH") {
        const update = JSON.parse(String(init.body));
        if (update.updated_at) version = update.updated_at;
        else {
          expect(update).toEqual({ issues: ["Diagnostic conservé."] });
          released = true;
        }
      }
      return Response.json({ updated_at: version });
    }
    throw new Error("Unexpected owned fixture request");
  } } });
  vi.mocked(createServiceRoleClient).mockReturnValue(service as ReturnType<typeof createServiceRoleClient>);
  vi.mocked(callLocalChatGptStructured).mockImplementation(async (caller, options) => {
    await options.beforeSend?.();
    sent.push(caller.userId);
    writeAllowed = false;
    return { data: { texte: "Première page fictive" } } as never;
  });
  expect(await scheduleIntakeTranscriptionAfterRetry({ context: { ...owner, supabase: createServiceRoleClient() },
    projectId: "affaire", reservation: { updatedAt, finalIssues: ["Diagnostic conservé."] }, document: { id: "piece", fileName: "scan.pdf" }, bytes, mimeType: "application/pdf", sourceSha256: "fixture" })).toBe(true);
  writeAllowed = allowedPages === 1;
  await afterResponse.mock.lastCall![0]();
  expect(sent).toEqual(Array(allowedPages).fill("retry-caller"));
  expect(version).not.toBe(updatedAt);
  expect(released).toBe(true);
});
