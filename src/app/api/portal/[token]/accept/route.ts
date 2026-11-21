import { apiFailure } from "@/lib/http/api-response";
import { NextResponse } from "next/server";
import { Resend } from "resend";

import { readOutgoingEmailRouting, routeOutgoingEmail } from "@/lib/email/outgoing-routing";
import { AcceptanceConfirmationEmailTemplate } from "@/lib/email/templates/acceptance-confirmation";
import { lookupPortalCapability, loadPortalOffer } from "@/lib/estimates/portal-offer";
import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { DEVIS_BUCKET } from "@/lib/storage/buckets";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

const MAX_SIGNATURE_BASE64_LENGTH = 700_000; // ~500KB decoded
const DATA_URI_PREFIX = "data:image/png;base64,";

type AcceptBody = {
  signature_base64?: string;
  accepted_terms: boolean;
};


function resolveClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) {
      return apiFailure(400, "BAD_REQUEST", "Token manquant.");
    }

    let body: AcceptBody;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object") {
        return apiFailure(400, "BAD_REQUEST", "Payload JSON invalide.");
      }
      body = parsed as AcceptBody;
    } catch {
      return apiFailure(400, "BAD_REQUEST", "Payload JSON invalide.");
    }

    if (body.accepted_terms !== true) {
      return apiFailure(400, "BAD_REQUEST", "Vous devez accepter les conditions.");
    }

    if (body.signature_base64 !== undefined) {
      if (
        typeof body.signature_base64 !== "string" ||
        !body.signature_base64.startsWith(DATA_URI_PREFIX)
      ) {
        return apiFailure(400, "BAD_REQUEST", "Format de signature invalide.");
      }
      if (body.signature_base64.length > MAX_SIGNATURE_BASE64_LENGTH) {
        return apiFailure(400, "BAD_REQUEST", "Signature trop volumineuse.");
      }
    }

    const supabase = createServiceRoleClient();

    const portalToken = await lookupPortalCapability({ supabase, token });
    if (!portalToken) return apiFailure(404, "PORTAL_TOKEN_NOT_FOUND", "Token invalide.");
    if (portalToken.status !== "pending") return apiFailure(409, "PORTAL_DECISION_ALREADY_RECORDED", "Ce devis a déjà été traité.");
    if (Date.parse(portalToken.expires_at) <= Date.now()) return apiFailure(404, "PORTAL_TOKEN_EXPIRED", "Ce lien a expiré.");
    const offer = await loadPortalOffer({ supabase, token, capability: portalToken }).catch(() => null);
    if (!offer) return apiFailure(409, "PORTAL_OFFER_UNVERIFIED", "La copie du devis ne peut pas être vérifiée.");

    const clientIp = resolveClientIp(request);

    // 3. Atomically claim both the capability and its parent estimate version.
    const acceptedAt = new Date().toISOString();
    const { error: claimError } = await supabase.rpc(
      "claim_portal_estimate_decision",
      {
        p_portal_token_id: portalToken.id,
        p_decision: "accepted",
        p_client_ip: clientIp,
        p_reject_reason: null,
        p_expected_seal_hash: offer.sealHash,
        p_expected_document_contract: offer.proof as unknown as Json,
      }
    );

    if (claimError) {
      if (!["P0001", "23514", "40001", "42501"].includes(claimError.code ?? "")) {
        console.error("Portal acceptance claim error:", claimError.code);
        return apiFailure(500, "INTERNAL_ERROR", "Erreur lors de la mise à jour du statut du devis.");
      }

      return apiFailure(409, "PORTAL_DECISION_ALREADY_RECORDED", "Ce devis a déjà été traité.");
    }

    // 4. Upload signature if provided (after concurrency guard to avoid orphans)
    let signatureUrl: string | null = null;

    if (body.signature_base64) {
      const base64Data = body.signature_base64.slice(DATA_URI_PREFIX.length);
      const buffer = Buffer.from(base64Data, "base64");
      const storagePath = `signatures/${portalToken.id}.png`;

      const { error: uploadError } = await supabase.storage
        .from(DEVIS_BUCKET)
        .upload(storagePath, buffer, {
          contentType: "image/png",
          upsert: false,
        });

      if (uploadError) {
        console.error("Signature upload error:", uploadError);
        // Token is already claimed — don't fail the acceptance, just skip signature
      } else {
        signatureUrl = storagePath;

        await supabase
          .from("portal_tokens")
          .update({ signature_url: signatureUrl })
          .eq("id", portalToken.id);
      }
    }

    // 5. Send confirmation email (best-effort)
    try {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      const emailFrom = process.env.EMAIL_FROM?.trim();

      if (apiKey && emailFrom) {
        const captured = offer.proof.clientContractSnapshot;
        const projectName = captured?.project.name ?? "Devis émis";
        const currency = normalizeEstimateCurrency(captured?.version.currency ?? offer.version.currency) ?? "EUR";
        const totalFormatted = formatCurrency(captured?.totals.payableTtcCents ?? offer.version.total_ttc_cents, currency);
        {
          const formattedDate = new Date(acceptedAt).toLocaleDateString(
            "fr-FR",
            { day: "numeric", month: "long", year: "numeric" }
          );

          const resend = new Resend(apiKey);
          const emailSubject = `Confirmation – devis ${projectName} accepté`;
          // The log below keeps the client's address and the subject as written; only the provider call is rerouted.
          const routing = readOutgoingEmailRouting();
          const routed = routeOutgoingEmail(routing, { to: portalToken.email, subject: emailSubject });
          const { data: emailResult, error: emailSendError } =
            await resend.emails.send({
              from: emailFrom,
              to: routed.to,
              subject: routed.subject,
              react: AcceptanceConfirmationEmailTemplate({
                projectName,
                versionNumber: captured?.version.number ?? offer.version.version_number,
                totalTtcFormatted: totalFormatted,
                acceptedAt: formattedDate,
                companyName: captured?.company.name ?? "Votre interlocuteur",
              }),
            });

          const emailStatus = emailSendError ? "failed" : "sent";
          const { error: logError } = await supabase.from("estimate_emails").insert({
            tenant_id: portalToken.tenant_id,
            version_id: portalToken.version_id,
            recipient: portalToken.email,
            subject: emailSubject,
            type: "acceptance_confirmation",
            status: emailStatus,
            provider_id: emailResult?.id ?? null,
            sent_at: emailStatus === "sent" ? acceptedAt : null,
            // Logged as written, and as redirected when the test mailbox received it (TI-691).
            redirected: routing.mode === "redirect",
          });
          if (logError) console.error("Failed to log the acceptance confirmation email:", logError.code);

          if (emailSendError) {
            console.error(
              "Resend returned error for acceptance confirmation:",
              emailSendError
            );
          }
        }
      }
    } catch (emailError) {
      console.error(
        "Failed to send acceptance confirmation email:",
        emailError
      );
    }

    return NextResponse.json({ status: "accepted", accepted_at: acceptedAt });
  } catch {
    console.error("Portal acceptance failed.");
    return apiFailure(500, "INTERNAL_ERROR", "Erreur interne.");
  }
}
