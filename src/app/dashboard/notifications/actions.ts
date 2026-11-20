"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";

export async function markTakeoffCompletionRead(form: FormData) {
  const id = z.string().uuid().safeParse(form.get("notificationId"));
  if (!id.success) return;
  const { supabase } = await getAuthenticatedTenantContext();
  const { error } = await supabase.rpc("mark_takeoff_completion_notification_read", { p_id: id.data });
  if (error) throw mapSupabaseError(error, "Impossible de marquer cette notification comme lue.");
  revalidatePath("/dashboard/notifications");
}
