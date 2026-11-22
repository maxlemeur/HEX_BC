import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { createHash } from "node:crypto";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { acceptItemListProposal, addItemListPoste, loadAffaireItemList } from "./item-list-server";
import { posteOriginKey } from "./poste-list";


/** A client whose tables and functions answer only when named: any other read throws (it was not expected). */
function client(tables: Record<string, unknown[]>, rpc: Record<string, unknown> = {}) {
  const reads: string[] = [];
  const from = (table: string) => {
    if (!(table in tables)) throw new Error(`Unexpected read of ${table}.`);
    reads.push(table);
    const data = tables[table];
    const reply = { data, error: null, count: data.length };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "gte", "order", "limit", "abortSignal"]) builder[method] = () => builder;
    builder.range = () => Promise.resolve(reply);
    builder.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null });
    builder.then = (resolve: (value: typeof reply) => unknown) => Promise.resolve(reply).then(resolve);
    return builder;
  };
  const call = (name: string) => {
    if (!(name in rpc)) throw new Error(`Unexpected call of ${name}.`);
    reads.push(`rpc:${name}`);
    return Promise.resolve({ data: rpc[name], error: null });
  };
  return { reads, client: { from, rpc: call } as never };
}

const stamped = "2026-11-21T09:00:00Z";
const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";

/**
 * One affaire's list in the database, as record_takeoff_list_revision keeps it (20261121230719_takeoff_item_lists.sql):
 * under the list's lock, a gesture's key already recorded answers with its revision when the gesture is the same, with a
 * conflict otherwise; a new gesture must name the latest revision. Every read sees what is recorded when it runs. `hold`:
 * the first call that reaches that point (the list's write function, or a read of its stored revisions) waits there
 * until `release`; `held` resolves when it arrives.
 */
function listDatabase(hold: "record" | "history", options: { armed?: boolean } = {}) {
  type Revision = { id: string; revision: number; cause: string; sources: unknown; item_count: number; content_sha256: string;
    created_by: string; created_at: string; intent_key: string; gesture_sha256: string };
  const revisions: Revision[] = [];
  const entries = new Map<string, Array<{ item_id: string; source_key: string }>>();
  const registry: Array<{ source_key: string; item_id: string; kind: "origin"; accepted_in_revision: number; accepted_by: string;
    accepted_at: string }> = [];
  let reached!: () => void;
  const held = new Promise<void>((resolve) => { reached = resolve; });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  // Unarmed, nothing waits until `arm` (the list's earlier revisions are recorded first).
  let waited = options.armed === false;
  const wait = async (point: typeof hold) => {
    if (point !== hold || waited) return;
    waited = true;
    reached();
    await released;
  };
  const rows = (table: string, filters: Record<string, unknown>): unknown[] => {
    switch (table) {
      case "takeoff_list_revisions": return revisions.filter((row) => filters.intent_key === undefined || row.intent_key === filters.intent_key)
        .sort((left, right) => right.revision - left.revision);
      case "takeoff_list_revision_entries": return entries.get(filters.revision_id as string) ?? [];
      case "takeoff_list_item_sources": return registry;
      case "profiles": return [];
      // No DPGF and no published template: the list comes from the template shipped with the application.
      case "dpgf_imports": case "affaire_intake_documents": case "takeoff_item_template_versions": return [];
      default: throw new Error(`Unexpected read of ${table}.`);
    }
  };
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let limit = Infinity;
    const read = async (range?: [number, number]) => {
      if (table === "takeoff_list_revisions" && filters.intent_key === undefined) await wait("history");
      const all = rows(table, filters);
      return { data: range ? all.slice(range[0], range[1] + 1) : all.slice(0, limit), error: null, count: all.length };
    };
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "in", "is", "gte", "order", "abortSignal"]) builder[method] = () => builder;
    builder.eq = (column: string, value: unknown) => { filters[column] = value; return builder; };
    builder.limit = (count: number) => { limit = count; return builder; };
    builder.range = (start: number, end: number) => read([start, end]);
    builder.maybeSingle = async () => ({ data: (await read()).data[0] ?? null, error: null });
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => read().then(resolve, reject);
    return builder;
  };
  const rpc = async (name: string, args: Record<string, unknown>) => {
    if (name === "takeoff_item_list_may_write") return { data: true, error: null };
    if (name !== "record_takeoff_list_revision") throw new Error(`Unexpected call of ${name}.`);
    await wait("record");
    const existing = revisions.find((row) => row.intent_key === args.p_intent_key);
    if (existing) {
      return existing.gesture_sha256 === args.p_gesture_sha256
        ? { data: [{ revision_id: existing.id, revision: existing.revision, content_sha256: existing.content_sha256, replayed: true }],
          error: null }
        : { data: null, error: { code: "23505", message: "TAKEOFF_ITEM_LIST_INTENT_CONFLICT" } };
    }
    const latest = revisions.reduce((highest, row) => Math.max(highest, row.revision), 0);
    if (latest !== args.p_expected_revision) return { data: null, error: { code: "40001", message: "TAKEOFF_ITEM_LIST_STALE" } };
    const list = args.p_entries as Array<{ item_id: string; source_key: string }>;
    const row = { id: `aaaaaaaa-0000-4000-8000-00000000010${latest + 1}`, revision: latest + 1, cause: args.p_cause as string,
      sources: args.p_sources, item_count: list.length, content_sha256: createHash("sha256").update(JSON.stringify(list)).digest("hex"),
      created_by: args.p_actor as string, created_at: stamped, intent_key: args.p_intent_key as string,
      gesture_sha256: args.p_gesture_sha256 as string };
    revisions.push(row);
    entries.set(row.id, list);
    for (const entry of list) {
      if (!registry.some(({ source_key }) => source_key === entry.source_key)) {
        registry.push({ source_key: entry.source_key, item_id: entry.item_id, kind: "origin", accepted_in_revision: row.revision,
          accepted_by: row.created_by, accepted_at: stamped });
      }
    }
    return { data: [{ revision_id: row.id, revision: row.revision, content_sha256: row.content_sha256, replayed: false }], error: null };
  };
  return { client: { from, rpc } as never, revisions, held, release, arm: () => { waited = false; } };
}

const importRow = { id: "import-a", filename: "plomberie.csv", source_format: "csv", status: "completed", row_count: 1 };

beforeEach(() => vi.clearAllMocks());

describe("the item list of an affaire", () => {
  it("gives a reader the DPGF's list even when the reader's session cannot see the import", async () => {
    // The member's session (RLS) sees no import: an engineer owner of an affaire whose DPGF an administrator uploaded.
    const member = client({ takeoff_list_revisions: [], profiles: [] });
    const service = client({
      dpgf_imports: [importRow], affaire_intake_documents: [],
      dpgf_mappings: [{ id: "mapping", status: "validated", column_mapping: {}, created_at: stamped, updated_at: stamped }],
      dpgf_rows_raw: [{ id: "raw", row_index: 0, structure: null, provenance: null }],
      dpgf_rows_mapped: [{ id: "mapped", raw_row_id: "raw", designation: "Lavabo", unit: "u", quantity: 2 }],
    }, { read_dpgf_import_confirmation: [], takeoff_item_list_notes_key: "a".repeat(64),
      takeoff_item_list_may_write: false });
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { userId: "engineer", tenantId: "tenant", tenantRole: "engineer", supabase: member.client },
      project: { id: "project", user_id: "engineer" },
    } as never);
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client);

    const list = await loadAffaireItemList("project");
    expect(list).toMatchObject({ canWrite: false, current: null, sources: { kind: "dpgf", filename: "plomberie.csv" },
      proposal: { cause: "initial", items: [{ label: "Lavabo" }] } });
    expect(member.reads).not.toContain("dpgf_imports");
    expect(service.reads).toContain("dpgf_imports");
  });

  it("sends no digest of an import's notes to the browser", async () => {
    const member = client({ takeoff_list_revisions: [], profiles: [] });
    const service = client({
      dpgf_imports: [importRow], affaire_intake_documents: [],
      dpgf_mappings: [{ id: "mapping", status: "validated", column_mapping: {}, created_at: stamped, updated_at: stamped }],
      dpgf_rows_raw: [{ id: "raw", row_index: 0, structure: null, provenance: null }],
      dpgf_rows_mapped: [{ id: "mapped", raw_row_id: "raw", designation: "Lavabo", unit: "u", quantity: 2,
        notes: "PU négocié 85 € HT" }],
    }, { read_dpgf_import_confirmation: [], takeoff_item_list_notes_key: "a".repeat(64),
      takeoff_item_list_may_write: false });
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { userId: "director", tenantId: "tenant", tenantRole: "director", supabase: member.client },
      project: { id: "project", user_id: "engineer" },
    } as never);
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
    const list = await loadAffaireItemList("project");
    expect(list.proposal?.items.map(({ label }) => label)).toEqual(["Lavabo"]);
    expect(JSON.stringify(list)).not.toMatch(/measurementNotesDigest|factsDigest|négocié/);
  });

  // A change of the DPGF row's notes is told on its own, even beside another change, never by its digest or its text.
  it.each([
    ["the notes and the unit change", "PU négocié 85 € HT", true],
    ["only the unit changes", null, false],
  ] as const)("tells a reader whether a row's notes changed when %s", async (_case, notes, notesChanged) => {
    const read = async (stored: { unit: string; origin: Record<string, unknown> } | null) => {
      const entry = stored && { item_id: "aaaaaaaa-0000-4000-8000-0000000000c1", source_key: posteOriginKey(stored.origin as never),
        label: "Lavabo", expected_unit: stored.unit, measurement_basis: null, qualifiers: {}, sections: [], synonyms: [],
        origin: stored.origin, reference_quantity: 2 };
      const member = client({ takeoff_list_revisions: entry ? [{ id: "rev-1", revision: 1, cause: "initial", item_count: 1,
        content_sha256: "c".repeat(64), created_by: "engineer", created_at: stamped, intent_key: "8f7c1d9e-0000-4000-8000-000000000003",
        sources: { kind: "dpgf", importId: "import-a", mappingId: "mapping", sourceFormat: "csv", decisions: "missing" } }] : [],
        takeoff_list_revision_entries: entry ? [entry] : [], takeoff_list_item_sources: [], profiles: [] });
      const service = client({
        dpgf_imports: [importRow], affaire_intake_documents: [],
        dpgf_mappings: [{ id: "mapping", status: "validated", column_mapping: {}, created_at: stamped, updated_at: stamped }],
        dpgf_rows_raw: [{ id: "raw", row_index: 0, structure: null, provenance: null }],
        dpgf_rows_mapped: [{ id: "mapped", raw_row_id: "raw", designation: "Lavabo", unit: "u", quantity: 2, notes }],
      }, { read_dpgf_import_confirmation: [], takeoff_item_list_notes_key: "a".repeat(64), takeoff_item_list_may_write: false });
      vi.mocked(requireAffaireAccess).mockResolvedValue({
        context: { userId: "engineer", tenantId: "tenant", tenantRole: "engineer", supabase: member.client },
        project: { id: "project", user_id: "engineer" },
      } as never);
      vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
      return loadAffaireItemList("project");
    };
    // The row as the sources give it now; the stored list had it in metres and without notes.
    const [item] = (await read(null)).proposal!.items;
    const list = await read({ unit: "ml", origin: { ...item!.origin, measurementNotesDigest: null, factsDigest: "f".repeat(64) } });
    expect(list.proposal?.changes).toEqual([expect.objectContaining({ measurementChanged: true, notesChanged,
      previous: expect.objectContaining({ expectedUnit: "ml" }), current: expect.objectContaining({ expectedUnit: "u" }) })]);
    expect(JSON.stringify(list)).not.toMatch(/measurementNotesDigest|factsDigest|négocié/);
  });

  it("shows why a revision omitted rows from its own facts, once its import is gone", async () => {
    const omissions = { sourceFormat: "xlsx", decisions: 1, exclusions: [
      { rowIndex: 3, reason: "footer", sourceRowNumber: 4, sheetRowNumber: 6, sourcePage: null },
    ] };
    const revision = { id: "rev-1", revision: 1, cause: "initial", item_count: 0, content_sha256: "c".repeat(64),
      created_by: "engineer", created_at: stamped, intent_key: "8f7c1d9e-0000-4000-8000-000000000002",
      sources: { kind: "dpgf", importId: "gone", mappingId: "gone", sourceFormat: "xlsx", decisions: "applied", confirmationId: "c1",
        confirmedAt: stamped, structure: { decisions: [{ rowIndex: 0, kind: "section", level: 1 }],
          exclusions: omissions.exclusions } } };
    // The import is deleted: the live sources are the shipped template; the revision still says what it left out.
    const member = client({ takeoff_list_revisions: [revision], takeoff_list_revision_entries: [],
      takeoff_list_item_sources: [], profiles: [] });
    const service = client({ dpgf_imports: [], affaire_intake_documents: [], takeoff_item_template_versions: [] },
      { takeoff_item_list_may_write: false });
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { userId: "engineer", tenantId: "tenant", tenantRole: "engineer", supabase: member.client },
      project: { id: "project", user_id: "engineer" },
    } as never);
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
    const list = await loadAffaireItemList("project");
    expect(list.sources).toMatchObject({ kind: "template" });
    expect(list.current).toMatchObject({ revision: 1, omissions });
    expect(list.history).toEqual([expect.objectContaining({ revision: 1, omissions })]);
    expect(JSON.stringify(list)).not.toContain("gone");
  });

  // Two identical first additions sent together (a double click on an affaire without a list): the second gets the first
  // one's receipt, whatever the point where the first one's revisions were recorded while it waited.
  it.each([
    ["while it records the affaire's first list", "record"],
    ["while it reads the stored list", "history"],
  ] as const)("answers the second of two identical first additions with the first one's receipt, the first done %s",
    async (_case, point) => {
      const database = listDatabase(point);
      vi.mocked(requireAffaireAccess).mockResolvedValue({
        context: { userId: OWNER, tenantId: "tenant", tenantRole: "engineer", supabase: database.client },
        project: { id: "project", user_id: OWNER },
      } as never);
      vi.mocked(createServiceRoleClient).mockReturnValue(database.client);
      const addition = { expectedRevision: 0, intentKey: "8f7c1d9e-0000-4000-8000-0000000000a1", label: "Robinet de puisage",
        expectedUnit: "u", measurementBasis: null, qualifiers: {}, sectionOfItemId: null };
      // The second call reaches the database first and waits there; the first runs to its end meanwhile.
      const second = addItemListPoste("project", addition);
      await database.held;
      const first = await addItemListPoste("project", addition);
      database.release();
      expect(first).toMatchObject({ revision: 2, replayed: false });
      await expect(second).resolves.toEqual({ ...first, replayed: true });
      expect(database.revisions.map(({ revision, cause }) => [revision, cause])).toEqual([[1, "initial"], [2, "item_added"]]);
    });

  // The same on a list that has revisions: the second reads the list once the first recorded its revision, and gets its
  // receipt, never « La liste des postes a changé depuis votre lecture » (the gesture is the same).
  it("answers the second of two identical additions to an existing list with the first one's receipt", async () => {
    const database = listDatabase("history", { armed: false });
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { userId: OWNER, tenantId: "tenant", tenantRole: "engineer", supabase: database.client },
      project: { id: "project", user_id: OWNER },
    } as never);
    vi.mocked(createServiceRoleClient).mockReturnValue(database.client);
    const addition = (expectedRevision: number, intentKey: string, label: string) => ({ expectedRevision, intentKey, label,
      expectedUnit: "u", measurementBasis: null, qualifiers: {}, sectionOfItemId: null });
    await addItemListPoste("project", addition(0, "8f7c1d9e-0000-4000-8000-0000000000a2", "Clapet anti-retour"));
    database.arm();
    const gesture = addition(2, "8f7c1d9e-0000-4000-8000-0000000000a3", "Purgeur automatique");
    const second = addItemListPoste("project", gesture);
    await database.held;
    const first = await addItemListPoste("project", gesture);
    database.release();
    expect(first).toMatchObject({ revision: 3, replayed: false });
    await expect(second).resolves.toEqual({ ...first, replayed: true });
    expect(database.revisions.map(({ revision }) => revision)).toEqual([1, 2, 3]);
  });

  // Two identical acceptances of the proposed first list: the second gets the first one's receipt.
  it("answers the second of two identical acceptances with the first one's receipt", async () => {
    const database = listDatabase("history", { armed: false });
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { userId: OWNER, tenantId: "tenant", tenantRole: "engineer", supabase: database.client },
      project: { id: "project", user_id: OWNER },
    } as never);
    vi.mocked(createServiceRoleClient).mockReturnValue(database.client);
    const { proposal } = await loadAffaireItemList("project");
    database.arm();
    const gesture = { expectedRevision: 0, proposalDigest: proposal!.digest, intentKey: "8f7c1d9e-0000-4000-8000-0000000000a4",
      continuities: [] };
    const second = acceptItemListProposal("project", gesture);
    await database.held;
    const first = await acceptItemListProposal("project", gesture);
    database.release();
    expect(first).toMatchObject({ revision: 1, replayed: false });
    await expect(second).resolves.toEqual({ ...first, replayed: true });
    expect(database.revisions.map(({ revision, cause }) => [revision, cause])).toEqual([[1, "initial"]]);
  });

  it("refuses a member who may not write the list before reading any earlier gesture", async () => {
    const service = client({}, { takeoff_item_list_may_write: false });
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { userId: "director", tenantId: "tenant", tenantRole: "director", supabase: client({}).client },
      project: { id: "project", user_id: "owner" },
    } as never);
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client);
    await expect(acceptItemListProposal("project", { expectedRevision: 0, proposalDigest: "a".repeat(64),
      intentKey: "8f7c1d9e-0000-4000-8000-000000000001", continuities: [] })).rejects.toMatchObject({ status: 403 });
    expect(service.reads).toEqual(["rpc:takeoff_item_list_may_write"]);
  });
});
