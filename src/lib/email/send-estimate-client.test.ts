import { afterEach, describe, expect, it, vi } from "vitest";

import { sendEstimateEmailRequest } from "@/lib/email/send-estimate-client";
import { ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE } from "@/lib/email/send-estimate-contract";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const input = {
  versionId: VERSION_ID,
  requestId: REQUEST_ID,
  payload: { to: "client@example.com", subject: "Devis", message: "Bonjour" },
};
const receipt = { version_id: VERSION_ID, request_id: REQUEST_ID, message_id: "email-1" };

describe("sendEstimateEmailRequest confirmation boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    null,
    {},
    { ok: false, data: receipt },
    { ok: true },
    receipt,
    { ok: true, data: { ...receipt, version_id: OTHER_ID } },
    { ok: true, data: { ...receipt, request_id: OTHER_ID } },
    { ok: true, data: { ...receipt, message_id: undefined } },
    { ok: true, data: { ...receipt, message_id: " " } },
    { ok: true, data: { ...receipt, message_id: 42 } },
    { ok: true, data: { ...receipt, request_id: "not-a-request" } },
    { ok: true, data: receipt, error: { code: "INTERNAL_ERROR" } },
    { ok: false, error: { code: "ESTIMATE_EMAIL_PROVIDER_REJECTED", message: "Refus" } },
  ])("preserves an ambiguous HTTP 200 result %# without starting another request", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(sendEstimateEmailRequest(input)).rejects.toMatchObject({
      message: ESTIMATE_EMAIL_CONFIRMATION_UNAVAILABLE,
      canStartNewRequest: false,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not automatically retry a rejected fetch", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(sendEstimateEmailRequest(input)).rejects.toMatchObject({ canStartNewRequest: false });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { error: { code: "ESTIMATE_EMAIL_PROVIDER_REJECTED", message: "Refus" } },
    { ok: true, error: { code: "ESTIMATE_EMAIL_PROVIDER_REJECTED", message: "Refus" } },
    { ok: false, data: receipt, error: { code: "ESTIMATE_EMAIL_PROVIDER_REJECTED", message: "Refus" } },
    { ok: false, error: { code: "ESTIMATE_EMAIL_PROVIDER_REJECTED" } },
  ])("does not authorize a fresh request from an invalid error envelope %#", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status: 500 })));
    await expect(sendEstimateEmailRequest(input)).rejects.toMatchObject({ canStartNewRequest: false });
  });

  it.each([
    ["ESTIMATE_EMAIL_PROVIDER_REJECTED", true],
    ["ESTIMATE_EMAIL_PDF_UNAVAILABLE", true],
    ["ESTIMATE_EMAIL_RETRY_REQUIRES_NEW_REQUEST", true],
    ["ESTIMATE_EMAIL_FINALIZE_UNKNOWN", false],
    ["INTERNAL_ERROR", false],
  ])("limits permission for a fresh request to named deterministic failures: %s", async (code, canStartNewRequest) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: false, error: { code, message: "Vérifiez le destinataire." },
    }, { status: 503 })));
    await expect(sendEstimateEmailRequest(input)).rejects.toMatchObject({
      message: "Vérifiez le destinataire.", canStartNewRequest,
    });
  });

  it("requires draft review after a confirmed version conflict without authorizing a new identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: false, error: { code: "VERSION_CONFLICT", message: "Le devis a changé." },
    }, { status: 409 })));
    await expect(sendEstimateEmailRequest(input)).rejects.toMatchObject({
      message: "Le devis a changé.", canStartNewRequest: false, requiresDraftReview: true,
    });
  });

  it.each([
    [409, { error: { code: "VERSION_CONFLICT", message: "Conflit" } }],
    [409, { ok: false, data: receipt, error: { code: "VERSION_CONFLICT", message: "Conflit" } }],
    [500, { ok: false, error: { code: "VERSION_CONFLICT", message: "Conflit" } }],
  ])("does not treat an ambiguous conflict envelope as permission to refresh the draft token", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status })));
    await expect(sendEstimateEmailRequest(input)).rejects.toMatchObject({
      canStartNewRequest: false, requiresDraftReview: false,
    });
  });
});
