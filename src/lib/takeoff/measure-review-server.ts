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
const rowSchema = z.object({ id: uuid.nullable(), observation_id: uuid, updated_at: z.string().nullable(), anomalies: z.array(z.string()),
  verified_by: uuid.nullable(), justification: verificationJustificationReadSchema.nullable(),
  rule_results: z.array(z.object({ status: z.string(), reason: z.string() })).nullable() });

const rawReview = measureReviewSchema.omit({ rows: true, previously_retained: true, retained: true }).extend({
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
  const ids = rows.flatMap(row => row.id ? [row.id] : []);
  const [history, decision, profiles, details] = await Promise.all([
    client.from("takeoff_item_review_events").select("command_id,after").eq("tenant_id", context.tenantId)
      .eq("project_id", projectId).eq("answer_id", answerId).eq("event", "accepted").contains("after", { individual: true })
      .order("at", { ascending: false }).limit(1).maybeSingle(),
    client.from("takeoff_item_answer_decisions").select("revision,kind,command_id").eq("tenant_id", context.tenantId)
      .eq("project_id", projectId).eq("answer_id", answerId).maybeSingle(),
    selectInChunks(authors, chunk => client.from("profiles").select("id,full_name").in("id", chunk)),
    selectInChunks(ids, chunk => client.from("takeoff_items").select("id,updated_at,source_page,evidence,quantity,unit,confidence")
      .eq("tenant_id", context.tenantId).in("id", chunk)),
  ]);
  const failure = history.error ?? decision.error ?? profiles.error ?? details.error;
  if (failure) throw mapSupabaseError(failure, "Impossible de lire le suivi de la mesure.");
  if ((decision.data?.revision ?? 0) !== review.decision_revision) throw conflict(measureRefusals.answer_changed);
  const names = new Map(profiles.data.map(profile => [profile.id, profile.full_name]));
  const currentRows = new Map(details.data.map(row => [row.id, row]));
  const recorded = review.reason === "already_decided" && decision.data?.kind === "accepted"
    && history.data && decision.data.command_id === history.data.command_id ? history.data.after : null;
  const retained = recorded ? z.object({ quantity: z.number(), unit: z.string() }).parse(recorded) : null;
  return measureReviewSchema.parse({ ...review, previously_retained: !!history.data, retained,
    rows: rows.map(row => {
      const current = row.id ? currentRows.get(row.id) : null;
      // The RPC includes the row edit token in the acknowledgement revision. Rule-only writes have a separate
      // clock: controls and justifications below are taken directly from the RPC.
      if (row.id && (!current || current.updated_at !== row.updated_at)) throw conflict(measureRefusals.answer_changed);
      return {
        id: row.id, observation_id: row.observation_id, page: current?.source_page ?? null,
        evidence: current?.evidence ?? null, quantity: current?.quantity ?? null,
        unit: current?.unit ?? null, confidence: current?.confidence ?? null,
        failures: (row.rule_results ?? []).filter(rule => rule.status === "fail").map(rule => rule.reason),
        justification: justificationText(row.justification),
        author: row.verified_by ? names.get(row.verified_by) || "Un membre" : null,
        needs_justification: rows_to_justify.includes(row.id ?? ""),
        low_confidence: row.anomalies.includes("low_confidence"),
      };
    }) });
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
