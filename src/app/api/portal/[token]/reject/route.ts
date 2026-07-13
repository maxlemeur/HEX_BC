import { NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

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

    // 1. Lookup portal token
    const { data: portalToken, error: lookupError } = await supabase
      .from("portal_tokens")
      .select("id, version_id, status, expires_at")
      .eq("token", token)
      .single();

    if (lookupError || !portalToken) {
      return NextResponse.json(
        { error: "Token invalide." },
        { status: 404 }
      );
    }

    if (portalToken.status !== "pending") {
      return NextResponse.json(
        { error: "Ce devis a deja ete traite." },
        { status: 409 }
      );
    }

    if (new Date(portalToken.expires_at) < new Date()) {
      return NextResponse.json(
        { error: "Ce lien a expire." },
        { status: 404 }
      );
    }

    // 2. Atomically claim both the capability and its parent estimate version.
    const { error: claimError } = await supabase.rpc(
      "claim_portal_estimate_decision" as never,
      {
        p_portal_token_id: portalToken.id,
        p_decision: "rejected",
        p_client_ip: null,
        p_reject_reason: reason ?? null,
      } as never
    );

    if (claimError) {
      if (claimError.code !== "P0001") {
        console.error("Portal rejection claim error:", claimError);
        return NextResponse.json(
          { error: "Erreur lors de la mise a jour du statut du devis." },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { error: "Ce devis a deja ete traite." },
        { status: 409 }
      );
    }

    return NextResponse.json({ status: "rejected" });
  } catch (error) {
    console.error("Portal reject error:", error);
    return NextResponse.json(
      { error: "Erreur interne." },
      { status: 500 }
    );
  }
}
