import {
  readActiveTenantMembership,
  readAuthenticatedUser,
} from "@/lib/auth/tenant-context";
import { badRequest, ok, toErrorResponse, unauthorized } from "@/lib/estimates/errors";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

async function getActorContext() {
  const { supabase, user, error: userError } = await readAuthenticatedUser();

  if (userError || !user) {
    throw unauthorized();
  }

  const { membership, error: membershipError } =
    await readActiveTenantMembership(supabase, user.id);

  if (membershipError) {
    throw badRequest("Impossible de charger le tenant courant.");
  }

  const tenantId = membership?.tenant_id ?? null;

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
