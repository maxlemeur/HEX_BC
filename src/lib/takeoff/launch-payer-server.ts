import "server-only";

import { formatUsdCeiling } from "@/lib/ai/access/openai-pricing";
import { readLocalChatGptSubscription, type LocalChatGptSubscription } from "@/lib/ai/chatgpt-takeoff";
import type { AuthenticatedTenantContext as Context } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import { describeTakeoffLaunchReason, isTakeoffLaunchReason, TAKEOFF_AUTOMATIC_PAYER_NOTICE,
  type TakeoffLaunchReason, type TakeoffLaunchRequestState } from "@/lib/takeoff/launch-request";
import { describeTakeoffLaunchAction, viewerLaunchAction, type TakeoffLaunchAction } from "@/lib/takeoff/operator-state";
import type { TakeoffPaymentChoice } from "@/lib/takeoff/payment-choice";
import { resolveTakeoffPayment } from "@/lib/takeoff/payment-server";
import type { TakeoffExecutionSelection } from "@/lib/takeoff/preparation";
import type { Json } from "@/types/database";

type Service = ReturnType<typeof createServiceRoleClient>;

export function databaseError(error: { code?: string; message: string }, message: string): never {
  throw mapSupabaseError({ ...error, code: error.code ?? "UNKNOWN" }, message);
}

export function selectionParameters(subscription: LocalChatGptSubscription | { issue: "MANDATE_REQUIRED"; selection: null }) {
  return subscription.selection
    ? { p_host: subscription.selection.hostId, p_selection: subscription.selection as unknown as Json }
    : { p_blocked_reason: subscription.issue };
}

/** The member's subscription on this Mac when the one payer rule lets them pay on the affaire; never read otherwise. */
export async function readPayerSubscription(service: Service, context: Context, projectId: string, host: string | null | undefined) {
  const { data: mayPay, error } = await service.rpc("takeoff_payer_may_launch", {
    p_tenant_id: context.tenantId, p_project_id: projectId, p_user_id: context.userId });
  if (error) databaseError(error, "Impossible de vérifier qui peut payer le métré de cette affaire.");
  if (mayPay !== true) return { issue: "MANDATE_REQUIRED" as const, selection: null };
  return readLocalChatGptSubscription({ userId: context.userId, tenantId: context.tenantId }, host);
}

export type GestureRow = { request_id: string | null; state: string | null; reason_code: string | null; payer_id: string | null };

/** What a gesture leaves: the request, its state and its reason in French, and the gesture it now allows this member. */
export type TakeoffLaunchGestureResult = {
  requestId: string; state: TakeoffLaunchRequestState; reason: TakeoffLaunchReason | null; message: string | null;
  action: TakeoffLaunchAction; actionLabel: string | null;
};
export async function gestureResult(service: Service, row: GestureRow, actorId: string, hasLocalRuntime: boolean): Promise<TakeoffLaunchGestureResult | null> {
  if (!row.request_id || !row.state) return null;
  const reason = isTakeoffLaunchReason(row.reason_code) ? row.reason_code : null;
  const { data: allowed, error } = await service.rpc("takeoff_launch_request_action", { p_request_id: row.request_id, p_actor: actorId });
  if (error) databaseError(error, "Impossible de lire le métré de l’affaire.");
  const action = viewerLaunchAction(allowed, hasLocalRuntime, row.state, row.reason_code);
  return { requestId: row.request_id, state: row.state as TakeoffLaunchRequestState, reason,
    message: reason ? describeTakeoffLaunchReason(reason) : null, action, actionLabel: describeTakeoffLaunchAction(action) };
}

/**
 * The payer notice of the brief's confirmation, for the member whose subscription the analysis will use: its text and
 * the digest the confirmation carries back (the member, both cut-offs and the subscription and settings it was shown
 * with on this Mac). None when the member may not pay, before both cut-offs or with the module off. A read that fails
 * throws: it is never taken for « no notice ».
 */
export function payerNoticeDigest(service: Service, scope: { tenantId: string; projectId: string; userId: string },
  selection: TakeoffExecutionSelection | null) {
  return service.rpc("takeoff_payer_notice", {
    p_tenant_id: scope.tenantId, p_project_id: scope.projectId, p_actor: scope.userId,
    p_selection: selection as unknown as Json, p_module_default: takeoffModuleDefault(),
  });
}

export async function readAutomaticTakeoffPayerNotice(context: Context, project: { id: string }, host?: string | null,
  paymentChoice?: TakeoffPaymentChoice) {
  const service = createServiceRoleClient();
  const scope = { ...context, projectId: project.id };
  const explicit = paymentChoice ? await resolveTakeoffPayment(scope, paymentChoice, service, false) : null;
  const subscription = explicit ? { issue: null, selection: explicit.selection }
    : await readPayerSubscription(service, context, project.id, host);
  if (subscription.issue === "MANDATE_REQUIRED") return null;
  const { data, error } = await payerNoticeDigest(service, scope, subscription.selection);
  if (error) databaseError(error, "Impossible de vérifier qui paiera les appels du métré.");
  if (typeof data !== "string") return null;
  if (explicit?.apiMandate) {
    const ceiling = formatUsdCeiling(explicit.apiMandate.maxNanoUsd);
    return { message: `Vous autorisez le métré à utiliser votre clé API OpenAI, avec un plafond de ${ceiling}.`, digest: data };
  }
  return { message: TAKEOFF_AUTOMATIC_PAYER_NOTICE, digest: data };
}

/**
 * The one rule of the notice the confirmation dialog shows, read when it opens: only for a brief to confirm, read now
 * under the member's own session, then as readAutomaticTakeoffPayerNotice gives it. The dialog sends back the digest of
 * what it showed; a brief that reached the page after its render is read here, not taken from that render.
 */
export async function readBriefConfirmationPayerNotice(context: Context, project: { id: string }, host?: string | null, paymentChoice?: TakeoffPaymentChoice) {
  const { data, error } = await context.supabase.from("affaire_briefs").select("status")
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).maybeSingle();
  if (error) databaseError(error, "Impossible de lire le brief de l’affaire.");
  if ((data as { status?: string } | null)?.status !== "a_confirmer") return null;
  return readAutomaticTakeoffPayerNotice(context, project, host, paymentChoice);
}
