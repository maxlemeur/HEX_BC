import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyEstimateStructureDraft, batchEstimateOperations, bulkUpdateEstimateItems,
  createEstimateItem, deleteEstimateItem, duplicateEstimateSection,
  importEstimateSections, importLinkedDpgfSource, insertAssemblyIntoVersion,
  insertTemplateIntoVersion, materializeVersionZeroDraft, moveEstimateItem,
  reorderEstimateItems, runEstimateEditorExternalMutation, saveEstimateVersion,
  updateEstimateItem, updateEstimateStatus,
} from "@/lib/estimates/client";
import {
  isOlderEstimateVersionToken, registerEstimateEditorMutations,
  runEstimateEditorMutation, waitForEstimateEditorMutations,
} from "@/lib/estimates/editor-mutations";
import type { Database } from "@/types/database";

// A local type bridge preserves the future CAS intent without changing runtime.
const saveEstimateSettingsPrecode = saveEstimateVersion as unknown as (
  versionId: string,
  updates: Database["public"]["Tables"]["estimate_versions"]["Update"],
  updatedAtToken: string,
  expectedContentRevision: number
) => Promise<{
  version: Database["public"]["Tables"]["estimate_versions"]["Row"];
  items: Database["public"]["Tables"]["estimate_items"]["Row"][];
}>;

const ID = "77777777-7777-4777-8777-777777777777";
const ITEM = "88888888-8888-4888-8888-888888888888";
const OTHER = "99999999-9999-4999-8999-999999999999";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const INITIAL = "2026-09-05T10:00:00.000001Z";
const NEXT = "2026-09-05T10:00:01.000001Z";
const LAST = "2026-09-05T10:00:02.000001Z";
const createInput = { version_id: ID, item_type: "line" as const, title: "Ligne", position: 1 };
const cleanups: Array<() => void> = [];
function editor(id = ID) {
  let token = INITIAL;
  const onCommit = vi.fn(({ version }) => { token = version.updated_at; });
  const onPendingChange = vi.fn();
  const stop = registerEstimateEditorMutations(id, {
    getToken: () => token, onCommit, onPendingChange,
    getIdentity: () => ({ actorId: ACTOR, tenantId: TENANT, versionId: id }),
  });
  cleanups.push(stop);
  return { onCommit, onPendingChange, stop, reload: (value: string) => { token = value; } };
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: status < 400, ...(status < 400 ? { data } : { error: data }) }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  vi.unstubAllGlobals();
});

const structuralCases: Array<{ name: string; run: () => Promise<unknown>; data: object }> = [
  { name: "ajout de ligne / chapitre et rétablissement", run: () => createEstimateItem(ID, createInput), data: { item: { id: ITEM } } },
  { name: "modification directe / annulation", run: () => updateEstimateItem(ID, ITEM, { title: "Modifiée" }), data: { item: { id: ITEM } } },
  { name: "suppression / annulation de création", run: () => deleteEstimateItem(ID, ITEM), data: { deleted_id: ITEM, deleted_ids: [ITEM, OTHER] } },
  { name: "ordre / collage / annulation et rétablissement", run: () => reorderEstimateItems(ID, null, [ITEM]), data: { ordered_ids: [ITEM], updated_count: 1 } },
  { name: "déplacement de lot", run: () => moveEstimateItem(ID, { item_id: ITEM, from_parent_id: null, to_parent_id: OTHER, ordered_source_ids: [], ordered_target_ids: [ITEM] }), data: { item_id: ITEM, updated_count: 1 } },
  { name: "duplication de chapitre", run: () => duplicateEstimateSection(ID, ITEM), data: { duplicated_section_id: OTHER, source_version_id: ID, target_version_id: ID, copied_item_count: 1 } },
  { name: "import de sections", run: () => importEstimateSections(ID, { sourceVersionId: OTHER, sectionIds: [ITEM], mode: "append" }), data: { sourceVersionId: OTHER, targetVersionId: ID, mode: "append", importedSectionsCount: 1, importedLinesCount: 1 } },
  { name: "import DPGF", run: () => importLinkedDpgfSource(ID), data: { sourceImportId: OTHER, targetVersionId: ID, createdSectionId: ITEM, importedLinesCount: 1, totals: { total_ht_cents: 100, total_tax_cents: 20, total_ttc_cents: 120 } } },
  { name: "application de structure", run: () => applyEstimateStructureDraft(ID, OTHER, { mode: "create_empty", selectedRootNodeIds: [ITEM] }), data: { draftId: OTHER, versionId: ID, mode: "create_empty", createdCount: 1, mergedCount: 0, skippedCount: 0 } },
  { name: "matérialisation V0", run: () => materializeVersionZeroDraft(ID, OTHER), data: { status: "applied" } },
  { name: "insertion de template", run: () => insertTemplateIntoVersion(OTHER, { versionId: ID }), data: { items: [{ id: ITEM }] } },
  { name: "insertion d’ouvrage", run: () => insertAssemblyIntoVersion(OTHER, { versionId: ID }), data: { items: [{ id: ITEM }] } },
];

describe("editor writes and optimistic concurrency", () => {
  it.each(structuralCases)("uses the committed token after $name", async ({ run, data }) => {
    const session = editor();
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ ...data, version: { id: ID, updated_at: NEXT, content_revision: 2 } }))
      .mockResolvedValueOnce(response({ version: { id: ID, updated_at: LAST, content_revision: 3 }, items: [] }));
    vi.stubGlobal("fetch", fetch);
    await run();
    // A caller may have captured its snapshot before the structural write.
    await saveEstimateSettingsPrecode(ID, { title: "Réglages" }, INITIAL, 1);
    const request = fetch.mock.calls[1][1] as RequestInit;
    expect(new Headers(request.headers).get("If-Match")).toBe(NEXT);
    expect(JSON.parse(String(request.body)).updated_at).toBe(NEXT);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session.onCommit.mock.calls[0][0]).toMatchObject({ structural: true });
    expect(session.onCommit.mock.calls[1][0].version.updated_at).toBe(LAST);
  });

  it("serializes a slow deletion, autosave and totals, updating both token fields", async () => {
    editor();
    const deletion = deferred<Response>();
    const fetch = vi.fn().mockReturnValueOnce(deletion.promise)
      .mockImplementationOnce((_path: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        return response({
          committed: true,
          results: [{ index: 0, op: "update", status: "ok", data: { item: {
            id: OTHER, version_id: ID, item_type: "line", quantity: 2,
            pu_ht_cents: 100, line_total_ht_cents: 200, line_tax_cents: 40,
            line_total_ttc_cents: 240,
          } } }],
          version: { id: ID, updated_at: LAST },
          current_version: { id: ID, updated_at: LAST, status: "draft" },
          totals: { total_ht_cents: 200, total_tax_cents: 40, total_ttc_cents: 240 },
          replayed: false,
          receipt: {
            operation_key: body.operation_key, actor_id: ACTOR, version_id: ID,
            expected_updated_at: NEXT, operations: body.operations, committed_at: LAST,
          },
        });
      })
      .mockResolvedValueOnce(response({ updated_count: 0, version: { id: ID, updated_at: LAST } }));
    vi.stubGlobal("fetch", fetch);
    const removed = deleteEstimateItem(ID, ITEM);
    const saved = batchEstimateOperations(ID, INITIAL, [{ op: "update", id: OTHER, data: { quantity: 2 } }]);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    deletion.resolve(response({ deleted_id: ITEM, deleted_ids: [ITEM], version: { id: ID, updated_at: NEXT } }));
    await Promise.all([removed, saved]);
    await bulkUpdateEstimateItems(ID, INITIAL, [], { total_ht_cents: 200, total_tax_cents: 40, total_ttc_cents: 240 });
    const batch = fetch.mock.calls[1][1] as RequestInit;
    expect(new Headers(batch.headers).get("If-Match")).toBe(NEXT);
    expect(JSON.parse(String(batch.body)).concurrency_token).toBe(NEXT);
    const totals = fetch.mock.calls[2][1] as RequestInit;
    expect(new Headers(totals.headers).get("If-Match")).toBe(LAST);
    expect(JSON.parse(String(totals.body)).updated_at).toBe(LAST);
  });

  it("refreshes legacy imports inside the queue before the next write", async () => {
    editor();
    const refresh = deferred<Response>();
    const fetch = vi.fn().mockResolvedValueOnce(response({ items: [] }))
      .mockReturnValueOnce(refresh.promise)
      .mockResolvedValueOnce(response({ version: { id: ID, updated_at: LAST } }));
    vi.stubGlobal("fetch", fetch);
    const inserted = insertAssemblyIntoVersion(OTHER, { versionId: ID });
    const saved = updateEstimateStatus(ID, "sent", INITIAL);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1][0]).toBe(`/api/estimates/${ID}`);
    refresh.resolve(response({ version: { id: ID, updated_at: NEXT } }));
    await Promise.all([inserted, saved]);
    expect(new Headers(fetch.mock.calls[2][1].headers).get("If-Match")).toBe(NEXT);
  });

  it("coordinates generated ouvrage server actions with HTTP autosave", async () => {
    editor();
    const action = deferred<number>();
    const fetch = vi.fn().mockResolvedValueOnce(response({ version: { id: ID, updated_at: NEXT, content_revision: 2 } }))
      .mockResolvedValueOnce(response({ version: { id: ID, updated_at: LAST, content_revision: 3 }, items: [] }));
    vi.stubGlobal("fetch", fetch);
    const inserted = runEstimateEditorExternalMutation(ID, () => action.promise);
    const saved = saveEstimateSettingsPrecode(ID, { title: "Devis" }, INITIAL, 1);
    await Promise.resolve();
    expect(fetch).not.toHaveBeenCalled();
    action.resolve(3);
    expect(await inserted).toBe(3);
    await saved;
    expect(new Headers(fetch.mock.calls[1][1].headers).get("If-Match")).toBe(NEXT);
  });

  it("never retries or acknowledges an external VERSION_CONFLICT", async () => {
    const session = editor();
    const fetch = vi.fn().mockResolvedValue(response({ code: "VERSION_CONFLICT", message: "Version modifiée ailleurs" }, 409));
    vi.stubGlobal("fetch", fetch);
    const results = await Promise.allSettled([
      deleteEstimateItem(ID, ITEM), saveEstimateSettingsPrecode(ID, { title: "Devis" }, INITIAL, 1),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.onCommit).not.toHaveBeenCalled();
  });

  it("does not rebase an unknown stale token or an old draft after a server reload", async () => {
    const session = editor();
    const operation = vi.fn(async (token) => ({ value: token, version: { id: ID, updated_at: NEXT } }));
    expect(await runEstimateEditorMutation(ID, "foreign-token", operation)).toBe("foreign-token");
    session.reload(LAST);
    expect(await runEstimateEditorMutation(ID, INITIAL, operation)).toBe(INITIAL);
  });

  it("cancels queued writes and ignores in-flight results when the route/account changes", async () => {
    const session = editor();
    const first = deferred<{ value: number; version: { id: string; updated_at: string } }>();
    const inFlight = runEstimateEditorMutation(ID, INITIAL, () => first.promise);
    const queued = vi.fn();
    const next = runEstimateEditorMutation(ID, INITIAL, queued);
    const completed = Promise.allSettled([inFlight, next]);
    await Promise.resolve();
    session.stop();
    first.resolve({ value: 1, version: { id: ID, updated_at: NEXT } });
    const results = await completed;
    expect(results[1].status).toBe("rejected");
    expect(queued).not.toHaveBeenCalled();
    expect(session.onCommit).not.toHaveBeenCalled();
  });

  it("drains writes added while waiting and isolates distinct estimates", async () => {
    editor();
    editor(OTHER);
    const first = deferred<{ value: number; version: { id: string; updated_at: string } }>();
    const running = runEstimateEditorMutation(ID, INITIAL, () => first.promise);
    const waiting = waitForEstimateEditorMutations(ID);
    const other = await runEstimateEditorMutation(OTHER, INITIAL, async () => ({ value: 2, version: { id: OTHER, updated_at: NEXT } }));
    expect(other).toBe(2);
    const last = runEstimateEditorMutation(ID, INITIAL, async () => ({ value: 3, version: { id: ID, updated_at: LAST } }));
    first.resolve({ value: 1, version: { id: ID, updated_at: NEXT } });
    await waiting;
    expect(await last).toBe(3);
    await running;
  });

  it("compares PostgreSQL microseconds and equivalent timezone representations", () => {
    expect(isOlderEstimateVersionToken(INITIAL, "2026-09-05T10:00:00.000002Z")).toBe(true);
    expect(isOlderEstimateVersionToken("2026-09-05T12:00:00.000001+02:00", INITIAL)).toBe(false);
  });
});
