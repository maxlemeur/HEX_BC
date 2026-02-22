import { z } from "zod";

import {
  badRequest,
  forbidden,
  mapSupabaseError,
  toErrorResponse,
  unauthorized,
} from "@/lib/estimates/errors";
import { streamEstimateVersionXlsx } from "@/lib/estimates/export-stream";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
>;

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

function isExportAllowedRole(role: TenantRole) {
  return role === "admin" || role === "engineer";
}

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).versionId;
}

function parseFormat(request: Request) {
  const rawFormat = new URL(request.url).searchParams.get("format");
  if (!rawFormat) return "xlsx";

  const normalized = rawFormat.trim().toLowerCase();
  if (normalized.length === 0 || normalized === "xlsx") return "xlsx";

  throw badRequest("Seul le format xlsx est supporte.");
}

async function assertExportAccess() {
  const supabase = await createSupabaseServerClient();
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

  if (!isExportAllowedRole(membership.role)) {
    throw forbidden("Export reserve aux roles admin et engineer.");
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    parseFormat(request);
    await assertExportAccess();

    const exported = await streamEstimateVersionXlsx(versionId);

    return new Response(exported.stream, {
      status: 200,
      headers: {
        "Content-Type": exported.contentType,
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "X-Export-Progress": exported.progress,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
