import { vi } from "vitest";

// Lot M3 (métré) : faux client Supabase partagé par les tests metre-m3-*.test.ts.
// Il enregistre chaque requête, chaque appel Storage et chaque RPC, pour prouver
// ce qu'un parcours n'a PAS touché (aucun téléversement, aucune tâche, aucun appel).
// Une table, un bucket ou une RPC sans gestionnaire lève immédiatement.

export const M3_USER_ID = "11111111-1111-4111-8111-111111111111";
export const M3_TENANT_ID = "22222222-2222-4222-8222-222222222222";
export const M3_VERSION_ID = "33333333-3333-4333-8333-333333333333";
export const M3_JOB_ID = "44444444-4444-4444-8444-444444444444";
export const M3_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
export const M3_PLAN_SET_ID = "66666666-6666-4666-8666-666666666666";
export const M3_ITEM_ID = "77777777-7777-4777-8777-777777777777";

export type FakeQueryResult = {
  data: unknown;
  error: unknown;
  count?: number | null;
};

export type FakeQuery = {
  table: string;
  operation: "select" | "insert" | "update" | "delete" | "upsert";
  payload: unknown;
  columns: string | null;
  filters: Array<{ kind: "eq" | "in"; column: string; value: unknown }>;
  cardinality: "single" | "maybeSingle" | "many";
};

export type FakeTableHandler = (
  query: FakeQuery
) => FakeQueryResult | Promise<FakeQueryResult>;

export type FakeStorageCall = {
  bucket: string;
  method: "upload" | "download" | "remove" | "info" | "createSignedUploadUrl" | "createSignedUrl";
  paths: string[];
};

export type FakeStorageHandler = (
  call: FakeStorageCall & { body?: unknown }
) => FakeQueryResult | Promise<FakeQueryResult>;

type QueryBuilder = {
  select: (columns?: string, options?: unknown) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  in: (column: string, value: unknown) => QueryBuilder;
  neq: (...args: unknown[]) => QueryBuilder;
  is: (...args: unknown[]) => QueryBuilder;
  not: (...args: unknown[]) => QueryBuilder;
  order: (...args: unknown[]) => QueryBuilder;
  limit: (...args: unknown[]) => QueryBuilder;
  range: (...args: unknown[]) => QueryBuilder;
  abortSignal: (...args: unknown[]) => QueryBuilder;
  single: () => Promise<FakeQueryResult>;
  maybeSingle: () => Promise<FakeQueryResult>;
  then: PromiseLike<FakeQueryResult>["then"];
};

export function filterValue(query: FakeQuery, column: string): unknown {
  return query.filters.find((filter) => filter.column === column)?.value;
}

export function createSupabaseFake(input: {
  tables?: Record<string, FakeTableHandler>;
  storage?: Record<string, FakeStorageHandler>;
  rpc?: Record<string, (args: unknown) => FakeQueryResult | Promise<FakeQueryResult>>;
}) {
  const queries: FakeQuery[] = [];
  const tablesTouched: string[] = [];
  const storageCalls: FakeStorageCall[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];

  function createQuery(table: string, handler: FakeTableHandler) {
    const state: Omit<FakeQuery, "cardinality"> = {
      table,
      operation: "select",
      payload: undefined,
      columns: null,
      filters: [],
    };

    const run = async (cardinality: FakeQuery["cardinality"]) => {
      const query: FakeQuery = { ...state, filters: [...state.filters], cardinality };
      queries.push(query);
      return await handler(query);
    };

    const builder: QueryBuilder = {
      select: (columns?: string) => {
        state.columns = typeof columns === "string" ? columns : null;
        return builder;
      },
      eq: (column, value) => {
        state.filters.push({ kind: "eq", column, value });
        return builder;
      },
      in: (column, value) => {
        state.filters.push({ kind: "in", column, value });
        return builder;
      },
      neq: () => builder,
      is: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      abortSignal: () => builder,
      single: () => run("single"),
      maybeSingle: () => run("maybeSingle"),
      then: <TResult1 = FakeQueryResult, TResult2 = never>(
        onFulfilled?: ((value: FakeQueryResult) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ) => run("many").then(onFulfilled, onRejected),
    };

    const start = (operation: FakeQuery["operation"], payload?: unknown) => {
      state.operation = operation;
      state.payload = payload;
      return builder;
    };

    return {
      select: (columns?: string) => {
        start("select");
        return builder.select(columns);
      },
      insert: (payload: unknown) => start("insert", payload),
      update: (payload: unknown) => start("update", payload),
      upsert: (payload: unknown) => start("upsert", payload),
      delete: () => start("delete"),
    };
  }

  const from = vi.fn((table: string) => {
    tablesTouched.push(table);
    const handler = input.tables?.[table];
    if (!handler) {
      throw new Error(`Unexpected table: ${table}`);
    }
    return createQuery(table, handler);
  });

  const storageFrom = vi.fn((bucket: string) => {
    const handler = input.storage?.[bucket];
    if (!handler) {
      throw new Error(`Unexpected storage bucket: ${bucket}`);
    }
    const call = async (
      method: FakeStorageCall["method"],
      paths: string[],
      body?: unknown
    ) => {
      const recorded: FakeStorageCall = { bucket, method, paths };
      storageCalls.push(recorded);
      return await handler({ ...recorded, body });
    };
    return {
      upload: (path: string, body: unknown) => call("upload", [path], body),
      download: (path: string) => call("download", [path]),
      remove: (paths: string[]) => call("remove", paths),
      info: (path: string) => call("info", [path]),
      createSignedUploadUrl: (path: string) => call("createSignedUploadUrl", [path]),
      createSignedUrl: (path: string) => call("createSignedUrl", [path]),
    };
  });

  const rpc = vi.fn(async (fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    const handler = input.rpc?.[fn];
    if (!handler) {
      throw new Error(`Unexpected rpc function: ${fn}`);
    }
    return await handler(args);
  });

  return {
    client: { from, storage: { from: storageFrom }, rpc },
    queries,
    tablesTouched,
    storageCalls,
    rpcCalls,
    writesTo(table: string) {
      return queries.filter((query) => query.table === table && query.operation !== "select");
    },
  };
}

export type SupabaseFake = ReturnType<typeof createSupabaseFake>;

/** Ligne `estimate_versions` lue par les gardes métré (accès, brouillon, moteur). */
export function estimateVersionRow(input: {
  calcEngineVersion?: number | null;
  status?: "draft" | "sent" | "accepted" | "archived";
  omitEngineColumn?: boolean;
}) {
  return {
    id: M3_VERSION_ID,
    status: input.status ?? "draft",
    ...(input.omitEngineColumn ? {} : { calc_engine_version: input.calcEngineVersion ?? 3 }),
    updated_at: "2026-10-24T00:00:00.000Z",
    estimate_projects: { tenant_id: M3_TENANT_ID, user_id: M3_USER_ID },
  };
}

/** Ligne `takeoff_jobs` complète, valide pour les schémas de lecture (résumé et détail). */
export function takeoffJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: M3_JOB_ID,
    tenant_id: M3_TENANT_ID,
    estimate_version_id: M3_VERSION_ID,
    plan_set_id: null,
    status: "failed",
    level: "B",
    processing_strategy: "sync",
    provider_batch_id: null,
    provider_batch_state: null,
    provider_batch_updated_at: null,
    source_file_name: "Plan R+1.pdf",
    source_file_type: "application/pdf",
    source_file_size_bytes: 2048,
    source_file_path: `${M3_TENANT_ID}/${M3_JOB_ID}/${"a".repeat(64)}-source.pdf`,
    prompt_version: "takeoff-b-v1",
    schema_version: "v1",
    model: "gemini-3-flash-preview",
    thinking_level: null,
    media_resolution: null,
    retry_count: 0,
    next_retry_at: null,
    last_error_at: null,
    token_count: 1200,
    cost_cents: 7,
    duration_ms: 4000,
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:01:00.000Z",
    error_code: "TAKEOFF_TIMEOUT",
    error_message: "Délai dépassé.",
    created_by: M3_USER_ID,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

/** Ligne `takeoff_items` valide pour `normalizeTakeoffItemRow`. */
export function takeoffItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: M3_ITEM_ID,
    designation: "Tube cuivre 22",
    quantity: 12.5,
    unit: "ml",
    confidence: 0.92,
    evidence: "Cote 12,50 m sur le plan",
    source_file_name: "Plan-R-1.pdf",
    source_page: 1,
    metadata: { original_unit: "m.l", normalized_unit: "ml", source_file: "Plan-R-1.pdf" },
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-01-01T00:02:00.000Z",
    updated_at: "2026-01-01T00:02:00.000Z",
    ...overrides,
  };
}

/** Document PDF « plans » du dossier d'affaire, éligible à la synchronisation intake. */
export function intakeDocument(input: { id: string; fileName: string }) {
  return {
    id: input.id,
    upload_id: "upload-m3",
    created_by: M3_USER_ID,
    storage_path: `${M3_TENANT_ID}/${M3_PROJECT_ID}/upload-m3/${input.id}/source.pdf`,
    file_name: input.fileName,
    mime_type: "application/pdf",
    size_bytes: 2048,
    upload_status: "uploaded",
    classification_status: "classified",
    document_kind: "plans",
  };
}

/**
 * Faux Supabase avec état pour `syncTakeoffPlanSetFromAffaireIntake` : le jeu créé et les
 * fichiers insérés sont relus au passage suivant, ce qui permet de rejouer une synchronisation.
 */
export function createIntakeFake(input: { failingDownloads?: Set<string> } = {}) {
  const planSets: Array<Record<string, unknown>> = [];
  const planFiles: Array<Record<string, unknown>> = [];
  const planObjects = new Map<string, Blob>();
  const fake = createSupabaseFake({
    tables: {
      plan_sets: (query) => {
        if (query.operation === "insert") {
          const row = { id: M3_PLAN_SET_ID, ...(query.payload as Record<string, unknown>) };
          planSets.push(row);
          return { data: row, error: null };
        }
        return { data: [...planSets], error: null, count: planSets.length };
      },
      plan_files: (query) => {
        if (query.operation === "insert") {
          planFiles.push(query.payload as Record<string, unknown>);
          return { data: null, error: null };
        }
        const setId = filterValue(query, "plan_set_id");
        const rows = planFiles.filter((row) => row.plan_set_id === setId);
        return { data: rows, error: null, count: rows.length };
      },
    },
    storage: {
      "affaire-intake": (call) =>
        input.failingDownloads?.has(call.paths[0] ?? "")
          ? { data: null, error: new Error("téléchargement simulé en échec") }
          : { data: new Blob(["%PDF-simule", new Uint8Array(2048 - "%PDF-simule".length)]), error: null },
      "plan-files": (call) => {
        const path = call.paths[0] ?? "";
        if (call.method === "upload" && call.body instanceof Blob) {
          planObjects.set(path, call.body);
          return { data: null, error: null };
        }
        const object = planObjects.get(path);
        if (!object) return { data: null, error: { status: 404 } };
        return { data: call.method === "info" ? { size: object.size } : object, error: null };
      },
    },
  });
  return { fake, planSets, planFiles, planObjects };
}

export function authenticatedContext(fake: SupabaseFake, tenantRole = "admin") {
  return {
    supabase: fake.client,
    userId: M3_USER_ID,
    tenantId: M3_TENANT_ID,
    tenantRole,
    isTenantAdmin: tenantRole === "admin",
    membership: {
      id: "88888888-8888-4888-8888-888888888888",
      tenant_id: M3_TENANT_ID,
      user_id: M3_USER_ID,
      role: tenantRole,
      is_default: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  };
}
