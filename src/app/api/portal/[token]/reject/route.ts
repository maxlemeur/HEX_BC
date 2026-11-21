import { apiFailure } from "@/lib/http/api-response";
import { NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { lookupPortalCapability, loadPortalOffer } from "@/lib/estimates/portal-offer";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

type RejectBody = {
  reason?: string;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token) {
      return apiFailure(400, "BAD_REQUEST", "Token manquant.");
    }

    let body: RejectBody = {};
    try {
      const parsed: unknown = await request.json();
      if (parsed && typeof parsed === "object") {
        body = parsed as RejectBody;
      }
    } catch {
      // Body is optional for reject
    }

    const reason =
      typeof body.reason === "string"
        ? body.reason.trim().slice(0, 1000) || undefined
        : undefined;

    const supabase = createServiceRoleClient();

    const portalToken = await lookupPortalCapability({ supabase, token });
    if (!portalToken) return apiFailure(404, "PORTAL_TOKEN_NOT_FOUND", "Token invalide.");
    if (portalToken.status !== "pending") return apiFailure(409, "PORTAL_DECISION_ALREADY_RECORDED", "Ce devis a déjà été traité.");
    if (Date.parse(portalToken.expires_at) <= Date.now()) return apiFailure(404, "PORTAL_TOKEN_EXPIRED", "Ce lien a expiré.");
    const offer = await loadPortalOffer({ supabase, token, capability: portalToken }).catch(() => null);
    if (!offer) return apiFailure(409, "PORTAL_OFFER_UNVERIFIED", "La copie du devis ne peut pas être vérifiée.");

    // 2. Atomically claim both the capability and its parent estimate version.
    const { error: claimError } = await supabase.rpc(
      "claim_portal_estimate_decision",
      {
        p_portal_token_id: portalToken.id,
        p_decision: "rejected",
        p_client_ip: null,
        p_reject_reason: reason ?? null,
        p_expected_seal_hash: offer.sealHash,
        p_expected_document_contract: offer.proof as unknown as Json,
      }
    );

    if (claimError) {
      if (!["P0001", "23514", "40001", "42501"].includes(claimError.code ?? "")) {
        console.error("Portal rejection claim error:", claimError.code);
        return apiFailure(500, "INTERNAL_ERROR", "Erreur lors de la mise à jour du statut du devis.");
      }

      return apiFailure(409, "PORTAL_DECISION_ALREADY_RECORDED", "Ce devis a déjà été traité.");
    }

    return NextResponse.json({ status: "rejected" });
  } catch {
    console.error("Portal rejection failed.");
    return apiFailure(500, "INTERNAL_ERROR", "Erreur interne.");
  }
}
