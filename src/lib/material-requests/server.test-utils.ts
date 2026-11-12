import { randomUUID } from "node:crypto";

/**
 * A small in-memory stand-in for the Supabase client the material request routes receive. It applies
 * the filters it is given and no RLS: a route that forgets to filter on the tenant or the affaire
 * therefore leaks in these tests, which is the point. Every write is recorded as it was sent.
 *
 * Of the database it reproduces only what the routes observe and pgTAP proves: defaults and scope on
 * insert, validation stamps, the unique keys of technicians, usual names and product references, the stored mark refused without bytes of the announced size, and the return to draft of the lines
 * that relied on a presumed material the request withdraws. The browser's own upload to a signed URL is
 * played by the test, which puts bytes in `objects`.
 */

export type FakeRow = Record<string, unknown>;
export type FakeTables = Record<string, FakeRow[]>;
export type FakeWrite = {
  table: string;
  operation: "insert" | "update" | "delete";
  values: unknown;
  /** Ids of the rows the statement reached. */
  ids: string[];
};
export type FakeStorageCall =
  | { operation: "sign"; bucket: string; path: string; upsert: boolean | undefined }
  | { operation: "info"; bucket: string; path: string }
  | { operation: "remove"; bucket: string; paths: string[] }
  | { operation: "download"; bucket: string; path: string };

type Filter = (row: FakeRow) => boolean;
type QueryError = { code: string; message: string; details: null; hint: null };
type QueryResult = { data: unknown; error: QueryError | null; count?: number | null };

/** What a database function answers from its arguments and the tables, as the database would (pgTAP proves it). */
export type FakeRpcHandler = (
  args: Record<string, unknown>,
  tables: FakeTables,
) => { data: unknown; error?: { code: string; message: string; details?: string | null } | null };

export type FakeSupabaseOptions = {
  userId: string | null;
  tables: FakeTables;
  /** A fixed answer by function name, or a FakeRpcHandler that reads its arguments. */
  rpc?: Record<string, unknown>;
  /** Stored objects, by path. */
  objects?: Record<string, Uint8Array>;
  /** Paths for which storage refuses to sign an upload. */
  failSign?: (path: string) => boolean;
  /** Updates the database refuses, as a CHECK or a trigger would (SQLSTATE 23514): the message it raises. */
  refuseUpdate?: (table: string, values: FakeRow) => string | false;
  /** Inserts the database refuses, as a trigger would (SQLSTATE 23514): the message it raises. */
  refuseInsert?: (table: string, values: unknown) => string | false;
  /**
   * The download stream delivers its bytes but its cancellation never settles, as the runtime's response
   * body does once it has been read to its end.
   */
  stallStreamCancel?: boolean;
  /** Called just before an update runs: what another session did in the meantime. */
  beforeUpdate?: (table: string, values: FakeRow, tables: FakeTables) => void;
};

function readPath(row: FakeRow, column: string): unknown {
  return column.split(".").reduce<unknown>((value, key) => (value as FakeRow | null | undefined)?.[key], row);
}

function project(row: FakeRow, columns: string | undefined): FakeRow {
  if (!columns || columns.trim() === "*" || columns.includes("(")) return { ...row };
  return Object.fromEntries(columns.split(",").map((column) => [column.trim(), row[column.trim()] ?? null]));
}

function comparable(value: unknown): string | number {
  return typeof value === "number" ? value : String(value ?? "");
}

const TECHNICIAN_NAME_KEY = (row: FakeRow) => `${row.tenant_id}|${String(row.name).replace(/\s+/g, "").toLowerCase()}`;
/** Unique keys the routes may hit; null: the row holds no key (a product without reference). */
const UNIQUE_KEYS: Record<string, (row: FakeRow) => string | null> = {
  material_request_technicians: TECHNICIAN_NAME_KEY,
  product_aliases: (row) => `${row.tenant_id}|${row.product_id}|${row.alias_key}`,
  products: (row) => (row.reference ? `${row.tenant_id}|${String(row.reference).trim().toLowerCase()}` : null),
};

export function createFakeSupabase(options: FakeSupabaseOptions) {
  const tables = options.tables;
  const objects = new Map(Object.entries(options.objects ?? {}));
  const writes: FakeWrite[] = [];
  const storageCalls: FakeStorageCall[] = [];
  const rpcCalls: string[] = [];
  /** Every database function call with the arguments it was given, in order. */
  const rpcArgs: Array<{ name: string; args: Record<string, unknown> }> = [];
  /** Every select, by table, in the order it ran: one entry per page read. */
  const reads: string[] = [];
  /** Writes and storage calls in the order they were made: "insert material_request_files", "upload", ... */
  const events: string[] = [];
  let signed = 0;
  // Rows are stamped from the real time: the server compares them with `Date.now()` (photos whose upload
  // was never completed are abandoned after three hours), so a fixed date turns stale as the day goes on.
  let clock = Date.now();
  const now = () => new Date((clock += 1000)).toISOString();

  function parentOf(table: string, id: unknown): FakeRow | undefined {
    return (tables[table] ?? []).find((row) => row.id === id);
  }

  /** What the database fills in: identifiers, dates, defaults, and the scope copied from the parent. */
  function completeInsert(table: string, values: FakeRow): FakeRow {
    const row: FakeRow = { id: randomUUID(), created_at: now(), ...values };
    if (table === "material_requests") {
      const parent = parentOf("estimate_projects", row.project_id);
      return {
        tenant_id: parent?.tenant_id ?? null, technician_id: null, requested_on: "2026-11-12", needed_on: null,
        delivery_place: null, is_urgent: false, presumed_material: null, material_confirmed: false,
        presumed_supplier_id: null, supplier_confirmed: false, source_text: null, note: null,
        updated_at: row.created_at, ...row,
      };
    }
    if (table === "material_request_lines") {
      const parent = parentOf("material_requests", row.request_id);
      return {
        tenant_id: parent?.tenant_id ?? null, project_id: parent?.project_id ?? null, original_text: null,
        quantity: null, quantity_doubtful: false, unit: null, dimension: null, no_dimension: false,
        product_type: null, material: null, material_precision: null, reference: null, supplier_id: null,
        zone: null, imputation: "project", overhead_category: null, duplicate_acknowledged: false,
        status: "draft", validated_at: null, validated_by: null, product_id: null, product_match: null,
        updated_at: row.created_at, ...row,
      };
    }
    if (table === "products") {
      // The column's default and the author trigger (TI-689): the caller's tenant, the caller as author.
      const membership = (tables.tenant_memberships ?? []).find((entry) => entry.user_id === options.userId);
      return {
        tenant_id: membership?.tenant_id ?? null, reference: null, category: null, product_type: null, material: null,
        grade: null, dimensions: null, standard: null, unit: "u", is_active: true, catalogue_status: "validated",
        supply_type_id: null, created_from_material_request: false, updated_at: row.created_at, ...row,
        created_by: options.userId,
      };
    }
    if (table === "product_aliases") {
      // The alias trigger: the article's tenant, the database's date, the caller as author.
      const product = parentOf("products", row.product_id);
      return { ...row, tenant_id: product?.tenant_id ?? null, created_by: options.userId };
    }
    if (table === "material_request_files") {
      const parent = parentOf("material_requests", row.request_id);
      // Like the database: a new original is not stored yet, whatever the client sends.
      return { tenant_id: parent?.tenant_id ?? null, project_id: parent?.project_id ?? null, rotation: 0, ...row, stored_at: null, removed_at: null };
    }
    if (table === "material_request_technicians") {
      // The column's default: the active tenant of the caller.
      const membership = (tables.tenant_memberships ?? []).find((entry) => entry.user_id === options.userId);
      return { tenant_id: membership?.tenant_id ?? null, current_project_id: null, is_active: true, updated_at: row.created_at, ...row };
    }
    return row;
  }

  function completeUpdate(table: string, row: FakeRow, values: FakeRow): FakeRow {
    const next: FakeRow = { ...row, ...values };
    if ("updated_at" in row) next.updated_at = now();
    if (table === "material_request_lines" && "status" in values) {
      next.validated_at = next.status === "validated" ? (row.validated_at ?? now()) : null;
      next.validated_by = next.status === "validated" ? (row.validated_by ?? options.userId) : null;
    }
    // The quote trigger dates the life of a quote (TI-691).
    if (table === "material_request_quotes" && next.status !== row.status) {
      if (next.status === "received") next.received_at = now();
      if (next.status === "closed") next.closed_at = now();
    }
    return next;
  }

  /** The request trigger: validated lines without a material of their own lose the one they relied on. */
  function reopenLinesOf(before: FakeRow, after: FakeRow) {
    const withdrawn =
      after.presumed_material !== before.presumed_material || (before.material_confirmed === true && after.material_confirmed !== true);
    if (!withdrawn) return;
    tables.material_request_lines = (tables.material_request_lines ?? []).map((line) =>
      line.request_id === after.id && line.status === "validated" && line.imputation === "project" && !String(line.material ?? "").trim()
        ? { ...line, status: "draft", validated_at: null, validated_by: null }
        : line,
    );
  }

  function uniqueViolation(table: string, candidate: FakeRow): QueryError | null {
    const key = UNIQUE_KEYS[table];
    if (!key || key(candidate) === null) return null;
    const taken = (tables[table] ?? []).some(
      (row) => row.id !== candidate.id && key(row) === key(candidate),
    );
    return taken
      ? { code: "23505", message: "duplicate key value violates unique constraint", details: null, hint: null }
      : null;
  }

  function from(table: string) {
    const filters: Filter[] = [];
    const orders: Array<{ column: string; ascending: boolean }> = [];
    let operation: "select" | "insert" | "update" | "delete" = "select";
    let payload: unknown;
    let columns: string | undefined;
    let wantsCount = false;
    let limitTo: number | null = null;
    let window: [number, number] | null = null;
    let returning = false;

    function execute(): QueryResult {
      tables[table] ??= [];
      if (operation === "insert") {
        const refusal = options.refuseInsert?.(table, payload);
        if (refusal) {
          events.push(`refused insert ${table}`);
          return { data: null, error: { code: "23514", message: refusal, details: null, hint: null } };
        }
        const inserted = (Array.isArray(payload) ? payload : [payload]).map((values) =>
          completeInsert(table, values as FakeRow),
        );
        for (const row of inserted) {
          const violation = uniqueViolation(table, row);
          if (violation) return { data: null, error: violation };
        }
        tables[table].push(...inserted);
        events.push(`insert ${table}`);
        writes.push({ table, operation, values: payload, ids: inserted.map((row) => String(row.id)) });
        return { data: inserted.map((row) => project(row, columns)), error: null };
      }
      if (operation === "update") options.beforeUpdate?.(table, payload as FakeRow, tables);
      const matching = tables[table].filter((row) => filters.every((filter) => filter(row)));
      if (operation === "update") {
        const refusal = options.refuseUpdate?.(table, payload as FakeRow);
        if (refusal) return { data: null, error: { code: "23514", message: refusal, details: null, hint: null } };
        // The file trigger: no stored mark for a withdrawn row, nor for a path that does not hold bytes
        // of the announced size.
        if (table === "material_request_files" && (payload as FakeRow).stored_at != null) {
          const refused = matching.filter((row) => row.stored_at == null).map((row) => {
            const bytes = objects.get(String(row.storage_path));
            if (row.removed_at != null || !bytes) return "MATERIAL_REQUEST_FILE_NOT_STORED";
            return bytes.byteLength === row.byte_size ? null : "MATERIAL_REQUEST_FILE_SIZE_MISMATCH";
          }).find((message) => message !== null);
          if (refused) return { data: null, error: { code: "23514", message: refused, details: null, hint: null } };
        }
        const updated = matching.map((row) => completeUpdate(table, row, payload as FakeRow));
        for (const row of updated) {
          const violation = uniqueViolation(table, row);
          if (violation) return { data: null, error: violation };
        }
        for (const row of updated) tables[table][tables[table].findIndex((existing) => existing.id === row.id)] = row;
        if (table === "material_requests") matching.forEach((before, index) => reopenLinesOf(before, updated[index]));
        events.push(`update ${table}`);
        writes.push({ table, operation, values: payload, ids: updated.map((row) => String(row.id)) });
        return { data: returning ? updated.map((row) => project(row, columns)) : null, error: null };
      }
      if (operation === "delete") {
        tables[table] = tables[table].filter((row) => !matching.includes(row));
        const cascade: Array<[string, string]> =
          table === "material_requests" ? [["material_request_lines", "request_id"], ["material_request_files", "request_id"]] : [];
        for (const [child, key] of cascade) {
          tables[child] = (tables[child] ?? []).filter((row) => !matching.some((parent) => parent.id === row[key]));
        }
        events.push(`delete ${table}`);
        writes.push({ table, operation, values: null, ids: matching.map((row) => String(row.id)) });
        return { data: returning ? matching.map((row) => project(row, columns)) : null, error: null };
      }
      reads.push(table);
      const sorted = [...matching].sort((left, right) => {
        for (const { column, ascending } of orders) {
          const a = comparable(left[column]);
          const b = comparable(right[column]);
          if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
      const ranged = window ? sorted.slice(window[0], window[1] + 1) : sorted;
      const limited = limitTo === null ? ranged : ranged.slice(0, limitTo);
      return {
        data: limited.map((row) => project(row, columns)),
        error: null,
        ...(wantsCount ? { count: matching.length } : {}),
      };
    }

    function one(required: boolean): QueryResult {
      const result = execute();
      if (result.error) return result;
      const rows = (result.data as FakeRow[] | null) ?? [];
      if (rows.length === 1) return { data: rows[0], error: null };
      if (rows.length === 0 && !required) return { data: null, error: null };
      return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: null, hint: null } };
    }

    const builder = {
      select(selected?: string, selectOptions?: { count?: "exact" }) {
        columns = selected;
        returning = true;
        if (selectOptions?.count === "exact") wantsCount = true;
        return builder;
      },
      insert(values: unknown) {
        operation = "insert";
        payload = values;
        return builder;
      },
      update(values: unknown) {
        operation = "update";
        payload = values;
        returning = false;
        return builder;
      },
      delete() {
        operation = "delete";
        returning = false;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => readPath(row, column) === value);
        return builder;
      },
      neq(column: string, value: unknown) {
        filters.push((row) => readPath(row, column) !== value);
        return builder;
      },
      in(column: string, values: readonly unknown[]) {
        filters.push((row) => values.includes(readPath(row, column)));
        return builder;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (readPath(row, column) ?? null) === value);
        return builder;
      },
      not(column: string, operator: "is", value: null) {
        if (operator !== "is" || value !== null) throw new Error("The fake only knows not(column, \"is\", null).");
        filters.push((row) => (readPath(row, column) ?? null) !== null);
        return builder;
      },
      /** Text searches are not run: every row matches. Tests shape their rows so that they all would. */
      or() {
        return builder;
      },
      ilike() {
        return builder;
      },
      order(column: string, orderOptions?: { ascending?: boolean }) {
        orders.push({ column, ascending: orderOptions?.ascending ?? true });
        return builder;
      },
      limit(count: number) {
        limitTo = count;
        return builder;
      },
      range(start: number, end: number) {
        window = [start, end];
        return builder;
      },
      maybeSingle: async () => one(false),
      single: async () => one(true),
      then<Resolved, Rejected>(
        resolve: (value: QueryResult) => Resolved,
        reject?: (reason: unknown) => Rejected,
      ) {
        return Promise.resolve().then(execute).then(resolve, reject);
      },
    };
    return builder;
  }

  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: options.userId ? { id: options.userId } : null }, error: null }),
    },
    from,
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push(name);
      rpcArgs.push({ name, args });
      const answer = options.rpc?.[name];
      if (typeof answer === "function") {
        const { data, error } = (answer as FakeRpcHandler)(args, tables);
        if (!error) events.push(`rpc ${name}`);
        // A refusal keeps the DETAIL the function raised with (positions of lines, a status...).
        return { data: error ? null : data, error: error ? { details: null, hint: null, ...error } : null };
      }
      return { data: answer ?? null, error: null };
    },
    storage: {
      from(bucket: string) {
        return {
          createSignedUploadUrl: async (path: string, signOptions?: { upsert: boolean }) => {
            events.push("sign");
            storageCalls.push({ operation: "sign", bucket, path, upsert: signOptions?.upsert });
            if (options.failSign?.(path)) return { data: null, error: { message: "new row violates row-level security policy" } };
            signed += 1;
            return { data: { signedUrl: `https://storage.test/upload/sign/${bucket}/${path}?token=token-${signed}`, token: `token-${signed}`, path }, error: null };
          },
          info: async (path: string) => {
            events.push("info");
            storageCalls.push({ operation: "info", bucket, path });
            const bytes = objects.get(path);
            return bytes
              ? { data: { name: path, size: bytes.byteLength }, error: null }
              : { data: null, error: { message: "Object not found", name: "StorageApiError", code: "NoSuchKey" } };
          },
          download: (path: string) => {
            const read = () => {
              events.push("download");
              storageCalls.push({ operation: "download", bucket, path });
              return objects.get(path);
            };
            const missing = { data: null, error: { message: "Object not found", name: "StorageApiError", code: "NoSuchKey" } };
            return {
              asStream: async () => {
                const bytes = read();
                if (!bytes) return missing;
                if (!options.stallStreamCancel) return { data: new Blob([bytes as BlobPart]).stream(), error: null };
                // A real ReadableStream cannot stall its cancellation once it has ended, the runtime's
                // response body can: the bytes come in one read, the next read ends, cancel never settles.
                let delivered = false;
                const stalled = {
                  getReader: () => ({
                    read: async () => {
                      if (delivered) return { done: true as const, value: undefined };
                      delivered = true;
                      return { done: false as const, value: bytes };
                    },
                    cancel: () => new Promise<void>(() => undefined),
                  }),
                } as unknown as ReadableStream<Uint8Array>;
                return { data: stalled, error: null };
              },
              then<Resolved>(resolve: (value: { data: Blob | null; error: unknown }) => Resolved) {
                const bytes = read();
                return Promise.resolve(bytes ? { data: new Blob([bytes as BlobPart]), error: null } : missing).then(resolve);
              },
            };
          },
          remove: async (paths: string[]) => {
            events.push("remove");
            storageCalls.push({ operation: "remove", bucket, paths });
            for (const path of paths) objects.delete(path);
            return { data: paths.map((name) => ({ name })), error: null };
          },
        };
      },
    },
  };

  return { supabase, tables, writes, storageCalls, rpcCalls, rpcArgs, events, objects, reads };
}

/** The membership row `getAuthenticatedTenantContext` reads for the signed-in member. */
export function fakeMembership(userId: string, tenantId: string, role: "admin" | "engineer" | "viewer" | "director") {
  return {
    id: `membership-${userId}`,
    tenant_id: tenantId,
    user_id: userId,
    role,
    is_default: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    tenants: { is_active: true, name: "Entreprise fictive" },
  };
}
