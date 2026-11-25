import "server-only";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { internalError } from "@/lib/http/api-response";

export async function intakeCurrentBriefActive(client = createServiceRoleClient()) {
  const { data, error } = await client.rpc("intake_current_brief_active");
  if (error) throw internalError("Impossible de vérifier le mode d’analyse du dossier.", error);
  return z.boolean().parse(data);
}

/** The caller has established access to this affaire (or holds its worker lease). */
export async function readIntakeBriefState(projectId: string, service = createServiceRoleClient()) {
  const { data, error } = await service.rpc("read_affaire_intake_brief_state", { p_project_id: projectId });
  if (error) throw internalError("Impossible de vérifier les modifications du dossier.", error);
  return z.enum(["legacy", "current", "required"]).parse(data);
}
