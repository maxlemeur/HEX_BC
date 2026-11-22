import "server-only";

import { Resend, type CreateEmailOptions, type ErrorResponse } from "resend";

import { canonicalJsonHash } from "@/lib/email/estimate-email-hash";
import { isOneMailbox, readOutgoingEmailRouting, routeOutgoingEmail } from "@/lib/email/outgoing-routing";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { describeTakeoffRequestEnd } from "@/lib/takeoff/launch-request-coverage";
import type { Database } from "@/types/database";

type Notification = Database["public"]["Tables"]["takeoff_completion_notifications"];
export type CompletionEmailClaim = Pick<Notification["Row"],
  "id" | "tenant_id" | "project_id" | "job_id" | "recipient_email" | "outcome" | "provider_key" | "attempt_count" | "first_send_at"
> & Partial<Pick<Notification["Row"],
  "subject_kind" | "request_id" | "plans_read_count" | "plans_failed_count" | "plans_not_started_count"
>>;

/** The end of a launch request whose notice is sent: its units, those stopped by a member, and whether a member stopped it. */
export type CompletionRequestEnd = { expected: number; canceled: number; stopped: boolean };

type Settlement = Pick<Notification["Update"], "delivery_state" | "last_delivery_code"> &
  Partial<Pick<Notification["Update"],
    "next_attempt_at" | "provider_id" | "first_send_at" | "routing_mode" | "effective_email" | "payload_hash" | "attempt_count"
  >>;

type DeliveryIO = {
  prepare: (mode: "live" | "redirect", effectiveEmail: string, hash: string) => Promise<boolean>;
  /** Milliseconds left, on the database's clock, before the lease ends or the provider forgets the first key; null when either is gone. */
  confirmDispatch: () => Promise<number | null>;
  /** The test the takeoff pages apply: when it fails, the job's page answers 404 and the link goes to the affaire. */
  takeoffEnabled: () => Promise<boolean>;
  /** The request a notice of a launch request tells the end of (final once closed): read for its counts. */
  requestEnd?: () => Promise<CompletionRequestEnd | null>;
  settle: (result: Settlement) => Promise<void>;
  send: (message: CreateEmailOptions, key: string) => Promise<{
    data: { id: string } | null;
    error: Pick<ErrorResponse, "name" | "statusCode"> | null;
  }>;
};

const RETRY_DELAYS_SECONDS = [30, 120, 600, 1_800, 3_600] as const;
const MAX_ATTEMPTS = 8;
// Resend retains the key for 24 hours. Leave time for clock skew and transport.
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1_000;
const SEND_TIMEOUT_MS = 15_000;
// A call starts only if it can end, timeout included, before the lease and the window do.
const DISPATCH_MARGIN_MS = SEND_TIMEOUT_MS + 5_000;
// A sender that stops before the call gives its attempt back and lets the next claim come soon.
const GIVEN_BACK_DELAY_MS = 30_000;

// The end on the affaire's activity, the job's or the request's: every reader of the affaire may open it, and it shows a
// failure's reason. A request's link names it, so that the activity opens on its plans.
function affaireEmailUrl(projectId: string, target: { job: string } | { request: string } | null, origin: string | undefined) {
  if (!origin) throw new Error("Missing takeoff email origin.");
  const url = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("Invalid takeoff email origin.");
  }
  const link = new URL(target ? `/dashboard/affaires/${projectId}/takeoff` : `/dashboard/affaires/${projectId}`, url.origin);
  if (target && "job" in target) link.searchParams.set("job", target.job);
  if (target && "request" in target) link.searchParams.set("request", target.request);
  return link.href;
}

/** What the notice tells: the end of one analysis, or of a request of several plans with its counts. */
function completionWording(claim: CompletionEmailClaim, end: CompletionRequestEnd | null) {
  const complete = claim.outcome === "success";
  const subject = complete ? "Votre métré est terminé"
    : claim.outcome === "partial" ? "Votre métré est terminé en partie" : "Votre métré nécessite une vérification";
  const read = claim.plans_read_count ?? 0;
  const failed = claim.plans_failed_count ?? 0;
  const notStarted = claim.plans_not_started_count ?? 0;
  const expected = end?.expected ?? read + failed + notStarted;
  if (claim.subject_kind === "request" && (expected > 1 || claim.outcome === "partial")) {
    const told = describeTakeoffRequestEnd({ outcome: claim.outcome as Parameters<typeof describeTakeoffRequestEnd>[0]["outcome"],
      expected, read, failed, notStarted, canceled: end?.canceled ?? 0, stopped: end?.stopped ?? false });
    return { subject, summary: `${told} Le suivi du métré dans l’affaire donne l’état et le motif de chaque plan.` };
  }
  return { subject, summary: complete
    ? "Le résultat de votre analyse est disponible dans l’affaire."
    : "Votre analyse n’a pas pu aboutir. Son suivi dans l’affaire en donne le motif." };
}

function retryOrStop(claim: CompletionEmailClaim, now: Date, code: string, mayHaveSent: boolean): Settlement {
  if (claim.attempt_count >= MAX_ATTEMPTS) {
    return { delivery_state: mayHaveSent ? "unknown" : "failed", last_delivery_code: code };
  }
  const delay = RETRY_DELAYS_SECONDS[Math.min(claim.attempt_count - 1, RETRY_DELAYS_SECONDS.length - 1)];
  return {
    delivery_state: "pending",
    last_delivery_code: code,
    next_attempt_at: new Date(now.getTime() + delay * 1_000).toISOString(),
  };
}

export async function deliverTakeoffCompletionEmail(
  claim: CompletionEmailClaim,
  io: DeliveryIO,
  env: Readonly<Record<string, string | undefined>>,
  now: Date,
  clock: () => number = Date.now,
) {
  const alreadyAttempted = claim.first_send_at !== null;
  if (claim.first_send_at && now.getTime() - Date.parse(claim.first_send_at) >= IDEMPOTENCY_WINDOW_MS) {
    await io.settle({ delivery_state: "unknown", last_delivery_code: "IDEMPOTENCY_WINDOW_EXPIRED" });
    return;
  }
  if (!claim.recipient_email || !isOneMailbox(claim.recipient_email)) {
    await io.settle({ delivery_state: "unavailable", last_delivery_code: "RECIPIENT_UNAVAILABLE" });
    return;
  }
  if (claim.attempt_count > MAX_ATTEMPTS) {
    await io.settle({
      delivery_state: alreadyAttempted ? "unknown" : "failed",
      last_delivery_code: "DELIVERY_ATTEMPTS_EXHAUSTED",
    });
    return;
  }

  let request: CreateEmailOptions;
  let routingMode: "live" | "redirect";
  let effectiveEmail: string;
  let fingerprint: string;
  try {
    const from = env.EMAIL_FROM?.trim();
    if (!from || !env.RESEND_API_KEY?.trim()) throw new Error("Missing Resend configuration.");
    const requestId = claim.subject_kind === "request" && claim.request_id ? claim.request_id : null;
    const target = claim.job_id ? { job: claim.job_id } : requestId ? { request: requestId } : null;
    const jobPage = target && await io.takeoffEnabled() ? target : null;
    const link = affaireEmailUrl(claim.project_id, jobPage, env.MERGEONE_TAKEOFF_EMAIL_ORIGIN);
    const { subject, summary } = completionWording(claim, requestId ? await io.requestEnd?.() ?? null : null);
    const routing = readOutgoingEmailRouting(env);
    const routed = routeOutgoingEmail(routing, { to: claim.recipient_email, subject });
    routingMode = routing.mode;
    effectiveEmail = routed.to;
    request = {
      from,
      to: routed.to,
      subject: routed.subject,
      text: `${summary}\n\n${jobPage ? "Ouvrir le suivi du métré" : "Ouvrir l’affaire"}\n${link}`,
    };
    // Include the provider configuration in the fingerprint because changing
    // Resend accounts can change the namespace of the idempotency key.
    fingerprint = canonicalJsonHash([request, env.RESEND_BASE_URL ?? null, env.RESEND_API_KEY.trim()]);
  } catch {
    await io.settle(retryOrStop(claim, now, "DELIVERY_CONFIGURATION_UNAVAILABLE", alreadyAttempted));
    return;
  }

  if (!(await io.prepare(routingMode, effectiveEmail, fingerprint))) return;
  // A sender can stop for any length of time after prepare. At the moment of sending, the database checks again that
  // it still holds its lease and that the provider still keeps the first attempt's key; the call then starts only
  // while enough of both remains, by this process's clock read before that check.
  const checkedAt = clock();
  const remainingMs = await io.confirmDispatch();
  if (remainingMs === null) return;
  if (clock() + DISPATCH_MARGIN_MS > checkedAt + remainingMs) {
    // Too little lease is left to finish a call: none is made, and the attempt is given back. An attempt counts only
    // when the provider is called, or when a sender stops without being able to give it back.
    await io.settle({
      delivery_state: "pending", last_delivery_code: "DISPATCH_WINDOW_TOO_SHORT", attempt_count: claim.attempt_count - 1,
      next_attempt_at: new Date(clock() + GIVEN_BACK_DELAY_MS).toISOString(),
    });
    return;
  }
  let response: Awaited<ReturnType<DeliveryIO["send"]>>;
  try {
    response = await io.send(request, claim.provider_key);
  } catch {
    await io.settle(retryOrStop(claim, now, "PROVIDER_OUTCOME_UNKNOWN", true));
    return;
  }
  if (response.data?.id) {
    await io.settle({ delivery_state: "sent", provider_id: response.data.id, last_delivery_code: null });
  } else if (response.error?.name === "invalid_idempotent_request") {
    await io.settle({ delivery_state: "unknown", last_delivery_code: "PROVIDER_IDEMPOTENCY_CONFLICT" });
  } else if (response.error?.name === "rate_limit_exceeded") {
    const retry = retryOrStop(claim, now, "PROVIDER_RATE_LIMITED", alreadyAttempted);
    await io.settle(alreadyAttempted ? retry : {
      ...retry, first_send_at: null, routing_mode: null, effective_email: null, payload_hash: null,
    });
  } else if (response.error?.statusCode && [400, 401, 403, 404, 422].includes(response.error.statusCode)) {
    await io.settle({
      delivery_state: alreadyAttempted ? "unknown" : "failed", last_delivery_code: "PROVIDER_REJECTED",
    });
  } else {
    await io.settle(retryOrStop(claim, now, "PROVIDER_OUTCOME_UNKNOWN", true));
  }
}

export async function drainTakeoffCompletionEmails(options: { id?: string; limit?: number } = {}) {
  const client = createServiceRoleClient();
  const limit = options.id ? 1 : Math.max(1, Math.min(options.limit ?? 5, 20));
  let claimed = 0;
  for (let i = 0; i < limit; i += 1) {
    const { data, error } = await client.rpc("claim_takeoff_completion_email", { p_id: options.id });
    if (error) throw new Error("Impossible de réserver le courriel de métré.");
    const row = data?.[0];
    if (!row?.lease_token) break;
    claimed += 1;

    await deliverTakeoffCompletionEmail(row, {
      async prepare(mode, effectiveEmail, hash) {
        const { data, error } = await client.rpc("prepare_takeoff_completion_email", {
          p_id: row.id,
          p_lease_token: row.lease_token!,
          p_routing_mode: mode,
          p_effective_email: effectiveEmail,
          p_payload_hash: hash,
        });
        if (error) throw new Error("Impossible de vérifier le destinataire du courriel de métré.");
        return data === true;
      },
      async confirmDispatch() {
        const { data, error } = await client.rpc("confirm_takeoff_completion_email_dispatch", {
          p_id: row.id,
          p_lease_token: row.lease_token!,
        });
        if (error) throw new Error("Impossible de vérifier l’envoi du courriel de métré.");
        return typeof data === "number" ? data : null;
      },
      takeoffEnabled: () => isTakeoffEnabled(row.tenant_id, { supabase: client }),
      async requestEnd() {
        if (!row.request_id) return null;
        const { data, error } = await client.from("takeoff_launch_requests").select("units_expected, units_canceled, stop_requested_at")
          .eq("id", row.request_id).eq("tenant_id", row.tenant_id).maybeSingle();
        if (error) throw new Error("Impossible de lire la fin du métré.");
        return data && data.units_expected !== null
          ? { expected: data.units_expected, canceled: data.units_canceled, stopped: data.stop_requested_at !== null } : null;
      },
      async settle(result) {
        const { error } = await client.from("takeoff_completion_notifications")
          .update({ next_attempt_at: null, ...result, lease_token: null, lease_expires_at: null })
          .eq("id", row.id).eq("lease_token", row.lease_token!)
          .gt("lease_expires_at", new Date().toISOString());
        if (error) throw new Error("Impossible d’enregistrer la livraison du courriel de métré.");
      },
      send: (message, key) => new Resend(process.env.RESEND_API_KEY?.trim()).emails.send(message, {
        idempotencyKey: key,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      }),
    }, process.env, new Date(), Date.now);
  }
  return claimed;
}
