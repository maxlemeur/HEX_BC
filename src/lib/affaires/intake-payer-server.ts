import "server-only";
import { z } from "zod";

import { hasLocalChatGptStore, readChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { getLocalChatGptCredential, hasLocalChatGptPlanAccess, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
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

export async function readLaunchConnection(uploadId: string, service = createServiceRoleClient()) {
  const { data, error } = await service.rpc("read_affaire_intake_launch_selection", { p_upload_id: uploadId });
  if (error) throw new Error("Impossible de vérifier la connexion du lancement.", { cause: error });
  return z.object({ profileId: z.string().min(1), authorizationId: z.string().min(1) }).nullable().parse(data);
}

export async function selectedIntakeConnection(owner: ChatGptOwner) {
  if (!isLocalChatGptEnabled()) return null;
  try {
    if (!await hasLocalChatGptStore(owner)) return null;
    const credential = await getLocalChatGptCredential(owner);
    return credential?.authorizationId && credential.model ? { profileId: credential.profileId, authorizationId: credential.authorizationId } : null;
  } catch {
    // Withdrawn, expired without a usable refresh token, or unreadable on this host.
    return null;
  }
}

export async function hostCanReadIntakeScans(owner: ChatGptOwner) {
  return Boolean(await selectedIntakeConnection(owner));
}

/** The explicit plan settings can outlive later profile model/effort changes. */
export async function readSelectedIntakePlanConnection(owner: ChatGptOwner) {
  if (!isLocalChatGptEnabled()) return null;
  const store = await readChatGptStore(owner).catch(() => null);
  const profile = store?.profiles.find((entry) => entry.id === store.selectedId);
  return profile?.authorizationId && hasLocalChatGptPlanAccess(profile)
    ? { profileId: profile.id, authorizationId: profile.authorizationId } : null;
}
