import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./item-list-server", () => ({ readStoredItemList: vi.fn() }));

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readStoredItemList } from "./item-list-server";
import { freezeAffaireItemSelection, readAffaireItemTable } from "./item-table-server";
import { ITEM_REVIEW_LIMITS } from "./item-table";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const TENANT = "77777777-7777-4777-8777-777777777777";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const itemId = (index: number) => `00000000-0000-4000-a000-${String(index).padStart(12, "0")}`;

function stored(count: number) {
  return {
    row: { id: "44444444-4444-4444-8444-444444444444", revision: 2, item_count: count },
    revision: { scope: { tenantId: TENANT, projectId: PROJECT }, revision: 2, digest: "d", items: Array.from({ length: count }, (_, index) => ({
      id: itemId(index), label: `Poste ${index}`, expectedUnit: index === 0 ? null : "u", measurementBasis: null, qualifiers: {},
      sections: [{ id: "s", title: "Plomberie", order: 1 }], synonyms: [], referenceQuantity: index === 1 ? 4 : null,
      origin: index === 1
        ? { kind: "dpgf", importId: "i", mappingId: "m", rawRowId: "r", mappedRowId: "mr", rowIndex: 1, sheetName: null,
          sourceRowNumber: 2, sourcePage: null, tableIndex: null, documentId: null, reference: "3.1.2", sourceUnit: "u",
          measurementNotesDigest: null, factsDigest: "f" }
        : { kind: "template", templateId: "plomberie", version: 1, familyId: "f", lineId: `l${index}` },
    })) },
  };
}

const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAffaireAccess).mockResolvedValue({ context: { tenantId: TENANT, userId: MEMBER,
    supabase: { from: () => { throw new Error("no member read expected"); } } }, project: { id: PROJECT } } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue({ rpc } as never);
  rpc.mockResolvedValue({ data: true, error: null });
});

const query = { scope: { kind: "affaire" as const }, filter: {}, offset: 0, limit: 50, focusItemId: null };

describe("readAffaireItemTable", () => {
  it("gives every item of the stored list its line, « to measure » while no answer is stored", async () => {
    vi.mocked(readStoredItemList).mockResolvedValue(stored(3) as never);
    const table = await readAffaireItemTable(PROJECT, query);
    expect(table.list).toEqual({ revisionId: "44444444-4444-4444-8444-444444444444", revision: 2, itemCount: 3 });
    expect(table.page.total).toBe(3);
    expect(table.page.lines.map(({ state, decision }) => [state, decision])).toEqual([
      ["to_measure", "none"], ["to_measure", "none"], ["to_measure", "none"]]);
    expect(table.page.lines[1]).toMatchObject({ origin: "dpgf", reference: { quantity: 4, dpgfReference: "3.1.2" },
      sectionPath: ["Plomberie"], family: "Plomberie" });
    expect(table.page.lines[0].expectedUnit).toBeNull();
    expect(table.canReview).toBe(true);
    // The operator rule of the list is the one asked, for this member of this affaire.
    expect(rpc).toHaveBeenCalledWith("takeoff_item_list_may_write", { p_tenant_id: TENANT, p_project_id: PROJECT, p_actor: MEMBER });
    expect(requireAffaireAccess).toHaveBeenCalledWith(PROJECT, "read");
  });

  it("answers without lines before the first list is recorded", async () => {
    vi.mocked(readStoredItemList).mockResolvedValue(null);
    rpc.mockResolvedValue({ data: false, error: null });
    const table = await readAffaireItemTable(PROJECT, query);
    expect(table).toMatchObject({ list: null, canReview: false, page: { lines: [], total: 0 } });
  });
});

describe("freezeAffaireItemSelection", () => {
  it("refuses a selection above its bound, never cuts it", async () => {
    vi.mocked(readStoredItemList).mockResolvedValue(stored(ITEM_REVIEW_LIMITS.items + 1) as never);
    await expect(freezeAffaireItemSelection(PROJECT, { scope: { kind: "affaire" }, selection: { kind: "filter", filter: {} } }))
      .rejects.toMatchObject({ status: 422, code: "TAKEOFF_ITEM_SELECTION_TOO_LARGE" });
  });

  it("freezes the items named, and names those no longer in the list", async () => {
    vi.mocked(readStoredItemList).mockResolvedValue(stored(2) as never);
    const frozen = await freezeAffaireItemSelection(PROJECT, { scope: { kind: "affaire" },
      selection: { kind: "items", itemIds: [itemId(1), itemId(9)] } });
    // No plan was read against the list yet: nothing to review, nothing to measure again.
    expect(frozen).toMatchObject({ count: 1, missing: [itemId(9)], items: [{ itemId: itemId(1), label: "Poste 1",
      target: { itemId: itemId(1), entryRevision: 0, answers: [] }, eligible: [] }] });
  });
});
