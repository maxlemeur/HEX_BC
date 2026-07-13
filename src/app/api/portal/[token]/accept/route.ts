import { NextResponse } from "next/server";
import { Resend } from "resend";

import { COMPANY_INFO } from "@/lib/company-info";
import { AcceptanceConfirmationEmailTemplate } from "@/lib/email/templates/acceptance-confirmation";
import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

const MAX_SIGNATURE_BASE64_LENGTH = 700_000; // ~500KB decoded
const DATA_URI_PREFIX = "data:image/png;base64,";

type AcceptBody = {
  signature_base64?: string;
  accepted_terms: boolean;
};

type EstimateProjectRow = Database["public"]["Tables"]["estimate_projects"]["Row"];

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
      return NextResponse.json(
        { error: "Token manquant." },
        { status: 400 }
      );
    }

    let body: AcceptBody;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== "object") {
        return NextResponse.json(
          { error: "Payload JSON invalide." },
          { status: 400 }
        );
      }
      body = parsed as AcceptBody;
    } catch {
      return NextResponse.json(
        { error: "Payload JSON invalide." },
        { status: 400 }
      );
    }

    // Validate accepted_terms
    if (body.accepted_terms !== true) {
      return NextResponse.json(
        { error: "Vous devez accepter les conditions." },
        { status: 400 }
      );
    }

    // Validate signature if provided
    if (body.signature_base64 !== undefined) {
      if (
        typeof body.signature_base64 !== "string" ||
        !body.signature_base64.startsWith(DATA_URI_PREFIX)
      ) {
        return NextResponse.json(
          { error: "Format de signature invalide." },
          { status: 400 }
        );
      }
      if (body.signature_base64.length > MAX_SIGNATURE_BASE64_LENGTH) {
        return NextResponse.json(
          { error: "Signature trop volumineuse." },
          { status: 400 }
        );
      }
    }

    const supabase = createServiceRoleClient();

    // 1. Lookup portal token
    const { data: portalToken, error: lookupError } = await supabase
      .from("portal_tokens")
      .select("id, version_id, status, expires_at, email")
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

    // 2. Capture client IP
    const clientIp = resolveClientIp(request);

    // 3. Atomically claim both the capability and its parent estimate version.
    const acceptedAt = new Date().toISOString();
    const { error: claimError } = await supabase.rpc(
      "claim_portal_estimate_decision" as never,
      {
        p_portal_token_id: portalToken.id,
        p_decision: "accepted",
        p_client_ip: clientIp,
        p_reject_reason: null,
      } as never
    );

    if (claimError) {
      if (claimError.code !== "P0001") {
        console.error("Portal acceptance claim error:", claimError);
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

    // 4. Upload signature if provided (after concurrency guard to avoid orphans)
    let signatureUrl: string | null = null;

    if (body.signature_base64) {
      const base64Data = body.signature_base64.slice(DATA_URI_PREFIX.length);
      const buffer = Buffer.from(base64Data, "base64");
      const storagePath = `signatures/${portalToken.id}.png`;

      const { error: uploadError } = await supabase.storage
        .from("devis")
        .upload(storagePath, buffer, {
          contentType: "image/png",
          upsert: false,
        });

      if (uploadError) {
        console.error("Signature upload error:", uploadError);
        // Token is already claimed — don't fail the acceptance, just skip signature
      } else {
        signatureUrl = storagePath;

        // Patch the token with the signature URL
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
        // Load version data for email content
        const { data: versionData } = await supabase
          .from("estimate_versions")
          .select(
            "version_number, total_ttc_cents, currency, estimate_projects(name)"
          )
          .eq("id", portalToken.version_id)
          .single();

        if (versionData) {
          const project = Array.isArray(versionData.estimate_projects)
            ? versionData.estimate_projects[0]
            : versionData.estimate_projects;
          const projectName = (project as Pick<EstimateProjectRow, "name"> | null)?.name ?? "Votre projet";
          const currency =
            normalizeEstimateCurrency(versionData.currency) ?? "EUR";
          const totalFormatted = formatCurrency(
            versionData.total_ttc_cents ?? 0,
            currency
          );

          const formattedDate = new Date(acceptedAt).toLocaleDateString(
            "fr-FR",
            { day: "numeric", month: "long", year: "numeric" }
          );

          const resend = new Resend(apiKey);
          const emailSubject = `Confirmation - Devis ${projectName} accepte`;
          const { data: emailResult, error: emailSendError } =
            await resend.emails.send({
              from: emailFrom,
              to: portalToken.email,
              subject: emailSubject,
              react: AcceptanceConfirmationEmailTemplate({
                projectName,
                versionNumber: versionData.version_number,
                totalTtcFormatted: totalFormatted,
                acceptedAt: formattedDate,
                companyName: COMPANY_INFO.name,
              }),
            });

          // Log email with accurate status
          const emailStatus = emailSendError ? "failed" : "sent";
          await supabase.from("estimate_emails").insert({
            version_id: portalToken.version_id,
            recipient: portalToken.email,
            subject: emailSubject,
            type: "acceptance_confirmation",
            status: emailStatus,
            provider_id: emailResult?.id ?? null,
          });

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
  } catch (error) {
    console.error("Portal accept error:", error);
    return NextResponse.json(
      { error: "Erreur interne." },
      { status: 500 }
    );
  }
}
