import { NextResponse } from "next/server";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { apiFailure, toErrorResponse } from "@/lib/http/api-response";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseOptionalText(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseLimit(value: string | null) {
  if (!value) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function isValidUuid(value: string) {
  return UUID_REGEX.test(value);
}

export async function GET(request: Request) {
  let context;
  try {
    context = await getAuthenticatedTenantContext();
  } catch (error) {
    return toErrorResponse(error);
  }

  const { supabase, tenantId } = context;

  const { searchParams } = new URL(request.url);
  const tableName = parseOptionalText(searchParams.get("table_name"));
  const estimateVersionId = parseOptionalText(
    searchParams.get("estimate_version_id")
  );
  const limit = parseLimit(searchParams.get("limit"));

  if (limit === null) {
    return apiFailure(400, "BAD_REQUEST", "Invalid limit. Use a positive integer.");
  }

  if (estimateVersionId && !isValidUuid(estimateVersionId)) {
    return apiFailure(400, "BAD_REQUEST", "Invalid estimate_version_id. Must be a UUID.");
  }

  let query = supabase
    .from("audit_logs")
    .select(
      "id, created_at, user_id, table_name, record_id, estimate_version_id, action, before_data, after_data"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (tableName) {
    query = query.eq("table_name", tableName);
  }

  if (estimateVersionId) {
    query = query.eq("estimate_version_id", estimateVersionId);
  }

  const { data, error } = await query;

  if (error) {
    const normalized = (error.message ?? "").toLowerCase();
    if (normalized.includes("row-level security")) {
      return apiFailure(403, "FORBIDDEN", "Forbidden");
    }
    console.error("Unable to fetch audit logs", error);
    return apiFailure(500, "INTERNAL_ERROR", "Impossible de charger le journal d’audit.");
  }

  return NextResponse.json({
    data: data ?? [],
    meta: {
      count: data?.length ?? 0,
      limit,
      filters: {
        table_name: tableName,
        estimate_version_id: estimateVersionId,
      },
      order: "created_at.desc",
    },
  });
}
