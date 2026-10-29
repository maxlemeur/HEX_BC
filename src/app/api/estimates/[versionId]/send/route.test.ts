import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/send-estimate", () => ({
  sendEstimateEmail: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/send/route";
import { sendEstimateEmail } from "@/lib/email/send-estimate";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function validRequest() {
  return new Request(`http://localhost/api/estimates/${VERSION_ID}/send`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": REQUEST_ID },
    body: JSON.stringify({ to: "client@example.com", subject: "Devis", message: "Bonjour" }),
  });
}

describe("estimate send route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["email-1", null])("returns a validated receipt, including historical provider ID %s", async (messageId) => {
    const data = { version_id: VERSION_ID, request_id: REQUEST_ID, message_id: messageId };
    vi.mocked(sendEstimateEmail).mockResolvedValueOnce(data);
    const response = await POST(validRequest(), { params: Promise.resolve({ versionId: VERSION_ID }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data });
  });

  it.each([
    undefined,
    { message_id: "email-1" },
    { version_id: OTHER_ID, request_id: REQUEST_ID, message_id: "email-1" },
    { version_id: VERSION_ID, request_id: OTHER_ID, message_id: "email-1" },
    { version_id: VERSION_ID, request_id: REQUEST_ID, message_id: "" },
  ])("does not expose an invalid or foreign backend receipt as HTTP success %#", async (data) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(sendEstimateEmail).mockResolvedValueOnce(data as Awaited<ReturnType<typeof sendEstimateEmail>>);
    const response = await POST(validRequest(), { params: Promise.resolve({ versionId: VERSION_ID }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(sendEstimateEmail).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it("returns 400 on invalid version id", async () => {
    const request = new Request("http://localhost/api/estimates/invalid-id/send", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: "client@example.com",
        subject: "Devis",
        message: "Bonjour",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: "invalid-id" }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
        }),
      })
    );
    expect(vi.mocked(sendEstimateEmail)).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid payload", async () => {
    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: "not-an-email",
        subject: "",
        message: "",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "VALIDATION_ERROR",
        }),
      })
    );
    expect(vi.mocked(sendEstimateEmail)).not.toHaveBeenCalled();
  });

  it("rejects a malformed idempotency key before dispatch", async () => {
    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "not-a-uuid",
      },
      body: JSON.stringify({
        to: "client@example.com",
        subject: "Devis",
        message: "Bonjour",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });

    expect(response.status).toBe(400);
    expect(vi.mocked(sendEstimateEmail)).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before dispatch", async () => {
    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: "client@example.com",
        subject: "Devis",
        message: "Bonjour",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "IDEMPOTENCY_KEY_REQUIRED",
        }),
      })
    );
    expect(vi.mocked(sendEstimateEmail)).not.toHaveBeenCalled();
  });
});
