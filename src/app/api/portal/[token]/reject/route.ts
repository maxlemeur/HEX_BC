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

    // 2. Update portal token — WHERE status='pending' is the concurrency guard
    const { data: updated, error: updateError } = await supabase
      .from("portal_tokens")
      .update({
        status: "rejected",
        reject_reason: reason ?? null,
      })
      .eq("id", portalToken.id)
      .eq("status", "pending")
      .select("id")
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Ce devis a deja ete traite." },
        { status: 409 }
      );
    }

    // 3. Archive the estimate version (no 'rejected' status in estimate enum)
    const { error: versionUpdateError } = await supabase
      .from("estimate_versions")
      .update({ status: "archived" })
      .eq("id", portalToken.version_id)
      .eq("status", "sent");

    if (versionUpdateError) {
      console.error("Version status update error:", versionUpdateError);
      return NextResponse.json(
        { error: "Erreur lors de la mise a jour du statut du devis." },
        { status: 500 }
      );
    }

    // 4. Log 'rejected' event
    const { error: eventError } = await supabase.rpc("log_estimate_version_event", {
      p_estimate_version_id: portalToken.version_id,
      p_event_type: "rejected",
      p_created_by: null,
      p_metadata: {
        portal_token_id: portalToken.id,
        rejected_via: "portal",
        ...(reason ? { reason } : {}),
      },
    });

    if (eventError) {
      console.error("Event log error:", eventError);
      // Non-fatal: token and version are already updated
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
