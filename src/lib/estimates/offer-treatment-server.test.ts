import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server-context", () => ({
  getAuthenticatedContext: vi.fn(),
  getVersionAccessOrThrow: vi.fn(),
  assertDraftStatus: vi.fn((status: string) => {
    if (status !== "draft") throw Object.assign(new Error("read only"), { code: "READ_ONLY" });
  }),
  assertDraftLockOwnedByCurrentUser: vi.fn(),
}));

import { buildOfferReserveSentence } from "@/lib/estimates/offer-treatment";
import { setEstimateLineOfferTreatments } from "@/lib/estimates/offer-treatment-server";
import {
  assertDraftLockOwnedByCurrentUser, getAuthenticatedContext, getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";

const VERSION_ID = "d6820000-0000-4000-8000-000000000100";
const NC = "d6820000-0000-4000-8001-000000000102";
const OTHER = "d6820000-0000-4000-8001-000000000101";
const USER = "d6820000-0000-4000-8000-000000000001";

type Line = { id: string; item_type: string; title: string; pricing_status: string; source_metadata: unknown };

function stored(title: string, text: string, basis: string) {
  return { offer_treatment: { version: 1, kind: "offer_reserve", basis, text, sentence: buildOfferReserveSentence(title, text),
    decided_by: USER, decided_at: "2026-11-11T10:00:00.000Z" } };
}

/** The reads of the route, answered from one set of lines; the write is the rpc mock. */
function fakeSupabase(input: { lines: Line[]; exclusions: string | null; rpc: ReturnType<typeof vi.fn> }) {
  const itemsQuery = () => {
    let rows = input.lines;
    const query = {
      select: () => query,
      eq: () => query,
      not: () => { rows = rows.filter((line) => (line.source_metadata as { offer_treatment?: unknown } | null)?.offer_treatment != null); return query; },
      limit: () => query,
      in: (_column: string, ids: string[]) => { rows = rows.filter((line) => ids.includes(line.id)); return query; },
      then: (resolve: (value: { data: Line[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    return query;
  };
  const versionQuery = { select: () => versionQuery, eq: () => versionQuery,
    maybeSingle: () => Promise.resolve({ data: { exclusions: input.exclusions }, error: null }) };
  return {
    from: vi.fn((table: string) => table === "estimate_versions" ? versionQuery : itemsQuery()),
    rpc: input.rpc,
  };
}

function arrange(options: { engine?: number; status?: string; revision?: number; lines?: Line[]; exclusions?: string | null;
  rpc?: ReturnType<typeof vi.fn> } = {}) {
  const rpc = options.rpc ?? vi.fn().mockResolvedValue({ error: null, data: {
    version_id: VERSION_ID, content_revision: 8, updated_at: "2026-11-11T12:00:00.000000+00:00",
    exclusions: "Réserve — « Calorifuge » : à définir", updated_count: 1 } });
  const supabase = fakeSupabase({
    lines: options.lines ?? [{ id: NC, item_type: "line", title: "Calorifuge", pricing_status: "not_priced", source_metadata: null }],
    exclusions: options.exclusions ?? null, rpc,
  });
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase, tenantId: "tenant-1", userId: USER, tenantRole: "engineer" } as never);
  vi.mocked(getVersionAccessOrThrow).mockResolvedValue({ version: {
    id: VERSION_ID, status: options.status ?? "draft", calc_engine_version: options.engine ?? 3, content_revision: options.revision ?? 7,
  } } as never);
  return { rpc, supabase };
}

const reserve = (basis = "private_estimate") => ({ expected_content_revision: 7,
  decisions: [{ item_id: NC, decision: { kind: "offer_reserve" as const, basis: basis as "private_estimate", text: "à définir" } }] });

beforeEach(() => {
  vi.mocked(getAuthenticatedContext).mockReset();
  vi.mocked(getVersionAccessOrThrow).mockReset();
  vi.mocked(assertDraftLockOwnedByCurrentUser).mockReset();
});

describe("setEstimateLineOfferTreatments", () => {
  it("writes the planned decisions and offer text of an engine 3 draft through the single writer", async () => {
    const { rpc } = arrange({ exclusions: "Hors peinture." });
    const result = await setEstimateLineOfferTreatments(VERSION_ID, reserve());
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("set_estimate_line_offer_treatments", {
      p_version_id: VERSION_ID, p_expected_content_revision: 7,
      p_treatments: [{ item_id: NC, treatment: { kind: "offer_reserve", basis: "private_estimate", text: "à définir",
        sentence: "Réserve — « Calorifuge » : à définir" } }],
      p_exclusions: "Hors peinture.\n\nRéserve — « Calorifuge » : à définir",
    });
    expect(result.version).toEqual({ id: VERSION_ID, content_revision: 8, updated_at: "2026-11-11T12:00:00.000000+00:00",
      exclusions: "Réserve — « Calorifuge » : à définir" });
    expect(result.items.map((item) => item.id)).toEqual([NC]);
    expect(assertDraftLockOwnedByCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("refuses an engine 2 version by name, a sent version, and a revision the editor did not read, before any write", async () => {
    const v2 = arrange({ engine: 2 });
    await expect(setEstimateLineOfferTreatments(VERSION_ID, reserve())).rejects.toMatchObject({ code: "OFFER_TREATMENT_ENGINE_NOT_SUPPORTED" });
    const sent = arrange({ status: "sent" });
    await expect(setEstimateLineOfferTreatments(VERSION_ID, reserve())).rejects.toMatchObject({ code: "READ_ONLY" });
    const stale = arrange({ revision: 9 });
    await expect(setEstimateLineOfferTreatments(VERSION_ID, reserve())).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    for (const { rpc, supabase } of [v2, sent, stale]) {
      expect(rpc).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();
    }
  });

  it("does not write without the draft lock of this session", async () => {
    const { rpc } = arrange();
    const locked = new Error("locked elsewhere");
    vi.mocked(assertDraftLockOwnedByCurrentUser).mockRejectedValue(locked);
    await expect(setEstimateLineOfferTreatments(VERSION_ID, reserve())).rejects.toBe(locked);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a second basis against a reserve the request does not name, and names both bases", async () => {
    const kept = stored("Réseau EU", "tracé à confirmer", "private_estimate");
    const { rpc } = arrange({
      lines: [
        { id: NC, item_type: "line", title: "Calorifuge", pricing_status: "not_priced", source_metadata: null },
        { id: OTHER, item_type: "line", title: "Réseau EU", pricing_status: "priced", source_metadata: kept },
      ],
      exclusions: kept.offer_treatment.sentence,
    });
    await expect(setEstimateLineOfferTreatments(VERSION_ID, reserve("indicative_quantities"))).rejects.toMatchObject({
      status: 400, code: "OFFER_RESERVE_BASIS_CONFLICT",
      message: expect.stringContaining("« Quantités déclarées indicatives par le règlement de consultation » et « Devis privé »"),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers a concurrent change found by the writer as a version conflict", async () => {
    arrange({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "40001", message: "ESTIMATE_OFFER_TREATMENT_STALE" } }) });
    await expect(setEstimateLineOfferTreatments(VERSION_ID, reserve())).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    arrange({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "22023", message: "ESTIMATE_OFFER_RESERVE_NOT_WRITTEN" } }) });
    await expect(setEstimateLineOfferTreatments(VERSION_ID, reserve())).rejects.toMatchObject({ status: 409, code: "OFFER_RESERVE_NOT_WRITTEN" });
  });
});
