import { beforeEach, describe, expect, it, vi } from "vitest";

// TI-682, lot C, PR 4: the administration route of the written reserve, with its real server module. Mocked: the
// session, the version read, the draft lock read and the service-role client (the RPC's own checks are pgTAP's,
// supabase/tests/database/estimate-line-offer-choice.test.sql).
const rpc = vi.fn();
vi.mock("@/lib/estimates/version-workflow-client-server", () => ({ getServiceRoleSupabaseClient: () => ({ rpc }) }));
vi.mock("@/lib/estimates/server-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/estimates/server-context")>("@/lib/estimates/server-context");
  return {
    ...actual,
    getAuthenticatedContext: vi.fn(),
    getVersionAccessOrThrow: vi.fn(),
    assertDraftLockOwnedByCurrentUser: vi.fn(),
  };
});

import { DELETE, PUT } from "@/app/api/estimates/[versionId]/items/[itemId]/offer-choice/route";
import { conflict } from "@/lib/estimates/errors";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import {
  assertDraftLockOwnedByCurrentUser,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";

const VERSION_ID = "1111111a-1111-4111-8111-11111111111a";
const ITEM_ID = "2222222b-2222-4222-8222-22222222222b";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const UPDATED_AT = "2026-11-11T18:00:00.000000+00:00";
const reserve = { kind: "reserve", basis: "private_estimate", code: "pending_survey", note: "  Relevé prévu sur site  " };
const stored = { kind: "reserve", basis: "private_estimate", code: "pending_survey", note: "Relevé prévu sur site",
  decided_by: USER_ID, decided_at: "2026-11-11T18:01:00.000000+00:00" };
const receipt = {
  item: { id: ITEM_ID, version_id: VERSION_ID, pricing_status: "not_priced", offer_choice: stored },
  version: { id: VERSION_ID, updated_at: "2026-11-11T18:01:00.000000+00:00", content_revision: 8 },
};

function request(method: "PUT" | "DELETE", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/estimates/${VERSION_ID}/items/${ITEM_ID}/offer-choice`, {
    method,
    headers: { "content-type": "application/json", "if-match": UPDATED_AT, [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: SESSION_ID,
      ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const params = { params: Promise.resolve({ versionId: VERSION_ID, itemId: ITEM_ID }) };
async function read(response: Response) {
  return { status: response.status, body: await response.json() as { ok: boolean; data?: unknown; error?: { code?: string } } };
}

describe("PUT/DELETE …/items/{itemId}/offer-choice (TI-682)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase: {}, tenantId: TENANT_ID, userId: USER_ID,
      tenantRole: "admin" } as never);
    vi.mocked(getVersionAccessOrThrow).mockResolvedValue({
      version: { id: VERSION_ID, status: "draft", updated_at: UPDATED_AT, calc_engine_version: 3 },
      project: { id: "p" },
    } as never);
    vi.mocked(assertDraftLockOwnedByCurrentUser).mockResolvedValue({} as never);
    rpc.mockResolvedValue({ data: receipt, error: null });
  });

  it("declares the reserve for an administrator holding the lock, the note trimmed, the author the session's user", async () => {
    const { status, body } = await read(await PUT(request("PUT", reserve), params));
    expect({ status, data: body.data }).toEqual({ status: 200, data: receipt });
    expect(rpc).toHaveBeenCalledWith("set_estimate_line_offer_choice", {
      p_tenant_id: TENANT_ID, p_version_id: VERSION_ID, p_item_id: ITEM_ID, p_actor_user_id: USER_ID,
      p_choice: { kind: "reserve", basis: "private_estimate", code: "pending_survey", note: "Relevé prévu sur site" },
      p_expected_updated_at: UPDATED_AT, p_draft_lock_session_id: SESSION_ID,
    });
  });

  it("withdraws the reserve with DELETE", async () => {
    rpc.mockResolvedValue({ data: { ...receipt, item: { ...receipt.item, offer_choice: null } }, error: null });
    const { status } = await read(await DELETE(request("DELETE"), params));
    expect(status).toBe(200);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_choice: null });
  });

  it("refuses an engineer, a director and a viewer with 403, before any write", async () => {
    for (const tenantRole of ["engineer", "director", "viewer"]) {
      vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase: {}, tenantId: TENANT_ID, userId: USER_ID, tenantRole } as never);
      const { status } = await read(await PUT(request("PUT", reserve), params));
      expect(status, tenantRole).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 409 to a stale version token and without this page's lock, before any write", async () => {
    const stale = await read(await PUT(request("PUT", reserve, { "if-match": "2026-11-11T17:00:00.000000+00:00" }), params));
    const noHeader = await read(await PUT(request("PUT", reserve, { [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: "" }), params));
    vi.mocked(assertDraftLockOwnedByCurrentUser).mockRejectedValueOnce(conflict("Verrou détenu ailleurs.", { lock: null }, "LOCK_REQUIRED"));
    const otherSession = await read(await PUT(request("PUT", reserve), params));
    expect([stale.status, noHeader.status, otherSession.status]).toEqual([409, 409, 409]);
    expect([noHeader.body.error?.code, otherSession.body.error?.code]).toEqual(["LOCK_REQUIRED", "LOCK_REQUIRED"]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a sent version, a v2 and a malformed reserve, before any write", async () => {
    vi.mocked(getVersionAccessOrThrow).mockResolvedValueOnce({
      version: { id: VERSION_ID, status: "sent", updated_at: UPDATED_AT, calc_engine_version: 3 }, project: { id: "p" },
    } as never);
    const sent = await read(await PUT(request("PUT", reserve), params));
    vi.mocked(getVersionAccessOrThrow).mockResolvedValueOnce({
      version: { id: VERSION_ID, status: "draft", updated_at: UPDATED_AT, calc_engine_version: 2 }, project: { id: "p" },
    } as never);
    const v2 = await read(await PUT(request("PUT", reserve), params));
    const malformed = await Promise.all([
      { ...reserve, basis: "public_lump_sum" },
      { ...reserve, code: "other", note: null },
      { ...reserve, basis: "indicative_quantities", note: null },
      { ...reserve, note: "court" },
      { ...reserve, decided_by: USER_ID },
      { ...reserve, kind: "provisional_quantity" },
    ].map(async (body) => (await read(await PUT(request("PUT", body), params))).status));
    expect({ sent: sent.status, v2: v2.status, malformed }).toEqual({ sent: 403, v2: 400, malformed: [400, 400, 400, 400, 400, 400] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names the database's refusals, and never trusts a receipt for another line", async () => {
    const answer = async (message: string) => {
      rpc.mockResolvedValueOnce({ data: null, error: { message, code: "P0001" } });
      const { status, body } = await read(await PUT(request("PUT", reserve), params));
      return [status, body.error?.code];
    };
    expect([
      await answer("ESTIMATE_OFFER_CHOICE_FORBIDDEN"),
      await answer("ESTIMATE_OFFER_CHOICE_STATUS_MISMATCH"),
      await answer("ESTIMATE_OFFER_CHOICE_LINE_REQUIRED"),
      await answer("ESTIMATE_OFFER_CHOICE_STALE"),
      await answer("ESTIMATE_OFFER_CHOICE_LOCK_REQUIRED"),
      await answer("ESTIMATE_VERSION_READ_ONLY"),
    ]).toEqual([[403, "ESTIMATE_OFFER_CHOICE_FORBIDDEN"], [409, "ESTIMATE_OFFER_CHOICE_STATUS_MISMATCH"],
      [404, "ESTIMATE_OFFER_CHOICE_LINE_REQUIRED"], [409, "VERSION_CONFLICT"], [409, "LOCK_REQUIRED"], [403, "READ_ONLY"]]);
    rpc.mockResolvedValueOnce({ data: { ...receipt, item: { ...receipt.item, id: VERSION_ID } }, error: null });
    expect((await read(await PUT(request("PUT", reserve), params))).status).toBe(500);
    // An identifier spelled in capitals in the URL is the same line: its committed receipt is accepted.
    const upper = { params: Promise.resolve({ versionId: VERSION_ID.toUpperCase(), itemId: ITEM_ID.toUpperCase() }) };
    expect((await read(await PUT(request("PUT", reserve), upper))).status).toBe(200);
  });
});
