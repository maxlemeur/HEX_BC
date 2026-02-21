import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { EstimateOutlierFlagKey } from "@/lib/estimates/outlier-detection";
import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  ok,
  toErrorResponse,
  unauthorized,
} from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
>;
type EmbeddedProjectAccess = Pick<
  Database["public"]["Tables"]["estimate_projects"]["Row"],
  "id" | "tenant_id" | "user_id"
>;
type VersionAccessRow = Pick<
  Database["public"]["Tables"]["estimate_versions"]["Row"],
  "id" | "tenant_id" | "status"
> & {
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

type OutlierDismissalRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  version_id: string;
  item_id: string;
  flag_key: EstimateOutlierFlagKey;
  dismissed_by: string;
  dismissed_at: string;
};

type OutlierDismissalInsert = {
  tenant_id: string;
  version_id: string;
  item_id: string;
  flag_key: EstimateOutlierFlagKey;
  dismissed_by: string;
  dismissed_at: string;
};

type OutlierDismissalsTable = {
  Row: OutlierDismissalRow;
  Insert: OutlierDismissalInsert;
  Update: Partial<OutlierDismissalInsert>;
  Relationships: [];
};

type DatabaseWithOutlierDismissals = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      estimate_item_outlier_dismissals: OutlierDismissalsTable;
    };
  };
};

type Supabase = SupabaseClient<DatabaseWithOutlierDismissals>;

type AuthenticatedContext = {
  supabase: Supabase;
  userId: string;
  tenantId: string;
  tenantRole: TenantRole;
};

const TENANT_ADMIN_ROLE: TenantRole = "admin";
const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

const toggleDismissSchema = z.object({
  item_id: z.string().uuid("item_id invalide."),
  flag_key: z.enum(["price_outlier", "quantity_outlier"]),
  dismissed: z.boolean(),
});

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

function resolveEmbeddedOne<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function isTenantAdmin(tenantRole: TenantRole) {
  return tenantRole === TENANT_ADMIN_ROLE;
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    isTenantAdmin(input.context.tenantRole)
  );
}

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).versionId;
}

async function getAuthenticatedContext(): Promise<AuthenticatedContext> {
  const rawSupabase = await createSupabaseServerClient();
  const supabase = rawSupabase as unknown as Supabase;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
  }

  const membership = memberships?.[0] as TenantMembershipRow | undefined;

  if (!membership?.tenant_id || !membership.role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    tenantRole: membership.role,
  };
}

async function getVersionAccessOrThrow(
  context: AuthenticatedContext,
  versionId: string
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await context.supabase
    .from("estimate_versions")
    .select("id, tenant_id, status, estimate_projects!inner(id, tenant_id, user_id)")
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const version = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(version.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version,
    project,
  };
}

async function resolveLockOwnerName(supabase: Supabase, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;

  const fullName = typeof data.full_name === "string" ? data.full_name.trim() : "";
  return fullName.length > 0 ? fullName : null;
}

async function assertDraftLockOwnedByCurrentUser(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data: lock, error } = await input.context.supabase
    .from("draft_locks")
    .select("id, version_id, user_id, locked_at, expires_at")
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de verifier le verrou de brouillon.");
  }

  if (!lock) {
    throw conflict(
      "Un verrou actif est requis pour modifier cette version brouillon.",
      {
        lock: null,
      },
      "LOCK_REQUIRED"
    );
  }

  if (lock.user_id === input.context.userId) {
    return;
  }

  const holderName = await resolveLockOwnerName(input.context.supabase, lock.user_id);

  throw conflict("Cette version est deja verrouillee par un autre utilisateur.", {
    lock: {
      version_id: lock.version_id,
      user_id: lock.user_id,
      holder_name: holderName,
      locked_at: lock.locked_at,
      expires_at: lock.expires_at,
      is_owner: false,
    },
  });
}

function buildDismissedMap(
  rows: Pick<OutlierDismissalRow, "item_id" | "flag_key">[]
) {
  const map: Record<string, EstimateOutlierFlagKey[]> = {};

  rows.forEach((row) => {
    const current = map[row.item_id] ?? [];
    if (current.includes(row.flag_key)) return;
    map[row.item_id] = [...current, row.flag_key];
  });

  return map;
}

async function loadDismissedByItemId(input: {
  context: AuthenticatedContext;
  versionId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_item_outlier_dismissals")
    .select("item_id, flag_key")
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .order("dismissed_at", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les outliers acceptes.");
  }

  return buildDismissedMap(
    (data ?? []) as Pick<OutlierDismissalRow, "item_id" | "flag_key">[]
  );
}

async function assertItemBelongsToVersion(input: {
  context: AuthenticatedContext;
  versionId: string;
  itemId: string;
}) {
  const { data, error } = await input.context.supabase
    .from("estimate_items")
    .select("id, item_type")
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .eq("id", input.itemId)
    .single();

  if (error || !data) {
    throw badRequest("item_id invalide.");
  }

  if (data.item_type !== "line") {
    throw badRequest("item_id doit correspondre a une ligne de devis.");
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const context = await getAuthenticatedContext();

    await getVersionAccessOrThrow(context, versionId);

    return ok({
      dismissed_by_item_id: await loadDismissedByItemId({
        context,
        versionId,
      }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const body = toggleDismissSchema.parse(await parseJsonBody(request));
    const context = await getAuthenticatedContext();

    const { version } = await getVersionAccessOrThrow(context, versionId);

    if (version.status !== "draft") {
      throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
    }

    await assertDraftLockOwnedByCurrentUser({
      context,
      versionId,
    });

    await assertItemBelongsToVersion({
      context,
      versionId,
      itemId: body.item_id,
    });

    if (body.dismissed) {
      const payload: OutlierDismissalInsert = {
        tenant_id: context.tenantId,
        version_id: versionId,
        item_id: body.item_id,
        flag_key: body.flag_key,
        dismissed_by: context.userId,
        dismissed_at: new Date().toISOString(),
      };

      const { error } = await context.supabase
        .from("estimate_item_outlier_dismissals")
        .upsert(payload, {
          onConflict: "version_id,item_id,flag_key",
        });

      if (error) {
        throw mapSupabaseError(error, "Impossible d'enregistrer l'acceptation de l'outlier.");
      }
    } else {
      const { error } = await context.supabase
        .from("estimate_item_outlier_dismissals")
        .delete()
        .eq("tenant_id", context.tenantId)
        .eq("version_id", versionId)
        .eq("item_id", body.item_id)
        .eq("flag_key", body.flag_key);

      if (error) {
        throw mapSupabaseError(error, "Impossible de reactiver l'outlier.");
      }
    }

    return ok({
      dismissed_by_item_id: await loadDismissedByItemId({
        context,
        versionId,
      }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
