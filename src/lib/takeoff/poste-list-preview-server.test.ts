import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { confirmMappedStructure } from "@/lib/imports/confirmed-mapped-structure";
import { loadPosteListPreview } from "./poste-list-preview-server";

function fixture(role: "admin" | "engineer", importOwner: string, confirmed = false) {
  const importRow = { id: "import-a", filename: "plomberie.csv", source_format: "csv", status: "completed", row_count: 1 };
  const stampedAt = "2026-11-20T09:00:00Z";
  const columns = { Designation: "designation", Unite: "unit", Qte: "quantity" };
  const line = { designation: "Option lavabo", unit: "u", quantity: 2 };
  const receipt = confirmed ? confirmMappedStructure([
    { id: "mapped-a", rawRowId: "raw-a", payload: { row_index: 0, mapped_row: line } },
  ], "legacy", columns, [])?.receipt : null;
  const tables: Record<string, unknown[]> = {
    // RLS exposes an administrator-authored direct import to administrators and its creator.
    dpgf_imports: role === "admin" || importOwner === "engineer" ? [importRow] : [],
    affaire_intake_documents: [],
    dpgf_mappings: [{ id: "legacy", status: "validated", created_at: stampedAt, updated_at: stampedAt }],
    dpgf_rows_raw: [{ id: "raw-a", row_index: 0, structure: {
      sheet_name: "DPGF", source_row_number: 4, bold_columns: ["Designation"], merged_columns: [],
      outline_level: 1, column_order: ["Designation", "Unite", "Qte"],
    } }],
    dpgf_rows_mapped: [{ id: "mapped-a", raw_row_id: "raw-a", ...line, receipt }],
  };
  const from = vi.fn((table: string) => {
    const data = tables[table];
    const reply = { data, error: null, count: data.length };
    const query = {
      select: () => query, eq: () => query, is: () => query, order: () => query, gte: () => query,
      limit: () => query, abortSignal: () => query, range: () => Promise.resolve(reply),
      then: (resolve: (value: typeof reply) => unknown) => Promise.resolve(reply).then(resolve),
    };
    return query;
  });
  vi.mocked(requireAffaireAccess).mockResolvedValue({
    context: { userId: "engineer", tenantId: "tenant", tenantRole: role, supabase: { from } },
    project: { id: "project", user_id: "engineer" },
  } as never);
}

describe("DPGF preview source confidence", () => {
  it("does not infer no DPGF when the project owner's session cannot see an administrator's import", async () => {
    fixture("engineer", "administrator");

    expect(await loadPosteListPreview("project")).toEqual({ kind: "limited" });
  });

  it("marks a visible confirmed DPGF as indicative when another import can be hidden", async () => {
    fixture("engineer", "engineer", true);

    expect(await loadPosteListPreview("project")).toMatchObject({
      kind: "dpgf", limitedVisibility: true, projection: { counts: { useful: 1 } },
    });
  });

  it("requires preparation for a single legacy mapping that cannot attest an ignored bold option with a quantity", async () => {
    fixture("admin", "administrator");

    expect(await loadPosteListPreview("project")).toEqual({ kind: "prepare" });
  });
});
