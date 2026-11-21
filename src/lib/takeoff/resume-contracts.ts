import { z } from "zod";

import { TAKEOFF_RESUME_ACTIONS, TAKEOFF_RESUME_REASONS } from "@/lib/takeoff/operator-state";
import { takeoffResponseTimestampSchema as timestamp } from "@/lib/takeoff/response-contracts";

const action = z.enum(TAKEOFF_RESUME_ACTIONS).describe(
  "Ce que le membre peut faire de l’analyse arrêtée : retry_now (la soumettre à nouveau), wait_retry (attendre la reprise programmée ou "
  + "la fin du délai), new_analysis (préparer une nouvelle analyse), none (rien).",
);
const reason = z.enum(TAKEOFF_RESUME_REASONS).describe(
  "La règle qui a décidé, à afficher en français (jamais le code) : not_stopped, legacy_provider, retry_limit, analysis_closed, "
  + "outcome_unknown, retry_scheduled, budget_exhausted, read_only, launched_by_other, execution_unavailable, other_mac, "
  + "plan_disconnected, plan_model_missing, retry_delay, retry_available.",
);
const availableAt = timestamp.nullable().describe("Pour une attente : l’échéance de la reprise programmée ou de la fin du délai.");

/** The resume decision on a job summary (detail, list of jobs, answer of an action). */
export const takeoffJobResumeResponseSchema = z.object({ action, reason, available_at: availableAt })
  .describe("Décision de reprise, la même que la liste de l’affaire et que la commande de nouvelle soumission.");

/** The same decision on a row of the affaire's activity. */
export const takeoffActivityResumeSchema = z.object({ action, reason, availableAt })
  .describe("Décision de reprise, la même que le détail de l’analyse et que la commande de nouvelle soumission.");
