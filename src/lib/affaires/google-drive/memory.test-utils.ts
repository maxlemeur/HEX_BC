import { vi } from "vitest";
import type { DriveFile } from "./contracts";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string } | null; count?: number };
// In-memory stand-in for the RLS-scoped tables the Drive links use. It honours the active
// link index and projections; RLS itself is covered by the pgTAP suite.
export function memoryBackend() {
  const tables = new Map<string, Map<string, Row>>();
  const failures = new Map<string, string>();
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; operation: string; selection: string }> = [];
  const rows = (table: string) => { if (!tables.has(table)) tables.set(table, new Map()); return tables.get(table)!; };
  const key = (table: string, value: Row) => String(table === "affaire_google_drive_folders" ? value.project_id : value.id);
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
    upsert(value: Row) { this.operation = "upsert"; this.value = value; return this; }
    update(value: Row) { this.operation = "update"; this.value = value; return this; }
    delete() { this.operation = "delete"; return this; }
    predicates: Array<(row: Row) => boolean> = [];
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
    is(column: string, value: unknown) { this.filters.push([column, value]); return this; }
    in(column: string, values: unknown[]) { this.predicates.push((row) => values.includes(row[column])); return this; }
    lt(column: string, value: string) { this.predicates.push((row) => String(row[column]) < value); return this; }
    order() { return this; }
    range(start: number, end: number) { this.start = start; this.end = end; return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    execute(): Result {
      queries.push({ table: this.table, filters: [...this.filters], operation: this.operation, selection: this.selection });
      if (failures.has(this.table)) return { data: null, error: { code: failures.get(this.table)! } };
      const table = rows(this.table);
      if (this.operation === "insert" || this.operation === "upsert") {
        const id = String(this.value.id ?? key(this.table, this.value) ?? Math.random());
        if (this.operation === "insert" && table.has(id)) return { data: null, error: { code: "23505" } };
        if (this.table === "affaire_intake_documents" && this.value.drive_file_id && [...table.values()].some((row) =>
          row.project_id === rows("affaire_intake_uploads").get(String(this.value.upload_id))?.project_id &&
          row.drive_file_id === this.value.drive_file_id && !row.deleted_at)) return { data: null, error: { code: "23505" } };
        const parent = this.table === "affaire_intake_documents" ? rows("affaire_intake_uploads").get(String(this.value.upload_id)) : null;
        table.set(id, { tenant_id: "tenant_demo", created_at: new Date().toISOString(), deleted_at: null, ...table.get(id), ...this.value,
          ...(this.table === "affaire_intake_uploads" ? { project_id: this.value.project_id } : {}),
          ...(parent ? { project_id: parent.project_id, tenant_id: parent.tenant_id } : {}) });
        return { data: this.value, error: null };
      }
      let found = [...table.entries()].filter(([, row]) => this.filters.every(([column, value]) =>
        value === null ? row[column] == null : row[column] === value) && this.predicates.every((matches) => matches(row)));
      if (this.operation === "update") { found.forEach(([, row]) => Object.assign(row, this.value)); return { data: found.map(([, row]) => row), error: null }; }
      if (this.operation === "delete") { found.forEach(([id]) => table.delete(id)); return { data: found.map(([, row]) => row), error: null }; }
      const count = found.length;
      found = found.slice(this.start, this.end + 1);
      const selected = this.selection.split(",").map((column) => column.trim()).filter(Boolean);
      const data = found.map(([, row]) => Object.fromEntries(selected.map((column) => [column, row[column] ?? null])));
      return { data: this.one ? data[0] ?? null : data, error: null, count };
    }
    then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }
  // The two RPCs of the migration: save binds to the signed-in member, the secret read is service-only.
  const rpc = vi.fn(async (name: string, args: Record<string, string>) => {
    if (name === "save_google_drive_connection") {
      const connections = rows("google_drive_connections");
      const existing = [...connections.values()].find((row) => row.tenant_id === access.context.tenantId &&
        row.user_id === access.context.userId && row.google_account_id === args.p_google_account_id);
      const id = String(existing?.id ?? `00000000-0000-4000-8000-${String(connections.size + 1).padStart(12, "0")}`);
      connections.set(id, { id, tenant_id: access.context.tenantId, user_id: access.context.userId, google_account_id: args.p_google_account_id,
        email: args.p_email, display_name: args.p_display_name, status: "active", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      rows("google_drive_connection_secrets").set(id, { connection_id: id, refresh_token_ciphertext: args.p_refresh_token_ciphertext });
      return { data: id, error: null };
    }
    if (name === "google_drive_connection_secret") {
      const connection = rows("google_drive_connections").get(args.p_connection_id);
      const secret = rows("google_drive_connection_secrets").get(args.p_connection_id);
      const shared = [...rows("google_drive_connections").values()].some((row) => row.google_account_id === connection?.google_account_id && row.id !== connection?.id);
      return { data: connection && secret ? [{ tenant_id: connection.tenant_id, user_id: connection.user_id, google_account_id: connection.google_account_id,
        status: connection.status, updated_at: connection.updated_at, shared_grant: shared, refresh_token_ciphertext: secret.refresh_token_ciphertext }] : [], error: null };
    }
    return { data: null, error: { code: "PGRST202" } };
  });
  const supabase = { from: (table: string) => new Query(table), rpc };
  const access = { context: { tenantId: "tenant_demo", userId: "user_demo", tenantRole: "admin", supabase },
    project: { id: "project_demo", name: "Affaire fictive POC", tenant_id: "tenant_demo", user_id: "user_demo", is_archived: false } };
  return { tables, rows, failures, queries, access, supabase, rpc };
}

export function fakeDrive() {
  const files = new Map<string, DriveFile>([
    ["root", { id: "root_demo", name: "Mon Drive", mimeType: "application/vnd.google-apps.folder" }],
    ["folder_demo", { id: "folder_demo", name: "Dossier fictif POC", mimeType: "application/vnd.google-apps.folder", parents: ["root_demo"] }],
    ["plan_demo", { id: "plan_demo", name: "plan-fictif.txt", mimeType: "text/plain", size: "5", version: "1", parents: ["folder_demo"] }],
    ["cctp_demo", { id: "cctp_demo", name: "cctp-fictif.txt", mimeType: "text/plain", size: "5", version: "1", parents: ["folder_demo"] }],
  ]);
  const responses = new Map<string, number>();
  const sharedWithMe = new Set<string>();
  const tokens: Array<Record<string, string>> = [];
  const fetchMock = vi.fn(async (input: URL | RequestInfo, options?: RequestInit) => {
    const url = new URL(String(input));
    if (options?.signal?.aborted) throw new Error("aborted");
    if (url.origin === "https://oauth2.googleapis.com") {
      const body = Object.fromEntries(new URLSearchParams(String(options?.body)));
      tokens.push(body);
      if (url.pathname === "/revoke") return new Response(null, { status: responses.get("revoke") ?? 200 });
      const status = responses.get(body.grant_type);
      if (status) return Response.json({ error: "invalid_grant" }, { status });
      return Response.json({ access_token: `access-${tokens.length}`, expires_in: 3600, scope: "https://www.googleapis.com/auth/drive.readonly",
        ...(body.grant_type === "authorization_code" ? { refresh_token: "fictitious-refresh-token" } : {}) });
    }
    const id = url.pathname.split("/").pop()!;
    const status = responses.get(id);
    if (status) return Response.json({ error: { errors: [{ reason: "insufficientFilePermissions" }] } }, { status });
    if (url.pathname.endsWith("/about")) return Response.json({ user: { permissionId: "google_account_demo", displayName: "Compte fictif", emailAddress: "poc@example.invalid" } });
    if (url.pathname.endsWith("/drives")) return Response.json({ drives: [{ id: "shared_drive_demo", name: "Drive partagé fictif" }] });
    if (url.pathname.endsWith("/files")) {
      const query = url.searchParams.get("q") ?? "";
      const parent = /^'([^']+)' in parents/.exec(query)?.[1];
      return Response.json({ files: [...files.values()].filter((file) => parent ? file.parents?.includes(parent) : query.startsWith("sharedWithMe") && sharedWithMe.has(file.id)) });
    }
    const file = files.get(id);
    if (!file) return Response.json({}, { status: 404 });
    return url.searchParams.get("alt") === "media" ? new Response("plans") : Response.json(file);
  });
  return { files, responses, sharedWithMe, tokens, fetchMock };
}
