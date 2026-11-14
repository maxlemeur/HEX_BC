import "server-only";

import { render } from "@react-email/components";
import { Resend, type ErrorResponse } from "resend";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { COMPANY_INFO } from "@/lib/company-info";
import { normalizeDocumentIssuerDisplay } from "@/lib/documents/issuer-display";
import { isOneMailbox, readOutgoingEmailRouting, routeOutgoingEmail, type OutgoingEmailRouting } from "@/lib/email/outgoing-routing";
import { PurchaseOrderEmailTemplate } from "@/lib/email/templates/purchase-order";
import {
  ApiError,
  type SupabaseErrorLike,
  conflict,
  forbidden,
  internalError,
  notFound,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { assertCompletePurchaseOrderSnapshot } from "@/lib/purchase-orders";
import { deliveryModeOf, lineKindOf, storedOrderAffaire } from "@/components/purchase-orders/order-lines";
import { createServiceRoleClient, hasServiceRoleConfig } from "@/lib/supabase/service-role";

import { formatSendMoment, purchaseOrderPdfFilename, type PurchaseOrderSent } from "./send";
import {
  beginSendAnswerSchema,
  finishSendAnswerSchema,
  toSendRecord,
  type PurchaseOrderSendRow,
  type SendPurchaseOrderData,
} from "./send-contracts";
import { renderPurchaseOrderPdf, type PurchaseOrderPdfData } from "./send-document";

/**
 * Sends a draft purchase order to its supplier by e-mail, the order attached as a PDF.
 *
 * In this order: everything that can refuse without a trace (rights, configuration, recipient, the screen's revision,
 * the rendering of the PDF and of the message), then the claim (begin_purchase_order_send, as the member), the e-mail
 * provider, and the settlement (finish_purchase_order_send, as the application server). The order becomes « envoyée »
 * in the settlement only, when the provider accepted the message.
 *
 * This is not the durable outbox of the estimates: nothing is stored to be replayed and no worker resumes a send.
 * What keeps a message from leaving twice is the claim (one send in flight per order, a replayed request answered
 * what was sent), the provider's idempotency key for the attempts of one request, and, when an outcome is unknown, a
 * send recorded as unconfirmed that a person checks before sending again.
 */

const ORDER_SELECT =
  "id, edit_revision, reference, status, order_date, expected_delivery_date, notes, total_ht_cents, total_tax_cents, total_ttc_cents, project_id, delivery_mode, estimate_projects ( name, site_address ), suppliers ( name, address, city, postal_code, email, phone, contact_name ), delivery_sites ( name, project_code, address, city, postal_code, contact_name, contact_phone ), profiles ( full_name, job_title, phone, work_email ), purchase_order_items(id, designation, reference, quantity, unit, unit_price_ht_cents, line_total_ht_cents, position, line_kind, price_per)";

type OrderForSend = {
  id: string;
  edit_revision: number;
  reference: string;
  status: PurchaseOrderSent["order"]["status"];
  order_date: string;
  expected_delivery_date: string | null;
  notes: string | null;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  project_id: string | null;
  delivery_mode: string | null;
  estimate_projects: { name: string; site_address: string | null } | null;
  suppliers: {
    name: string; address: string | null; city: string | null; postal_code: string | null; email: string | null;
    phone: string | null; contact_name: string | null;
  } | null;
  delivery_sites: {
    name: string; project_code: string | null; address: string | null; city: string | null; postal_code: string | null;
    contact_name: string | null; contact_phone: string | null;
  } | null;
  profiles: { full_name: string | null; job_title: string | null; phone: string | null; work_email: string | null } | null;
  purchase_order_items: Array<{
    id: string; designation: string; reference: string | null; quantity: number; unit: string | null;
    unit_price_ht_cents: number; line_total_ht_cents: number; position: number; line_kind: string | null; price_per: number | null;
  }>;
};

const NOT_FOUND = "Bon de commande introuvable.";
const STAYS_DRAFT = "Le bon reste en brouillon.";
/** One attempt of the provider call: beyond it the outcome is unknown, not refused. */
const ATTEMPT_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [1_000, 2_000] as const;
/** Refusals after which the same request, with the same key, is tried again. */
const RETRYABLE = new Set<ErrorResponse["name"]>([
  "rate_limit_exceeded", "concurrent_idempotent_requests", "application_error", "internal_server_error",
]);
/** Of those, the one after which the provider holds nothing of the message; after the others it may have left. */
const NOTHING_LEFT: ErrorResponse["name"] = "rate_limit_exceeded";

function notConfigured(message: string, code: string): ApiError {
  return new ApiError({ status: 503, code, message: `${message} ${STAYS_DRAFT}` });
}

/** The provider's key and sender, and where the server's e-mails go: read before anything is claimed. */
function readEmailConfiguration(): { apiKey: string; from: string; routing: OutgoingEmailRouting } {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw notConfigured("L’envoi d’e-mails n’est pas configuré sur le serveur : la clé du service d’e-mail (RESEND_API_KEY) manque.",
      "EMAIL_PROVIDER_NOT_CONFIGURED");
  }
  const from = process.env.EMAIL_FROM?.trim();
  if (!from) {
    throw notConfigured("L’envoi d’e-mails n’est pas configuré sur le serveur : l’adresse d’expédition (EMAIL_FROM) manque.",
      "EMAIL_PROVIDER_NOT_CONFIGURED");
  }
  // The acceptance of the provider is recorded with the application server's own key: without it the message would
  // leave and the order never say so.
  if (!hasServiceRoleConfig()) {
    throw notConfigured("L’envoi ne peut pas être enregistré : la clé de service de la base (SUPABASE_SERVICE_ROLE_KEY) manque sur le serveur.",
      "EMAIL_PROVIDER_NOT_CONFIGURED");
  }
  try {
    return { apiKey, from, routing: readOutgoingEmailRouting() };
  } catch (error) {
    if (error instanceof ApiError && error.code === "EMAIL_REDIRECT_NOT_CONFIGURED") {
      throw notConfigured(
        "Les e-mails sont redirigés vers une boîte de test, mais son adresse (EMAIL_REDIRECT_TO) n’est pas configurée sur le serveur.",
        error.code);
    }
    if (error instanceof ApiError && error.code === "EMAIL_DELIVERY_MODE_INVALID") {
      throw notConfigured("Le mode d’envoi des e-mails (EMAIL_DELIVERY_MODE) vaut « redirect » ou « live » : sa valeur sur le serveur est autre.",
        error.code);
    }
    throw error;
  }
}

function pdfData(order: OrderForSend): PurchaseOrderPdfData {
  const supplier = order.suppliers;
  const site = order.delivery_sites;
  // As the printed order names its issuer: a profile whose name is an e-mail address reads as a name.
  const issuer = normalizeDocumentIssuerDisplay({
    issuerName: order.profiles?.full_name, issuerRole: order.profiles?.job_title, issuerEmail: order.profiles?.work_email,
    fallbackName: COMPANY_INFO.name,
  });
  return {
    reference: order.reference,
    orderDate: order.order_date,
    expectedDeliveryDate: order.expected_delivery_date,
    notes: order.notes,
    issuer: {
      name: issuer.displayName, role: issuer.displayRole || null, phone: order.profiles?.phone ?? null,
      email: issuer.displayEmail || null,
    },
    supplier: {
      name: supplier?.name ?? "Fournisseur", address: supplier?.address ?? null, postalCode: supplier?.postal_code ?? null,
      city: supplier?.city ?? null, contactName: supplier?.contact_name ?? null, phone: supplier?.phone ?? null,
      email: supplier?.email ?? null,
    },
    deliverySite: site ? {
      name: site.name, projectCode: site.project_code, address: site.address, postalCode: site.postal_code, city: site.city,
      contactName: site.contact_name, contactPhone: site.contact_phone,
    } : null,
    affaire: storedOrderAffaire(order.estimate_projects),
    deliveryMode: deliveryModeOf(order.delivery_mode),
    lines: [...order.purchase_order_items].sort((left, right) => left.position - right.position).map((item) => ({
      designation: item.designation, reference: item.reference, quantity: Number(item.quantity), unit: item.unit,
      unitPriceHtCents: item.unit_price_ht_cents, pricePer: item.price_per && item.price_per > 1 ? item.price_per : 1,
      lineTotalHtCents: item.line_total_ht_cents, kind: lineKindOf(item.line_kind),
    })),
    totalHtCents: order.total_ht_cents,
    totalTaxCents: order.total_tax_cents,
    totalTtcCents: order.total_ttc_cents,
  };
}

function beginRefusal(error: Pick<SupabaseErrorLike, "message"> & { code?: string | null }): ApiError {
  switch (error.message) {
    case "PURCHASE_ORDER_ACCESS_DENIED":
    case "PURCHASE_ORDER_AUTH_REQUIRED":
      return forbidden("Seuls l’auteur du bon et les administrateurs peuvent l’envoyer au fournisseur.");
    case "PURCHASE_ORDER_SEND_NOT_DRAFT":
      return conflict("Ce bon n’est plus un brouillon : rechargez la page.", undefined, error.message);
    case "PURCHASE_ORDER_REVISION_REQUIRED":
    case "PURCHASE_ORDER_REVISION_CONFLICT":
      return conflict("Ce bon a été modifié entre-temps : rechargez la page, puis envoyez-le de nouveau.", undefined,
        "PURCHASE_ORDER_REVISION_CONFLICT");
    case "PURCHASE_ORDER_SEND_IN_PROGRESS":
      return conflict("Un envoi de ce bon est déjà en cours : attendez sa réponse, puis rechargez la page.", undefined, error.message);
    case "PURCHASE_ORDER_SEND_EMPTY":
      return unprocessableEntity("Ce bon n’a aucun article à commander : ajoutez-en avant de l’envoyer.", undefined, error.message);
    case "PURCHASE_ORDER_SEND_KEY_SPENT":
    case "PURCHASE_ORDER_SEND_KEY_TAKEN":
      return conflict("Cette demande d’envoi a déjà reçu sa réponse : rouvrez la fenêtre d’envoi pour en faire une nouvelle.", undefined,
        "PURCHASE_ORDER_SEND_KEY_SPENT");
    case "PURCHASE_ORDER_SEND_INPUT_INVALID":
      return unprocessableEntity("Le destinataire, l’objet ou le message de l’envoi est invalide.", undefined, error.message);
    default:
      if (error.code === "40001" || error.code === "40P01") {
        return conflict("Une autre modification de ce bon était en cours : réessayez.", undefined, "PURCHASE_ORDER_REVISION_CONFLICT");
      }
      return internalError(`L’envoi n’a pas pu être préparé. ${STAYS_DRAFT} Réessayez.`);
  }
}

type ProviderOutcome =
  | { status: "sent"; providerMessageId: string }
  | { status: "failed" | "unconfirmed"; failureCode: string };

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** One call of the provider, cut after ATTEMPT_TIMEOUT_MS: a thrown error or a timeout says nothing of the outcome. */
async function attempt(send: () => Promise<{ data: { id: string } | null; error: ErrorResponse | null }>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      send(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("The e-mail provider did not answer in time.")), ATTEMPT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the provider, the same request with the same key up to three times, and says what is known of the outcome:
 * sent (accepted), failed (refused, nothing left) or unconfirmed (an attempt may have left: no answer, an error of the
 * provider's own, or a key it already holds with another content).
 */
async function callProvider(send: () => Promise<{ data: { id: string } | null; error: ErrorResponse | null }>): Promise<ProviderOutcome> {
  let mayHaveLeft = false;
  let failureCode = "provider_unreachable";
  for (let index = 0; index <= RETRY_DELAYS_MS.length; index += 1) {
    const answer = await attempt(send);
    if (answer?.data?.id) return { status: "sent", providerMessageId: answer.data.id };
    const name = answer?.error?.name;
    if (name === "invalid_idempotent_request") return { status: "unconfirmed", failureCode: name };
    if (name && !RETRYABLE.has(name)) return { status: mayHaveLeft ? "unconfirmed" : "failed", failureCode: name };
    if (name !== NOTHING_LEFT) mayHaveLeft = true;
    failureCode = name ?? "provider_unreachable";
    if (index < RETRY_DELAYS_MS.length) await wait(RETRY_DELAYS_MS[index]);
  }
  return { status: mayHaveLeft ? "unconfirmed" : "failed", failureCode };
}

/** An acceptance that is not recorded cannot be recovered: its settlement is tried again for about half a minute. */
const ACCEPTANCE_SETTLE_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000] as const;

/** Settles the claim with the application server's own client. */
async function settle(sendId: string, outcome: ProviderOutcome) {
  const payload = outcome.status === "sent"
    ? { status: "sent", provider_message_id: outcome.providerMessageId }
    : { status: outcome.status, failure_code: outcome.failureCode.slice(0, 120) };
  const delays = outcome.status === "sent" ? ACCEPTANCE_SETTLE_DELAYS_MS : [];
  for (let index = 0; index <= delays.length; index += 1) {
    try {
      const { data, error } = await createServiceRoleClient().rpc("finish_purchase_order_send", { p_send_id: sendId, p_outcome: payload });
      const parsed = error ? null : finishSendAnswerSchema.safeParse(data);
      if (parsed?.success) return parsed.data;
      console.error("Purchase order send settlement failed", { sendId, outcome: outcome.status, code: error?.code ?? "INVALID_ANSWER" });
    } catch (error) {
      console.error("Purchase order send settlement failed", { sendId, outcome: outcome.status, error });
    }
    if (index < delays.length) await wait(delays[index]);
  }
  // What an operator needs to settle it by hand (finish_purchase_order_send): the send and the provider's id.
  if (outcome.status === "sent") {
    console.error("Purchase order send accepted by the provider but not recorded", { sendId, providerMessageId: outcome.providerMessageId });
  }
  return null;
}

export async function sendPurchaseOrder(orderId: string, input: SendPurchaseOrderData): Promise<PurchaseOrderSent> {
  const context = await getAuthenticatedTenantContext();
  const { data: orderData, error: orderError } = await context.supabase
    .from("purchase_orders").select(ORDER_SELECT).eq("id", orderId).single();
  if (orderError || !orderData) throw notFound(NOT_FOUND);
  const order = orderData as unknown as OrderForSend;

  const { apiKey, from, routing } = readEmailConfiguration();
  const recipient = input.recipient || order.suppliers?.email?.trim() || "";
  if (!recipient) {
    throw unprocessableEntity(
      `${order.suppliers?.name ?? "Ce fournisseur"} n’a pas d’adresse e-mail : renseignez-la sur sa fiche (Fournisseurs), ou saisissez le destinataire de cet envoi. ${STAYS_DRAFT}`,
      undefined, "PURCHASE_ORDER_SEND_NO_RECIPIENT");
  }
  if (!isOneMailbox(recipient)) {
    throw unprocessableEntity(
      `L’adresse e-mail de ${order.suppliers?.name ?? "ce fournisseur"} n’est pas une adresse valide : corrigez-la sur sa fiche (Fournisseurs), ou saisissez le destinataire de cet envoi. ${STAYS_DRAFT}`,
      undefined, "PURCHASE_ORDER_SEND_NO_RECIPIENT");
  }
  const attachmentFilename = purchaseOrderPdfFilename(order.reference);
  // The supplier answers the member who sends, who may not be the order's author (an admin sends a colleague's order).
  const { data: sender } = await context.supabase.from("profiles").select("full_name, work_email").eq("id", context.userId).maybeSingle();
  const senderProfile = sender as { full_name: string | null; work_email: string | null } | null;
  const issuerEmail = senderProfile?.work_email?.trim() ?? "";
  /** The order as a PDF and the message, from the order as read above. */
  async function renderContent() {
    try {
      await assertCompletePurchaseOrderSnapshot(context.supabase, orderId, order.edit_revision, order.purchase_order_items.length);
    } catch {
      throw beginRefusal({ message: "PURCHASE_ORDER_REVISION_CONFLICT" });
    }
    const template = PurchaseOrderEmailTemplate({
      companyName: COMPANY_INFO.name, reference: order.reference, supplierName: order.suppliers?.name ?? "votre société",
      message: input.message, attachmentFilename,
      issuerName: normalizeDocumentIssuerDisplay({ issuerName: senderProfile?.full_name, issuerEmail, fallbackName: "" }).displayName || null,
      issuerEmail: isOneMailbox(issuerEmail) ? issuerEmail : null,
    });
    try {
      const [pdf, html, text] = await Promise.all([
        renderPurchaseOrderPdf(pdfData(order)), render(template), render(template, { plainText: true }),
      ]);
      return { pdf, html, text };
    } catch (error) {
      console.error("Purchase order PDF or e-mail rendering failed", { orderId, error });
      throw internalError(`Le bon de commande n’a pas pu être mis en PDF. ${STAYS_DRAFT} Réessayez.`, undefined, "PURCHASE_ORDER_SEND_RENDER_FAILED");
    }
  }
  // Rendered before the claim when the order read above is the draft the screen showed, so that a failure leaves no
  // trace. Otherwise only the database can answer: a replay of an accepted request (the order is « envoyée » by now,
  // at a later revision) is answered what was sent, anything else is refused there.
  const asShown = order.status === "draft" && order.edit_revision === input.expected_revision;
  let content = asShown ? await renderContent() : null;

  const { data: beginData, error: beginError } = await context.supabase.rpc("begin_purchase_order_send", {
    p_order_id: orderId,
    p_expected_revision: input.expected_revision,
    p_send: {
      id: input.idempotency_key, recipient, subject: input.subject, message: input.message, redirected: routing.mode === "redirect",
    },
  });
  if (beginError) throw beginRefusal(beginError);
  const begun = beginSendAnswerSchema.safeParse(beginData);
  if (!begun.success) throw internalError(`L’envoi n’a pas pu être préparé. ${STAYS_DRAFT} Réessayez.`);
  const claimed: PurchaseOrderSendRow = begun.data.send;

  if (begun.data.state === "sent") {
    const { data: current } = await context.supabase.from("purchase_orders").select("id, status, edit_revision").eq("id", orderId).single();
    const now = (current ?? order) as Pick<OrderForSend, "id" | "status" | "edit_revision">;
    return { send: toSendRecord(claimed), order: { id: now.id, status: now.status, edit_revision: now.edit_revision }, replayed: true };
  }
  if (begun.data.state === "unconfirmed") {
    throw conflict(
      `Un envoi de ce bon à ${claimed.recipient}, demandé le ${formatSendMoment(claimed.requested_at)}, n’a jamais été confirmé par le service d’e-mail : il est peut-être arrivé. Vérifiez auprès du destinataire avant de renvoyer ce bon. Rien n’a été envoyé cette fois-ci.`,
      undefined, "PURCHASE_ORDER_SEND_UNCONFIRMED");
  }

  if (!content) {
    // The order changed between the read above and the claim: what was read is not what was claimed.
    await settle(claimed.id, { status: "failed", failureCode: "order_changed_before_claim" });
    throw beginRefusal({ message: "PURCHASE_ORDER_REVISION_CONFLICT" });
  }
  const { pdf, html, text } = content;
  content = null;
  const routed = routeOutgoingEmail(routing, { to: claimed.recipient, subject: claimed.subject });
  const resend = new Resend(apiKey);
  const message = {
    from,
    to: routed.to,
    subject: routed.subject,
    html,
    text,
    ...(isOneMailbox(issuerEmail) ? { replyTo: issuerEmail } : {}),
    attachments: [{ filename: attachmentFilename, content: pdf.toString("base64") }],
  };
  const outcome = await callProvider(() => resend.emails.send(message, { idempotencyKey: `purchase-order-send/${claimed.id}` }));
  const settled = await settle(claimed.id, outcome);

  if (outcome.status === "sent") {
    if (!settled) {
      throw internalError(
        `Le message est parti vers ${routing.mode === "redirect" ? "la boîte de test" : claimed.recipient}, mais son envoi n’a pas pu être enregistré : le bon est resté en brouillon et rien ne le corrigera seul. Ne le renvoyez pas : ${order.project_id ? "confirmez la commande depuis ce brouillon à la réception de l’accusé du fournisseur" : "marquez-le « Envoyée » à la main"}.`,
        undefined, "PURCHASE_ORDER_SEND_RECORD_FAILED");
    }
    return { send: toSendRecord(settled.send), order: settled.order, replayed: false };
  }
  if (outcome.status === "failed") {
    throw new ApiError({
      status: 503, code: "PURCHASE_ORDER_SEND_REFUSED",
      message: `Le service d’e-mail a refusé le message : rien n’est parti. ${STAYS_DRAFT} Réessayez dans un instant ; si le refus persiste, la configuration de l’envoi d’e-mails est à vérifier.`,
    });
  }
  throw new ApiError({
    status: 503, code: "PURCHASE_ORDER_SEND_UNCONFIRMED",
    message: `Le service d’e-mail n’a pas confirmé l’envoi à ${claimed.recipient} : le message est peut-être parti. ${STAYS_DRAFT} Vérifiez auprès du destinataire avant de le renvoyer.`,
  });
}
