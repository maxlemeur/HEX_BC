import "server-only";

import { z } from "zod";

import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { chatGptPreferencesSchema } from "@/lib/ai/chatgpt-model-preferences";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { deriveDeterministicJobId } from "@/lib/takeoff/job-creation-input";
import type { TakeoffExecutionSelection } from "@/lib/takeoff/preparation";

type Service = ReturnType<typeof createServiceRoleClient>;
export type TakeoffPaymentScope = ChatGptOwner & { projectId: string };
export const takeoffApiMandateSchema = chatGptPreferencesSchema.extend({
  connectionId: z.string().uuid(),
  connectionVersion: z.number().int().positive(),
  hostId: z.string(),
  maxTokens: z.number().int().positive(),
  maxNanoUsd: z.number().int().positive(),
});
export type TakeoffApiMandate = z.infer<typeof takeoffApiMandateSchema>;

export function takeoffPaymentError(message: string, jobId?: string) {
  return new TakeoffError({ status: 422, code: TakeoffErrorCode.AI_PROVIDER, retryable: false, jobId, message });
}

export const TAKEOFF_API_CONNECTION_CHANGED =
  "La clé API OpenAI du payeur a été remplacée ou retirée. Les résultats déjà enregistrés sont conservés.";

export function takeoffApiHostId(hostId: string) {
  // Separate queue identity. The immediately preceding runtime only polls its own ChatGPT host.
  return `urn:uuid:${deriveDeterministicJobId(hostId, "takeoff-personal-api-key")}`;
}

export async function assertTakeoffPayer(service: Service, scope: TakeoffPaymentScope) {
  const { data, error } = await service.rpc("takeoff_payer_may_launch", {
    p_tenant_id: scope.tenantId, p_project_id: scope.projectId, p_user_id: scope.userId,
  });
  if (error || data !== true) throw new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false,
    message: "Votre rôle ne permet pas de payer le métré de cette affaire." });
}

export async function readTakeoffApiMandate(service: Service, scope: TakeoffPaymentScope, selection: TakeoffExecutionSelection) {
  const { data, error } = await service.rpc("read_takeoff_api_mandate", {
    p_id: selection.authorizationId ?? "", p_tenant_id: scope.tenantId, p_project_id: scope.projectId, p_payer_id: scope.userId,
  });
  const mandate = takeoffApiMandateSchema.safeParse(data);
  if (error || !mandate.success || mandate.data.hostId !== selection.hostId) {
    throw takeoffPaymentError("Le mandat de paiement du métré n’est plus utilisable. Les résultats déjà enregistrés sont conservés.");
  }
  return mandate.data;
}

export async function assertTakeoffApiConnection(scope: ChatGptOwner, mandate: TakeoffApiMandate) {
  const state = await openAiApiKeyAccess().state(scope);
  if (state.status === "unavailable") throw takeoffPaymentError(state.message);
  if (state.status !== "saved" || state.connection.connectionId !== mandate.connectionId ||
      state.connection.version !== mandate.connectionVersion) {
    throw takeoffPaymentError(TAKEOFF_API_CONNECTION_CHANGED);
  }
}

export function usesTakeoffApiKey(snapshot: unknown): boolean {
  return (snapshot as { execution_selection?: { source?: unknown } } | null)?.execution_selection?.source === "personal_api_key";
}
