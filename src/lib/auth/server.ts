import { redirect } from "next/navigation";
import { cache } from "react";

import { readActiveTenantMembership, readAuthenticatedUser } from "@/lib/auth/tenant-context";
import type { UserProfile } from "@/lib/auth/user-context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUiMode } from "@/lib/ui-mode";

export const getSupabase = cache(async () => createSupabaseServerClient());

export const requireUser = cache(async () => {
  const { user } = await readAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }

  return user;
});

export const getUserProfile = cache(async (userId: string) => {
  const supabase = await getSupabase();
  const [{ data: profileData }, { membership, error: membershipError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, phone, job_title, work_email, role, ui_mode")
      .eq("id", userId)
      .single(),
    readActiveTenantMembership(supabase, userId),
  ]);

  if (!profileData) {
    return null;
  }

  if (membershipError) {
    console.error("Unable to resolve active tenant membership", {
      code: membershipError.code,
    });
  }

  return {
    ...profileData,
    ui_mode: normalizeUiMode(profileData.ui_mode),
    tenant_id: membership?.tenant_id ?? null,
    tenant_role: membership?.role ?? null,
  } as UserProfile;
});

export async function getUserContext() {
  const user = await requireUser();
  const profile = await getUserProfile(user.id);
  return {
    userEmail: user.email ?? "",
    profile,
    tenantId: profile?.tenant_id ?? null,
  };
}
