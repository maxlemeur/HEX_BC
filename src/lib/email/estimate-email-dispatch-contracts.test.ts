import { describe, expect, it } from "vitest";
import {
  assertEstimateEmailRpcConfirmation,
  parseEstimateEmailDispatch,
  parseEstimateEmailDispatchIdentity,
} from "@/lib/email/estimate-email-dispatch-contracts";
import { actorUserId, dispatch, dispatchId, tenantId, versionId } from "@/lib/email/estimate-email.test-utils";

const invalid = { code: "ESTIMATE_EMAIL_DISPATCH_INVALID_RESPONSE" };

describe("stored email dispatch contracts", () => {
  it("retains nullable historical request fields without inventing a transactional envelope", () => {
    const legacy = { ...dispatch(), status: "sent", request_contract_version: 1,
      request_id: null, payload_hash: null, idempotency_key: null, version_content_revision: null,
      from_address: null, created_by: null, provider_id: null, offer_identity_snapshot: null };
    expect(parseEstimateEmailDispatch(legacy)).toEqual(legacy);
  });

  it("requires the transactional envelope when a request exists", () => {
    for (const patch of [{ from_address: null }, { idempotency_key: null }, { payload_hash: "invalid" }, { version_content_revision: null }]) {
      expect(() => parseEstimateEmailDispatch({ ...dispatch(), ...patch })).toThrowError(expect.objectContaining(invalid));
    }
  });

  it("parses the reconciliation projection without demanding fields that were not selected", () => {
    const identity = { id: dispatchId, tenant_id: tenantId, version_id: versionId, status: "unknown" };
    expect(parseEstimateEmailDispatchIdentity(identity, { dispatchId })).toEqual(identity);
    expect(() => parseEstimateEmailDispatchIdentity({ ...identity, status: "invented" })).toThrow();
    expect(() => parseEstimateEmailDispatch(identity)).toThrow();
  });

  it("binds a request lookup to its request identifier", () => {
    expect(() => parseEstimateEmailDispatch(dispatch(), { requestId: dispatchId })).toThrowError(expect.objectContaining(invalid));
  });

  it("accepts an active reservation with another request key and the same immutable envelope", () => {
    const row = { ...dispatch(), status: "queued" as const };
    expect(() => assertEstimateEmailRpcConfirmation(row, "reserve_estimate_email_dispatch_with_session", {
      p_tenant_id: tenantId, p_version_id: versionId, p_request_id: dispatchId,
      p_actor_user_id: actorUserId, p_payload_hash: row.payload_hash, p_recipient: row.recipient,
      p_cc: row.cc, p_subject: row.subject, p_body: row.body, p_from_address: row.from_address,
    })).not.toThrow();
  });

  it("checks the frozen document before acknowledging an idempotent preparation", () => {
    const row = { ...dispatch(), status: "sent" as const };
    const args = {
      p_dispatch_id: dispatchId, p_tenant_id: tenantId, p_provider_payload_hash: row.provider_payload_hash,
      p_html_body: row.html_body, p_text_body: row.text_body, p_document_path: row.document_path,
      p_document_sha256: row.document_sha256, p_attachment_filename: row.attachment_filename,
    };
    expect(() => assertEstimateEmailRpcConfirmation(row, "prepare_estimate_email_dispatch", args)).not.toThrow();
    expect(() => assertEstimateEmailRpcConfirmation(row, "prepare_estimate_email_dispatch", {
      ...args, p_document_sha256: "d".repeat(64),
    })).toThrowError(expect.objectContaining(invalid));
  });

  it("accepts admin reconciliation of another creator and checks the normalized provider receipt", () => {
    const row = { ...dispatch(), status: "sent" as const, provider_id: "provider-1" };
    const args = { p_dispatch_id: dispatchId, p_actor_user_id: tenantId, p_resolution: "sent", p_provider_id: " provider-1 " };
    expect(() => assertEstimateEmailRpcConfirmation(row, "reconcile_estimate_email_dispatch", args)).not.toThrow();
    expect(() => assertEstimateEmailRpcConfirmation(row, "reconcile_estimate_email_dispatch", {
      ...args, p_resolution: "failed",
    })).toThrow();
    expect(() => assertEstimateEmailRpcConfirmation(row, "complete_estimate_email_dispatch", {
      p_dispatch_id: dispatchId, p_tenant_id: tenantId, p_provider_id: "provider-2",
    })).toThrow();
  });
});
