import { getOwnedEstimateVersion } from "@/lib/estimates/version-owner-access";
import { readAllRows } from "@/lib/supabase/read-all";
import { z } from "zod";

import { getAuthenticatedTenantContext as getAuthenticatedContext, type AuthenticatedTenantContext as AuthenticatedContext } from "@/lib/auth/tenant-context";
import type { EstimateOutlierFlagKey } from "@/lib/estimates/outlier-detection";
import { assertDraftLockOwnedByCurrentUser } from "@/lib/estimates/server-context";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  ok,
  toErrorResponse,
} from "@/lib/estimates/errors";

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

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).versionId;
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
  const { data, error } = await readAllRows(() => input.context.supabase
    .from("estimate_item_outlier_dismissals")
    .select("item_id, flag_key, id", { count: "exact" })
    .eq("tenant_id", input.context.tenantId)
    .eq("version_id", input.versionId)
    .order("dismissed_at", { ascending: true }));

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les valeurs atypiques acceptées.");
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

    await getOwnedEstimateVersion(context, versionId);

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

    const { version } = await getOwnedEstimateVersion(context, versionId);

    if (version.status !== "draft") {
      throw forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY");
    }

    await assertDraftLockOwnedByCurrentUser({
      supabase: context.supabase,
      tenantId: context.tenantId,
      userId: context.userId,
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
