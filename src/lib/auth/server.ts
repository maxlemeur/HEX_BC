import { redirect } from "next/navigation";
import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUiMode, type UiMode } from "@/lib/ui-mode";
import type { Database } from "@/types/database";

export type UserProfile = {
  id: string;
  full_name: string;
  phone: string | null;
  job_title: string | null;
  work_email: string | null;
  role: "buyer" | "site_manager" | "admin";
  ui_mode: UiMode;
  tenant_id: string | null;
  tenant_role: Database["public"]["Enums"]["tenant_role"] | null;
};

export const getSupabase = cache(async () => createSupabaseServerClient());

export const requireUser = cache(async () => {
  const supabase = await getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return user;
});

export const getUserProfile = cache(async (userId: string) => {
  const supabase = await getSupabase();
  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, full_name, phone, job_title, work_email, role, ui_mode")
    .eq("id", userId)
    .single();

  if (!profileData) {
    return null;
  }

  const { data: membershipData } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  const membership = membershipData?.[0] ?? null;

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
