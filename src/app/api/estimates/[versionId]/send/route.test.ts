import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email/send-estimate", () => ({
  sendEstimateEmail: vi.fn(),
}));

import { POST } from "@/app/api/estimates/[versionId]/send/route";
import { internalError } from "@/lib/estimates/errors";
import { sendEstimateEmail } from "@/lib/email/send-estimate";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const IDEMPOTENCY_KEY = "44444444-4444-4444-8444-444444444444";

describe("estimate send route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("sends estimate email and returns success payload", async () => {
    vi.mocked(sendEstimateEmail).mockResolvedValue({
      message_id: "email_123",
    } as never);

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
      },
      body: JSON.stringify({
        to: " client@example.com ",
        cc: [" copy@example.com "],
        subject: " Devis Hydro ",
        message: " Bonjour ",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ versionId: VERSION_ID }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      data: {
        message_id: "email_123",
      },
    });
    expect(vi.mocked(sendEstimateEmail)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      payload: {
        to: "client@example.com",
        cc: ["copy@example.com"],
        subject: "Devis Hydro",
        message: "Bonjour",
      },
      requestUrl: request.url,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("maps service failures to error response", async () => {
    vi.mocked(sendEstimateEmail).mockRejectedValue(
      internalError("Erreur lors de l'envoi de l'email.")
    );

    const request = new Request(`http://localhost/api/estimates/${VERSION_ID}/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": IDEMPOTENCY_KEY,
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

    expect(response.status).toBe(500);
    expect(payload).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "INTERNAL_ERROR",
          message: "Erreur lors de l'envoi de l'email.",
        }),
      })
    );
  });
});
