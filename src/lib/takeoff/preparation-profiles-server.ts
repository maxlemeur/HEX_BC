import "server-only";

import { z } from "zod";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { takeoffPreparationProfileSchema, type TakeoffPreparationProfile } from "@/lib/takeoff/preparation";
import { preparationConflict } from "@/lib/takeoff/preparation-repository";
import { readAllRows } from "@/lib/supabase/read-all";
import type { Json } from "@/types/database";

export async function loadTakeoffPreparationProfiles() {
  const context = await getAuthenticatedContext();
  const { data, error } = await readAllRows(() => context.supabase.from("takeoff_preparation_profiles" as never)
    .select("profile" as never, { count: "exact" }).eq("tenant_id" as never, context.tenantId as never).order("name" as never));
  if (error) throw mapSupabaseError(error, "Impossible de charger les profils de préparation.");
  return (data as Array<{ profile: unknown }> ?? []).map((row) => takeoffPreparationProfileSchema.parse(row.profile));
}

export async function saveTakeoffPreparationProfile(input: { profile: TakeoffPreparationProfile; expectedVersion: number | null }) {
  const profile = takeoffPreparationProfileSchema.parse(input.profile);
  z.string().uuid().parse(profile.id);
  z.number().int().positive().nullable().parse(input.expectedVersion);
  const context = await getAuthenticatedContext();
  if (context.tenantRole !== "admin" && context.tenantRole !== "engineer") {
    throw new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, message: "Votre rôle ne permet pas de modifier un profil métier.", retryable: false });
  }
  const nextProfile = { ...profile, version: (input.expectedVersion ?? 0) + 1 };
  const row = {
    id: profile.id, tenant_id: context.tenantId, name: profile.name, version: nextProfile.version,
    profile: nextProfile as unknown as Json, updated_by: context.userId,
  };
  const server = createServiceRoleClient();
  let query;
  if (input.expectedVersion === null) {
    query = server.from("takeoff_preparation_profiles" as never).insert({ ...row, created_by: context.userId } as never);
  } else {
    query = server.from("takeoff_preparation_profiles" as never).update(row as never)
      .eq("tenant_id" as never, context.tenantId as never).eq("id" as never, profile.id as never)
      .eq("version" as never, input.expectedVersion as never);
    if (context.tenantRole !== "admin") query = query.eq("created_by" as never, context.userId as never);
  }
  const { data, error } = await query.select("id" as never).maybeSingle();
  if (error?.code === "23505" || (!error && !data)) preparationConflict("Ce profil a changé ou vous ne pouvez pas le modifier. Rechargez les profils.");
  if (error) throw mapSupabaseError(error, "Impossible d'enregistrer le profil métier.");
  return nextProfile;
}
