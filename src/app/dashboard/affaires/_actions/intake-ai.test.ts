import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { beforeEach, expect, it, vi } from "vitest";
import { launchAffaireIntakeAnalysis, readAffaireIntakeAiOptions, retryAffaireDocumentAnalysis } from "./intake";
import { createIntakeAiRunner, IntakeAiBudgetStopped, readIntakeAiBatch, resolveIntakeAiSelection } from "@/lib/affaires/intake-ai-server";
import { processAffaireIntakeAnalysisLaunch, retryAffaireDocumentAnalysis as retryDocument } from "@/lib/affaires/intake-analysis-server";
import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { refreshAffaireIntakeFromActiveDocuments } from "@/lib/affaires/intake-derived-state-server";
import { readEditableIntakeDocument } from "@/lib/affaires/intake-editable-document-server";
import { AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE, isAffaireIntakeAnalysisStale, isAffaireIntakeReanalysisPending } from "@/lib/affaires/intake";
import { scheduleIntakeTranscriptionAfterRetry } from "@/lib/affaires/intake-transcription-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const { rpc, after, access, planGrant } = vi.hoisted(() => ({ rpc: vi.fn(), after: vi.fn<(effect: () => Promise<void>) => void>(), access: vi.fn(), planGrant: vi.fn() }));
vi.mock("next/server", async (actual) => ({ ...await actual<typeof import("next/server")>(), after }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: access }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/affaires/intake-editable-document-server", () => ({ readEditableIntakeDocument: vi.fn() }));
vi.mock("@/lib/affaires/intake-payer-server", async (actual) => ({
  ...await actual<typeof import("@/lib/affaires/intake-payer-server")>(),
  readSelectedIntakePlanConnection: planGrant,
}));
vi.mock("@/lib/ai/request-settings-server", () => ({
  readAiRequestOptions: vi.fn(async () => ({
    defaultSource: "chatgpt_plan",
    options: { chatgpt_plan: { ok: true, message: "Forfait fictif", models: [],
      preferences: { model: "fixture-plan", reasoningEffort: "high" }, connection: null } },
  })),
  resolveAiRequest: vi.fn(async () => ({
    ok: true, source: "chatgpt_plan", connection: null, preferences: { model: "fixture-plan", reasoningEffort: "high" },
  })),
}));
vi.mock("@/lib/affaires/intake-ai-server", async (actual) => ({
  ...await actual<typeof import("@/lib/affaires/intake-ai-server")>(),
  createIntakeAiRunner: vi.fn(), readIntakeAiBatch: vi.fn(), resolveIntakeAiSelection: vi.fn(),
}));
vi.mock("@/lib/affaires/intake-analysis-server", () => ({
  processAffaireIntakeAnalysisLaunch: vi.fn(), retryAffaireDocumentAnalysis: vi.fn(),
}));
vi.mock("@/lib/supabase/read-all", () => ({ readAllRowsInChunks: vi.fn() }));
vi.mock("@/lib/affaires/intake-derived-state-server", () => ({ refreshAffaireIntakeFromActiveDocuments: vi.fn() }));

const projectId = "12eac43b-087d-481e-a2fb-a151d1b76e2f";
const tenantId = "2b5bb144-d1ed-4033-b21d-24b3e5d39ce0";
const userId = "9527a3fa-551d-4787-9cd8-1767824d48ee";
const batchId = "980e45b3-a0cd-4e09-b293-da1eea1639d8";
const second = "c506d80b-91a5-44c0-9e63-0327ca5d2703";
const third = "0044dc58-3784-4077-8f50-6366b32c684a";
const choice = { source: "personal_api_key", expectedConnectionId: "fictive", model: "gpt-6.2-sol", effort: "high" } as const;
const selection = { source: choice.source, connection: { id: choice.expectedConnectionId, version: 4 },
  preferences: { model: choice.model, reasoningEffort: choice.effort } } as const;
const batch = { id: batchId, launch_id: null, project_id: projectId, payer_id: userId, tenant_id: tenantId,
  budget_stop_message: null, finished_at: null, selection, ceiling_nano_usd: 2_000_000_000, remaining_nano_usd: 2_000_000_000 } as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);
  access.mockResolvedValue({ project: { id: projectId }, context: { userId, tenantId } });
  vi.mocked(resolveIntakeAiSelection).mockResolvedValue(selection);
  vi.mocked(readIntakeAiBatch).mockResolvedValue(batch);
  vi.mocked(createIntakeAiRunner).mockReturnValue({ source: "personal_api_key", run: vi.fn() });
  vi.mocked(readAllRowsInChunks).mockImplementation(async ids => ({
    data: ids.map((id, index) => ({ id, file_name: `${index + 1}.txt` })), error: null,
  }));
});

it("starts the worker with an accepted lot id after recording the explicit authenticated choice", async () => {
  rpc.mockResolvedValue({ data: [{ outcome: "launched", batch_id: batchId, piece_count: 2 }] });
  await expect(launchAffaireIntakeAnalysis(projectId, choice)).resolves.toEqual({ message: "Analyse du dossier lancée." });
  expect(resolveIntakeAiSelection).toHaveBeenCalledWith({ userId, tenantId }, choice);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("start_affaire_intake_ai_batch", {
    p_project_id: projectId, p_tenant_id: tenantId, p_payer_id: userId, p_selection: selection, p_retry: false,
  });
  expect(processAffaireIntakeAnalysisLaunch).not.toHaveBeenCalled();
  await after.mock.calls[0][0]();
  expect(processAffaireIntakeAnalysisLaunch).toHaveBeenCalledExactlyOnceWith(batchId, null, {
    projectId, tenantId, payerId: userId,
  });
});

it("gives all retry documents the same persisted batch and leaves later documents untouched at the cap", async () => {
  rpc.mockResolvedValue({ data: [{ outcome: "retry", batch_id: batchId, piece_count: 0 }] });
  const readPage = vi.fn();
  vi.mocked(retryDocument).mockImplementationOnce(async input => {
    input.defer?.(readPage);
    return { uploadId: batchId, analyzed: true, usedFallback: false, preservedManualClassification: true, failure: undefined, warning: null };
  }).mockRejectedValueOnce(new IntakeAiBudgetStopped());
  const result = await retryAffaireDocumentAnalysis({ projectId, choice, documentIds: [projectId, second, third] });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("start_affaire_intake_ai_batch", expect.objectContaining({ p_retry: true, p_selection: selection }));
  expect(retryDocument).toHaveBeenCalledTimes(2);
  expect(vi.mocked(retryDocument).mock.calls[0][0].ai).toBe(vi.mocked(retryDocument).mock.calls[1][0].ai);
  expect(result.message).toContain("2,00 $ US");
  expect(result.failures).toContainEqual(expect.stringMatching(/^3.txt : analyse non lancée/));
  await after.mock.calls[0][0]();
  expect(readPage).toHaveBeenCalledOnce();
  expect(refreshAffaireIntakeFromActiveDocuments).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith("finish_affaire_intake_ai_retry", {
    p_batch_id: batchId, p_project_id: projectId, p_tenant_id: tenantId, p_payer_id: userId,
  });
});

async function deferredReadings(pageCount: number) {
  const documentIds = [projectId, second];
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) pdf.addPage();
  const bytes = Uint8Array.from(await pdf.save()).buffer;
  const sourceSha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
  const rows = Object.fromEntries(documentIds.map((id, index) => [id, {
    id, file_name: `${index + 1}.pdf`, upload_status: "uploaded", classification_status: "classified",
    updated_at: new Date().toISOString(), issues: [AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE],
  }]));
  const transcriptions = new Map<string, { pages: unknown[]; status: string }>();
  const api = createClient("http://127.0.0.1:54321", "fixture", { global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/affaire_intake_document_transcriptions")) {
      if (init?.method === "POST") {
        const row = JSON.parse(String(init.body));
        transcriptions.set(row.document_id, row);
      }
      return Response.json(null);
    }
    if (!url.pathname.endsWith("/affaire_intake_documents")) throw new Error("Unexpected fixture request");
    const row = rows[url.searchParams.get("id")!.slice(3)];
    expect(url.searchParams.get("updated_at")).toBe(`eq.${row.updated_at}`);
    if (init?.method === "PATCH") {
      Object.assign(row, JSON.parse(String(init.body)));
    }
    return Response.json({ updated_at: row.updated_at });
  } } });
  const supabase = { rpc, from: api.from.bind(api) } as unknown as ReturnType<typeof createServiceRoleClient>;
  const context = { userId, tenantId, supabase };
  vi.mocked(createServiceRoleClient).mockReturnValue(supabase);
  access.mockResolvedValue({ project: { id: projectId }, context });
  rpc.mockImplementation(async (name: string) => ({
    data: name === "start_affaire_intake_ai_batch" ? [{ outcome: "retry", batch_id: batchId, piece_count: 0 }] : true, error: null,
  }));
  vi.mocked(retryDocument).mockImplementation(async input => {
    const document = rows[input.documentId];
    await scheduleIntakeTranscriptionAfterRetry({ context, projectId, document: { id: document.id, fileName: document.file_name },
      mimeType: "application/pdf", sourceSha256, readBytes: async () => bytes, readAi: input.readAi, defer: input.defer,
      reservation: { updatedAt: document.updated_at, finalIssues: [] } });
    return { uploadId: batchId, analyzed: true, usedFallback: false, preservedManualClassification: true, failure: undefined, warning: null };
  });
  return { documentIds, rows, transcriptions };
}

it("keeps the second scan reserved and transcribes it when the first reading takes over ten minutes", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const startedAt = Date.now();
  const pages = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
  let complete: Promise<void> | undefined;
  try {
    const { documentIds, rows, transcriptions } = await deferredReadings(pages.length);
    const sends = vi.fn();
    const run = vi.fn(async (stage, options) => {
      expect(stage).toBe("transcription");
      await options.beforeSend();
      const [, page, file] = /page (\d+) de la pièce « ([^»]+) »/.exec(options.prompt)!;
      sends(file, Number(page));
      await pages[Number(page) - 1].promise;
      return { data: { texte: "Page fictive" }, receipt: { source: "personal_api_key", model: "gpt-6.1-terra", reasoningEffort: "high" } };
    });
    vi.mocked(createIntakeAiRunner).mockReturnValue({ source: "personal_api_key", run } as never);
    await retryAffaireDocumentAnalysis({ projectId, documentIds, choice });
    complete = after.mock.calls[0][0]();
    for (let i = 0; i < pages.length; i++) {
      await vi.waitFor(() => {
        expect(sends).toHaveBeenCalledWith("1.pdf", i + 1);
        expect(sends).toHaveBeenCalledWith("2.pdf", i + 1);
      });
      if (i === pages.length - 1) break;
      vi.setSystemTime(startedAt + (i + 1) * 3 * 60_000);
      pages[i].resolve();
    }
    vi.setSystemTime(startedAt + 11 * 60_000);
    const pending = rows[second];
    expect(isAffaireIntakeReanalysisPending(pending)).toBe(true);
    expect(isAffaireIntakeAnalysisStale({ ...pending, classificationUpdatedAt: pending.updated_at })).toBe(false);
    const real = await vi.importActual<typeof import("@/lib/affaires/intake-analysis-server")>("@/lib/affaires/intake-analysis-server");
    vi.mocked(readEditableIntakeDocument).mockResolvedValue(pending as never);
    await expect(real.retryAffaireDocumentAnalysis({ projectId, documentId: second, ai: createIntakeAiRunner({} as never, batch, null) }))
      .rejects.toMatchObject({ status: 409, message: "Une analyse de cette pièce est déjà en cours." });
    expect(refreshAffaireIntakeFromActiveDocuments).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some(([name]) => name === "finish_affaire_intake_ai_retry")).toBe(false);
    pages.at(-1)!.resolve();
    await complete;
    expect(transcriptions.get(second)).toMatchObject({ status: "completed", pages: expect.arrayContaining([{ page: 4, text: "Page fictive", illegible: 0 }]) });
    expect(rows[second].issues).toEqual([]);
    expect(refreshAffaireIntakeFromActiveDocuments).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenLastCalledWith("finish_affaire_intake_ai_retry", expect.objectContaining({ p_batch_id: batchId }));
  } finally {
    for (const page of pages) page.resolve();
    await complete;
    vi.useRealTimers();
  }
});

it("clears both concurrent reading reservations and skips the brief when the batch stops", async () => {
  const { documentIds, rows, transcriptions } = await deferredReadings(1);
  const admitted = Promise.withResolvers<void>();
  const finishPage = Promise.withResolvers<void>();
  const sent = vi.fn();
  const stop = new IntakeAiBudgetStopped();
  const run = vi.fn(async (stage, options) => {
    expect(stage).toBe("transcription");
    await options.beforeSend();
    if (options.prompt.includes("« 2.pdf »")) {
      await admitted.promise;
      vi.mocked(readIntakeAiBatch).mockResolvedValue({ ...batch, budget_stop_message: stop.message });
      throw stop;
    }
    sent();
    admitted.resolve();
    await finishPage.promise;
    return { data: { texte: "Lecture fictive admise" }, receipt: { source: "personal_api_key", model: "gpt-6.1-terra", reasoningEffort: "high" } };
  });
  vi.mocked(createIntakeAiRunner).mockReturnValue({ source: "personal_api_key", run } as never);
  await retryAffaireDocumentAnalysis({ projectId, documentIds, choice });
  const complete = after.mock.calls[0][0]();
  try {
    await vi.waitFor(() => expect(rows[second].issues).toEqual([stop.message]));
    expect(isAffaireIntakeReanalysisPending(rows[projectId])).toBe(true);
    expect(rpc.mock.calls.some(([name]) => name === "finish_affaire_intake_ai_retry")).toBe(false);
  } finally {
    finishPage.resolve();
    await complete;
  }
  expect(sent).toHaveBeenCalledOnce();
  expect(rows[projectId].issues).toEqual([]);
  expect(transcriptions.get(projectId)).toMatchObject({ status: "completed" });
  expect(transcriptions.get(second)).toMatchObject({ error_code: "AI_KEY_CEILING" });
  expect(refreshAffaireIntakeFromActiveDocuments).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenLastCalledWith("finish_affaire_intake_ai_retry", expect.objectContaining({ p_batch_id: batchId }));
});

it("refuses a different plan grant between display and acceptance before reserving a batch", async () => {
  const grantA = { profileId: "fixture-account-a", authorizationId: "fixture-grant-a" };
  const grantB = { profileId: "fixture-account-b", authorizationId: "fixture-grant-b" };
  planGrant.mockResolvedValueOnce(grantA).mockResolvedValueOnce(grantB);
  const real = await vi.importActual<typeof import("@/lib/affaires/intake-ai-server")>("@/lib/affaires/intake-ai-server");
  vi.mocked(resolveIntakeAiSelection).mockImplementation(real.resolveIntakeAiSelection);
  const shown = await readAffaireIntakeAiOptions(projectId);
  expect(shown.planConnectionId).toMatch(/^[0-9a-f]{64}$/);
  expect(await launchAffaireIntakeAnalysis(projectId, {
    source: "chatgpt_plan", model: "fixture-plan", effort: "high", expectedConnectionId: shown.planConnectionId!,
  })).toEqual({
    message: "Le forfait ChatGPT affiché a changé. Rechargez les réglages avant de lancer l’analyse.",
  });
  expect(rpc).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
});
