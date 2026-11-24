import "server-only";

import { hasLocalChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { getLocalChatGptCredential, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export class IntakePayerAccessLost extends Error {
  constructor() {
    super("Le membre ne peut plus modifier ce dossier.");
  }
}

/** The SQL predicate resolves the member's current active tenant, role, ownership and archive state. */
export async function requireIntakePayerRight(owner: ChatGptOwner | null, projectId: string,
  service = createServiceRoleClient()) {
  if (!owner) throw new IntakePayerAccessLost();
  const { data, error } = await service.rpc("intake_payer_can_write", {
    p_user_id: owner.userId, p_tenant_id: owner.tenantId, p_project_id: projectId,
  });
  if (error) throw new Error("Impossible de vérifier le droit sur le dossier.", { cause: error });
  if (data !== true) throw new IntakePayerAccessLost();
}

export async function hostCanReadIntakeScans(owner: ChatGptOwner) {
  if (!isLocalChatGptEnabled()) return false;
  try {
    if (!await hasLocalChatGptStore(owner)) return false;
    const credential = await getLocalChatGptCredential(owner);
    return Boolean(credential?.authorizationId && credential.model);
  } catch {
    // Withdrawn, expired without a usable refresh token, or unreadable on this host.
    return false;
  }
}
