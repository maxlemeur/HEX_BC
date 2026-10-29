import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/send-estimate", () => ({
  sendEstimateEmail: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/send/route";
import { sendEstimateEmail } from "@/lib/email/send-estimate";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

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

  it.each([null])("returns a validated receipt, including historical provider ID %s", async (messageId) => {
    const data = { version_id: VERSION_ID, request_id: REQUEST_ID, message_id: messageId };
    vi.mocked(sendEstimateEmail).mockResolvedValueOnce(data);
    const response = await POST(validRequest(), { params: Promise.resolve({ versionId: VERSION_ID }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data });
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
