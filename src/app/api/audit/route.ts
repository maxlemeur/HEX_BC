import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tableName = parseOptionalText(searchParams.get("table_name"));
  const estimateVersionId = parseOptionalText(
    searchParams.get("estimate_version_id")
  );
  const limit = parseLimit(searchParams.get("limit"));

  if (limit === null) {
    return NextResponse.json(
      { error: "Invalid limit. Use a positive integer." },
      { status: 400 }
    );
  }

  if (estimateVersionId && !isValidUuid(estimateVersionId)) {
    return NextResponse.json(
      { error: "Invalid estimate_version_id. Must be a UUID." },
      { status: 400 }
    );
  }

  let query = supabase
    .from("audit_logs")
    .select(
      "id, created_at, user_id, table_name, record_id, estimate_version_id, action, before_data, after_data"
    )
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: error.message ?? "Unable to fetch audit logs." },
      { status: 500 }
    );
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
