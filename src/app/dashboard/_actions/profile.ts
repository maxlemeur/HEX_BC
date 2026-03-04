"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UI_MODE_VALUES, normalizeUiMode, type UiMode } from "@/lib/ui-mode";

const updateProfileUiModeSchema = z.object({
  mode: z.enum(UI_MODE_VALUES),
});

type UpdateProfileUiModeInput = {
  mode: UiMode;
};

export async function updateProfileUiMode(input: UpdateProfileUiModeInput) {
  const parsed = updateProfileUiModeSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Mode d'interface invalide.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentification requise.");
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ ui_mode: parsed.data.mode })
    .eq("id", user.id)
    .select("ui_mode")
    .single();

  if (error || !data) {
    throw new Error("Impossible de mettre a jour le mode d'interface.");
  }

  revalidatePath("/dashboard");

  return {
    mode: normalizeUiMode(data.ui_mode),
  };
}
