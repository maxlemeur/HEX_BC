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

import { DELETE, GET, PUT } from "@/app/api/estimates/[versionId]/items/[itemId]/offer-choice/route";
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

  // TI-682, lot C, PR 5: the provisional quantity of a priced line resting on a takeoff hypothesis.
  const provisional = { kind: "provisional_quantity", basis: "private_estimate", note: null,
    established_on: "  le plan CVC\n  indice B ", to_confirm_by: "le relevé\tcontradictoire sur site" };

  it("declares a provisional quantity, its texts on one line", async () => {
    const { status } = await read(await PUT(request("PUT", provisional), params));
    expect(status).toBe(200);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_choice: { kind: "provisional_quantity", basis: "private_estimate", note: null,
      established_on: "le plan CVC indice B", to_confirm_by: "le relevé contradictoire sur site" } });
  });

  it("refuses a provisional quantity without its texts, with a code, or with texts the client document cannot carry", async () => {
    const malformed = await Promise.all([
      { ...provisional, established_on: "ab" },
      { ...provisional, to_confirm_by: "x".repeat(161) },
      { ...provisional, established_on: "le plan\u200bCVC" },
      { ...provisional, to_confirm_by: "relevé \u202esur site" },
      { ...provisional, code: "pending_survey" },
      { kind: "provisional_quantity", basis: "private_estimate", established_on: "le plan CVC" },
      { ...provisional, basis: "indicative_quantities" },
    ].map(async (body) => (await read(await PUT(request("PUT", body), params))).status));
    expect(malformed).toEqual([400, 400, 400, 400, 400, 400, 400]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names the refusal of a line whose quantity rests on no hypothesis", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED", code: "P0001" } });
    const { status, body } = await read(await PUT(request("PUT", provisional), params));
    expect([status, body.error?.code]).toEqual([409, "ESTIMATE_OFFER_CHOICE_HYPOTHESIS_REQUIRED"]);
  });

  it("reads what « Établie sur » starts from: the takeoff lines' notes, in the marker's order, on one bounded line", async () => {
    const SOURCE_A = "6666666a-6666-4666-8666-66666666666a";
    const SOURCE_B = "7777777b-7777-4777-8777-77777777777b";
    const marker = { takeoff_provision: { version: 1, job_id: "job", sources: [SOURCE_B, SOURCE_A, "not-a-uuid"].map((id) => ({
      takeoff_item_id: id, forced: false, forced_reason: null, entry_category: null, hypothesis_cause: "estimated" })) } };
    const rows: Record<string, unknown> = {
      estimate_items: { data: { id: ITEM_ID, item_type: "line", source_metadata: marker }, error: null },
      takeoff_items: { data: [{ id: SOURCE_A, quantity_entry_note: "plan  RDC" }, { id: SOURCE_B, quantity_entry_note: "plan R+1\n indice B" }],
        error: null },
    };
    const filters: unknown[][] = [];
    const supabase = { from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in"]) builder[method] = (...args: unknown[]) => { filters.push([table, method, ...args]); return builder; };
      builder.maybeSingle = async () => rows[table];
      builder.then = (resolve: (value: unknown) => unknown) => resolve(rows[table]);
      return builder;
    } };
    vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase, tenantId: TENANT_ID, userId: USER_ID, tenantRole: "engineer" } as never);
    const { status, body } = await read(await GET(new Request("http://localhost"), params));
    expect({ status, data: body.data }).toEqual({ status: 200, data: { established_on: "plan R+1 indice B ; plan RDC" } });
    expect(filters).toContainEqual(["takeoff_items", "in", "id", [SOURCE_B, SOURCE_A]]);
    expect(filters).toContainEqual(["takeoff_items", "eq", "tenant_id", TENANT_ID]);
    rows.estimate_items = { data: { id: ITEM_ID, item_type: "line", source_metadata: {} }, error: null };
    expect((await read(await GET(new Request("http://localhost"), params))).body.data).toEqual({ established_on: null });
    expect(rpc).not.toHaveBeenCalled();
  });
});
