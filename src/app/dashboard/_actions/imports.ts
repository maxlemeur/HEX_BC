"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role"
>;

const linkImportToProjectSchema = z.object({
  importId: z.string().uuid("importId invalide."),
  projectId: z.string().uuid("projectId invalide.").nullable().optional(),
});

type LinkImportToProjectInput = {
  importId: string;
  projectId?: string | null;
};

async function getCurrentMembershipOrThrow(
  userId: string
): Promise<TenantMembershipRow> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    throw new Error("Impossible de charger le tenant courant.");
  }

  const membership = data?.[0] as TenantMembershipRow | undefined;
  if (!membership) {
    throw new Error("Aucun tenant actif pour cet utilisateur.");
  }

  return membership;
}

export async function linkImportToProject(input: LinkImportToProjectInput) {
  const parsed = linkImportToProjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Payload de liaison invalide.");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Authentification requise.");
  }

  const membership = await getCurrentMembershipOrThrow(user.id);
  const projectId = parsed.data.projectId ?? null;
  const isTenantAdmin = membership.role === "admin";

  if (projectId) {
    let projectQuery = supabase
      .from("estimate_projects")
      .select("id")
      .eq("id", projectId)
      .eq("tenant_id", membership.tenant_id)
      .eq("is_archived", false);

    if (!isTenantAdmin) {
      projectQuery = projectQuery.eq("user_id", user.id);
    }

    const { data: project, error: projectError } = await projectQuery.maybeSingle();
    if (projectError) {
      throw new Error("Impossible de verifier le projet cible.");
    }
    if (!project) {
      throw new Error("Projet cible introuvable ou non autorise.");
    }
  }

  let updateQuery = supabase
    .from("dpgf_imports")
    .update({ project_id: projectId })
    .eq("id", parsed.data.importId)
    .eq("tenant_id", membership.tenant_id);

  if (!isTenantAdmin) {
    updateQuery = updateQuery.eq("user_id", user.id);
  }

  const { data, error } = await updateQuery.select("id, project_id").maybeSingle();
  if (error) {
    throw new Error("Impossible de lier l'import au projet.");
  }
  if (!data) {
    throw new Error("Import introuvable ou non autorise.");
  }

  revalidatePath("/dashboard/imports");
  if (projectId) {
    revalidatePath(`/dashboard/affaires/${projectId}`);
  }

  return {
    importId: data.id,
    projectId: data.project_id,
  };
}
