import "server-only";

import { headers } from "next/headers";

import { canAccessAffaire } from "@/lib/affaires/access-server";
import { assertLocalChatGptHost, hasLocalChatGptPlanAccess, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getChatGptHostId, readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import type { TakeoffResumePlanStatus, TakeoffResumeViewer } from "@/lib/takeoff/operator-state";

type Member = Pick<AuthenticatedTenantContext, "userId" | "tenantRole" | "tenantId">;
type Execution = { hostId: string | null; planStatus: TakeoffResumePlanStatus | null };
type Affaire = { user_id: string; is_archived: boolean };
const KNOWN_ROLES = new Set<string>(["admin", "director", "engineer", "viewer"] satisfies Member["tenantRole"][]);

/**
 * Where a retry started from this request would run, as the admission and the retry command require it: the local
 * ChatGPT runtime on an allowed address, and the member's own connection and model there (a retry runs on the plan of
 * the member who launched the job, who is the only one allowed to start it). Null on the hosted runtime or another
 * address. One read per request, whatever the number of rows.
 */
export async function readTakeoffExecution(member: Pick<Member, "userId" | "tenantId">): Promise<Execution> {
  if (!isLocalChatGptEnabled()) return { hostId: null, planStatus: null };
  let hostId: string;
  try {
    assertLocalChatGptHost((await headers()).get("host"));
    hostId = await getChatGptHostId();
  } catch {
    return { hostId: null, planStatus: null };
  }
  return { hostId, planStatus: await readPlanStatus(member) };
}

async function readPlanStatus(member: Pick<Member, "userId" | "tenantId">): Promise<TakeoffResumePlanStatus> {
  try {
    const store = await readChatGptStore({ userId: member.userId, tenantId: member.tenantId });
    const profile = store.profiles.find((entry) => entry.id === store.selectedId);
    if (!profile || !hasLocalChatGptPlanAccess(profile)) return "disconnected";
    return profile.model ? "ready" : "no_model";
  } catch {
    // An unreadable store is reconnected from Mon profil, as the launch says.
    return "disconnected";
  }
}

/** The member as the resume policy sees them on one affaire. An archived or unknown affaire is written by nobody. */
export function toTakeoffResumeViewer(member: Member, affaire: Affaire | null | undefined, execution: Execution): TakeoffResumeViewer {
  return {
    userId: member.userId,
    tenantRole: member.tenantRole,
    canWriteAffaire: Boolean(affaire && !affaire.is_archived && KNOWN_ROLES.has(member.tenantRole)
      && canAccessAffaire(member, affaire.user_id, "write")),
    executionHostId: execution.hostId,
    planStatus: execution.planStatus,
  };
}

/** The viewer of each affaire of the given jobs, from one read of their affaires: never one read per job. */
export async function readTakeoffResumeViewers(input: {
  supabase: AuthenticatedTenantContext["supabase"];
  tenantId: string;
  member: Pick<Member, "userId" | "tenantRole">;
  projectIds: Array<string | null | undefined>;
}): Promise<(projectId: string | null | undefined) => TakeoffResumeViewer> {
  const projectIds = [...new Set(input.projectIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  const member = { ...input.member, tenantId: input.tenantId };
  const [execution, affaires] = await Promise.all([
    readTakeoffExecution(member),
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
  return (projectId) => toTakeoffResumeViewer(member, projectId ? affaires.get(projectId) : null, execution);
}
