import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database";

const RLS_E2E_ENABLED = process.env.RLS_E2E === "1";

type RoleKey = "admin" | "engineer" | "viewer";
type CrudOperation = "select" | "insert" | "update" | "delete";
type MatrixTable =
  | "estimate_versions"
  | "estimate_items"
  | "estimate_categories"
  | "labor_roles"
  | "estimate_suggestion_rules"
  | "audit_logs";
type OptionalMatrixTable = "portal_tokens";
type KnownCleanupTable = MatrixTable | "estimate_projects" | "tenant_memberships" | "tenants";
type LooseDatabase = {
  public: {
    Tables: Record<
      string,
      {
        Row: Record<string, unknown>;
        Insert: Record<string, unknown>;
        Update: Record<string, unknown>;
        Relationships: [];
      }
    >;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

interface AuthenticatedUser {
  email: string;
  userId: string;
  client: SupabaseClient<Database>;
}

interface SeedContext {
  tenantId: string;
  isolatedTenantId: string;
  ownerUserId: string;
  projectId: string;
  versionId: string;
  categoryId: string;
  laborRoleId: string;
  isolatedProjectId: string;
  isolatedVersionId: string;
  isolatedCategoryId: string;
}

interface OperationResult {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
}

const ROLES: RoleKey[] = ["admin", "engineer", "viewer"];
const OPERATIONS: CrudOperation[] = ["select", "insert", "update", "delete"];
const REQUIRED_MATRIX_TABLES: MatrixTable[] = [
  "estimate_versions",
  "estimate_items",
  "estimate_categories",
  "labor_roles",
  "estimate_suggestion_rules",
  "audit_logs",
];
const OPTIONAL_MATRIX_TABLES: OptionalMatrixTable[] = ["portal_tokens"];

const EXPECTED_MATRIX: Record<
  MatrixTable,
  Record<RoleKey, Record<CrudOperation, boolean>>
> = {
  estimate_versions: {
    admin: { select: true, insert: true, update: true, delete: true },
    engineer: { select: true, insert: true, update: true, delete: true },
    viewer: { select: false, insert: false, update: false, delete: false },
  },
  estimate_items: {
    admin: { select: true, insert: true, update: true, delete: true },
    engineer: { select: true, insert: true, update: true, delete: true },
    viewer: { select: false, insert: false, update: false, delete: false },
  },
  estimate_categories: {
    admin: { select: true, insert: true, update: true, delete: true },
    engineer: { select: true, insert: true, update: true, delete: true },
    viewer: { select: false, insert: false, update: false, delete: false },
  },
  labor_roles: {
    admin: { select: true, insert: true, update: true, delete: true },
    engineer: { select: true, insert: true, update: true, delete: true },
    viewer: { select: false, insert: false, update: false, delete: false },
  },
  estimate_suggestion_rules: {
    admin: { select: true, insert: true, update: true, delete: true },
    engineer: { select: true, insert: true, update: true, delete: true },
    viewer: { select: false, insert: false, update: false, delete: false },
  },
  audit_logs: {
    admin: { select: true, insert: true, update: false, delete: false },
    engineer: { select: false, insert: true, update: false, delete: false },
    viewer: { select: false, insert: false, update: false, delete: false },
  },
};

const createdRows: Partial<Record<KnownCleanupTable, Set<string>>> = {};

let runTag = "";
let sequence = 0;
let serviceClient: SupabaseClient<Database>;
let serviceAdmin: SupabaseClient<LooseDatabase>;
let users: Record<RoleKey, AuthenticatedUser>;
let seedContext: SeedContext;

function envValueOrThrow(name: string, fallbackNames: string[] = []) {
  const names = [name, ...fallbackNames];

  for (const key of names) {
    const value = process.env[key]?.trim();
    if (value) {
      return value;
    }
  }

  const fallbackSuffix =
    fallbackNames.length > 0 ? ` (fallbacks: ${fallbackNames.join(", ")})` : "";
  throw new Error(`Missing required environment variable: ${name}${fallbackSuffix}`);
}

function nextSuffix(prefix: string) {
  sequence += 1;
  return `${prefix}-${runTag}-${sequence}`;
}

function nextVersionNumber() {
  sequence += 1;
  return 700_000 + sequence;
}

function nextPosition() {
  sequence += 1;
  return 20_000 + sequence;
}

function asAnyClient(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<LooseDatabase>;
}

function trackRow(table: KnownCleanupTable, id: string) {
  if (!createdRows[table]) {
    createdRows[table] = new Set<string>();
  }
  createdRows[table]?.add(id);
}

async function assertNoError(
  action: string,
  error: { message?: string; code?: string } | null
) {
  if (error) {
    throw new Error(`${action} failed [${error.code ?? "no-code"}]: ${error.message ?? "unknown"}`);
  }
}

async function signInUser(params: {
  url: string;
  anonKey: string;
  email: string;
  password: string;
}) {
  const client = createClient<Database>(params.url, params.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  });
  await assertNoError(`signIn ${params.email}`, error);

  if (!data.user?.id) {
    throw new Error(`Could not resolve authenticated user id for ${params.email}`);
  }

  return {
    email: params.email,
    userId: data.user.id,
    client,
  } satisfies AuthenticatedUser;
}

async function probeTableExists(table: string) {
  const { error } = await serviceAdmin.from(table).select("id").limit(1);
  if (!error) {
    return true;
  }

  if (error.code === "42P01") {
    return false;
  }

  throw new Error(
    `Could not probe table ${table} [${error.code ?? "no-code"}]: ${error.message ?? "unknown"}`
  );
}

async function createTenantAndMemberships() {
  const tenantId = randomUUID();
  const isolatedTenantId = randomUUID();

  const tenants = [
    {
      id: tenantId,
      name: `RLS E2E ${runTag} primary`,
      slug: `rls-e2e-${runTag}-a`,
    },
    {
      id: isolatedTenantId,
      name: `RLS E2E ${runTag} isolated`,
      slug: `rls-e2e-${runTag}-b`,
    },
  ];

  const { data: tenantRows, error: tenantError } = await serviceClient
    .from("tenants")
    .insert(tenants)
    .select("id");
  await assertNoError("insert tenants", tenantError);
  for (const row of tenantRows ?? []) {
    trackRow("tenants", row.id);
  }

  const memberships = [
    { tenant_id: tenantId, user_id: users.admin.userId, role: "admin" as const },
    { tenant_id: tenantId, user_id: users.engineer.userId, role: "engineer" as const },
    { tenant_id: tenantId, user_id: users.viewer.userId, role: "viewer" as const },
  ];

  const { data: membershipRows, error: membershipError } = await serviceClient
    .from("tenant_memberships")
    .insert(memberships)
    .select("id");
  await assertNoError("insert tenant memberships", membershipError);
  for (const row of membershipRows ?? []) {
    trackRow("tenant_memberships", row.id);
  }

  return { tenantId, isolatedTenantId };
}

async function seedBaseContext(tenantId: string, isolatedTenantId: string) {
  const ownerUserId = users.engineer.userId;

  const projectId = randomUUID();
  const { error: projectError } = await serviceClient.from("estimate_projects").insert({
    id: projectId,
    tenant_id: tenantId,
    user_id: ownerUserId,
    name: nextSuffix("project"),
  });
  await assertNoError("insert base estimate project", projectError);
  trackRow("estimate_projects", projectId);

  const versionId = randomUUID();
  const { error: versionError } = await serviceClient.from("estimate_versions").insert({
    id: versionId,
    tenant_id: tenantId,
    project_id: projectId,
    version_number: nextVersionNumber(),
    status: "draft",
    title: nextSuffix("version"),
  });
  await assertNoError("insert base estimate version", versionError);
  trackRow("estimate_versions", versionId);

  const categoryId = randomUUID();
  const { error: categoryError } = await serviceClient.from("estimate_categories").insert({
    id: categoryId,
    tenant_id: tenantId,
    user_id: ownerUserId,
    name: nextSuffix("category"),
  });
  await assertNoError("insert base estimate category", categoryError);
  trackRow("estimate_categories", categoryId);

  const laborRoleId = randomUUID();
  const { error: laborRoleError } = await serviceClient.from("labor_roles").insert({
    id: laborRoleId,
    tenant_id: tenantId,
    user_id: ownerUserId,
    name: nextSuffix("labor-role"),
  });
  await assertNoError("insert base labor role", laborRoleError);
  trackRow("labor_roles", laborRoleId);

  const suggestionRuleId = randomUUID();
  const { error: suggestionError } = await serviceClient
    .from("estimate_suggestion_rules")
    .insert({
      id: suggestionRuleId,
      tenant_id: tenantId,
      user_id: ownerUserId,
      name: nextSuffix("rule"),
      match_value: nextSuffix("match"),
      category_id: categoryId,
      labor_role_id: laborRoleId,
    });
  await assertNoError("insert base suggestion rule", suggestionError);
  trackRow("estimate_suggestion_rules", suggestionRuleId);

  const isolatedProjectId = randomUUID();
  const { error: isolatedProjectError } = await serviceClient.from("estimate_projects").insert({
    id: isolatedProjectId,
    tenant_id: isolatedTenantId,
    user_id: ownerUserId,
    name: nextSuffix("isolated-project"),
  });
  await assertNoError("insert isolated project", isolatedProjectError);
  trackRow("estimate_projects", isolatedProjectId);

  const isolatedVersionId = randomUUID();
  const { error: isolatedVersionError } = await serviceClient.from("estimate_versions").insert({
    id: isolatedVersionId,
    tenant_id: isolatedTenantId,
    project_id: isolatedProjectId,
    version_number: nextVersionNumber(),
    status: "draft",
    title: nextSuffix("isolated-version"),
  });
  await assertNoError("insert isolated version", isolatedVersionError);
  trackRow("estimate_versions", isolatedVersionId);

  const isolatedCategoryId = randomUUID();
  const { error: isolatedCategoryError } = await serviceClient
    .from("estimate_categories")
    .insert({
      id: isolatedCategoryId,
      tenant_id: isolatedTenantId,
      user_id: ownerUserId,
      name: nextSuffix("isolated-category"),
    });
  await assertNoError("insert isolated category", isolatedCategoryError);
  trackRow("estimate_categories", isolatedCategoryId);

  return {
    tenantId,
    isolatedTenantId,
    ownerUserId,
    projectId,
    versionId,
    categoryId,
    laborRoleId,
    isolatedProjectId,
    isolatedVersionId,
    isolatedCategoryId,
  } satisfies SeedContext;
}

async function createOwnedRowForOperation(table: MatrixTable) {
  const id = randomUUID();

  switch (table) {
    case "estimate_versions": {
      const { error } = await serviceClient.from("estimate_versions").insert({
        id,
        tenant_id: seedContext.tenantId,
        project_id: seedContext.projectId,
        version_number: nextVersionNumber(),
        status: "draft",
        title: nextSuffix("op-version"),
      });
      await assertNoError("seed estimate_versions row", error);
      trackRow("estimate_versions", id);
      return id;
    }

    case "estimate_items": {
      const { error } = await serviceClient.from("estimate_items").insert({
        id,
        tenant_id: seedContext.tenantId,
        version_id: seedContext.versionId,
        item_type: "line",
        position: nextPosition(),
        title: nextSuffix("op-item"),
        quantity: 1,
        unit_price_ht_cents: 1000,
        tax_rate_bp: 2000,
      });
      await assertNoError("seed estimate_items row", error);
      trackRow("estimate_items", id);
      return id;
    }

    case "estimate_categories": {
      const { error } = await serviceClient.from("estimate_categories").insert({
        id,
        tenant_id: seedContext.tenantId,
        user_id: seedContext.ownerUserId,
        name: nextSuffix("op-category"),
      });
      await assertNoError("seed estimate_categories row", error);
      trackRow("estimate_categories", id);
      return id;
    }

    case "labor_roles": {
      const { error } = await serviceClient.from("labor_roles").insert({
        id,
        tenant_id: seedContext.tenantId,
        user_id: seedContext.ownerUserId,
        name: nextSuffix("op-labor-role"),
      });
      await assertNoError("seed labor_roles row", error);
      trackRow("labor_roles", id);
      return id;
    }

    case "estimate_suggestion_rules": {
      const { error } = await serviceClient.from("estimate_suggestion_rules").insert({
        id,
        tenant_id: seedContext.tenantId,
        user_id: seedContext.ownerUserId,
        name: nextSuffix("op-rule"),
        match_value: nextSuffix("op-match"),
        category_id: seedContext.categoryId,
        labor_role_id: seedContext.laborRoleId,
      });
      await assertNoError("seed estimate_suggestion_rules row", error);
      trackRow("estimate_suggestion_rules", id);
      return id;
    }

    case "audit_logs": {
      const { error } = await serviceClient.from("audit_logs").insert({
        id,
        tenant_id: seedContext.tenantId,
        user_id: seedContext.ownerUserId,
        table_name: "estimate_versions",
        record_id: seedContext.versionId,
        estimate_version_id: seedContext.versionId,
        action: "INSERT",
      });
      await assertNoError("seed audit_logs row", error);
      trackRow("audit_logs", id);
      return id;
    }
  }
}

function buildInsertPayload(table: MatrixTable, actorUserId: string) {
  switch (table) {
    case "estimate_versions":
      return {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        project_id: seedContext.projectId,
        version_number: nextVersionNumber(),
        status: "draft" as const,
        title: nextSuffix("insert-version"),
      };

    case "estimate_items":
      return {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        version_id: seedContext.versionId,
        item_type: "line" as const,
        position: nextPosition(),
        title: nextSuffix("insert-item"),
        quantity: 1,
        unit_price_ht_cents: 1500,
        tax_rate_bp: 2000,
      };

    case "estimate_categories":
      return {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        user_id: seedContext.ownerUserId,
        name: nextSuffix("insert-category"),
      };

    case "labor_roles":
      return {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        user_id: seedContext.ownerUserId,
        name: nextSuffix("insert-labor-role"),
      };

    case "estimate_suggestion_rules":
      return {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        user_id: seedContext.ownerUserId,
        name: nextSuffix("insert-rule"),
        match_value: nextSuffix("insert-match"),
        category_id: seedContext.categoryId,
        labor_role_id: seedContext.laborRoleId,
      };

    case "audit_logs":
      return {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        user_id: actorUserId,
        table_name: "estimate_versions",
        record_id: seedContext.versionId,
        estimate_version_id: seedContext.versionId,
        action: "invariant_violation",
        after_data: { source: "rls-e2e" },
      };
  }
}

function buildUpdatePayload(table: MatrixTable) {
  switch (table) {
    case "estimate_versions":
      return { title: nextSuffix("update-version") };
    case "estimate_items":
      return { title: nextSuffix("update-item") };
    case "estimate_categories":
      return { name: nextSuffix("update-category") };
    case "labor_roles":
      return { name: nextSuffix("update-labor-role") };
    case "estimate_suggestion_rules":
      return { name: nextSuffix("update-rule") };
    case "audit_logs":
      return { after_data: { source: nextSuffix("update-audit") } };
  }
}

async function runSelect(
  client: SupabaseClient<Database>,
  table: MatrixTable,
  rowId: string
): Promise<OperationResult> {
  const { data, error } = await asAnyClient(client).from(table).select("id").eq("id", rowId).limit(1);
  if (error) {
    return { allowed: false, errorCode: error.code, errorMessage: error.message };
  }

  const allowed = Array.isArray(data) && data.length === 1;
  return { allowed };
}

async function runInsert(
  client: SupabaseClient<Database>,
  table: MatrixTable,
  actorUserId: string
): Promise<OperationResult> {
  const payload = buildInsertPayload(table, actorUserId);
  const { data, error } = await asAnyClient(client).from(table).insert(payload).select("id").maybeSingle();
  if (error) {
    return { allowed: false, errorCode: error.code, errorMessage: error.message };
  }

  const insertedId = data?.id as string | undefined;
  if (insertedId) {
    trackRow(table, insertedId);
  }

  return { allowed: Boolean(insertedId) };
}

async function runUpdate(
  client: SupabaseClient<Database>,
  table: MatrixTable,
  rowId: string
): Promise<OperationResult> {
  const payload = buildUpdatePayload(table);
  const { data, error } = await asAnyClient(client)
    .from(table)
    .update(payload)
    .eq("id", rowId)
    .select("id");
  if (error) {
    return { allowed: false, errorCode: error.code, errorMessage: error.message };
  }

  const allowed = Array.isArray(data) && data.length === 1;
  return { allowed };
}

async function runDelete(
  client: SupabaseClient<Database>,
  table: MatrixTable,
  rowId: string
): Promise<OperationResult> {
  const { data, error } = await asAnyClient(client)
    .from(table)
    .delete()
    .eq("id", rowId)
    .select("id");
  if (error) {
    return { allowed: false, errorCode: error.code, errorMessage: error.message };
  }

  const allowed = Array.isArray(data) && data.length === 1;
  return { allowed };
}

async function cleanupTrackedRows(table: KnownCleanupTable) {
  const ids = Array.from(createdRows[table] ?? []);
  if (ids.length === 0) {
    return;
  }

  const { error } = await asAnyClient(serviceClient).from(table).delete().in("id", ids);
  if (error) {
    throw new Error(
      `Cleanup failed for ${table} [${error.code ?? "no-code"}]: ${error.message ?? "unknown"}`
    );
  }
}

describe.runIf(RLS_E2E_ENABLED)("EST-261 RLS matrix E2E", () => {
  beforeAll(async () => {
    runTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const supabaseUrl = envValueOrThrow("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = envValueOrThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceRoleKey = envValueOrThrow("SUPABASE_SERVICE_ROLE_KEY");

    const adminEmail = envValueOrThrow("RLS_E2E_ADMIN_EMAIL", ["E2E_LOGIN_EMAIL_ADMIN"]);
    const adminPassword = envValueOrThrow("RLS_E2E_ADMIN_PASSWORD", ["E2E_LOGIN_PASSWORD_ADMIN"]);
    const engineerEmail = envValueOrThrow("RLS_E2E_ENGINEER_EMAIL", ["E2E_LOGIN_EMAIL"]);
    const engineerPassword = envValueOrThrow("RLS_E2E_ENGINEER_PASSWORD", ["E2E_LOGIN_PASSWORD"]);
    const viewerEmail = envValueOrThrow("RLS_E2E_VIEWER_EMAIL", ["E2E_LOGIN_EMAIL_2"]);
    const viewerPassword = envValueOrThrow("RLS_E2E_VIEWER_PASSWORD", ["E2E_LOGIN_PASSWORD_2"]);

    serviceClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    serviceAdmin = serviceClient as unknown as SupabaseClient<LooseDatabase>;

    const [adminUser, engineerUser, viewerUser] = await Promise.all([
      signInUser({
        url: supabaseUrl,
        anonKey,
        email: adminEmail,
        password: adminPassword,
      }),
      signInUser({
        url: supabaseUrl,
        anonKey,
        email: engineerEmail,
        password: engineerPassword,
      }),
      signInUser({
        url: supabaseUrl,
        anonKey,
        email: viewerEmail,
        password: viewerPassword,
      }),
    ]);

    users = {
      admin: adminUser,
      engineer: engineerUser,
      viewer: viewerUser,
    };

    const { tenantId, isolatedTenantId } = await createTenantAndMemberships();
    seedContext = await seedBaseContext(tenantId, isolatedTenantId);
  }, 120_000);

  afterAll(async () => {
    const cleanupOrder: KnownCleanupTable[] = [
      "audit_logs",
      "estimate_items",
      "estimate_suggestion_rules",
      "labor_roles",
      "estimate_categories",
      "estimate_versions",
      "estimate_projects",
      "tenant_memberships",
      "tenants",
    ];

    for (const table of cleanupOrder) {
      await cleanupTrackedRows(table);
    }

    const signOutPromises = Object.values(users ?? {}).map(async (user) => {
      await user.client.auth.signOut();
    });
    await Promise.all(signOutPromises);
  }, 120_000);

  it(
    "enforces SELECT/INSERT/UPDATE/DELETE matrix by role on estimate tables",
    async () => {
      const missingRequiredTables: string[] = [];
      for (const table of REQUIRED_MATRIX_TABLES) {
        const exists = await probeTableExists(table);
        if (!exists) {
          missingRequiredTables.push(table);
        }
      }

      expect(missingRequiredTables).toEqual([]);

      const missingOptionalTables: string[] = [];
      for (const table of OPTIONAL_MATRIX_TABLES) {
        const exists = await probeTableExists(table);
        if (!exists) {
          missingOptionalTables.push(table);
        }
      }
      if (missingOptionalTables.length > 0) {
        console.warn(
          `[EST-261] Optional matrix tables absent from schema: ${missingOptionalTables.join(", ")}`
        );
      }

      const mismatches: string[] = [];

      for (const table of REQUIRED_MATRIX_TABLES) {
        for (const role of ROLES) {
          const actor = users[role];
          for (const operation of OPERATIONS) {
            let result: OperationResult;
            if (operation === "insert") {
              result = await runInsert(actor.client, table, actor.userId);
            } else {
              const rowId = await createOwnedRowForOperation(table);
              if (operation === "select") {
                result = await runSelect(actor.client, table, rowId);
              } else if (operation === "update") {
                result = await runUpdate(actor.client, table, rowId);
              } else {
                result = await runDelete(actor.client, table, rowId);
              }
            }

            const expected = EXPECTED_MATRIX[table][role][operation];
            if (result.allowed !== expected) {
              const details = result.errorCode
                ? ` code=${result.errorCode} message=${result.errorMessage ?? ""}`
                : "";
              mismatches.push(
                `${table}.${operation} role=${role} expected=${expected} actual=${result.allowed}${details}`
              );
            }
          }
        }
      }

      expect(mismatches).toEqual([]);
    },
    240_000
  );

  it("blocks cross-tenant read/write access when the user is not a tenant member", async () => {
    const mismatches: string[] = [];

    for (const role of ROLES) {
      const actor = users[role];

      const versionSelect = await runSelect(actor.client, "estimate_versions", seedContext.isolatedVersionId);
      if (versionSelect.allowed) {
        mismatches.push(`estimate_versions.select role=${role} expected=false actual=true`);
      }

      const categorySelect = await runSelect(
        actor.client,
        "estimate_categories",
        seedContext.isolatedCategoryId
      );
      if (categorySelect.allowed) {
        mismatches.push(`estimate_categories.select role=${role} expected=false actual=true`);
      }
    }

    const engineer = users.engineer;
    const isolatedUpdate = await runUpdate(
      engineer.client,
      "estimate_versions",
      seedContext.isolatedVersionId
    );
    if (isolatedUpdate.allowed) {
      mismatches.push("estimate_versions.update role=engineer expected=false actual=true");
    }

    const isolatedDelete = await runDelete(
      engineer.client,
      "estimate_versions",
      seedContext.isolatedVersionId
    );
    if (isolatedDelete.allowed) {
      mismatches.push("estimate_versions.delete role=engineer expected=false actual=true");
    }

    const { data: isolatedInsertData, error: isolatedInsertError } = await asAnyClient(
      engineer.client
    )
      .from("estimate_items")
      .insert({
        id: randomUUID(),
        tenant_id: seedContext.isolatedTenantId,
        version_id: seedContext.isolatedVersionId,
        item_type: "line",
        position: nextPosition(),
        title: nextSuffix("isolated-insert"),
        quantity: 1,
        source_provider: "takeoff",
        source_job_id: null,
        source_file_name: "isolated-quantif.csv",
        source_page: 1,
      })
      .select("id")
      .maybeSingle();

    if (!isolatedInsertError && isolatedInsertData?.id) {
      mismatches.push("estimate_items.insert role=engineer expected=false actual=true");
      trackRow("estimate_items", isolatedInsertData.id as string);
    }

    expect(mismatches).toEqual([]);
  });
});
