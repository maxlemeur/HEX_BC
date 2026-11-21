import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { acceptItemListProposal, loadAffaireItemList } from "./item-list-server";


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
