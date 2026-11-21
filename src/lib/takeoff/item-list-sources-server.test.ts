import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resolveItemListSources } from "./item-list-sources-server";

const scope = { tenantId: "tenant", projectId: "project" };
const stampedAt = "2026-11-20T09:00:00Z";
const columns = { Designation: "designation", Unite: "unit", Qte: "quantity" };

/**
 * The service role's view of an affaire: every import linked to it, whoever uploaded it (the old preview read them
 * through the member's session and could only say « a DPGF may exist that this account cannot see »).
 */
function service(options: {
  imports?: unknown[]; documents?: unknown[]; mappings?: unknown[]; raw?: unknown[]; mapped?: unknown[];
  confirmation?: unknown[]; templates?: unknown[];
}) {
  const tables: Record<string, unknown[]> = {
    dpgf_imports: options.imports ?? [], affaire_intake_documents: options.documents ?? [],
    dpgf_mappings: options.mappings ?? [], dpgf_rows_raw: options.raw ?? [], dpgf_rows_mapped: options.mapped ?? [],
    takeoff_item_template_versions: options.templates ?? [],
  };
  const from = vi.fn((table: string) => {
    const data = tables[table];
    const reply = { data, error: null, count: data.length };
    const query = {
      select: () => query, eq: () => query, is: () => query, order: () => query, gte: () => query,
      limit: () => query, range: () => Promise.resolve(reply),
      then: (resolve: (value: typeof reply) => unknown) => Promise.resolve(reply).then(resolve),
    };
    return query;
  });
  // The tenant's notes key (public.takeoff_item_list_notes_key), and the confirmation's record.
  const rpc = vi.fn(async (name: string) => ({
    data: name === "takeoff_item_list_notes_key" ? "a".repeat(64) : options.confirmation ?? [], error: null,
  }));
  return { from, rpc } as never;
}

const importRow = { id: "import-a", filename: "plomberie.csv", source_format: "csv", status: "completed", row_count: 3 };
const mapping = { id: "mapping-a", status: "validated", column_mapping: columns, created_at: stampedAt, updated_at: stampedAt };
const raw = [
  { id: "raw-0", row_index: 0, structure: null, provenance: null },
  { id: "raw-1", row_index: 1, structure: null, provenance: null },
  { id: "raw-2", row_index: 2, structure: null, provenance: null },
];
const mapped = [
  { id: "m0", raw_row_id: "raw-0", designation: "Bâtiment A" },
  { id: "m1", raw_row_id: "raw-1", designation: "Option lavabo", unit: "u", quantity: 2 },
  { id: "m2", raw_row_id: "raw-2", designation: "WC", unit: "u", quantity: 3 },
];

describe("the sources of an affaire's list", () => {
  it("gives the DPGF's list to every reader, whoever uploaded the import", async () => {
    const state = await resolveItemListSources(scope, service({ imports: [importRow], mappings: [mapping], raw, mapped }));
    expect(state).toMatchObject({ kind: "dpgf", importId: "import-a", decisions: { status: "unrecorded" } });
    expect(state.kind === "dpgf" && state.drafts.map(({ label }) => label)).toEqual(["Option lavabo", "WC"]);
  });

  it("applies the structure decisions whose proof still holds", async () => {
    const confirmation = [{ confirmation_id: "c1", mapping_id: "mapping-a", confirmed_at: stampedAt, proof_current: true,
      decisions: [{ rowIndex: 0, kind: "section", level: 1 }, { rowIndex: 1, kind: "ignore", level: null }] }];
    const state = await resolveItemListSources(scope, service({ imports: [importRow], mappings: [mapping], raw, mapped, confirmation }));
    expect(state).toMatchObject({ kind: "dpgf", decisions: { status: "applied", confirmationId: "c1", count: 2 } });
    expect(state.kind === "dpgf" && state.drafts.map(({ label, sections }) => [label, sections.map(({ title }) => title)]))
      .toEqual([["WC", ["Bâtiment A"]]]);
  });

  it("does not apply decisions whose proof no longer matches the import (another confirmation since)", async () => {
    const confirmation = [{ confirmation_id: "c1", mapping_id: "mapping-a", confirmed_at: stampedAt, proof_current: false,
      decisions: [{ rowIndex: 1, kind: "ignore", level: null }] }];
    const state = await resolveItemListSources(scope, service({ imports: [importRow], mappings: [mapping], raw, mapped, confirmation }));
    expect(state).toMatchObject({ kind: "dpgf", decisions: { status: "stale" } });
    expect(state.kind === "dpgf" && state.drafts.map(({ label }) => label)).toContain("Option lavabo");
  });

  it("asks to prepare a dossier DPGF that has no import, and to choose between two", async () => {
    expect(await resolveItemListSources(scope, service({ documents: [{ id: "doc" }] })))
      .toMatchObject({ kind: "prepare", reason: "document_without_import" });
    expect(await resolveItemListSources(scope, service({ imports: [importRow, { ...importRow, id: "import-b" }] })))
      .toMatchObject({ kind: "choose", imports: 2 });
    expect(await resolveItemListSources(scope, service({ imports: [importRow], mappings: [{ ...mapping, status: "draft" }] })))
      .toMatchObject({ kind: "prepare", reason: "mapping_draft" });
  });

  it("reads the tenant's published template, else the shipped one", async () => {
    const shipped = await resolveItemListSources(scope, service({}));
    expect(shipped).toMatchObject({ kind: "template", template: { version: 1, publicationId: null } });
    const published = await resolveItemListSources(scope, service({ templates: [{ id: "v2", version: 2,
      published_at: stampedAt, published_by: "admin", definition: { contract: 1, title: "Plomberie", families: [
        { id: "sanitaires", title: "Appareils sanitaires", lines: [{ id: "lavabo", label: "Lavabo sur colonne",
          expectedUnit: "u", measurementBasis: null, qualifiers: {}, synonyms: [] }] }] } }] }));
    expect(published).toMatchObject({ kind: "template", template: { version: 2, publicationId: "v2" } });
    expect(published.kind === "template" && published.drafts).toEqual([expect.objectContaining({ label: "Lavabo sur colonne",
      origin: expect.objectContaining({ kind: "template", lineId: "lavabo", version: 2, publicationId: "v2" }) })]);
  });
});
