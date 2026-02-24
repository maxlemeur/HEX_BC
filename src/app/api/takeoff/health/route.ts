import { badRequest, ok, toErrorResponse, unauthorized } from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

async function getActorContext() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw badRequest("Impossible de charger le tenant courant.");
  }

  const tenantId =
    memberships?.[0] && typeof memberships[0].tenant_id === "string"
      ? memberships[0].tenant_id
      : null;

  if (!tenantId) {
    throw unauthorized();
  }

  return {
    supabase,
    tenantId,
  };
}

export async function GET() {
  try {
    const { supabase, tenantId } = await getActorContext();
    await assertTakeoffEnabled(tenantId, { supabase });

    return ok({
      tenant_id: tenantId,
      enabled: true,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
