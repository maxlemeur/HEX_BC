import type { EstimateEmailDispatch } from "@/lib/email/estimate-email-dispatch-contracts";

export const dispatchId = "11111111-1111-4111-8111-111111111111";
export const tenantId = "22222222-2222-4222-8222-222222222222";
export const versionId = "33333333-3333-4333-8333-333333333333";
export const actorUserId = "55555555-5555-4555-8555-555555555555";
export const leaseToken = "66666666-6666-4666-8666-666666666666";

export function dispatch(): EstimateEmailDispatch {
  return {
    id: dispatchId, tenant_id: tenantId, version_id: versionId, recipient: "client@example.test",
    cc: null, subject: "Devis", body: "Bonjour", status: "processing", provider_id: null, sent_at: null,
    request_id: "44444444-4444-4444-8444-444444444444", payload_hash: "a".repeat(64),
    provider_payload_hash: "b".repeat(64), idempotency_key: `estimate-email/${dispatchId}`,
    created_by: actorUserId, version_content_revision: 1, from_address: "sender@example.test",
    request_contract_version: 2, portal_url: "https://example.test/portal/token", offer_identity_snapshot: null,
    html_body: "<p>Bonjour</p>", text_body: "Bonjour", document_path: "tenant/version.pdf",
    document_sha256: "c".repeat(64), attachment_filename: "devis.pdf", attempt_count: 1,
    first_attempt_at: "2026-08-12T00:00:00.000Z", lease_token: leaseToken,
    lease_expires_at: "2026-08-12T00:02:00.000Z", last_error_code: null, last_error_message: null,
  };
}
