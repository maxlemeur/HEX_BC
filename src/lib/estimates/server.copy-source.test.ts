import { beforeEach, describe, expect, it, vi } from "vitest";

// Isolated regression for copies into a v1/v2, written before their fix (docs/testing/copy-row-limit-v2.md).
// The copies read each version by pages of 500, in several requests. Ways that can fail:
//  P1 the source version is edited between two pages, its item count unchanged: the duplicated section mixes two
//     revisions and the copy still answers 201;
//  P2 the same during a section import, on its source;
//  P3 the same on the import target: its titles and child positions come from two revisions;
//  P4 the refusal comes after the insert, so part of the copy is written.
// The TesterArmy journeys (RL01 to RL05) cannot place an edit between two page requests of one API call; these
// doubles do, and stand for nothing else (no SQL, RLS, lock or trigger semantics). An unchanged version is still
// copied: the journeys cover that.
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/estimates/server-context", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/estimates/server-context")>(),
  getAuthenticatedContext: vi.fn(),
  getVersionAccessOrThrow: vi.fn(),
  assertDraftLockOwnedByCurrentUser: vi.fn(),
}));

import { duplicateSectionFromVersion, importSectionsFromVersion } from "@/lib/estimates/server";
import {
  assertDraftLockOwnedByCurrentUser,
  getAuthenticatedContext,
  getVersionAccessOrThrow,
  type VersionAccessRow,
} from "@/lib/estimates/server-context";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_ID = "55555555-5555-4555-8555-555555555555";
const SECTION_ID = "66666666-6666-4666-8666-666666666666";
type Row = Record<string, unknown>;
type VersionState = { row: VersionAccessRow; items: Row[]; editAfterFirstPage: boolean };

const itemId = (versionId: string, index: number) => `${versionId.slice(0, 24)}${String(index).padStart(12, "0")}`;

/** A v2 draft holding one root section and `lines` lines under it. */
function v2Draft(versionId: string, lines: number, sectionId = itemId(versionId, 0)): VersionState {
  const section = { id: sectionId, tenant_id: TENANT_ID, version_id: versionId, parent_id: null, item_type: "section", position: 1, title: "Lot" };
  const items: Row[] = [section, ...Array.from({ length: lines }, (_, index) => ({
    id: itemId(versionId, index + 1), tenant_id: TENANT_ID, version_id: versionId, parent_id: sectionId, item_type: "line",
    position: index + 1, title: `Ligne ${index + 1}`, quantity: 1, unit_price_ht_cents: 100, tax_rate_bp: 2000,
    line_total_ht_cents: 100, line_tax_cents: 20, line_total_ttc_cents: 120,
  }))];
  const row = {
    id: versionId, tenant_id: TENANT_ID, project_id: PROJECT_ID, status: "draft", calc_engine_version: 2,
    updated_at: "2026-10-18T10:00:00.000Z", content_revision: 7, estimate_projects: { id: PROJECT_ID, tenant_id: TENANT_ID, user_id: USER_ID },
  } as unknown as VersionAccessRow;
  return { row, items, editAfterFirstPage: false };
}

/** Serves the copy's own queries; any other query rejects, which stops a copy that went on past its reads. */
function fakeSupabase(versions: Map<string, VersionState>) {
  const inserts: unknown[] = [];
  const current = new Map([...versions].map(([id, state]) => [id, { ...state.row }]));
  const from = (table: string) => {
    const call: { select?: string; filters: Map<string, unknown>; range?: [number, number]; insert?: unknown } = { filters: new Map() };
    const respond = () => {
      const versionId = String(call.filters.get("version_id") ?? call.filters.get("id"));
      if (table === "estimate_items" && call.insert !== undefined) {
        inserts.push(call.insert);
        return { data: null, error: null };
      }
      if (table === "estimate_items" && call.range) {
        const state = versions.get(versionId)!;
        const [start, end] = call.range;
        if (start === 0 && state.editAfterFirstPage) {
          // Another page saves a title in this draft: the trigger bumps its revision, the item count stays.
          const version = current.get(versionId)!;
          current.set(versionId, { ...version, content_revision: version.content_revision + 1, updated_at: "2026-10-18T10:00:01.000Z" });
        }
        return { data: state.items.slice(start, end + 1), error: null, count: state.items.length };
      }
      if (table === "estimate_items" && call.select === "id, version_id, item_type, title") {
        const section = [...versions.values()].flatMap((state) => state.items).find((item) => item.id === call.filters.get("id"));
        return { data: section ?? null, error: section ? null : { code: "PGRST116", message: "not found", details: null, hint: null } };
      }
      if (table === "estimate_items" && call.select === "position") return { data: [], error: null };
      if (table === "estimate_versions" && call.select === "id, tenant_id, project_id, status, updated_at, content_revision") {
        return { data: current.get(versionId) ?? null, error: null };
      }
      throw new Error(`Unexpected query after the reads: ${table} ${call.select ?? "(write)"}`);
    };
    const builder = {
      select: (columns: string) => { call.select = columns; return builder; },
      eq: (column: string, value: unknown) => { call.filters.set(column, value); return builder; },
      is: (column: string, value: unknown) => { call.filters.set(column, value); return builder; },
      order: () => builder,
      limit: () => builder,
      abortSignal: () => builder,
      range: (start: number, end: number) => { call.range = [start, end]; return builder; },
      insert: (payload: unknown) => { call.insert = payload; return builder; },
      single: async () => respond(),
      maybeSingle: async () => respond(),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(respond).then(resolve, reject),
    };
    return builder;
  };
  // The v1/v2 copies write through public.copy_estimate_items_atomic (docs/testing/copy-large-v2.md): a write is an insert too.
  const rpc = async (name: string, args: unknown) => {
    inserts.push({ rpc: name, args });
    return { data: null, error: null };
  };
  return { client: { from, rpc }, inserts };
}

function arrange(versions: VersionState[]) {
  const byId = new Map(versions.map((state) => [String(state.row.id), state]));
  const supabase = fakeSupabase(byId);
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ supabase: supabase.client, userId: USER_ID, tenantId: TENANT_ID, tenantRole: "owner" } as never);
  vi.mocked(getVersionAccessOrThrow).mockImplementation(async (_client, versionId) => {
    const state = byId.get(versionId)!;
    return { version: { ...state.row }, project: state.row.estimate_projects } as never;
  });
  vi.mocked(assertDraftLockOwnedByCurrentUser).mockResolvedValue({ session_id: "77777777-7777-4777-8777-777777777777" } as never);
  return supabase;
}

const VERSION_CONFLICT = { status: 409, code: "VERSION_CONFLICT" };

describe("copies into a v1/v2 read pinned versions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("P1, P4: refuses to duplicate a section whose v2 version changes between two pages, before any insert", async () => {
    const source = v2Draft(SOURCE_ID, 600, SECTION_ID);
    source.editAfterFirstPage = true;
    const supabase = arrange([source]);

    await expect(duplicateSectionFromVersion(SOURCE_ID, SECTION_ID)).rejects.toMatchObject(VERSION_CONFLICT);
    expect(supabase.inserts).toEqual([]);
  });

  it("P2, P4: refuses to import a section whose v2 source changes between two pages, before any insert", async () => {
    const source = v2Draft(SOURCE_ID, 600, SECTION_ID);
    source.editAfterFirstPage = true;
    const supabase = arrange([source, v2Draft(TARGET_ID, 2)]);

    await expect(importSectionsFromVersion(TARGET_ID, { source_version_id: SOURCE_ID, section_ids: [SECTION_ID], mode: "append" }))
      .rejects.toMatchObject(VERSION_CONFLICT);
    expect(supabase.inserts).toEqual([]);
  });

  it("P3, P4: refuses to import into a v2 target that changes between two pages, before any insert", async () => {
    const target = v2Draft(TARGET_ID, 600);
    target.editAfterFirstPage = true;
    const supabase = arrange([v2Draft(SOURCE_ID, 2, SECTION_ID), target]);

    await expect(importSectionsFromVersion(TARGET_ID, { source_version_id: SOURCE_ID, section_ids: [SECTION_ID], mode: "append" }))
      .rejects.toMatchObject(VERSION_CONFLICT);
    expect(supabase.inserts).toEqual([]);
  });
});
