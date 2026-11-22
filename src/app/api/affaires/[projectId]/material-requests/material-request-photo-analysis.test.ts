import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
// The provider boundary: no test reaches a ChatGPT plan.
vi.mock("@/lib/ai/structured-ai", () => ({
  callStructuredAi: vi.fn(),
  getStructuredAiAvailability: vi.fn(),
}));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: vi.fn(),
}));

import * as analysisRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/files/[fileId]/analysis/route";
import * as requestRoute from "@/app/api/affaires/[projectId]/material-requests/[requestId]/route";
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { callStructuredAi, getStructuredAiAvailability } from "@/lib/ai/structured-ai";
import { StructuredAiError } from "@/lib/ai/structured-ai-diagnostic";
import { ChatGptSignInError } from "@/lib/ai/chatgpt-sign-in-errors";
import {
  MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES,
  MATERIAL_REQUEST_PHOTO_ANALYSIS_TIMEOUT_MS,
  materialRequestPhotoAnswerSchema,
} from "@/lib/material-requests/photo-analysis";
import { z } from "zod";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes, written before the route. Everything is fictional.
 *  1. Rights: a member who may only read the affaire (viewer, director, an engineer who does not own it) spends the
 *     ChatGPT plan on a reading; a member of another tenant learns that the photo exists.
 *  2. Scope: the reading is sent a file that is not an original of this request: the photo of another request or
 *     affaire through this URL, a supplier's answer to a quote, a photo whose upload never finished, a photo being
 *     deleted.
 *  3. A reading is asked where none can run (no AI on the instance, ChatGPT plan not connected): bytes are read
 *     from storage, or the refusal does not say what to do.
 *  4. A photo too heavy for the model is downloaded and sent.
 *  5. The model is sent something else than the stored bytes of that one photo, under another type than the one
 *     verified at upload; or the reading writes lines by itself.
 *  6. A failure of the provider reaches the screen raw (its payload, its status), or without a reason the screen
 *     can act on; an answer that is not the one asked for becomes lines.
 *  7. The request does not say whether its screen may offer the reading, or says it to a reader.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const OWNER = "20000000-0000-4000-8000-000000000002";
const ENGINEER = "20000000-0000-4000-8000-000000000003";
const VIEWER = "20000000-0000-4000-8000-000000000004";
const DIRECTOR = "20000000-0000-4000-8000-000000000005";
const OUTSIDER = "20000000-0000-4000-8000-000000000006";
const PROJECT = "30000000-0000-4000-8000-000000000001";
const OTHER_PROJECT = "30000000-0000-4000-8000-000000000002";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const OTHER_REQUEST = "60000000-0000-4000-8000-000000000003";
const QUOTE = "90000000-0000-4000-8000-000000000001";
const PHOTO = "80000000-0000-4000-8000-000000000001";
const PENDING_PHOTO = "80000000-0000-4000-8000-000000000002";
const WITHDRAWN_PHOTO = "80000000-0000-4000-8000-000000000003";
const QUOTE_FILE = "80000000-0000-4000-8000-000000000004";
const HEAVY_PHOTO = "80000000-0000-4000-8000-000000000005";
const OTHER_PHOTO = "80000000-0000-4000-8000-000000000009";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
const OTHER_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x09, 0x09, 0x09, 0x09]);

type Role = "admin" | "engineer" | "viewer" | "director";

function pathOf(fileId: string, projectId = PROJECT, requestId = REQUEST) {
  return `${TENANT}/${projectId}/${requestId}/${fileId}/photo.jpg`;
}

function file(id: string, extra: FakeRow = {}): FakeRow {
  return {
    id, tenant_id: TENANT, project_id: PROJECT, request_id: REQUEST, quote_id: null, storage_path: pathOf(id),
    file_name: "photo.jpg", mime_type: "image/jpeg", byte_size: JPEG.byteLength, rotation: 0, created_by: OWNER,
    created_at: "2026-11-11T09:05:00.000Z", stored_at: "2026-11-11T09:05:02.000Z", removed_at: null, ...extra,
  };
}

function seed(actor: string, role: Role) {
  const fake = createFakeSupabase({
    userId: actor,
    rpc: { material_request_material_options: [] },
    objects: {
      [pathOf(PHOTO)]: JPEG,
      [pathOf(PENDING_PHOTO)]: OTHER_BYTES,
      [pathOf(WITHDRAWN_PHOTO)]: OTHER_BYTES,
      [pathOf(QUOTE_FILE)]: OTHER_BYTES,
      [pathOf(HEAVY_PHOTO)]: OTHER_BYTES,
      [pathOf(OTHER_PHOTO, OTHER_PROJECT, OTHER_REQUEST)]: OTHER_BYTES,
    },
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      estimate_projects: [
        { id: PROJECT, tenant_id: TENANT, user_id: OWNER, name: "Affaire 1", is_archived: false },
        { id: OTHER_PROJECT, tenant_id: TENANT, user_id: OWNER, name: "Affaire 2", is_archived: false },
      ],
      suppliers: [],
      material_requests: [REQUEST, OTHER_REQUEST].map((id) => ({
        id, tenant_id: TENANT, project_id: id === REQUEST ? PROJECT : OTHER_PROJECT, technician_id: null,
        requested_on: "2026-11-10", needed_on: null, delivery_place: null, is_urgent: false, presumed_material: null,
        material_confirmed: false, presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null,
        created_by: OWNER, created_at: "2026-11-10T09:00:00.000Z", updated_at: "2026-11-10T09:00:00.000Z",
      })),
      material_request_lines: [],
      material_request_files: [
        file(PHOTO, { rotation: 90 }),
        file(PENDING_PHOTO, { stored_at: null }),
        file(WITHDRAWN_PHOTO, { removed_at: "2026-11-11T10:00:00.000Z" }),
        file(QUOTE_FILE, { quote_id: QUOTE }),
        file(HEAVY_PHOTO, { byte_size: MATERIAL_REQUEST_PHOTO_ANALYSIS_MAX_BYTES + 1 }),
        file(OTHER_PHOTO, { project_id: OTHER_PROJECT, request_id: OTHER_REQUEST, storage_path: pathOf(OTHER_PHOTO, OTHER_PROJECT, OTHER_REQUEST) }),
      ],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(handler: unknown, method: string, params: Record<string, string>) {
  const response = await (handler as Handler)(new Request("http://localhost/api/test", { method }), {
    params: Promise.resolve(params as never),
  });
  const payload = (await response.json()) as { ok: boolean; data?: never; error?: { code: string; message: string; details?: never } };
  return { status: response.status, data: payload.data as never, error: payload.error };
}

const analyze = (fileId: string, projectId = PROJECT, requestId = REQUEST) =>
  call(analysisRoute.POST, "POST", { projectId, requestId, fileId });

const ANSWER = {
  lignes: [
    { texte: "12 coudes cuivre Ø22", quantite: 12, quantite_douteuse: false, unite: "u", dimension: "Ø 22", type: "coude", matiere: "cuivre", precision: null, reference: null, zone: null },
    { texte: "7 vannes", quantite: 7, quantite_douteuse: true, unite: null, dimension: null, type: "vanne", matiere: null, precision: null, reference: null, zone: null },
  ],
};

function answerWith(data: unknown) {
  vi.mocked(callStructuredAi).mockResolvedValue({
    data, tokenCount: 1200, tokenUsage: { inputTokens: 1000, reasoningTokens: 100, outputTokens: 100, totalTokens: 1200 },
    costCents: 0, durationMs: 4200, model: "modele-fictif", promptVersion: "test", provider: "chatgpt",
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(true);
  vi.mocked(getStructuredAiAvailability).mockResolvedValue({ available: true, message: "Connexion ChatGPT configurée." });
  answerWith(ANSWER);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("POST material request photo analysis", () => {
  it("reads the stored bytes of that one photo and answers drafts, writing nothing", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, data } = await analyze(PHOTO);

    expect(status).toBe(200);
    expect(data).toEqual({
      file_id: PHOTO,
      model: "modele-fictif",
      lines: [
        { original_text: "12 coudes cuivre Ø22", quantity: 12, unit: "u", dimension: "Ø 22", product_type: "coude", material: "cuivre" },
        { original_text: "7 vannes", quantity: 7, quantity_doubtful: true, product_type: "vanne" },
      ],
    });
    expect(fake.writes).toEqual([]);
    expect(fake.storageCalls).toEqual([{ operation: "download", bucket: "material-requests", path: pathOf(PHOTO) }]);

    expect(callStructuredAi).toHaveBeenCalledTimes(1);
    const [options, owner] = vi.mocked(callStructuredAi).mock.calls[0];
    // The interactive call: the plan is the caller's own, resolved from their session by the AI module.
    expect(owner).toBeUndefined();
    expect(options.files).toEqual([{ mimeType: "image/jpeg", data: Buffer.from(JPEG).toString("base64"), detail: "high" }]);
    // The photo was turned a quarter on screen: the model is told how to read it upright.
    expect(options.prompt).toMatch(/quart de tour dans le sens des aiguilles/);
    expect(options.context).toMatchObject({ tenantId: TENANT });
    // The answer asked for is this reading's own, within the time of one call on the plan.
    expect(options.schema).toBe(materialRequestPhotoAnswerSchema);
    expect(options.timeoutMs).toBe(MATERIAL_REQUEST_PHOTO_ANALYSIS_TIMEOUT_MS);
  });

  it.each<[string, string, Role]>([
    ["a viewer", VIEWER, "viewer"],
    ["a director", DIRECTOR, "director"],
    ["an engineer who does not own the affaire", ENGINEER, "engineer"],
  ])("refuses %s, who may only read: no plan is spent", async (_label, actor, role) => {
    const fake = seed(actor, role);
    const { status } = await analyze(PHOTO);
    expect(status).toBe(403);
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(fake.storageCalls).toEqual([]);
  });

  it("answers 404 to a member of another tenant", async () => {
    seed(OUTSIDER, "admin");
    expect((await analyze(PHOTO)).status).toBe(404);
    expect(callStructuredAi).not.toHaveBeenCalled();
  });

  it.each<[string, () => Promise<{ status: number }>]>([
    ["the photo of another affaire through this URL", () => analyze(OTHER_PHOTO)],
    ["a photo of this affaire under another request", () => analyze(PHOTO, PROJECT, OTHER_REQUEST)],
    ["a supplier's answer to a quote", () => analyze(QUOTE_FILE)],
    ["a photo whose upload never finished", () => analyze(PENDING_PHOTO)],
    ["a photo being deleted", () => analyze(WITHDRAWN_PHOTO)],
  ])("does not read %s", async (_label, attempt) => {
    const fake = seed(OWNER, "engineer");
    expect((await attempt()).status).toBe(404);
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(fake.storageCalls).toEqual([]);
  });

  it("refuses with what to do when the member's ChatGPT plan is not connected, before any byte is read", async () => {
    const fake = seed(OWNER, "engineer");
    vi.mocked(getStructuredAiAvailability).mockResolvedValue({ available: false, message: "Connectez votre forfait ChatGPT dans Mon profil pour analyser les documents." });

    const { status, error } = await analyze(PHOTO);

    expect(status).toBe(409);
    expect(error).toMatchObject({
      code: "MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE",
      message: "Connectez votre forfait ChatGPT dans Mon profil pour analyser les documents.",
    });
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(fake.storageCalls).toEqual([]);
  });

  it("refuses on an instance without AI, without reading the member's ChatGPT store", async () => {
    seed(OWNER, "engineer");
    vi.mocked(isLocalChatGptEnabled).mockReturnValue(false);

    const { status, error } = await analyze(PHOTO);

    expect(status).toBe(409);
    expect(error?.code).toBe("MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE");
    expect(getStructuredAiAvailability).not.toHaveBeenCalled();
    expect(callStructuredAi).not.toHaveBeenCalled();
  });

  it("refuses a photo too heavy for the model without downloading it", async () => {
    const fake = seed(OWNER, "engineer");
    const { status, error } = await analyze(HEAVY_PHOTO);
    expect(status).toBe(413);
    expect(error?.code).toBe("MATERIAL_REQUEST_PHOTO_TOO_LARGE");
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(fake.storageCalls).toEqual([]);
  });

  it.each<[string, unknown, string]>([
    ["the plan's quota", new StructuredAiError("AI_QUOTA", "message du fournisseur", 429), "AI_QUOTA"],
    ["a rate limit", new StructuredAiError("AI_RATE_LIMIT", "message du fournisseur", 429), "AI_RATE_LIMIT"],
    ["a refused request", new StructuredAiError("AI_REQUEST_REJECTED", "message du fournisseur", 400), "AI_REQUEST_REJECTED"],
    ["a timeout", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }), "TIMEOUT"],
    ["an answer that is not JSON", new SyntaxError("Unexpected token < in JSON"), "INVALID_ANSWER"],
    ["an answer that is not the one asked for", z.object({ lignes: z.array(z.string()) }).safeParse({ lignes: "aborted" }).error, "INVALID_ANSWER"],
    ["a failure of the provider", new StructuredAiError("AI_PROVIDER_FAILED", "message du fournisseur", 500), "PROVIDER_ERROR"],
    ["an unexpected failure", new Error("secret-provider-payload sk-fictif"), "PROVIDER_ERROR"],
  ])("answers 503 with a reason and a fixed sentence on %s", async (_label, failure, reason) => {
    const fake = seed(OWNER, "engineer");
    vi.mocked(callStructuredAi).mockRejectedValue(failure);

    const { status, error } = await analyze(PHOTO);

    expect(status).toBe(503);
    expect(error).toMatchObject({ code: "MATERIAL_REQUEST_PHOTO_ANALYSIS_FAILED", details: { reason } });
    // Nothing the provider or the runtime said crosses: the sentence is this module's own.
    expect(JSON.stringify(error)).not.toMatch(/fournisseur|sk-fictif|aborted|Unexpected token/);
    expect(error?.message.length).toBeGreaterThan(20);
    expect(fake.writes).toEqual([]);
  });

  it("asks to reconnect, as a refusal to run, when the plan's access is refused during the reading", async () => {
    seed(OWNER, "engineer");
    vi.mocked(callStructuredAi).mockRejectedValue(new StructuredAiError("AI_AUTH_REQUIRED", "Reconnectez votre forfait ChatGPT dans Mon profil.", 401));
    const { status, error } = await analyze(PHOTO);
    expect(status).toBe(409);
    expect(error).toMatchObject({ code: "MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE", message: "Reconnectez votre forfait ChatGPT dans Mon profil." });
  });

  it("asks to reconnect when the plan's access could not be renewed, instead of asking to try again", async () => {
    seed(OWNER, "engineer");
    vi.mocked(callStructuredAi).mockRejectedValue(new ChatGptSignInError("renewal"));
    const { status, error } = await analyze(PHOTO);
    expect(status).toBe(409);
    expect(error?.code).toBe("MATERIAL_REQUEST_PHOTO_ANALYSIS_UNAVAILABLE");
    expect(error?.message).toMatch(/Reconnectez votre forfait dans Mon profil/);
  });

  it("answers no line for a photo without article, rather than a failure", async () => {
    seed(OWNER, "engineer");
    answerWith({ lignes: [] });
    const { status, data } = await analyze(PHOTO);
    expect(status).toBe(200);
    expect(data).toMatchObject({ lines: [] });
  });
});

describe("GET material request: whether its screen may offer the reading", () => {
  const open = () => call(requestRoute.GET, "GET", { projectId: PROJECT, requestId: REQUEST });

  it("tells a writer that the reading is available, or what to do when the plan is not connected", async () => {
    seed(OWNER, "engineer");
    expect((await open()).data).toMatchObject({ photoAnalysis: { status: "available" } });

    vi.mocked(getStructuredAiAvailability).mockResolvedValue({ available: false, message: "Connectez votre forfait ChatGPT dans Mon profil pour analyser les documents." });
    expect((await open()).data).toMatchObject({
      photoAnalysis: { status: "unavailable", message: "Connectez votre forfait ChatGPT dans Mon profil pour analyser les documents." },
    });
  });

  it("says « disabled » on an instance without AI: the screen then offers nothing", async () => {
    seed(OWNER, "engineer");
    vi.mocked(isLocalChatGptEnabled).mockReturnValue(false);
    expect((await open()).data).toMatchObject({ photoAnalysis: { status: "disabled" } });
    expect(getStructuredAiAvailability).not.toHaveBeenCalled();
  });

  it("says nothing to a reader, and does not read their ChatGPT store", async () => {
    seed(DIRECTOR, "director");
    const { status, data } = await open();
    expect(status).toBe(200);
    expect(data).toMatchObject({ canWrite: false, photoAnalysis: null });
    expect(getStructuredAiAvailability).not.toHaveBeenCalled();
  });

  it("opens the request when the availability cannot be read", async () => {
    seed(OWNER, "engineer");
    vi.mocked(getStructuredAiAvailability).mockRejectedValue(new Error("store illisible"));
    const { status, data } = await open();
    expect(status).toBe(200);
    expect(data).toMatchObject({ photoAnalysis: { status: "unavailable" } });
  });
});
