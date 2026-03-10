import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth/server";

import type { CockpitCommandPreference } from "@/lib/cockpit/suggestions";

type CockpitPreferenceRow = {
  action_id: string;
  is_hidden: boolean;
  is_pinned: boolean;
};

function isMissingCockpitPreferencesTableError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42P01"
  );
}

export async function fetchCockpitCommandPreferences(
  projectId: string,
): Promise<CockpitCommandPreference[]> {
  const { tenantId, profile } = await getUserContext();
  if (!tenantId || !profile) {
    return [];
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("cockpit_command_preferences" as never)
    .select("action_id, is_hidden, is_pinned")
    .eq("tenant_id", tenantId)
    .eq("user_id", profile.id)
    .eq("project_id", projectId);

  if (error) {
    if (isMissingCockpitPreferencesTableError(error)) {
      return [];
    }
    throw error;
  }

  return ((data ?? []) as CockpitPreferenceRow[]).map((row) => ({
    actionId: row.action_id,
    isHidden: row.is_hidden,
    isPinned: row.is_pinned,
  }));
}

export async function upsertCockpitCommandPreference(input: {
  projectId: string;
  actionId: string;
  isHidden: boolean;
  isPinned: boolean;
}) {
  const { tenantId, profile } = await getUserContext();
  if (!tenantId || !profile) {
    return;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("cockpit_command_preferences" as never)
    .upsert(
      {
        tenant_id: tenantId,
        user_id: profile.id,
        project_id: input.projectId,
        action_id: input.actionId,
        is_hidden: input.isHidden,
        is_pinned: input.isPinned,
      } as never,
      {
        onConflict: "tenant_id,user_id,project_id,action_id",
      },
    );

  if (error) {
    if (isMissingCockpitPreferencesTableError(error)) {
      return;
    }
    throw error;
  }
}
