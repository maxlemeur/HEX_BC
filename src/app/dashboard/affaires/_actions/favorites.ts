"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserContext } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const toggleAffaireFavoriteSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  isFavorite: z.boolean(),
});

export async function toggleAffaireFavoriteAction(input: {
  projectId: string;
  isFavorite: boolean;
}) {
  const parsed = toggleAffaireFavoriteSchema.parse(input);
  const { tenantId, profile } = await getUserContext();

  if (!tenantId || !profile) {
    throw new Error("Authentification requise.");
  }

  const supabase = await createSupabaseServerClient();

  if (parsed.isFavorite) {
    const { error } = await supabase
      .from("user_favorite_projects" as never)
      .upsert(
        {
          tenant_id: tenantId,
          user_id: profile.id,
          project_id: parsed.projectId,
        } as never,
        { onConflict: "tenant_id,user_id,project_id" },
      );

    if (error) {
      throw new Error("Impossible d'ajouter l'affaire aux favoris.");
    }
  } else {
    const { error } = await supabase
      .from("user_favorite_projects" as never)
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", profile.id)
      .eq("project_id", parsed.projectId);

    if (error) {
      throw new Error("Impossible de retirer l'affaire des favoris.");
    }
  }

  revalidatePath("/dashboard/affaires");

  return { ok: true };
}
