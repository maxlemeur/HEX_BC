import { vi } from "vitest";
import type { DriveFile } from "./contracts";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string } | null; count?: number };
function contains(row: unknown, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null) return row === expected;
  return typeof row === "object" && row !== null && Object.entries(expected).every(([key, value]) => contains((row as Row)[key], value));
}
export function memoryBackend() {
  const tables = new Map<string, Map<string, Row>>();
  const objects = new Map<string, File>();
  const failStorage = new Set<string>();
  const failures = new Map<string, string>();
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; operation: string; selection: string }> = [];
  const rows = (table: string) => { if (!tables.has(table)) tables.set(table, new Map()); return tables.get(table)!; };
  class Query {
    filters: Array<[string, unknown]> = [];
    operation = "select";
    selection = "";
    value: Row = {};
    one = false;
    start = 0;
    end = Infinity;
    constructor(readonly table: string) {}
    select(value: string) { this.selection = value; return this; }
    insert(value: Row) { this.operation = "insert"; this.value = value; return this; }
    update(value: Row) { this.operation = "update"; this.value = value; return this; }
    eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
    is(key: string, value: unknown) { this.filters.push([key, value]); return this; }
    in(key: string, values: unknown[]) { this.filters.push([key, { values }]); return this; }
    contains(key: string, value: unknown) { this.filters.push([key, { contains: value }]); return this; }
    order() { return this; }
    range(start: number, end: number) { this.start = start; this.end = end; return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    execute(): Result {
      queries.push({ table: this.table, filters: [...this.filters], operation: this.operation, selection: this.selection });
      if (failures.has(this.table)) return { data: null, error: { code: failures.get(this.table)! } };
      const table = rows(this.table);
      if (this.operation === "insert") {
        if (table.has(String(this.value.id))) return { data: null, error: { code: "23505" } };
        const parent = this.table === "affaire_intake_documents" ? rows("affaire_intake_uploads").get(String(this.value.upload_id))
          : this.table === "affaire_intake_events" ? rows("affaire_intake_documents").get(String(this.value.document_id)) : null;
        table.set(String(this.value.id), { tenant_id: "tenant_demo", ...this.value,
          ...(parent ? { project_id: parent.project_id, tenant_id: parent.tenant_id } : {}) });
        return { data: this.value, error: null };
      }
      let found = [...table.values()].filter((row) => this.filters.every(([key, value]) => {
        if (key === "affaire_intake_documents.upload_status") return rows("affaire_intake_documents").get(String(row.document_id))?.upload_status === value;
        if (typeof value === "object" && value !== null && "values" in value) return (value.values as unknown[]).includes(row[key]);
        return typeof value === "object" && value !== null && "contains" in value ? contains(row[key], value.contains) : (value === null ? row[key] == null : row[key] === value);
      }));
      if (this.operation === "update") { found.forEach((row) => Object.assign(row, this.value)); return { data: this.selection ? found : null, error: null }; }
      const count = found.length;
      found = found.slice(this.start, this.end + 1);
      // Honour projection, including the identity requirement of readAllRows.
      const selected = this.selection.split(",").filter((key) => !key.includes("(") && !key.includes(")"));
      const data = found.map((row) => ({ ...Object.fromEntries(selected.map((key) => [key, row[key]])),
        ...(this.selection.includes("affaire_intake_documents!inner") ? { affaire_intake_documents: rows("affaire_intake_documents").get(String(row.document_id)) } : {}) }));
      return { data: this.one ? data[0] ?? null : data, error: null, count };
    }
    then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }
  const upload = vi.fn(async (path: string, file: File) => {
    if (failStorage.has(file.name)) return { error: { message: "simulated_storage_failure" } };
    if (objects.has(path)) return { error: { message: "duplicate" } };
    objects.set(path, file);
    return { error: null };
  });
  const supabase = { from: (table: string) => new Query(table), storage: { from: () => ({ upload,
    download: async (path: string) => ({ data: objects.get(path) ?? null, error: objects.has(path) ? null : { message: "missing" } }),
  }) } };
  const access = { context: { tenantId: "tenant_demo", userId: "user_demo", tenantRole: "admin", supabase },
    project: { id: "project_demo", name: "Affaire fictive POC", tenant_id: "tenant_demo", user_id: "user_demo", is_archived: false } };
  return { tables, rows, objects, failStorage, failures, queries, access, upload };
}

export function fakeDrive() {
  const files = new Map<string, DriveFile>([
    ["folder_demo", { id: "folder_demo", name: "Dossier fictif POC", mimeType: "application/vnd.google-apps.folder" }],
    ["plan_demo", { id: "plan_demo", name: "plan-fictif.txt", mimeType: "text/plain", size: "5", version: "1", parents: ["folder_demo"] }],
    ["cctp_demo", { id: "cctp_demo", name: "cctp-fictif.txt", mimeType: "text/plain", size: "5", version: "1", parents: ["folder_demo"] }],
  ]);
  const responses = new Map<string, number>();
  const fetchMock = vi.fn(async (input: URL | RequestInfo, options?: RequestInit) => {
    const url = new URL(String(input));
    const id = url.pathname.split("/").pop()!;
    const status = responses.get(id);
    if (status) return Response.json({ error: { errors: [{ reason: "insufficientFilePermissions" }] } }, { status });
    if (options?.signal?.aborted) throw new Error("aborted");
    if (url.pathname.endsWith("/about")) return Response.json({ user: { displayName: "Compte fictif", emailAddress: "poc@example.invalid" } });
    if (url.pathname.endsWith("/files")) return Response.json({ files: [...files.values()].filter((file) => file.parents?.includes("folder_demo")) });
    const file = files.get(id === "root" ? "folder_demo" : id);
    if (!file) return Response.json({}, { status: 404 });
    return url.searchParams.get("alt") === "media" ? new Response("plans") : Response.json(file);
  });
  return { files, responses, fetchMock };
}
