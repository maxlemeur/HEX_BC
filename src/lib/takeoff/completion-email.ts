import "server-only";

import { Resend, type CreateEmailOptions, type ErrorResponse } from "resend";

import { canonicalJsonHash } from "@/lib/email/estimate-email-hash";
import { isOneMailbox, readOutgoingEmailRouting, routeOutgoingEmail } from "@/lib/email/outgoing-routing";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

type Notification = Database["public"]["Tables"]["takeoff_completion_notifications"];
export type CompletionEmailClaim = Pick<Notification["Row"],
  "id" | "project_id" | "recipient_email" | "outcome" | "provider_key" | "attempt_count" | "first_send_at"
>;

type Settlement = Pick<Notification["Update"], "delivery_state" | "last_delivery_code"> &
  Partial<Pick<Notification["Update"],
    "next_attempt_at" | "provider_id" | "first_send_at" | "routing_mode" | "effective_email" | "payload_hash"
  >>;

type DeliveryIO = {
  prepare: (mode: "live" | "redirect", effectiveEmail: string, hash: string) => Promise<boolean>;
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

function affaireEmailUrl(projectId: string, origin: string | undefined) {
  if (!origin) throw new Error("Missing takeoff email origin.");
  const url = new URL(origin);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("Invalid takeoff email origin.");
  }
  return new URL(`/dashboard/affaires/${projectId}`, url.origin).href;
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
    const link = affaireEmailUrl(claim.project_id, env.MERGEONE_TAKEOFF_EMAIL_ORIGIN);
    const complete = claim.outcome === "success";
    const subject = complete ? "Votre métré est terminé" : "Votre métré nécessite une vérification";
    const summary = complete
      ? "Le résultat de votre analyse est disponible dans l’affaire."
      : "Votre analyse n’a pas pu aboutir. Consultez l’affaire pour connaître le motif.";
    const routing = readOutgoingEmailRouting(env);
    const routed = routeOutgoingEmail(routing, { to: claim.recipient_email, subject });
    routingMode = routing.mode;
    effectiveEmail = routed.to;
    request = {
      from,
      to: routed.to,
      subject: routed.subject,
      text: `${summary}\n\nOuvrir l’affaire\n${link}`,
    };
    // Include the provider configuration in the fingerprint because changing
    // Resend accounts can change the namespace of the idempotency key.
    fingerprint = canonicalJsonHash([request, env.RESEND_BASE_URL ?? null, env.RESEND_API_KEY.trim()]);
  } catch {
    await io.settle(retryOrStop(claim, now, "DELIVERY_CONFIGURATION_UNAVAILABLE", alreadyAttempted));
    return;
  }

  if (!(await io.prepare(routingMode, effectiveEmail, fingerprint))) return;
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
      async settle(result) {
        const { error } = await client.from("takeoff_completion_notifications")
          .update({ next_attempt_at: null, ...result, lease_token: null, lease_expires_at: null })
          .eq("id", row.id).eq("lease_token", row.lease_token!)
          .gt("lease_expires_at", new Date().toISOString());
        if (error) throw new Error("Impossible d’enregistrer la livraison du courriel de métré.");
      },
      send: (message, key) => new Resend(process.env.RESEND_API_KEY?.trim()).emails.send(message, {
        idempotencyKey: key,
        signal: AbortSignal.timeout(15_000),
      }),
    }, process.env, new Date());
  }
  return claimed;
}
