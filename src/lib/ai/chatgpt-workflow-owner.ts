import "server-only";

import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import type { AffaireIntakeClaim } from "@/lib/workflows/affaire-intake-lifecycle";

/** A durable claim supplies tenant/work identity; HTTP cookies never select its plan. */
export async function resolveChatGptIntakeOwner(supabase: ServerSupabaseClient, claim: AffaireIntakeClaim): Promise<ChatGptOwner | null> {
  const { data: upload, error } = await supabase.from("affaire_intake_uploads")
    .select("created_by").eq("id", claim.uploadId).eq("tenant_id", claim.tenantId)
    .eq("project_id", claim.projectId).maybeSingle();
  if (error || !upload?.created_by) return null;
  const { data: membership, error: membershipError } = await supabase.from("tenant_memberships")
    .select("user_id, tenants!inner(is_active)").eq("user_id", upload.created_by)
    .eq("tenant_id", claim.tenantId).eq("tenants.is_active", true).maybeSingle();
  if (membershipError || !membership) return null;
  return { userId: upload.created_by, tenantId: claim.tenantId };
}
