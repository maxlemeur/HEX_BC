import { describe, expect, it } from "vitest";
import { assertDispatchMatchesSubmission, canRearmUnfrozenEmailRequest, hashSubmission } from "@/lib/email/send-estimate-plan";
import { canonicalJsonHash } from "@/lib/email/estimate-email-hash";
import { actorUserId, dispatch, versionId } from "@/lib/email/estimate-email.test-utils";

const payload = { to: "client@example.test", subject: "Devis", message: "Bonjour" };
const requestUrl = "https://example.test/api/send";
const hash = hashSubmission({ versionId, from: "sender@example.test", to: payload.to, cc: [],
  subject: payload.subject, message: payload.message, portalOrigin: "https://example.test" });

const frozen = { ...dispatch(), payload_hash: hash };
const matchInput = { dispatch: frozen, versionId, actorUserId, payload, requestUrl };

describe("email replay decisions", () => {
  it("matches a frozen v2 submission using its captured origin, independent of a changed live configuration", () => {
    expect(() => assertDispatchMatchesSubmission({ ...matchInput, configuredPortalBaseUrl: "invalid" })).not.toThrow();
    expect(() => assertDispatchMatchesSubmission({ ...matchInput, payload: { ...payload, to: "other@example.test" } })).toThrow();
    expect(() => assertDispatchMatchesSubmission({ ...matchInput, actorUserId: versionId })).toThrow();
  });

  it("preserves the v1 replay hash with the legacy portal URL", () => {
    const legacy = { ...frozen, request_contract_version: 1 as const,
      payload_hash: canonicalJsonHash({ contract: "estimate-email-initial-v1", versionId,
        from: frozen.from_address, to: payload.to, cc: [], subject: payload.subject, message: payload.message,
        portalUrl: `https://old.example.test/base/estimates/${versionId}` }) };
    expect(() => assertDispatchMatchesSubmission({ ...matchInput, dispatch: legacy,
      configuredPortalBaseUrl: "https://old.example.test/base" })).not.toThrow();
  });

  it("rearms only an unchanged v2 preparation that failed before its payload was frozen", () => {
    const failed = { ...frozen, status: "failed" as const, provider_payload_hash: null, html_body: null,
      text_body: null, document_path: null, document_sha256: null, attachment_filename: null };
    const input = { completedReplay: failed, requestPayloadHash: hash, versionId, actorUserId, payload };
    expect(canRearmUnfrozenEmailRequest(input)).toBe(true);
    for (const patch of [{ status: "unknown" as const }, { request_contract_version: 1 as const }, { created_by: null }, { version_id: actorUserId }]) {
      expect(canRearmUnfrozenEmailRequest({ ...input, completedReplay: { ...failed, ...patch } })).toBe(false);
    }
    expect(canRearmUnfrozenEmailRequest({ ...input, completedReplay: { ...frozen, status: "failed" } })).toBe(false);
    expect(canRearmUnfrozenEmailRequest({ ...input, payload: { ...payload, subject: "Changed" } })).toBe(false);
  });
});
