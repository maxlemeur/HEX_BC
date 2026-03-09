import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/server";

export async function recordCockpitCommand(input: {
  projectId: string;
  actionId: string;
  intent: string;
}): Promise<void> {
  const { tenantId, profile } = await getUserContext();
  if (!tenantId || !profile) return;

  const supabase = await createSupabaseServerClient();
  await supabase.from("cockpit_command_history" as never).insert({
    tenant_id: tenantId,
    user_id: profile.id,
    project_id: input.projectId,
    action_id: input.actionId,
    intent: input.intent,
  } as never);
}
