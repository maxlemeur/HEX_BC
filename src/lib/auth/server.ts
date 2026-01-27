import { redirect } from "next/navigation";
import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export type UserProfile = {
  id: string;
  full_name: string;
  phone: string | null;
  job_title: string | null;
  work_email: string | null;
  role: "buyer" | "site_manager" | "admin";
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
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, phone, job_title, work_email, role")
    .eq("id", userId)
    .single();

  return (data ?? null) as UserProfile | null;
});

export async function getUserContext() {
  const user = await requireUser();
  const profile = await getUserProfile(user.id);
  return {
    userEmail: user.email ?? "",
    profile,
  };
}
