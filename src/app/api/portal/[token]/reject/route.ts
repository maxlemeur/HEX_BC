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
      return NextResponse.json(
        { error: "Token manquant." },
        { status: 400 }
      );
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
    if (!portalToken) return NextResponse.json({ error: "Token invalide." }, { status: 404 });
    if (portalToken.status !== "pending") return NextResponse.json({ error: "Ce devis a déjà été traité." }, { status: 409 });
    if (Date.parse(portalToken.expires_at) <= Date.now()) return NextResponse.json({ error: "Ce lien a expiré." }, { status: 404 });
    const offer = await loadPortalOffer({ supabase, token, capability: portalToken }).catch(() => null);
    if (!offer) return NextResponse.json({ error: "La copie du devis ne peut pas être vérifiée." }, { status: 409 });

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
        return NextResponse.json(
          { error: "Erreur lors de la mise à jour du statut du devis." },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: "Ce devis a déjà été traité." },
        { status: 409 }
      );
    }

    return NextResponse.json({ status: "rejected" });
  } catch {
    console.error("Portal rejection failed.");
    return NextResponse.json(
      { error: "Erreur interne." },
      { status: 500 }
    );
  }
}
