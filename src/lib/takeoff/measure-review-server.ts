import "server-only";

import { selectInChunks } from "@/lib/supabase/in-chunks";
import { z } from "zod";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { conflict, mapSupabaseError, notFound } from "@/lib/http/api-response";
import { measureReviewSchema, measureReasonSchema, measureRefusals, retainedMeasureSchema, type retainCommandSchema } from "./measure-review-contracts";
import { requireReviewer, reviewFailure } from "./item-review-commands-server";
import { AREA_PRINTED_REASONS, SCALE_DIMENSION_REASONS, VERIFICATION_REASONS, RETAINED_SURFACE_BASES,
  verificationJustificationReadSchema } from "./rules/verification";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const uuid = z.string().uuid();
const rowSchema = z.object({ id: uuid.nullable(), observation_id: uuid, anomalies: z.array(z.string()),
  verified_by: uuid.nullable(), justification: verificationJustificationReadSchema.nullable(),
  rule_results: z.array(z.object({ status: z.string(), reason: z.string() })).nullable() });

const rawReview = measureReviewSchema.omit({ rows: true, previously_retained: true }).extend({
  rows: z.array(rowSchema), rows_to_justify: z.array(uuid),
}).strip();

function label(labels: Readonly<Record<string, string>>, code?: string) {
  return code ? labels[code] : undefined;
}

function justificationText(value: z.infer<typeof verificationJustificationReadSchema> | null) {
  return [label(VERIFICATION_REASONS, value?.reason_code), value?.system_reference,
    label(SCALE_DIMENSION_REASONS, value?.scale_dimension?.reason_code), value?.scale_dimension?.note,
    label(AREA_PRINTED_REASONS, value?.area_printed?.reason_code), label(RETAINED_SURFACE_BASES, value?.area_printed?.retained_basis),
    value?.area_printed?.note].filter((text): text is string => !!text);
}

export async function readMeasureReview(projectId: string, answerId: string) {
  const { context } = await requireAffaireAccess(projectId, "read");
  const client = context.supabase as unknown as SupabaseClient<Database>;
  const { data, error } = await client.rpc("read_takeoff_measure_review", {
    p_tenant_id: context.tenantId, p_project_id: projectId, p_answer_id: answerId,
  });
  if (error?.code === "P0002") throw notFound("Réponse du poste introuvable.");
  if (error) reviewFailure(error);
  if (z.object({ reason: z.literal("answer_changed") }).safeParse(data).success) throw conflict(measureRefusals.answer_changed);
  const { rows, rows_to_justify, ...review } = rawReview.parse(data);
  const authors = [...new Set(rows.flatMap(row => row.verified_by ? [row.verified_by] : []))];
  const [history, profiles] = await Promise.all([
    client.from("takeoff_item_review_events").select("id").eq("tenant_id", context.tenantId)
      .eq("project_id", projectId).eq("answer_id", answerId).eq("event", "accepted").contains("after", { individual: true }).limit(1),
    selectInChunks(authors, chunk => client.from("profiles").select("id,full_name").in("id", chunk)),
  ]);
  if (history.error || profiles.error) throw mapSupabaseError((history.error ?? profiles.error)!, "Impossible de lire le suivi de la mesure.");
  const names = new Map(profiles.data?.map(profile => [profile.id, profile.full_name]));
  return measureReviewSchema.parse({ ...review, previously_retained: !!history.data?.length,
    rows: rows.map(row => ({ id: row.id, observation_id: row.observation_id, failures: (row.rule_results ?? [])
      .filter(rule => rule.status === "fail").map(rule => rule.reason), justification: justificationText(row.justification),
      author: row.verified_by ? names.get(row.verified_by) || "Un membre" : null,
      needs_justification: rows_to_justify.includes(row.id ?? ""), low_confidence: row.anomalies.includes("low_confidence") })) });
}

export async function retainMeasure(projectId: string, answerId: string, command: z.infer<typeof retainCommandSchema>) {
  const { context } = await requireReviewer(projectId);
  const { data, error } = await (context.supabase as unknown as SupabaseClient<Database>).rpc("retain_takeoff_measure", {
    p_tenant_id: context.tenantId, p_project_id: projectId, p_answer_id: answerId, p_intent_key: command.intent_key,
    p_acknowledgement: command.acknowledgement,
  });
  if (error?.code === "P0002") throw notFound("Réponse du poste introuvable.");
  if (error) reviewFailure(error);
  if (z.object({ outcome: z.literal("stale") }).safeParse(data).success) throw conflict(measureRefusals.answer_changed);
  const refusal = z.object({ outcome: z.literal("refused"), reason: measureReasonSchema }).safeParse(data);
  if (refusal.success) throw conflict(measureRefusals[refusal.data.reason]);
  return retainedMeasureSchema.parse(data);
}
