import "server-only";

import { createHash } from "node:crypto";

import type { AiBillingSource } from "@/lib/ai/access/contracts";
import { getChatGptHostId, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { readAiRequestOptions, resolveAiRequest } from "@/lib/ai/request-settings-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getTakeoffLevelCProcessingConfigForTenant } from "@/lib/takeoff/feature-flags";
import { deriveDeterministicJobId } from "@/lib/takeoff/job-creation-input";
import { TAKEOFF_NANO_USD_PER_CENT, takeoffPaymentChoiceSchema, type TakeoffPaymentChoice } from "@/lib/takeoff/payment-choice";
import { assertTakeoffPayer, takeoffPaymentHostId, takeoffApiMandateSchema, takeoffPaymentError, takeoffPaymentSettingsChanged,
  type TakeoffApiMandate, type TakeoffPaymentScope } from "@/lib/takeoff/payment-mandate-server";
import type { TakeoffExecutionSelection } from "@/lib/takeoff/preparation";
import type { ChatGptPreferences } from "@/lib/ai/chatgpt-model-preferences";

type Service = ReturnType<typeof createServiceRoleClient>;
const policy = { allowedSources: ["chatgpt_plan", "personal_api_key"] } as const;

export function takeoffSelectionFingerprint(selection: TakeoffExecutionSelection) {
  return createHash("sha256").update(JSON.stringify([selection.profileId, selection.hostId, selection.model,
    selection.reasoningEffort, selection.authorizationId ?? null, ...(selection.source ? [selection.source] : [])])).digest("hex");
}

export async function readTakeoffPaymentOptions(scope: TakeoffPaymentScope) {
  const service = createServiceRoleClient();
  await assertTakeoffPayer(service, scope);
  const [{ defaultSource, options }, { readLocalChatGptSubscription }, budget] = await Promise.all([
    readAiRequestOptions(scope, policy), import("@/lib/ai/chatgpt-takeoff"),
    getTakeoffLevelCProcessingConfigForTenant(scope.tenantId, { supabase: service }),
  ]);
  const plan = await readLocalChatGptSubscription(scope);
  return { defaultSource, options, chatGptConnectionId: plan.selection?.authorizationId ?? null, maxCostCents: budget.maxCostCents };
}

/** Resolve inside the authenticated gesture. Only the opaque mandate reference goes in public snapshots. */
export async function resolveTakeoffPayment(scope: TakeoffPaymentScope, input: TakeoffPaymentChoice, service: Service,
  persist = true): Promise<{ selection: TakeoffExecutionSelection & { authorizationId: string; source: AiBillingSource };
    preferences: ChatGptPreferences; apiMandate?: TakeoffApiMandate }> {
  const choice = takeoffPaymentChoiceSchema.parse(input);
  await assertTakeoffPayer(service, scope);
  const { expectedConnectionId, expectedMaxCostCents, ...settings } = choice;
  const resolved = await resolveAiRequest(scope, policy, settings);
  if (!resolved.ok) throw takeoffPaymentSettingsChanged(resolved.message);
  if (resolved.source === "chatgpt_plan") {
    const { readLocalChatGptSubscription } = await import("@/lib/ai/chatgpt-takeoff");
    const plan = await readLocalChatGptSubscription(scope, undefined, resolved.preferences);
    if (!plan.selection || plan.selection.authorizationId !== expectedConnectionId) {
      throw takeoffPaymentSettingsChanged("La connexion ChatGPT a changé. Rechargez les réglages du métré.");
    }
    return { selection: { ...plan.selection, source: "chatgpt_plan", hostId: takeoffPaymentHostId(plan.selection.hostId) }, preferences: resolved.preferences };
  }
  if (resolved.connection?.id !== expectedConnectionId) {
    throw takeoffPaymentSettingsChanged("La connexion OpenAI a changé. Rechargez les réglages du métré.");
  }
  const config = await getTakeoffLevelCProcessingConfigForTenant(scope.tenantId, { supabase: service });
  if (expectedMaxCostCents !== config.maxCostCents) {
    throw takeoffPaymentSettingsChanged("Le plafond du métré a changé. Rechargez les réglages du métré avant de confirmer.");
  }
  const mandate = takeoffApiMandateSchema.parse({ ...resolved.preferences, connectionId: resolved.connection.id,
    connectionVersion: resolved.connection.version, hostId: takeoffPaymentHostId(await getChatGptHostId()),
    maxTokens: config.maxTotalTokens, maxNanoUsd: expectedMaxCostCents * TAKEOFF_NANO_USD_PER_CENT });
  // The exact same object produces the same brief-notice digest at preview and confirmation.
  const id = deriveDeterministicJobId(scope.tenantId, JSON.stringify([scope.projectId.toLowerCase(), scope.userId, mandate]));
  if (persist) {
    const { error } = await service.rpc("seal_takeoff_api_mandate", {
      p_id: id, p_tenant_id: scope.tenantId, p_project_id: scope.projectId, p_payer_id: scope.userId, p_settings: mandate,
    });
    if (error) throw takeoffPaymentError("Impossible d’enregistrer le mandat de paiement du métré.");
  }
  return { selection: { source: "personal_api_key", profileId: id, authorizationId: id, hostId: mandate.hostId,
    model: "personal_api_key", reasoningEffort: null }, preferences: resolved.preferences, apiMandate: mandate };
}

export async function assertTakeoffPaymentMatches(owner: ChatGptOwner, projectId: string,
  snapshot: unknown, choice?: TakeoffPaymentChoice) {
  if (!choice) return;
  const { selection } = await resolveTakeoffPayment({ ...owner, projectId }, choice, createServiceRoleClient(), false);
  const pinned = (snapshot as { execution_selection?: TakeoffExecutionSelection } | null)?.execution_selection;
  if (!pinned || takeoffSelectionFingerprint(pinned) !== takeoffSelectionFingerprint(selection)) {
    throw takeoffPaymentSettingsChanged("Confirmez de nouveau la préparation avec les réglages de paiement que vous avez choisis.");
  }
}
