"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  getCurrentMembershipOrThrow,
  normalizeNullableText,
} from "@/lib/affaires/import-flow-server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const updateAffaireProjectMetadataSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  projectName: z.string().trim().min(1, "Nom projet requis.").max(200),
  clientName: z.string().trim().max(200).nullable().optional(),
  reference: z.string().trim().max(200).nullable().optional(),
});

export type UpdateAffaireProjectMetadataInput = z.infer<
  typeof updateAffaireProjectMetadataSchema
>;

function ensureEngineerOrAdmin(role: string) {
  if (role !== "engineer" && role !== "admin") {
    throw new Error("Acces refuse: role non autorise pour cette action.");
  }
}

export async function updateAffaireProjectMetadataAction(
  input: UpdateAffaireProjectMetadataInput
) {
  const parsed = updateAffaireProjectMetadataSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentification requise.");
  }

  const membership = await getCurrentMembershipOrThrow(supabase, user.id);
  ensureEngineerOrAdmin(membership.role);
  const isTenantAdmin = membership.role === "admin";

  let query = supabase
    .from("estimate_projects")
    .update({
      name: parsed.projectName.trim(),
      client_name: normalizeNullableText(parsed.clientName),
      reference: normalizeNullableText(parsed.reference),
    })
    .eq("id", parsed.projectId)
    .eq("tenant_id", membership.tenant_id)
    .eq("is_archived", false);

  if (!isTenantAdmin) {
    query = query.eq("user_id", user.id);
  }

  const { data, error } = await query
    .select("id, name, client_name, reference")
    .maybeSingle();

  if (error) {
    throw new Error("Impossible de mettre a jour les informations affaire.");
  }

  if (!data) {
    throw new Error("Affaire introuvable ou non autorisee.");
  }

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);
  revalidatePath("/dashboard/estimates");

  return {
    projectId: data.id,
    projectName: data.name,
    clientName: data.client_name,
    reference: data.reference,
  };
}
