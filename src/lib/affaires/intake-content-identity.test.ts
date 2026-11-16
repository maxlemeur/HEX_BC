import { describe, expect, it } from "vitest";

import {
  findDuplicateIntakeDocument,
  hashIntakeContent,
  INTAKE_DUPLICATE_MESSAGE,
  INTAKE_DUPLICATE_PENDING_MESSAGE,
} from "@/lib/affaires/intake-content-identity";
import {
  createFakeSupabase,
  type FakeRow,
  type FakeSupabaseOptions,
} from "@/lib/material-requests/server.test-utils";

const TENANT_ID = "tenant-1";
const PROJECT_ID = "project-1";
const SHA = "a".repeat(64);
const SIZE = 11;
const MINUTE = 60_000;

type Call = [method: string, ...args: unknown[]];

/** The shared fake, with every query's builder calls recorded in the order they were made. */
function setup(rows: FakeRow[], options: Partial<FakeSupabaseOptions> = {}) {
  const fake = createFakeSupabase({ userId: "user-1", tables: { affaire_intake_documents: rows }, ...options });
  const queries: Call[][] = [];
  const from = fake.supabase.from;
  const recordedFrom = (table: string) => {
    const calls: Call[] = [["from", table]];
    queries.push(calls);
    const builder = from(table) as unknown as Record<string, unknown>;
    const proxy: Record<string, unknown> = new Proxy(builder, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function" || property === "then") return value;
        return (...args: unknown[]) => {
          calls.push([String(property), ...args]);
          const result = (value as (...inner: unknown[]) => unknown).apply(target, args);
          return result === target ? proxy : result;
        };
      },
    });
    return proxy;
  };
  const access = {
    context: { supabase: { ...fake.supabase, from: recordedFrom }, tenantId: TENANT_ID },
    project: { id: PROJECT_ID },
  } as never;
  const updates = () => queries.filter((calls) => calls.some(([method]) => method === "update"));
  return { ...fake, access, queries, updates };
}

function pendingRow(ageMinutes: number, overrides: FakeRow = {}): FakeRow {
  const createdAt = new Date(Date.now() - ageMinutes * MINUTE).toISOString();
  return {
    id: "pending-1", tenant_id: TENANT_ID, project_id: PROJECT_ID, content_sha256: SHA, deleted_at: null,
    upload_status: "pending", classification_status: "queued", rejection_reason: null, source_provider: null,
    storage_path: null, size_bytes: SIZE, created_at: createdAt, updated_at: createdAt, ...overrides,
  };
}

const RELEASE_PAYLOAD = {
  upload_status: "rejected",
  classification_status: "failed",
  rejection_reason: "Transfert interrompu. Vous pouvez renvoyer ce document.",
};

describe("findDuplicateIntakeDocument: interrupted reservations", () => {
  it("releases a pending reservation older than 15 minutes with one compare-and-swap, then scans legacy rows", async () => {
    const bytes = new TextEncoder().encode("plan fictif");
    const sha = await hashIntakeContent(new Blob([bytes]));
    const stale = pendingRow(16, { content_sha256: sha });
    const legacy: FakeRow = {
      id: "legacy-1", tenant_id: TENANT_ID, project_id: PROJECT_ID, content_sha256: null, source_provider: null,
      deleted_at: null, upload_status: "uploaded", size_bytes: bytes.byteLength, storage_path: "legacy/plan.txt",
      created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
    };
    const { access, updates, tables, writes } = setup([stale, legacy], { objects: { "legacy/plan.txt": bytes } });

    const result = await findDuplicateIntakeDocument(access, sha, bytes.byteLength);

    expect(result).toEqual({ documentId: "legacy-1", message: INTAKE_DUPLICATE_MESSAGE });
    expect(updates()).toEqual([[
      ["from", "affaire_intake_documents"],
      ["update", RELEASE_PAYLOAD],
      ["eq", "tenant_id", TENANT_ID],
      ["eq", "project_id", PROJECT_ID],
      ["eq", "id", "pending-1"],
      ["eq", "upload_status", "pending"],
      ["eq", "updated_at", stale.updated_at],
      ["is", "deleted_at", null],
      ["select", "id"],
    ]]);
    expect(writes).toEqual([{ table: "affaire_intake_documents", operation: "update", values: RELEASE_PAYLOAD, ids: ["pending-1"] }]);
    expect(tables.affaire_intake_documents.find((row) => row.id === "pending-1")).toMatchObject(RELEASE_PAYLOAD);
  });

  it("gives up after three reads when another writer changes the reservation before every release", async () => {
    let bump = 0;
    const { access, reads, writes } = setup([pendingRow(20)], {
      beforeUpdate: (_table, _values, tables) => {
        bump += 1;
        tables.affaire_intake_documents[0].updated_at = new Date(Date.now() - 20 * MINUTE + bump * 1000).toISOString();
      },
    });

    await expect(findDuplicateIntakeDocument(access, SHA, SIZE)).rejects.toMatchObject({
      message: "Le transfert a changé pendant la vérification. Réessayez.",
    });
    expect(reads).toEqual(["affaire_intake_documents", "affaire_intake_documents", "affaire_intake_documents"]);
    expect(writes.map(({ operation, ids }) => ({ operation, ids }))).toEqual([
      { operation: "update", ids: [] },
      { operation: "update", ids: [] },
      { operation: "update", ids: [] },
    ]);
  });

  it("reports a refused release", async () => {
    const { access } = setup([pendingRow(30)], { refuseUpdate: () => "refused by the database" });

    await expect(findDuplicateIntakeDocument(access, SHA, SIZE)).rejects.toMatchObject({
      message: "Impossible de reprendre le transfert interrompu. Réessayez.",
    });
  });

  it("treats a pending reservation younger than 15 minutes as an upload in progress and writes nothing", async () => {
    const { access, writes, updates } = setup([pendingRow(5)]);

    await expect(findDuplicateIntakeDocument(access, SHA, SIZE)).resolves.toEqual({
      documentId: "pending-1",
      message: INTAKE_DUPLICATE_PENDING_MESSAGE,
    });
    expect(updates()).toEqual([]);
    expect(writes).toEqual([]);
  });
});
