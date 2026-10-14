import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { loadVerifiedOfferDocument } from "@/lib/estimates/offer-document";
import type { Database } from "@/types/database";

export type PortalCapability = Pick<Database["public"]["Tables"]["portal_tokens"]["Row"],
  "id" | "tenant_id" | "version_id" | "status" | "expires_at" | "email" | "estimate_email_dispatch_id" | "capability_contract_version"> & { expired: boolean };

/** Server-only lookup; active tenant is checked for every read and decision. */
export async function lookupPortalCapability(input: { supabase: ServerSupabaseClient; token: string }): Promise<PortalCapability | null> {
  const { data, error } = await input.supabase.from("portal_tokens")
    .select("id, tenant_id, version_id, status, expires_at, email, estimate_email_dispatch_id, capability_contract_version, tenants!inner(is_active)")
    .eq("token", input.token).eq("tenants.is_active", true).single();
  if (error || !data || ![1, 2].includes(data.capability_contract_version)
    || !["pending", "accepted", "rejected", "expired"].includes(data.status)
    || !Number.isFinite(Date.parse(data.expires_at))) return null;
  return { ...data, expired: Date.parse(data.expires_at) <= Date.now() };
}

/** The returned version and PDF bytes stay on the server; render only Client1. */
export async function loadPortalOffer(input: {
  supabase: ServerSupabaseClient;
  token: string;
  capability: PortalCapability;
}) {
  const capability = input.capability;
  if (capability.capability_contract_version === 2) {
    if (!capability.estimate_email_dispatch_id) throw new Error("OFFER_CAPABILITY_CONTRACT_INVALID");
    const { data: dispatch, error } = await input.supabase.from("estimate_emails")
      .select("id, tenant_id, version_id, recipient, type, status, provider_id, sent_at, request_contract_version, portal_url, document_path, document_sha256, version_content_revision")
      .eq("id", capability.estimate_email_dispatch_id).eq("tenant_id", capability.tenant_id)
      .eq("version_id", capability.version_id).single();
    if (error || !dispatch || dispatch.request_contract_version !== 2 || dispatch.type !== "initial"
      || dispatch.recipient !== capability.email || !["sent", "delivered", "bounced"].includes(dispatch.status)
      || !dispatch.provider_id?.trim() || !dispatch.sent_at || !dispatch.portal_url) throw new Error("OFFER_DISPATCH_NOT_EMITTED");
    const url = new URL(dispatch.portal_url);
    if (url.pathname !== `/portal/${input.token}` || url.search || url.hash) throw new Error("OFFER_CAPABILITY_CONTRACT_INVALID");
    const offer = await loadVerifiedOfferDocument({ supabase: input.supabase,
      tenantId: capability.tenant_id, versionId: capability.version_id });
    if (dispatch.document_path !== offer.proof.filePath || dispatch.document_sha256 !== offer.proof.sha256Hash
      || dispatch.version_content_revision !== offer.proof.publishedContentRevision) throw new Error("OFFER_DOCUMENT_PROOF_MISMATCH");
    return offer;
  }
  if (capability.capability_contract_version !== 1 || capability.estimate_email_dispatch_id !== null) throw new Error("OFFER_CAPABILITY_CONTRACT_INVALID");
  const offer = await loadVerifiedOfferDocument({ supabase: input.supabase,
    tenantId: capability.tenant_id, versionId: capability.version_id });
  if (offer.proof.clientContractVersion !== null) throw new Error("OFFER_CAPABILITY_CONTRACT_INVALID");
  return offer;
}
