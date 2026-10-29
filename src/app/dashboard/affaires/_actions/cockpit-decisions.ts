"use server";

import { z } from "zod";

import { fetchAffaireIntakeWorkspace, requireAffaireProjectOwnerOrAdmin } from "@/lib/affaires/intake-server";
import { fetchAffaireRegisterSummary } from "@/lib/affaires/register-server";
import { fetchAffaireHubPlansSummary, fetchAffaireHubSummary } from "@/lib/affaires/server";
import { getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { suggestCockpitNextAction, fingerprintCockpitCandidates, type CockpitDecisionSuggestion } from "@/lib/cockpit/decision-assistance";
import { readCockpitDecisionFingerprint } from "@/lib/cockpit/decision-freshness";
import { fetchCockpitCommandPreferences } from "@/lib/cockpit/preferences";
import { computeCockpitSuggestions } from "@/lib/cockpit/suggestions";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const inputSchema = z.object({ projectId: z.uuid(), candidateIds: z.array(z.string().min(1).max(100)).max(40) }).strict();

export async function suggestCockpitNextActionAction(input: { projectId: string; candidateIds: string[] }): Promise<CockpitDecisionSuggestion> {
  const parsed = inputSchema.parse(input);
  const { context } = await requireAffaireProjectOwnerOrAdmin(parsed.projectId);
  const capability = getOpenAiDecisionsCapability();
  if (capability.status !== "available") return { status: "unavailable", action_id: null, message: capability.message, request_fingerprint: null };
  const before = await readCockpitDecisionFingerprint(context, parsed.projectId);
  const stale = (): CockpitDecisionSuggestion => ({ status: "to_review", action_id: null, request_fingerprint: null,
    message: "Le dossier, la version ou vos préférences ont changé. Rechargez le cockpit avant de demander un nouveau conseil." });
  if (!before) return stale();
  const [summary, intakeWorkspace, preferences, takeoffEnabled] = await Promise.all([
    fetchAffaireHubSummary(parsed.projectId), fetchAffaireIntakeWorkspace(parsed.projectId),
    fetchCockpitCommandPreferences(parsed.projectId), isTakeoffEnabled(context.tenantId),
  ]);
  const [plansSummary, registerSummary] = await Promise.all([
    takeoffEnabled ? fetchAffaireHubPlansSummary(parsed.projectId) : Promise.resolve(null),
    fetchAffaireRegisterSummary({ projectId: parsed.projectId, versionId: summary.currentVersion?.id ?? null }),
  ]);
  const suggestions = computeCockpitSuggestions({ projectId: parsed.projectId, takeoffEnabled,
    isReadOnlyReview: context.tenantRole === "director", plansSummary, registerSummary,
    // Approval/AI draft projections are not needed to advise dossier preparation.
    approvalSummary: null, intakeWorkspace, versionZeroSummary: null,
    currentVersion: summary.currentVersion, structureMode: summary.structureMode, lineCount: summary.lineCount, preferences,
  }).filter((suggestion) => parsed.candidateIds.includes(suggestion.actionId));
  const result = await suggestCockpitNextAction({ owner: { tenantId: context.tenantId, userId: context.userId },
    projectId: parsed.projectId, suggestions, evidenceFingerprint: `${before}:${fingerprintCockpitCandidates(suggestions)}` });
  const after = await readCockpitDecisionFingerprint(context, parsed.projectId);
  return after === before ? result : stale();
}
