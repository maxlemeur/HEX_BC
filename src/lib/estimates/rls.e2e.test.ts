import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/types/database";
import { assertLoopbackSupabaseUrl } from "@/test/local-supabase-ci";

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
type KnownCleanupTable =
  | MatrixTable
  | OptionalMatrixTable
  | "draft_locks"
  | "estimate_projects"
  | "plan_sets"
  | "takeoff_items"
  | "takeoff_jobs"
  | "tenant_memberships"
  | "tenants";
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
  sectionId: string;
  categoryId: string;
  laborRoleId: string;
  isolatedProjectId: string;
  isolatedVersionId: string;
  isolatedSectionId: string;
  isolatedCategoryId: string;
}

interface OperationResult {
  allowed: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface LooseRpcResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
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
    admin: { select: true, insert: false, update: true, delete: true },
    engineer: { select: true, insert: false, update: true, delete: true },
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

function envValueOrThrow(name: string) {
  const value = process.env[name]?.trim();
  if (value) {
    return value;
  }
  throw new Error(`Missing required environment variable: ${name}`);
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

function callLooseRpc(
  client: SupabaseClient<LooseDatabase>,
  functionName: string,
  args: Record<string, unknown>
) {
  return client.rpc(
    functionName as never,
    args as never
  ) as unknown as Promise<LooseRpcResult>;
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
      created_by: users.engineer.userId,
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
    {
      tenant_id: tenantId,
      user_id: users.admin.userId,
      role: "admin" as const,
      is_default: true,
    },
    {
      tenant_id: tenantId,
      user_id: users.engineer.userId,
      role: "engineer" as const,
      is_default: true,
    },
    {
      tenant_id: tenantId,
      user_id: users.viewer.userId,
      role: "viewer" as const,
      is_default: true,
    },
  ];

  // Local Auth signup creates a personal tenant with is_default=true. Move the
  // ephemeral users to the matrix tenant before exercising current_tenant_id().
  const { error: clearDefaultError } = await serviceAdmin
    .from("tenant_memberships")
    .update({ is_default: false })
    .in("user_id", Object.values(users).map((user) => user.userId));
  await assertNoError("clear local signup tenant defaults", clearDefaultError);

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

  const sectionId = randomUUID();
  const { error: sectionError } = await serviceClient.from("estimate_items").insert({
    id: sectionId,
    tenant_id: tenantId,
    version_id: versionId,
    parent_id: null,
    item_type: "section",
    position: 1,
    title: nextSuffix("section"),
  });
  await assertNoError("insert base estimate section", sectionError);
  trackRow("estimate_items", sectionId);

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

  const isolatedSectionId = randomUUID();
  const { error: isolatedSectionError } = await serviceClient
    .from("estimate_items")
    .insert({
      id: isolatedSectionId,
      tenant_id: isolatedTenantId,
      version_id: isolatedVersionId,
      parent_id: null,
      item_type: "section",
      position: 1,
      title: nextSuffix("isolated-section"),
    });
  await assertNoError("insert isolated estimate section", isolatedSectionError);
  trackRow("estimate_items", isolatedSectionId);

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
    sectionId,
    categoryId,
    laborRoleId,
    isolatedProjectId,
    isolatedVersionId,
    isolatedSectionId,
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
        parent_id: seedContext.sectionId,
        item_type: "line",
        position: nextPosition(),
        title: nextSuffix("op-item"),
        quantity: 1,
        unit_price_ht_cents: 1000,
        tax_rate_bp: 2000,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: 1,
        k_mo: 1,
        pu_ht_cents: 1000,
        line_total_ht_cents: 1000,
        line_tax_cents: 200,
        line_total_ttc_cents: 1200,
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

type MatrixInsert<Table extends MatrixTable> =
  Database["public"]["Tables"][Table]["Insert"];
type MatrixInsertPayload = {
  [Table in MatrixTable]: MatrixInsert<Table>;
}[MatrixTable];

function buildInsertPayload(
  table: "estimate_versions",
  actorUserId: string
): MatrixInsert<"estimate_versions">;
function buildInsertPayload(
  table: "estimate_items",
  actorUserId: string
): MatrixInsert<"estimate_items">;
function buildInsertPayload(
  table: "estimate_categories",
  actorUserId: string
): MatrixInsert<"estimate_categories">;
function buildInsertPayload(
  table: "labor_roles",
  actorUserId: string
): MatrixInsert<"labor_roles">;
function buildInsertPayload(
  table: "estimate_suggestion_rules",
  actorUserId: string
): MatrixInsert<"estimate_suggestion_rules">;
function buildInsertPayload(
  table: "audit_logs",
  actorUserId: string
): MatrixInsert<"audit_logs">;
function buildInsertPayload(table: MatrixTable, actorUserId: string): MatrixInsertPayload;
function buildInsertPayload(
  table: MatrixTable,
  actorUserId: string
): MatrixInsertPayload {
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
        parent_id: seedContext.sectionId,
        item_type: "line" as const,
        position: nextPosition(),
        title: nextSuffix("insert-item"),
        quantity: 1,
        unit_price_ht_cents: 1500,
        tax_rate_bp: 2000,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: 1,
        k_mo: 1,
        pu_ht_cents: 1500,
        line_total_ht_cents: 1500,
        line_tax_cents: 300,
        line_total_ttc_cents: 1800,
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
  const insertedId = payload.id;
  if (!insertedId) {
    throw new Error(`RLS insert fixture for ${table} must define an id`);
  }

  // Do not chain SELECT here: INSERT and SELECT have intentionally different
  // policies for append-only audit rows, and the matrix verifies each verb
  // independently.
  const { error } = await asAnyClient(client)
    .from(table)
    .insert(payload as Record<string, unknown>);
  if (error) {
    return { allowed: false, errorCode: error.code, errorMessage: error.message };
  }

  trackRow(table, insertedId);
  return { allowed: true };
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

async function assertProjectExists(projectId: string, expected: boolean) {
  const { data, error } = await serviceAdmin
    .from("estimate_projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  await assertNoError("verify estimate project persistence", error);
  if ((data?.id === projectId) !== expected) {
    throw new Error(
      `Estimate project ${projectId} persistence mismatch: expected=${expected}`
    );
  }
}

async function seedProjectForDeleteBoundary(params: {
  isArchived?: boolean;
  ownerUserId: string;
  prefix: string;
}) {
  const projectId = randomUUID();
  const { error } = await serviceAdmin.from("estimate_projects").insert({
    id: projectId,
    tenant_id: seedContext.tenantId,
    user_id: params.ownerUserId,
    name: nextSuffix(params.prefix),
    is_archived: params.isArchived ?? false,
  });
  await assertNoError(`seed ${params.prefix} project`, error);
  trackRow("estimate_projects", projectId);
  return projectId;
}

async function assertViewerOwnerEstimateMutationsDenied() {
  const viewerClient = asAnyClient(users.viewer.client);
  const projectId = await seedProjectForDeleteBoundary({
    ownerUserId: users.viewer.userId,
    prefix: "viewer-owned-write-boundary",
  });
  const versionId = randomUUID();
  const sectionId = randomUUID();
  const itemId = randomUUID();
  const categoryId = randomUUID();
  const laborRoleId = randomUUID();
  const ruleId = randomUUID();

  const { error: versionError } = await serviceAdmin.from("estimate_versions").insert({
    id: versionId,
    tenant_id: seedContext.tenantId,
    project_id: projectId,
    version_number: nextVersionNumber(),
    status: "draft",
    title: nextSuffix("viewer-owned-version"),
  });
  await assertNoError("seed viewer-owned estimate version", versionError);
  trackRow("estimate_versions", versionId);

  const { error: sectionError } = await serviceAdmin.from("estimate_items").insert({
    id: sectionId,
    tenant_id: seedContext.tenantId,
    version_id: versionId,
    parent_id: null,
    item_type: "section",
    position: nextPosition(),
    title: nextSuffix("viewer-owned-section"),
  });
  await assertNoError("seed viewer-owned estimate section", sectionError);
  trackRow("estimate_items", sectionId);

  const { error: itemError } = await serviceAdmin.from("estimate_items").insert({
    id: itemId,
    tenant_id: seedContext.tenantId,
    version_id: versionId,
    parent_id: sectionId,
    item_type: "line",
    position: nextPosition(),
    title: nextSuffix("viewer-owned-item"),
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 1000,
    line_total_ht_cents: 1000,
    line_tax_cents: 200,
    line_total_ttc_cents: 1200,
  });
  await assertNoError("seed viewer-owned estimate item", itemError);
  trackRow("estimate_items", itemId);

  const { error: categoryError } = await serviceAdmin
    .from("estimate_categories")
    .insert({
      id: categoryId,
      tenant_id: seedContext.tenantId,
      user_id: users.viewer.userId,
      name: nextSuffix("viewer-owned-category"),
    });
  await assertNoError("seed viewer-owned estimate category", categoryError);
  trackRow("estimate_categories", categoryId);

  const { error: laborRoleError } = await serviceAdmin.from("labor_roles").insert({
    id: laborRoleId,
    tenant_id: seedContext.tenantId,
    user_id: users.viewer.userId,
    name: nextSuffix("viewer-owned-labor"),
  });
  await assertNoError("seed viewer-owned labor role", laborRoleError);
  trackRow("labor_roles", laborRoleId);

  const { error: ruleError } = await serviceAdmin
    .from("estimate_suggestion_rules")
    .insert({
      id: ruleId,
      tenant_id: seedContext.tenantId,
      user_id: users.viewer.userId,
      name: nextSuffix("viewer-owned-rule"),
      match_value: nextSuffix("viewer-owned-match"),
      category_id: categoryId,
      labor_role_id: laborRoleId,
    });
  await assertNoError("seed viewer-owned estimate rule", ruleError);
  trackRow("estimate_suggestion_rules", ruleId);

  const resources: Array<{
    id: string;
    insertPayload: Record<string, unknown>;
    table: KnownCleanupTable;
    updatePayload: Record<string, unknown>;
  }> = [
    {
      table: "estimate_projects",
      id: projectId,
      updatePayload: { name: nextSuffix("viewer-project-update-denied") },
      insertPayload: {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        user_id: users.viewer.userId,
        name: nextSuffix("viewer-project-insert-denied"),
      },
    },
    {
      table: "estimate_versions",
      id: versionId,
      updatePayload: { title: nextSuffix("viewer-version-update-denied") },
      insertPayload: {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        project_id: projectId,
        version_number: nextVersionNumber(),
        status: "draft",
        title: nextSuffix("viewer-version-insert-denied"),
      },
    },
    {
      table: "estimate_items",
      id: itemId,
      updatePayload: { title: nextSuffix("viewer-item-update-denied") },
      insertPayload: {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        version_id: versionId,
        parent_id: sectionId,
        item_type: "line",
        position: nextPosition(),
        title: nextSuffix("viewer-item-insert-denied"),
        quantity: 1,
        unit_price_ht_cents: 1000,
        tax_rate_bp: 2000,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: 1,
        k_mo: 1,
        pu_ht_cents: 1000,
        line_total_ht_cents: 1000,
        line_tax_cents: 200,
        line_total_ttc_cents: 1200,
      },
    },
    {
      table: "estimate_categories",
      id: categoryId,
      updatePayload: { name: nextSuffix("viewer-category-update-denied") },
      insertPayload: {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        user_id: users.viewer.userId,
        name: nextSuffix("viewer-category-insert-denied"),
      },
    },
    {
      table: "labor_roles",
      id: laborRoleId,
      updatePayload: { name: nextSuffix("viewer-labor-update-denied") },
      insertPayload: {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        user_id: users.viewer.userId,
        name: nextSuffix("viewer-labor-insert-denied"),
      },
    },
    {
      table: "estimate_suggestion_rules",
      id: ruleId,
      updatePayload: { name: nextSuffix("viewer-rule-update-denied") },
      insertPayload: {
        id: randomUUID(),
        tenant_id: seedContext.tenantId,
        user_id: users.viewer.userId,
        name: nextSuffix("viewer-rule-insert-denied"),
        match_value: nextSuffix("viewer-rule-match-denied"),
        category_id: categoryId,
        labor_role_id: laborRoleId,
      },
    },
  ];

  for (const resource of resources) {
    const { data: selectedRows, error: selectError } = await viewerClient
      .from(resource.table)
      .select("id")
      .eq("id", resource.id);
    await assertNoError(`viewer-owner SELECT ${resource.table}`, selectError);
    if (!Array.isArray(selectedRows) || selectedRows[0]?.id !== resource.id) {
      throw new Error(`Viewer-owner lost read access to ${resource.table}`);
    }

    const { data: updatedRows, error: updateError } = await viewerClient
      .from(resource.table)
      .update(resource.updatePayload)
      .eq("id", resource.id)
      .select("id");
    if (!updateError && Array.isArray(updatedRows) && updatedRows.length > 0) {
      throw new Error(`Viewer-owner unexpectedly updated ${resource.table}`);
    }

    const { data: deletedRows, error: deleteError } = await viewerClient
      .from(resource.table)
      .delete()
      .eq("id", resource.id)
      .select("id");
    if (!deleteError && Array.isArray(deletedRows) && deletedRows.length > 0) {
      throw new Error(`Viewer-owner unexpectedly deleted ${resource.table}`);
    }

    const insertId = resource.insertPayload.id as string;
    const { error: insertError } = await viewerClient
      .from(resource.table)
      .insert(resource.insertPayload);
    if (!insertError) {
      trackRow(resource.table, insertId);
      throw new Error(`Viewer-owner unexpectedly inserted ${resource.table}`);
    }
  }
}

async function assertGovernedEstimateProjectDeletes() {
  const deletableProjectId = await seedProjectForDeleteBoundary({
    ownerUserId: users.engineer.userId,
    prefix: "direct-delete-allowed",
  });
  const deletableVersionId = randomUUID();
  const { error: deletableVersionError } = await serviceAdmin
    .from("estimate_versions")
    .insert({
      id: deletableVersionId,
      tenant_id: seedContext.tenantId,
      project_id: deletableProjectId,
      version_number: nextVersionNumber(),
      status: "draft",
      title: nextSuffix("direct-delete-draft-version"),
    });
  await assertNoError("seed direct-delete draft version", deletableVersionError);
  trackRow("estimate_versions", deletableVersionId);
  const { data: deletedRows, error: deleteError } = await asAnyClient(
    users.engineer.client
  )
    .from("estimate_projects")
    .delete()
    .eq("id", deletableProjectId)
    .select("id");
  await assertNoError("direct engineer project DELETE", deleteError);
  if (!Array.isArray(deletedRows) || deletedRows[0]?.id !== deletableProjectId) {
    throw new Error("Eligible engineer project DELETE did not remove one row");
  }
  await assertProjectExists(deletableProjectId, false);
  const { count: deletedVersionCount, error: deletedVersionCountError } =
    await serviceAdmin
      .from("estimate_versions")
      .select("id", { count: "exact", head: true })
      .eq("id", deletableVersionId);
  await assertNoError("verify direct-delete draft cascade", deletedVersionCountError);
  if (deletedVersionCount !== 0) {
    throw new Error("Eligible engineer project DELETE left its draft version behind");
  }

  const viewerProjectId = await seedProjectForDeleteBoundary({
    ownerUserId: users.viewer.userId,
    prefix: "viewer-delete-denied",
  });
  const { data: viewerDeletedRows, error: viewerDeleteError } = await asAnyClient(
    users.viewer.client
  )
    .from("estimate_projects")
    .delete()
    .eq("id", viewerProjectId)
    .select("id");
  await assertNoError("viewer project DELETE filtered by RLS", viewerDeleteError);
  if (Array.isArray(viewerDeletedRows) && viewerDeletedRows.length > 0) {
    throw new Error("Viewer project DELETE unexpectedly removed a row");
  }
  await assertProjectExists(viewerProjectId, true);

  const archivedProjectId = await seedProjectForDeleteBoundary({
    isArchived: true,
    ownerUserId: users.engineer.userId,
    prefix: "archived-delete-denied",
  });
  const { data: archivedDeletedRows, error: archivedDeleteError } = await asAnyClient(
    users.engineer.client
  )
    .from("estimate_projects")
    .delete()
    .eq("id", archivedProjectId)
    .select("id");
  await assertNoError("archived project DELETE filtered by RLS", archivedDeleteError);
  if (Array.isArray(archivedDeletedRows) && archivedDeletedRows.length > 0) {
    throw new Error("Archived project DELETE unexpectedly removed a row");
  }
  await assertProjectExists(archivedProjectId, true);

  const cascadeProjectId = randomUUID();
  const cascadeVersionId = randomUUID();
  const intakeUploadId = randomUUID();
  const intakeEventId = randomUUID();
  const registerEntryId = randomUUID();
  const registerEventId = randomUUID();
  const { error: cascadeProjectError } = await serviceAdmin
    .from("estimate_projects")
    .insert({
      id: cascadeProjectId,
      tenant_id: seedContext.tenantId,
      user_id: users.engineer.userId,
      name: nextSuffix("rpc-cascade-project"),
    });
  await assertNoError("seed RPC cascade project", cascadeProjectError);
  const { error: cascadeVersionError } = await serviceAdmin
    .from("estimate_versions")
    .insert({
      id: cascadeVersionId,
      tenant_id: seedContext.tenantId,
      project_id: cascadeProjectId,
      version_number: nextVersionNumber(),
      status: "draft",
      title: nextSuffix("rpc-cascade-version"),
    });
  await assertNoError("seed RPC cascade version", cascadeVersionError);
  const { error: intakeUploadError } = await serviceAdmin
    .from("affaire_intake_uploads")
    .insert({
      id: intakeUploadId,
      tenant_id: seedContext.tenantId,
      project_id: cascadeProjectId,
      created_by: users.engineer.userId,
      status: "queued",
    });
  await assertNoError("seed RPC cascade intake upload", intakeUploadError);
  const { error: intakeEventError } = await serviceAdmin
    .from("affaire_intake_events")
    .insert({
      id: intakeEventId,
      upload_id: intakeUploadId,
      actor_user_id: users.engineer.userId,
      event_type: "upload.created",
      after_payload: { source: "rls-e2e" },
    });
  await assertNoError("seed immutable intake event", intakeEventError);
  const { error: registerEntryError } = await serviceAdmin
    .from("affaire_register_entries")
    .insert({
      id: registerEntryId,
      tenant_id: seedContext.tenantId,
      project_id: cascadeProjectId,
      kind: "assumption",
      text: "RLS cascade fixture",
      scope_label: "Affaire",
      created_by: users.engineer.userId,
      updated_by: users.engineer.userId,
    });
  await assertNoError("seed affaire register entry", registerEntryError);
  const { error: registerEventError } = await serviceAdmin
    .from("affaire_register_events")
    .insert({
      id: registerEventId,
      tenant_id: seedContext.tenantId,
      project_id: cascadeProjectId,
      entry_id: registerEntryId,
      actor_user_id: users.engineer.userId,
      event_type: "created",
      after_payload: { source: "rls-e2e" },
    });
  await assertNoError("seed immutable register event", registerEventError);

  const { data: cascadeDeleteData, error: cascadeDeleteError } =
    await callLooseRpc(
      asAnyClient(users.engineer.client),
      "bulk_delete_draft_affaires",
      {
        p_tenant_id: seedContext.tenantId,
        p_project_ids: [cascadeProjectId],
      }
    );
  await assertNoError("bulk delete draft affaire cascade", cascadeDeleteError);
  const cascadeOutcome = Array.isArray(cascadeDeleteData)
    ? cascadeDeleteData[0]
    : cascadeDeleteData;
  if (
    !cascadeOutcome ||
    typeof cascadeOutcome !== "object" ||
    (cascadeOutcome as { outcome?: unknown }).outcome !== "deleted"
  ) {
    throw new Error("Bulk draft-affaire RPC did not report a deleted cascade");
  }
  for (const [table, id] of [
    ["estimate_projects", cascadeProjectId],
    ["estimate_versions", cascadeVersionId],
    ["affaire_intake_uploads", intakeUploadId],
    ["affaire_intake_events", intakeEventId],
    ["affaire_register_entries", registerEntryId],
    ["affaire_register_events", registerEventId],
  ] as const) {
    const { count, error } = await serviceAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("id", id);
    await assertNoError(`verify ${table} cascade`, error);
    if (count !== 0) {
      throw new Error(`Bulk draft-affaire RPC left ${table} behind`);
    }
  }

  if (process.env.RLS_E2E_EPHEMERAL === "1") {
    const nonDraftProjectId = randomUUID();
    const nonDraftVersionId = randomUUID();
    const { error: nonDraftProjectError } = await serviceAdmin
      .from("estimate_projects")
      .insert({
        id: nonDraftProjectId,
        tenant_id: seedContext.tenantId,
        user_id: users.engineer.userId,
        name: nextSuffix("rpc-non-draft-project"),
      });
    await assertNoError("seed non-draft delete project", nonDraftProjectError);
    const { error: nonDraftVersionError } = await serviceAdmin
      .from("estimate_versions")
      .insert({
        id: nonDraftVersionId,
        tenant_id: seedContext.tenantId,
        project_id: nonDraftProjectId,
        version_number: nextVersionNumber(),
        status: "sent",
        title: nextSuffix("rpc-non-draft-version"),
      });
    await assertNoError("seed non-draft delete version", nonDraftVersionError);

    const { error: directNonDraftDeleteError } = await asAnyClient(
      users.engineer.client
    )
      .from("estimate_projects")
      .delete()
      .eq("id", nonDraftProjectId)
      .select("id");
    if (directNonDraftDeleteError?.code !== "42501") {
      throw new Error(
        `Direct project DELETE accepted a non-draft version [${directNonDraftDeleteError?.code ?? "no-code"}]`
      );
    }
    await assertProjectExists(nonDraftProjectId, true);

    const { data: nonDraftDeleteData, error: nonDraftDeleteError } =
      await callLooseRpc(
        asAnyClient(users.engineer.client),
        "bulk_delete_draft_affaires",
        {
          p_tenant_id: seedContext.tenantId,
          p_project_ids: [nonDraftProjectId],
        }
      );
    await assertNoError("refuse non-draft affaire cascade", nonDraftDeleteError);
    const nonDraftOutcome = Array.isArray(nonDraftDeleteData)
      ? nonDraftDeleteData[0]
      : nonDraftDeleteData;
    if (
      !nonDraftOutcome ||
      typeof nonDraftOutcome !== "object" ||
      (nonDraftOutcome as { outcome?: unknown }).outcome !== "not_eligible"
    ) {
      throw new Error("Bulk draft-affaire RPC accepted a non-draft version");
    }
    await assertProjectExists(nonDraftProjectId, true);

    const nonDraftJobId = randomUUID();
    const { error: nonDraftJobError } = await asAnyClient(users.engineer.client)
      .from("takeoff_jobs")
      .insert({
        id: nonDraftJobId,
        tenant_id: seedContext.tenantId,
        estimate_version_id: nonDraftVersionId,
        level: "A",
        status: "pending",
        processing_strategy: "sync",
        source_file_path: `${seedContext.tenantId}/${nonDraftJobId}/rls-fixture.csv`,
        prompt_version: "rls-e2e-v1",
        created_by: users.engineer.userId,
      });
    if (nonDraftJobError?.code !== "42501") {
      trackRow("takeoff_jobs", nonDraftJobId);
      throw new Error(
        `Authenticated takeoff job accepted a non-draft version [${nonDraftJobError?.code ?? "no-code"}]`
      );
    }
  }
}

async function assertAuthenticatedTakeoffWorkflow() {
  const engineerClient = asAnyClient(users.engineer.client);
  const seedBoundaryJob = async (
    overrides: Record<string, unknown>
  ): Promise<string> => {
    const boundaryJobId = randomUUID();
    const { error } = await serviceAdmin.from("takeoff_jobs").insert({
      id: boundaryJobId,
      tenant_id: seedContext.tenantId,
      estimate_version_id: seedContext.versionId,
      level: "A",
      status: "pending",
      processing_strategy: "sync",
      source_file_path: `${seedContext.tenantId}/${boundaryJobId}/rls-fixture.csv`,
      prompt_version: "rls-e2e-v1",
      created_by: users.engineer.userId,
      ...overrides,
    });
    await assertNoError("seed takeoff operator boundary job", error);
    trackRow("takeoff_jobs", boundaryJobId);
    return boundaryJobId;
  };
  const resetJobPayload = (retryCount: number) => ({
    status: "pending",
    retry_count: retryCount + 1,
    next_retry_at: null,
    last_error_at: null,
    started_at: null,
    completed_at: null,
    token_count: null,
    cost_cents: null,
    duration_ms: null,
    error_code: null,
    error_message: null,
    provider_batch_id: null,
    provider_batch_state: null,
    provider_batch_updated_at: null,
    provider_reconcile_due_at: null,
    provider_reconcile_attempt_count: 0,
    provider_reconcile_lease_token: null,
    provider_reconcile_lease_expires_at: null,
  });
  const assertJobMutationDenied = async (
    action: string,
    jobId: string,
    payload: Record<string, unknown>
  ) => {
    const { error } = await engineerClient
      .from("takeoff_jobs")
      .update(payload)
      .eq("id", jobId)
      .select("id");
    if (error?.code !== "42501") {
      throw new Error(
        `${action} must be denied [${error?.code ?? "no-code"}]`
      );
    }
  };
  const jobId = randomUUID();
  const { data: insertedJob, error: insertJobError } = await engineerClient
    .from("takeoff_jobs")
    .insert({
      id: jobId,
      tenant_id: seedContext.tenantId,
      estimate_version_id: seedContext.versionId,
      level: "A",
      status: "pending",
      processing_strategy: "sync",
      source_file_path: `${seedContext.tenantId}/${jobId}/rls-fixture.csv`,
      prompt_version: "rls-e2e-v1",
      created_by: users.engineer.userId,
    })
    .select("id, status")
    .single();
  await assertNoError("authenticated INSERT takeoff job", insertJobError);
  if (insertedJob?.id !== jobId || insertedJob.status !== "pending") {
    throw new Error("Authenticated takeoff job INSERT did not return the pending job");
  }
  trackRow("takeoff_jobs", jobId);

  const invalidInitialJobId = randomUUID();
  const { error: invalidInitialJobError } = await engineerClient
    .from("takeoff_jobs")
    .insert({
      id: invalidInitialJobId,
      tenant_id: seedContext.tenantId,
      estimate_version_id: seedContext.versionId,
      level: "A",
      status: "applied",
      processing_strategy: "sync",
      source_file_path: `${seedContext.tenantId}/${invalidInitialJobId}/rls-fixture.csv`,
      prompt_version: "rls-e2e-v1",
      created_by: users.engineer.userId,
    });
  if (invalidInitialJobError?.code !== "42501") {
    trackRow("takeoff_jobs", invalidInitialJobId);
    throw new Error(
      `Authenticated takeoff job accepted a forged initial state [${invalidInitialJobError?.code ?? "no-code"}]`
    );
  }

  const forgedSourceJobId = randomUUID();
  const { error: forgedSourceError } = await engineerClient
    .from("takeoff_jobs")
    .insert({
      id: forgedSourceJobId,
      tenant_id: seedContext.tenantId,
      estimate_version_id: seedContext.versionId,
      level: "A",
      status: "pending",
      processing_strategy: "sync",
      source_file_path: `${seedContext.tenantId}/${jobId}/foreign-job.csv`,
      prompt_version: "rls-e2e-v1",
      created_by: users.engineer.userId,
    });
  if (forgedSourceError?.code !== "42501") {
    trackRow("takeoff_jobs", forgedSourceJobId);
    throw new Error(
      `Authenticated takeoff job reused another job's source path [${forgedSourceError?.code ?? "no-code"}]`
    );
  }

  const forgedTenantJobId = randomUUID();
  const { error: forgedTenantError } = await engineerClient
    .from("takeoff_jobs")
    .insert({
      id: forgedTenantJobId,
      tenant_id: seedContext.isolatedTenantId,
      estimate_version_id: seedContext.versionId,
      level: "A",
      status: "pending",
      processing_strategy: "sync",
      source_file_path: `${seedContext.isolatedTenantId}/${forgedTenantJobId}/rls-fixture.csv`,
      prompt_version: "rls-e2e-v1",
      created_by: users.engineer.userId,
    });
  if (forgedTenantError?.code !== "42501") {
    trackRow("takeoff_jobs", forgedTenantJobId);
    throw new Error(
      `Authenticated takeoff job accepted a forged tenant [${forgedTenantError?.code ?? "no-code"}]`
    );
  }

  const viewerProjectId = randomUUID();
  const viewerVersionId = randomUUID();
  const { error: viewerProjectError } = await serviceAdmin
    .from("estimate_projects")
    .insert({
      id: viewerProjectId,
      tenant_id: seedContext.tenantId,
      user_id: users.viewer.userId,
      name: nextSuffix("viewer-takeoff-project"),
    });
  await assertNoError("seed viewer-owned takeoff project", viewerProjectError);
  trackRow("estimate_projects", viewerProjectId);
  const { error: viewerVersionError } = await serviceAdmin
    .from("estimate_versions")
    .insert({
      id: viewerVersionId,
      tenant_id: seedContext.tenantId,
      project_id: viewerProjectId,
      version_number: nextVersionNumber(),
      status: "draft",
      title: nextSuffix("viewer-takeoff-version"),
    });
  await assertNoError("seed viewer-owned takeoff version", viewerVersionError);
  trackRow("estimate_versions", viewerVersionId);

  const viewerJobId = randomUUID();
  const { error: viewerJobError } = await asAnyClient(users.viewer.client)
    .from("takeoff_jobs")
    .insert({
      id: viewerJobId,
      tenant_id: seedContext.tenantId,
      estimate_version_id: viewerVersionId,
      level: "A",
      status: "pending",
      processing_strategy: "sync",
      source_file_path: `${seedContext.tenantId}/${viewerJobId}/rls-fixture.csv`,
      prompt_version: "rls-e2e-v1",
      created_by: users.viewer.userId,
    });
  if (viewerJobError?.code !== "42501") {
    trackRow("takeoff_jobs", viewerJobId);
    throw new Error(
      `Viewer-owner takeoff INSERT must be denied [${viewerJobError?.code ?? "no-code"}]`
    );
  }

  const viewerCompletedJobId = await seedBoundaryJob({
    estimate_version_id: viewerVersionId,
    status: "completed",
    completed_at: new Date().toISOString(),
    created_by: users.viewer.userId,
  });
  const viewerOwnedItemId = randomUUID();
  const { error: viewerOwnedItemError } = await serviceAdmin
    .from("takeoff_items")
    .insert({
      id: viewerOwnedItemId,
      tenant_id: seedContext.tenantId,
      job_id: viewerCompletedJobId,
      result_id: null,
      designation: "Viewer-owned item",
      quantity: 1,
      unit: "u",
    });
  await assertNoError("seed viewer-owned takeoff item", viewerOwnedItemError);
  trackRow("takeoff_items", viewerOwnedItemId);
  const viewerClient = asAnyClient(users.viewer.client);
  const { data: visibleViewerJob, error: visibleViewerJobError } =
    await viewerClient
      .from("takeoff_jobs")
      .select("id, status")
      .eq("id", viewerCompletedJobId)
      .single();
  await assertNoError("viewer SELECT own takeoff job", visibleViewerJobError);
  if (visibleViewerJob?.id !== viewerCompletedJobId) {
    throw new Error("Viewer cannot read their retained takeoff job");
  }
  const { data: visibleViewerItem, error: visibleViewerItemError } =
    await viewerClient
      .from("takeoff_items")
      .select("id, designation")
      .eq("id", viewerOwnedItemId)
      .single();
  await assertNoError("viewer SELECT own takeoff item", visibleViewerItemError);
  if (visibleViewerItem?.id !== viewerOwnedItemId) {
    throw new Error("Viewer cannot read their retained takeoff item");
  }
  const { error: viewerApplyError } = await callLooseRpc(
    viewerClient,
    "apply_takeoff_job_guarded_atomic",
    {
      p_job_id: viewerCompletedJobId,
      p_strategy: "append",
      p_target_section_id: null,
      p_mapping_plan: [
        {
          item_id: viewerOwnedItemId,
          source_order: 0,
          rule_id: null,
          action: "none",
          designation: "Viewer-owned item",
          unit_price_cents: null,
          category_id: null,
          assembly_id: null,
        },
      ],
    }
  );
  if (viewerApplyError?.code !== "42501") {
    throw new Error(
      `Viewer entered guarded takeoff apply [${viewerApplyError?.code ?? "no-code"}]`
    );
  }
  const { count: viewerApplyItemCount, error: viewerApplyItemCountError } =
    await serviceAdmin
      .from("estimate_items")
      .select("id", { count: "exact", head: true })
      .eq("version_id", viewerVersionId);
  await assertNoError(
    "verify rejected viewer takeoff apply",
    viewerApplyItemCountError
  );
  if (viewerApplyItemCount !== 0) {
    throw new Error("Rejected viewer takeoff apply created estimate rows");
  }
  const { data: viewerUpdatedItems, error: viewerUpdateItemError } =
    await viewerClient
      .from("takeoff_items")
      .update({ designation: "Viewer mutation" })
      .eq("id", viewerOwnedItemId)
      .select("id");
  if (!viewerUpdateItemError && (viewerUpdatedItems?.length ?? 0) > 0) {
    throw new Error("Viewer updated their retained takeoff item");
  }

  const viewerPendingJobId = await seedBoundaryJob({
    estimate_version_id: viewerVersionId,
    status: "pending",
    created_by: users.viewer.userId,
  });
  const { data: viewerUpdatedJobs, error: viewerUpdateJobError } =
    await viewerClient
      .from("takeoff_jobs")
      .update({ status: "canceled" })
      .eq("id", viewerPendingJobId)
      .select("id");
  if (!viewerUpdateJobError && (viewerUpdatedJobs?.length ?? 0) > 0) {
    throw new Error("Viewer updated their retained pending takeoff job");
  }
  const { data: viewerDeletedJobs, error: viewerDeleteJobError } =
    await viewerClient
      .from("takeoff_jobs")
      .delete()
      .eq("id", viewerPendingJobId)
      .select("id");
  if (!viewerDeleteJobError && (viewerDeletedJobs?.length ?? 0) > 0) {
    throw new Error("Viewer deleted their retained pending takeoff job");
  }
  const { data: unchangedViewerPendingJob, error: unchangedViewerPendingJobError } =
    await serviceAdmin
      .from("takeoff_jobs")
      .select("id, status")
      .eq("id", viewerPendingJobId)
      .single();
  await assertNoError(
    "verify viewer-owned pending takeoff job unchanged",
    unchangedViewerPendingJobError
  );
  const { data: unchangedViewerJob, error: unchangedViewerJobError } =
    await serviceAdmin
      .from("takeoff_jobs")
      .select("id, status")
      .eq("id", viewerCompletedJobId)
      .single();
  await assertNoError("verify viewer-owned takeoff job unchanged", unchangedViewerJobError);
  const { data: unchangedViewerItem, error: unchangedViewerItemError } =
    await serviceAdmin
      .from("takeoff_items")
      .select("id, designation")
      .eq("id", viewerOwnedItemId)
      .single();
  await assertNoError(
    "verify viewer-owned takeoff item unchanged",
    unchangedViewerItemError
  );
  if (
    unchangedViewerJob?.status !== "completed" ||
    unchangedViewerPendingJob?.status !== "pending" ||
    unchangedViewerItem?.designation !== "Viewer-owned item"
  ) {
    throw new Error("Rejected viewer takeoff mutation changed stored data");
  }

  const foreignEngineerProjectId = randomUUID();
  const foreignEngineerVersionId = randomUUID();
  const { error: foreignEngineerProjectError } = await serviceAdmin
    .from("estimate_projects")
    .insert({
      id: foreignEngineerProjectId,
      tenant_id: seedContext.tenantId,
      user_id: users.engineer.userId,
      name: nextSuffix("foreign-engineer-plan-project"),
    });
  await assertNoError(
    "seed foreign engineer plan project",
    foreignEngineerProjectError
  );
  trackRow("estimate_projects", foreignEngineerProjectId);
  const { error: foreignEngineerVersionError } = await serviceAdmin
    .from("estimate_versions")
    .insert({
      id: foreignEngineerVersionId,
      tenant_id: seedContext.tenantId,
      project_id: foreignEngineerProjectId,
      version_number: nextVersionNumber(),
      status: "draft",
      title: nextSuffix("foreign-engineer-plan-version"),
    });
  await assertNoError(
    "seed foreign engineer plan version",
    foreignEngineerVersionError
  );
  trackRow("estimate_versions", foreignEngineerVersionId);

  const sameProjectPlanSetId = randomUUID();
  const foreignProjectPlanSetId = randomUUID();
  const { error: planSetSeedError } = await serviceAdmin.from("plan_sets").insert([
    {
      id: sameProjectPlanSetId,
      tenant_id: seedContext.tenantId,
      project_id: seedContext.projectId,
      estimate_version_id: seedContext.versionId,
      name: nextSuffix("same-project-plan-set"),
      created_by: users.engineer.userId,
    },
    {
      id: foreignProjectPlanSetId,
      tenant_id: seedContext.tenantId,
      project_id: foreignEngineerProjectId,
      estimate_version_id: foreignEngineerVersionId,
      name: nextSuffix("foreign-project-plan-set"),
      created_by: users.engineer.userId,
    },
  ]);
  await assertNoError("seed plan-set scope fixtures", planSetSeedError);
  trackRow("plan_sets", sameProjectPlanSetId);
  trackRow("plan_sets", foreignProjectPlanSetId);
  const { data: visibleForeignPlanSet, error: visibleForeignPlanSetError } =
    await engineerClient
      .from("plan_sets")
      .select("id")
      .eq("id", foreignProjectPlanSetId)
      .single();
  await assertNoError(
    "engineer SELECT foreign-project plan set",
    visibleForeignPlanSetError
  );
  if (visibleForeignPlanSet?.id !== foreignProjectPlanSetId) {
    throw new Error("Engineer cannot read the cross-project plan-set fixture");
  }

  const crossProjectPlanJobId = randomUUID();
  const { error: crossProjectPlanJobError } = await engineerClient
    .from("takeoff_jobs")
    .insert({
      id: crossProjectPlanJobId,
      tenant_id: seedContext.tenantId,
      estimate_version_id: seedContext.versionId,
      level: "B",
      status: "pending",
      processing_strategy: "sync",
      prompt_version: "rls-e2e-v1",
      plan_set_id: foreignProjectPlanSetId,
      created_by: users.engineer.userId,
    });
  if (crossProjectPlanJobError?.code !== "42501") {
    trackRow("takeoff_jobs", crossProjectPlanJobId);
    throw new Error(
      `Authenticated takeoff job crossed project plan-set scope [${crossProjectPlanJobError?.code ?? "no-code"}]`
    );
  }

  const sameProjectPlanJobId = randomUUID();
  const { error: sameProjectPlanJobError } = await engineerClient
    .from("takeoff_jobs")
    .insert({
      id: sameProjectPlanJobId,
      tenant_id: seedContext.tenantId,
      estimate_version_id: seedContext.versionId,
      level: "B",
      status: "pending",
      processing_strategy: "sync",
      prompt_version: "rls-e2e-v1",
      plan_set_id: sameProjectPlanSetId,
      created_by: users.engineer.userId,
    });
  await assertNoError("insert same-project plan-set takeoff job", sameProjectPlanJobError);
  trackRow("takeoff_jobs", sameProjectPlanJobId);

  const { error: forgedStatusError } = await engineerClient
    .from("takeoff_jobs")
    .update({ status: "processing" })
    .eq("id", jobId)
    .select("id");
  if (forgedStatusError?.code !== "42501") {
    throw new Error(
      `Authenticated takeoff job accepted a worker status transition [${forgedStatusError?.code ?? "no-code"}]`
    );
  }

  const { error: forgedWorkerUpdateError } = await engineerClient
    .from("takeoff_jobs")
    .update({ token_count: 999 })
    .eq("id", jobId)
    .select("id");
  if (forgedWorkerUpdateError?.code !== "42501") {
    throw new Error(
      `Authenticated takeoff job accepted worker metrics [${forgedWorkerUpdateError?.code ?? "no-code"}]`
    );
  }
  const { data: unchangedJob, error: verifyWorkerUpdateError } = await serviceAdmin
    .from("takeoff_jobs")
    .select("id, token_count")
    .eq("id", jobId)
    .single();
  await assertNoError("verify takeoff worker fields remain unchanged", verifyWorkerUpdateError);
  if (unchangedJob?.id !== jobId || unchangedJob.token_count !== null) {
    throw new Error("Rejected takeoff worker-field mutation changed the stored job");
  }

  await assertJobMutationDenied(
    "forged takeoff cancellation metadata",
    jobId,
    { status: "canceled", error_code: "FORGED" }
  );

  const oldTimestamp = new Date(Date.now() - 60_000).toISOString();
  const maxRetryJobId = await seedBoundaryJob({
    status: "failed",
    retry_count: 3,
    completed_at: oldTimestamp,
  });
  await assertJobMutationDenied(
    "takeoff retry beyond budget",
    maxRetryJobId,
    resetJobPayload(3)
  );

  const backoffJobId = await seedBoundaryJob({
    status: "failed",
    retry_count: 0,
    completed_at: new Date().toISOString(),
  });
  await assertJobMutationDenied(
    "takeoff retry before backoff",
    backoffJobId,
    resetJobPayload(0)
  );

  for (const providerState of ["running", "succeeded"] as const) {
    const providerJobId = await seedBoundaryJob({
      status: "failed",
      retry_count: 0,
      completed_at: oldTimestamp,
      processing_strategy: "batch",
      provider_batch_id: `rls-${providerState}-${randomUUID()}`,
      provider_batch_state: providerState,
    });
    await assertJobMutationDenied(
      `takeoff resubmit with ${providerState} provider batch`,
      providerJobId,
      resetJobPayload(0)
    );
  }

  const liveLeaseJobId = await seedBoundaryJob({
    status: "processing",
    processing_strategy: "batch",
    provider_batch_id: `rls-running-${randomUUID()}`,
    provider_batch_state: "running",
    provider_reconcile_due_at: oldTimestamp,
    provider_reconcile_lease_token: randomUUID(),
    provider_reconcile_lease_expires_at: new Date(
      Date.now() + 60_000
    ).toISOString(),
  });
  await assertJobMutationDenied(
    "takeoff reconcile with live lease",
    liveLeaseJobId,
    {
      provider_reconcile_due_at: new Date().toISOString(),
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
    }
  );

  const failedProviderJobId = await seedBoundaryJob({
    status: "failed",
    processing_strategy: "batch",
    provider_batch_id: `rls-failed-${randomUUID()}`,
    provider_batch_state: "failed",
    completed_at: oldTimestamp,
    last_error_at: oldTimestamp,
    error_code: "AI_PROVIDER_ERROR",
    error_message: "provider failed",
  });
  await assertJobMutationDenied(
    "takeoff reconcile after terminal provider failure",
    failedProviderJobId,
    {
      status: "processing",
      completed_at: null,
      next_retry_at: null,
      last_error_at: null,
      error_code: null,
      error_message: null,
      provider_reconcile_due_at: new Date().toISOString(),
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
    }
  );

  const retryJobId = await seedBoundaryJob({
    status: "failed",
    retry_count: 0,
    completed_at: oldTimestamp,
  });
  const { data: retriedJob, error: retryJobError } = await engineerClient
    .from("takeoff_jobs")
    .update(resetJobPayload(0))
    .eq("id", retryJobId)
    .select("id, status, retry_count")
    .single();
  await assertNoError("eligible authenticated takeoff retry", retryJobError);
  if (retriedJob?.status !== "pending" || retriedJob.retry_count !== 1) {
    throw new Error("Eligible authenticated takeoff retry did not persist");
  }

  const reconcileJobId = await seedBoundaryJob({
    status: "processing",
    processing_strategy: "batch",
    provider_batch_id: `rls-reconcile-${randomUUID()}`,
    provider_batch_state: "running",
    provider_reconcile_due_at: oldTimestamp,
    provider_reconcile_attempt_count: 1,
  });
  const { data: reconciledJob, error: reconcileJobError } = await engineerClient
    .from("takeoff_jobs")
    .update({
      provider_reconcile_due_at: new Date().toISOString(),
      provider_reconcile_attempt_count: 1,
      provider_reconcile_lease_token: null,
      provider_reconcile_lease_expires_at: null,
    })
    .eq("id", reconcileJobId)
    .select("id, status, provider_reconcile_attempt_count")
    .single();
  await assertNoError(
    "eligible authenticated takeoff reconcile",
    reconcileJobError
  );
  if (
    reconciledJob?.status !== "processing" ||
    reconciledJob.provider_reconcile_attempt_count !== 1
  ) {
    throw new Error("Eligible authenticated takeoff reconcile did not persist");
  }

  const failedReconcileJobId = await seedBoundaryJob({
    status: "failed",
    processing_strategy: "batch",
    provider_batch_id: `rls-failed-reconcile-${randomUUID()}`,
    provider_batch_state: "running",
    completed_at: oldTimestamp,
    next_retry_at: new Date(Date.now() + 60_000).toISOString(),
    last_error_at: oldTimestamp,
    error_code: "AI_TIMEOUT",
    error_message: "worker timeout",
    provider_reconcile_attempt_count: 2,
  });
  const { data: recoveredReconcileJob, error: recoveredReconcileError } =
    await engineerClient
      .from("takeoff_jobs")
      .update({
        status: "processing",
        completed_at: null,
        next_retry_at: null,
        last_error_at: null,
        error_code: null,
        error_message: null,
        provider_reconcile_due_at: new Date().toISOString(),
        provider_reconcile_attempt_count: 0,
        provider_reconcile_lease_token: null,
        provider_reconcile_lease_expires_at: null,
      })
      .eq("id", failedReconcileJobId)
      .select("id, status, next_retry_at, provider_reconcile_attempt_count")
      .single();
  await assertNoError(
    "eligible failed takeoff reconcile",
    recoveredReconcileError
  );
  if (
    recoveredReconcileJob?.status !== "processing" ||
    recoveredReconcileJob.next_retry_at !== null ||
    recoveredReconcileJob.provider_reconcile_attempt_count !== 0
  ) {
    throw new Error("Eligible failed takeoff reconcile did not clear retry state");
  }

  const pendingItemId = randomUUID();
  const { error: seedPendingItemError } = await serviceAdmin
    .from("takeoff_items")
    .insert({
      id: pendingItemId,
      tenant_id: seedContext.tenantId,
      job_id: jobId,
      result_id: null,
      designation: "Pending RLS fixture",
      quantity: 1,
      unit: "u",
    });
  await assertNoError("seed pending takeoff item", seedPendingItemError);
  trackRow("takeoff_items", pendingItemId);

  const { error: pendingItemUpdateError } = await engineerClient
    .from("takeoff_items")
    .update({ designation: "Pending mutation denied" })
    .eq("id", pendingItemId)
    .select("id");
  if (pendingItemUpdateError?.code !== "42501") {
    throw new Error(
      `Authenticated takeoff item UPDATE ignored parent status [${pendingItemUpdateError?.code ?? "no-code"}]`
    );
  }

  const completedJobId = randomUUID();
  const { error: completedJobError } = await serviceAdmin.from("takeoff_jobs").insert({
    id: completedJobId,
    tenant_id: seedContext.tenantId,
    estimate_version_id: seedContext.versionId,
    level: "A",
    status: "completed",
    processing_strategy: "sync",
    prompt_version: "rls-e2e-v1",
    created_by: users.engineer.userId,
    completed_at: new Date().toISOString(),
  });
  await assertNoError("seed completed takeoff job", completedJobError);
  trackRow("takeoff_jobs", completedJobId);

  const { error: directApplyError } = await engineerClient
    .from("takeoff_jobs")
    .update({ status: "applied" })
    .eq("id", completedJobId)
    .select("id");
  if (directApplyError?.code !== "42501") {
    throw new Error(
      `Authenticated takeoff job bypassed the atomic apply RPC [${directApplyError?.code ?? "no-code"}]`
    );
  }

  const completedItemId = randomUUID();
  const { error: seedCompletedItemError } = await serviceAdmin
    .from("takeoff_items")
    .insert({
      id: completedItemId,
      tenant_id: seedContext.tenantId,
      job_id: completedJobId,
      result_id: null,
      designation: "Completed RLS fixture",
      quantity: 1,
      unit: "u",
    });
  await assertNoError("seed completed takeoff item", seedCompletedItemError);
  trackRow("takeoff_items", completedItemId);

  const { data: updatedItem, error: updateItemError } = await engineerClient
    .from("takeoff_items")
    .update({ designation: "Completed RLS fixture updated" })
    .eq("id", completedItemId)
    .select("id, designation")
    .single();
  await assertNoError("authenticated UPDATE completed takeoff item", updateItemError);
  if (
    updatedItem?.id !== completedItemId ||
    updatedItem.designation !== "Completed RLS fixture updated"
  ) {
    throw new Error("Authenticated completed takeoff item UPDATE did not persist");
  }

  const { error: trustedItemUpdateError } = await engineerClient
    .from("takeoff_items")
    .update({ confidence: 0.99 })
    .eq("id", completedItemId)
    .select("id");
  if (trustedItemUpdateError?.code !== "42501") {
    throw new Error(
      `Authenticated takeoff item accepted trusted-field mutation [${trustedItemUpdateError?.code ?? "no-code"}]`
    );
  }

  const verifiedAt = new Date().toISOString();
  const { data: verifiedItem, error: verifyItemError } = await engineerClient
    .from("takeoff_items")
    .update({
      is_verified: true,
      verified_at: verifiedAt,
      verified_by: users.engineer.userId,
    })
    .eq("id", completedItemId)
    .select("id, is_verified, verified_at, verified_by")
    .single();
  await assertNoError("verify completed takeoff item", verifyItemError);
  if (
    verifiedItem?.is_verified !== true ||
    verifiedItem.verified_by !== users.engineer.userId
  ) {
    throw new Error("Authenticated takeoff item verification did not persist");
  }

  const { data: invalidatedItem, error: invalidateItemError } =
    await engineerClient
      .from("takeoff_items")
      .update({ quantity: 2 })
      .eq("id", completedItemId)
      .select("id, quantity, is_verified, verified_at, verified_by")
      .single();
  await assertNoError(
    "invalidate verification after takeoff content edit",
    invalidateItemError
  );
  if (
    invalidatedItem?.quantity !== 2 ||
    invalidatedItem.is_verified !== false ||
    invalidatedItem.verified_at !== null ||
    invalidatedItem.verified_by !== null
  ) {
    throw new Error("Takeoff content edit kept a stale human verification");
  }

  const draftLockId = randomUUID();
  const { error: draftLockError } = await serviceAdmin.from("draft_locks").insert({
    id: draftLockId,
    tenant_id: seedContext.tenantId,
    user_id: users.engineer.userId,
    version_id: seedContext.versionId,
    session_id: randomUUID(),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  await assertNoError("seed takeoff apply draft lock", draftLockError);
  trackRow("draft_locks", draftLockId);

  const countVersionItems = async () => {
    const { count, error } = await serviceAdmin
      .from("estimate_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", seedContext.tenantId)
      .eq("version_id", seedContext.versionId);
    await assertNoError("count estimate items around takeoff apply", error);
    return count ?? 0;
  };
  const itemCountBeforeLegacyApply = await countVersionItems();
  const { error: legacyApplyError } = await callLooseRpc(
    engineerClient,
    "apply_takeoff_job",
    {
      p_job_id: completedJobId,
      p_strategy: "append",
      p_target_section_id: seedContext.sectionId,
    }
  );
  if (!legacyApplyError) {
    throw new Error(
      "Legacy takeoff apply RPC bypassed its guarded wrapper"
    );
  }
  if ((await countVersionItems()) !== itemCountBeforeLegacyApply) {
    throw new Error("Rejected legacy takeoff apply RPC left partial estimate rows");
  }
  const { data: legacyRejectedJob, error: legacyRejectedJobError } =
    await serviceAdmin
      .from("takeoff_jobs")
      .select("id, status")
      .eq("id", completedJobId)
      .single();
  await assertNoError(
    "verify rejected legacy takeoff apply status",
    legacyRejectedJobError
  );
  if (legacyRejectedJob?.status !== "completed") {
    throw new Error("Rejected legacy takeoff apply RPC changed the job status");
  }

  const { data: guardedApplyData, error: guardedApplyError } =
    await callLooseRpc(engineerClient, "apply_takeoff_job_guarded_atomic", {
      p_job_id: completedJobId,
      p_strategy: "append",
      p_target_section_id: seedContext.sectionId,
      p_mapping_plan: [
        {
          item_id: completedItemId,
          source_order: 0,
          rule_id: null,
          action: "none",
          designation: "Completed RLS fixture updated",
          unit_price_cents: null,
          category_id: null,
          assembly_id: null,
        },
      ],
    });
  await assertNoError("guarded takeoff apply RPC", guardedApplyError);
  const guardedApplySummary = Array.isArray(guardedApplyData)
    ? guardedApplyData[0]
    : guardedApplyData;
  const guardedCreatedIds =
    guardedApplySummary && typeof guardedApplySummary === "object"
      ? (guardedApplySummary as { created_ids?: unknown }).created_ids
      : undefined;
  if (!Array.isArray(guardedCreatedIds) || guardedCreatedIds.length === 0) {
    throw new Error("Guarded takeoff apply RPC returned no created estimate rows");
  }
  for (const createdId of guardedCreatedIds) {
    if (typeof createdId === "string") {
      trackRow("estimate_items", createdId);
    }
  }
  const { data: appliedJob, error: appliedJobError } = await serviceAdmin
    .from("takeoff_jobs")
    .select("id, status")
    .eq("id", completedJobId)
    .single();
  await assertNoError("verify guarded takeoff apply status", appliedJobError);
  if (appliedJob?.status !== "applied") {
    throw new Error("Guarded takeoff apply RPC did not apply the completed job");
  }

  const { data: canceledJob, error: cancelJobError } = await engineerClient
    .from("takeoff_jobs")
    .update({ status: "canceled" })
    .eq("id", jobId)
    .select("id, status, completed_at")
    .single();
  await assertNoError("authenticated UPDATE takeoff job", cancelJobError);
  if (
    canceledJob?.id !== jobId ||
    canceledJob.status !== "canceled" ||
    typeof canceledJob.completed_at !== "string"
  ) {
    throw new Error("Authenticated takeoff job UPDATE did not reach canceled");
  }

  const { data: forbiddenDeleteRows, error: forbiddenDeleteError } = await engineerClient
    .from("takeoff_jobs")
    .delete()
    .eq("id", jobId)
    .select("id");
  await assertNoError("canceled takeoff job DELETE filtered by RLS", forbiddenDeleteError);
  if (Array.isArray(forbiddenDeleteRows) && forbiddenDeleteRows.length > 0) {
    throw new Error("Authenticated operator deleted a non-pending takeoff job");
  }

  const rollbackJobId = randomUUID();
  const { error: rollbackInsertError } = await engineerClient
    .from("takeoff_jobs")
    .insert({
      id: rollbackJobId,
      tenant_id: seedContext.tenantId,
      estimate_version_id: seedContext.versionId,
      level: "A",
      status: "pending",
      processing_strategy: "sync",
      source_file_path: `${seedContext.tenantId}/${rollbackJobId}/rls-fixture.csv`,
      prompt_version: "rls-e2e-v1",
      created_by: users.engineer.userId,
    });
  await assertNoError("insert rollback takeoff job", rollbackInsertError);
  trackRow("takeoff_jobs", rollbackJobId);

  const { data: deletedRollbackJob, error: deleteRollbackError } = await engineerClient
    .from("takeoff_jobs")
    .delete()
    .eq("id", rollbackJobId)
    .select("id")
    .single();
  await assertNoError("authenticated rollback DELETE takeoff job", deleteRollbackError);
  if (deletedRollbackJob?.id !== rollbackJobId) {
    throw new Error("Authenticated rollback DELETE did not remove the pending job");
  }
}

async function assertInactiveTenantBoundaries() {
  const projectId = randomUUID();
  const versionId = randomUUID();
  const portalTokenId = randomUUID();

  const { error: projectError } = await serviceClient
    .from("estimate_projects")
    .insert({
      id: projectId,
      tenant_id: seedContext.tenantId,
      user_id: users.engineer.userId,
      name: nextSuffix("inactive-portal-project"),
    });
  await assertNoError("seed inactive portal project", projectError);
  trackRow("estimate_projects", projectId);

  const { error: versionError } = await serviceClient
    .from("estimate_versions")
    .insert({
      id: versionId,
      tenant_id: seedContext.tenantId,
      project_id: projectId,
      version_number: nextVersionNumber(),
      status: "sent",
      title: nextSuffix("inactive-portal-version"),
    });
  await assertNoError("seed inactive portal version", versionError);
  trackRow("estimate_versions", versionId);

  const { error: tokenError } = await serviceClient.from("portal_tokens").insert({
    id: portalTokenId,
    tenant_id: seedContext.tenantId,
    version_id: versionId,
    email: "inactive-tenant@example.test",
    expires_at: "2099-01-01T00:00:00.000Z",
    status: "pending",
  });
  await assertNoError("seed inactive portal token", tokenError);
  trackRow("portal_tokens", portalTokenId);

  const { data: activeMembership, error: activeMembershipError } =
    await users.engineer.client
      .from("tenant_memberships")
      .select("tenant_id, tenants!inner(is_active)")
      .eq("tenant_id", seedContext.tenantId)
      .eq("user_id", users.engineer.userId)
      .eq("tenants.is_active", true)
      .single();
  await assertNoError("read active tenant membership", activeMembershipError);
  if (activeMembership?.tenant_id !== seedContext.tenantId) {
    throw new Error("Active tenant membership was not visible to its user");
  }

  const { data: ownMembershipRows, error: ownMembershipRowsError } =
    await serviceAdmin
      .from("tenant_memberships")
      .select("id, tenant_id, user_id, role, is_default")
      .in("user_id", Object.values(users).map((user) => user.userId));
  await assertNoError("load default-switch fixtures", ownMembershipRowsError);
  const ownMemberships = (ownMembershipRows ?? []) as Array<{
    id: string;
    tenant_id: string;
    user_id: string;
    role: string;
    is_default: boolean;
  }>;
  const membershipFor = (role: RoleKey, primary: boolean) =>
    ownMemberships.find(
      (membership) =>
        membership.user_id === users[role].userId &&
        (membership.tenant_id === seedContext.tenantId) === primary
    );
  const adminPrimaryMembership = membershipFor("admin", true);
  const adminFallbackMembership = membershipFor("admin", false);
  const engineerFallbackMembership = membershipFor("engineer", false);
  const viewerFallbackMembership = membershipFor("viewer", false);
  if (
    !adminPrimaryMembership ||
    !adminFallbackMembership ||
    !engineerFallbackMembership ||
    !viewerFallbackMembership
  ) {
    throw new Error("Default-switch fixtures are incomplete");
  }

  const { error: deactivateError } = await serviceClient
    .from("tenants")
    .update({ is_active: false })
    .eq("id", seedContext.tenantId);
  await assertNoError("deactivate primary tenant", deactivateError);

  try {
    const { data: hiddenMembership, error: membershipError } =
      await users.engineer.client
        .from("tenant_memberships")
        .select("tenant_id, tenants!inner(is_active)")
        .eq("tenant_id", seedContext.tenantId)
        .eq("user_id", users.engineer.userId)
        .eq("tenants.is_active", true)
        .maybeSingle();
    await assertNoError("read inactive tenant membership", membershipError);
    if (hiddenMembership) {
      throw new Error("Inactive tenant membership remained visible to its user");
    }

    const { data: hiddenTenant, error: tenantError } =
      await users.engineer.client
        .from("tenants")
        .select("id")
        .eq("id", seedContext.tenantId)
        .maybeSingle();
    await assertNoError("read inactive tenant", tenantError);
    if (hiddenTenant) {
      throw new Error("Inactive tenant metadata remained visible to its user");
    }

    const { data: currentTenantId, error: currentTenantError } =
      await users.engineer.client.rpc("current_tenant_id");
    await assertNoError("resolve active fallback tenant", currentTenantError);
    if (currentTenantId === seedContext.tenantId) {
      throw new Error("current_tenant_id returned an inactive tenant");
    }

    const inactiveTargetResult = await callLooseRpc(
      asAnyClient(users.admin.client),
      "set_active_tenant_membership_default",
      { p_membership_id: adminPrimaryMembership.id }
    );
    if (inactiveTargetResult.error?.code !== "42501") {
      throw new Error("Inactive membership became the default tenant");
    }

    const foreignTargetResult = await callLooseRpc(
      asAnyClient(users.admin.client),
      "set_active_tenant_membership_default",
      { p_membership_id: viewerFallbackMembership.id }
    );
    if (foreignTargetResult.error?.code !== "42501") {
      throw new Error("Another user's membership became the default tenant");
    }

    const blockedEngineerSwitch = await callLooseRpc(
      asAnyClient(users.engineer.client),
      "set_active_tenant_membership_default",
      { p_membership_id: engineerFallbackMembership.id }
    );
    if (
      blockedEngineerSwitch.error?.code !== "42501" ||
      blockedEngineerSwitch.error.message !== "TENANT_DEFAULT_SWITCH_FORBIDDEN"
    ) {
      throw new Error("A non-admin historical default did not block tenant switching");
    }

    const adminSwitchResult = await callLooseRpc(
      asAnyClient(users.admin.client),
      "set_active_tenant_membership_default",
      { p_membership_id: adminFallbackMembership.id }
    );
    await assertNoError("switch from inactive admin default", adminSwitchResult.error);
    if (adminSwitchResult.data !== adminFallbackMembership.id) {
      throw new Error("Default-switch RPC returned the wrong membership");
    }

    const { data: adminDefaults, error: adminDefaultsError } =
      await serviceAdmin
        .from("tenant_memberships")
        .select("id")
        .eq("user_id", users.admin.userId)
        .eq("is_default", true);
    await assertNoError("verify atomic default switch", adminDefaultsError);
    if (
      adminDefaults?.length !== 1 ||
      adminDefaults[0]?.id !== adminFallbackMembership.id
    ) {
      throw new Error("Default-switch RPC did not leave exactly one target default");
    }

    const claimResult = await callLooseRpc(
      serviceAdmin,
      "claim_portal_estimate_decision",
      {
        p_portal_token_id: portalTokenId,
        p_decision: "accepted",
        p_client_ip: null,
        p_reject_reason: null,
      }
    );
    if (claimResult.error?.code !== "P0001") {
      throw new Error(
        `Inactive portal claim did not fail closed [${claimResult.error?.code ?? "no-code"}]`
      );
    }

    const [{ data: token }, { data: version }] = await Promise.all([
      serviceClient
        .from("portal_tokens")
        .select("status")
        .eq("id", portalTokenId)
        .single(),
      serviceClient
        .from("estimate_versions")
        .select("status")
        .eq("id", versionId)
        .single(),
    ]);
    if (token?.status !== "pending" || version?.status !== "sent") {
      throw new Error("Inactive portal claim left a partial decision mutation");
    }
  } finally {
    const { error: reactivateError } = await serviceClient
      .from("tenants")
      .update({ is_active: true })
      .eq("id", seedContext.tenantId);
    await assertNoError("reactivate primary tenant", reactivateError);

    const { error: clearAdminDefaultsError } = await serviceAdmin
      .from("tenant_memberships")
      .update({ is_default: false })
      .eq("user_id", users.admin.userId)
      .eq("is_default", true);
    await assertNoError("clear admin default-switch fixture", clearAdminDefaultsError);
    const { error: restoreAdminDefaultError } = await serviceAdmin
      .from("tenant_memberships")
      .update({ is_default: true })
      .eq("id", adminPrimaryMembership.id)
      .eq("user_id", users.admin.userId);
    await assertNoError("restore primary admin default", restoreAdminDefaultError);
  }
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

async function cleanupTenantAuditRows() {
  if (!seedContext) {
    return;
  }
  const { error } = await asAnyClient(serviceClient)
    .from("audit_logs")
    .delete()
    .in("tenant_id", [seedContext.tenantId, seedContext.isolatedTenantId]);
  if (error) {
    throw new Error(
      `Cleanup failed for tenant audit logs [${error.code ?? "no-code"}]: ${error.message ?? "unknown"}`
    );
  }
  createdRows.audit_logs?.clear();
}

async function cleanupTenantFeatureFlags() {
  if (!seedContext) {
    return;
  }
  const { error } = await serviceAdmin
    .from("feature_flags")
    .delete()
    .in("tenant_id", [seedContext.tenantId, seedContext.isolatedTenantId]);
  if (error) {
    throw new Error(
      `Cleanup failed for tenant feature flags [${error.code ?? "no-code"}]: ${error.message ?? "unknown"}`
    );
  }
}

describe.runIf(RLS_E2E_ENABLED)("EST-261 RLS matrix E2E", () => {
  beforeAll(async () => {
    runTag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const supabaseUrl = envValueOrThrow("NEXT_PUBLIC_SUPABASE_URL");
    if (
      process.env.RLS_E2E_LOCAL !== "1" ||
      process.env.RLS_E2E_EPHEMERAL !== "1"
    ) {
      throw new Error(
        "The RLS matrix requires the ephemeral local Supabase runner"
      );
    }
    assertLoopbackSupabaseUrl(supabaseUrl);
    const anonKey = envValueOrThrow("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const serviceRoleKey = envValueOrThrow("SUPABASE_SERVICE_ROLE_KEY");

    const adminEmail = envValueOrThrow("RLS_E2E_ADMIN_EMAIL");
    const adminPassword = envValueOrThrow("RLS_E2E_ADMIN_PASSWORD");
    const engineerEmail = envValueOrThrow("RLS_E2E_ENGINEER_EMAIL");
    const engineerPassword = envValueOrThrow("RLS_E2E_ENGINEER_PASSWORD");
    const viewerEmail = envValueOrThrow("RLS_E2E_VIEWER_EMAIL");
    const viewerPassword = envValueOrThrow("RLS_E2E_VIEWER_PASSWORD");

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
    if (process.env.RLS_E2E_EPHEMERAL !== "1") {
      const cleanupOrder: KnownCleanupTable[] = [
        "takeoff_items",
        "takeoff_jobs",
        "draft_locks",
        "plan_sets",
        "portal_tokens",
        "estimate_items",
        "estimate_suggestion_rules",
        "labor_roles",
        "estimate_categories",
        "estimate_versions",
        "estimate_projects",
      ];

      for (const table of cleanupOrder) {
        await cleanupTrackedRows(table);
      }
      await cleanupTenantAuditRows();
      await cleanupTenantFeatureFlags();
      await cleanupTrackedRows("tenant_memberships");
      await cleanupTrackedRows("tenants");
    }

    const signOutPromises = Object.values(users ?? {}).map(async (user) => {
      await user.client.auth.signOut();
    });
    await Promise.all(signOutPromises);
  }, 120_000);

  it(
    "enforces estimate RLS, governed project deletion and authenticated takeoff writes",
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

      await assertViewerOwnerEstimateMutationsDenied();
      await assertGovernedEstimateProjectDeletes();
      await assertAuthenticatedTakeoffWorkflow();
      await assertInactiveTenantBoundaries();

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
        parent_id: seedContext.isolatedSectionId,
        item_type: "line",
        position: nextPosition(),
        title: nextSuffix("isolated-insert"),
        quantity: 1,
        unit_price_ht_cents: 1000,
        tax_rate_bp: 2000,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: 1,
        k_mo: 1,
        pu_ht_cents: 1000,
        line_total_ht_cents: 1000,
        line_tax_cents: 200,
        line_total_ttc_cents: 1200,
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
