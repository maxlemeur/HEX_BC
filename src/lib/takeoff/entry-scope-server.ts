import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";
import { collisionEntrySchema, entryScopeResultSchema, type EntryScopeCommand } from "./entry-scope-contracts";
import { requireReviewer, reviewFailure } from "./item-review-commands-server";

export async function changeEntryScope(projectId: string, itemId: string, command: EntryScopeCommand) {
  const { context } = await requireReviewer(projectId);
  const client = context.supabase as unknown as SupabaseClient<Database>;
  const { data, error } = await client.rpc("change_takeoff_entry_scope", {
    p_tenant_id: context.tenantId, p_project_id: projectId, p_item_id: itemId,
    p_intent_key: command.intent_key, p_action: command.action, p_entry_revision: command.entry_revision,
    ...(command.action === "withdraw" ? { p_plan_entry_revision: 0 }
      : { p_plan_id: command.plan_id, p_plan_entry_revision: command.plan_entry_revision }),
  });
  if (error) reviewFailure(error);
  const collision = z.object({ outcome: z.literal("collision"), entry: collisionEntrySchema }).safeParse(data);
  if (!collision.success) return entryScopeResultSchema.parse(data);
  const entry = collision.data.entry;
  const profile = await client.from("profiles").select("full_name").eq("id", entry.actor_id).maybeSingle();
  if (profile.error) throw mapSupabaseError(profile.error, "Impossible de lire l’auteur de la saisie du plan.");
  return { outcome: "collision" as const, entry: { ...entry, author: profile.data?.full_name?.trim() || "Un membre" } };
}
