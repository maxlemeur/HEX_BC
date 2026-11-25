import "server-only";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import type { AffaireIntakeClaim } from "@/lib/workflows/affaire-intake-lifecycle";

/** A durable claim supplies tenant/work identity; HTTP cookies never select its plan. */
export async function resolveChatGptIntakeOwner(supabase: ServerSupabaseClient, claim: AffaireIntakeClaim): Promise<ChatGptOwner | null> {
  let payerId = claim.launch?.payerId;
  if (!claim.launch) {
    const { data, error } = await supabase.from("affaire_intake_uploads")
      .select("created_by").eq("id", claim.uploadId).eq("tenant_id", claim.tenantId)
      .eq("project_id", claim.projectId).maybeSingle();
    if (error) return null;
    payerId = data?.created_by;
  }
  if (!payerId) return null;
  const { data: membership, error: membershipError } = await supabase.from("tenant_memberships")
    .select("user_id, tenants!inner(is_active)").eq("user_id", payerId)
    .eq("tenant_id", claim.tenantId).eq("tenants.is_active", true).maybeSingle();
  if (membershipError || !membership) return null;
  return { userId: payerId, tenantId: claim.tenantId };
}
