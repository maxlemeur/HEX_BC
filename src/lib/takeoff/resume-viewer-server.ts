import "server-only";

import { headers } from "next/headers";

import { canAccessAffaire } from "@/lib/affaires/access-server";
import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getChatGptHostId } from "@/lib/ai/chatgpt-local-store";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type { TakeoffResumeViewer } from "@/lib/takeoff/operator-state";

type Member = Pick<AuthenticatedTenantContext, "userId" | "tenantRole">;
type Affaire = { user_id: string; is_archived: boolean };
const KNOWN_ROLES = new Set<string>(["admin", "director", "engineer", "viewer"] satisfies Member["tenantRole"][]);

/**
 * The Mac a retry started from this request would run on: the local ChatGPT runtime on an allowed address, as the
 * admission and the retry command require it. Null on the hosted runtime or another address. One read per request.
 */
export async function readTakeoffExecutionHostId(): Promise<string | null> {
  if (!isLocalChatGptEnabled()) return null;
  try {
    assertLocalChatGptHost((await headers()).get("host"));
    return await getChatGptHostId();
  } catch {
    return null;
  }
}

/** The member as the resume policy sees them on one affaire. An archived or unknown affaire is written by nobody. */
export function toTakeoffResumeViewer(member: Member, affaire: Affaire | null | undefined, executionHostId: string | null): TakeoffResumeViewer {
  return {
    userId: member.userId,
    tenantRole: member.tenantRole,
    canWriteAffaire: Boolean(affaire && !affaire.is_archived && KNOWN_ROLES.has(member.tenantRole)
      && canAccessAffaire(member, affaire.user_id, "write")),
    executionHostId,
  };
}

/** The viewer of each affaire of the given jobs, from one read of their affaires: never one read per job. */
export async function readTakeoffResumeViewers(input: {
  supabase: AuthenticatedTenantContext["supabase"];
  tenantId: string;
  member: Member;
  projectIds: Array<string | null | undefined>;
}): Promise<(projectId: string | null | undefined) => TakeoffResumeViewer> {
  const projectIds = [...new Set(input.projectIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const [executionHostId, affaires] = await Promise.all([
    readTakeoffExecutionHostId(),
    projectIds.length === 0 ? Promise.resolve(new Map<string, Affaire>()) : (async () => {
      const { data, error } = await input.supabase
        .from("estimate_projects")
        .select("id, user_id, is_archived")
        .eq("tenant_id", input.tenantId)
        .in("id", projectIds);
      if (error) {
        throw toTakeoffError(mapSupabaseError(error, "Impossible de vérifier les droits sur l’affaire."), {
          fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false,
        });
      }
      return new Map(((data ?? []) as Array<Affaire & { id: string }>).map((row) => [row.id, row]));
    })(),
  ]);
  return (projectId) => toTakeoffResumeViewer(input.member, projectId ? affaires.get(projectId) : null, executionHostId);
}
