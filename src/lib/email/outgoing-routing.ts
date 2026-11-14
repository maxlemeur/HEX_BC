import { internalError } from "@/lib/estimates/errors";

/**
 * Where an outgoing email really goes. While the product is being tested, in development and in production alike,
 * no message may reach the recipient written on it: by default every message is redirected to one test mailbox
 * (EMAIL_REDIRECT_TO), its written recipients named in the subject. Without that mailbox nothing is sent.
 * Real delivery is an explicit choice: EMAIL_DELIVERY_MODE=live.
 *
 * Only the provider call is rerouted. What the application stores (recipient, frozen payload, hashes, idempotency
 * key) stays what the user wrote, so a later live send and the audit trail are unchanged.
 */
export type OutgoingEmailRouting = { mode: "live" } | { mode: "redirect"; address: string };

/** `process.env`, or the two variables alone. */
type RoutingEnvironment = Readonly<Record<string, string | undefined>>;

/** One mailbox the provider will accept, with nothing a header or a second recipient could be built from. */
const ONE_MAILBOX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const SUBJECT_MAX = 200;

/** Whether a text is one mailbox, and nothing else: what a typed recipient must be before it reaches the provider. */
export function isOneMailbox(address: string): boolean {
  return address.length <= 320 && ONE_MAILBOX.test(address);
}

export function readOutgoingEmailRouting(env: RoutingEnvironment = process.env): OutgoingEmailRouting {
  const mode = env.EMAIL_DELIVERY_MODE?.trim() || "redirect";
  if (mode === "live") return { mode: "live" };
  if (mode !== "redirect") {
    throw internalError(
      "Configuration email invalide: EMAIL_DELIVERY_MODE vaut « redirect » ou « live ».",
      undefined,
      "EMAIL_DELIVERY_MODE_INVALID",
    );
  }
  const address = env.EMAIL_REDIRECT_TO?.trim() ?? "";
  if (!ONE_MAILBOX.test(address)) {
    throw internalError("Configuration email manquante: EMAIL_REDIRECT_TO.", undefined, "EMAIL_REDIRECT_NOT_CONFIGURED");
  }
  return { mode: "redirect", address };
}

/**
 * The written recipients, cut to what a subject can carry: the first always whole, then the copies that fit, then
 * the count of those left out. Only the first recipient and that count may exceed `room`.
 */
function writtenRecipients(to: string, cc: readonly string[], room: number): string {
  let label = to;
  for (let index = 0; index < cc.length; index += 1) {
    const next = `${label}${index === 0 ? ", cc " : ", "}${cc[index]}`;
    const left = cc.length - index - 1;
    const leftOut = left > 0 ? ` +${left}`.length : 0;
    if (next.length + leftOut > room) return `${label} +${cc.length - index}`;
    label = next;
  }
  return label;
}

export function routeOutgoingEmail(
  routing: OutgoingEmailRouting,
  message: { to: string; cc?: readonly string[] | null; subject: string },
): { to: string; cc: string[] | undefined; subject: string } {
  const cc = message.cc && message.cc.length > 0 ? [...message.cc] : undefined;
  if (routing.mode === "live") return { to: message.to, cc, subject: message.subject };
  // A long subject leaves no room for copies: the first recipient is still named, the copies are counted.
  const room = SUBJECT_MAX - message.subject.length - "[TEST → ] ".length;
  return {
    to: routing.address,
    cc: undefined,
    subject: `[TEST → ${writtenRecipients(message.to, cc ?? [], room)}] ${message.subject}`,
  };
}
