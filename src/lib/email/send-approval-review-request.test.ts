import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

import { sendApprovalReviewRequestNotification } from "@/lib/email/send-approval-review-request";

const input = {
  recipientEmail: "validateur@exemple.invalid",
  reviewerName: "Valideur",
  requesterName: "Demandeur",
  projectName: "Affaire inventée",
  versionNumber: 2,
  ruleLabels: ["Marge minimale"],
};
const VARIABLES = ["RESEND_API_KEY", "EMAIL_FROM", "EMAIL_DELIVERY_MODE", "EMAIL_REDIRECT_TO"] as const;

describe("approval review request email", () => {
  beforeEach(() => {
    send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@example.com";
    delete process.env.EMAIL_DELIVERY_MODE;
    delete process.env.EMAIL_REDIRECT_TO;
  });
  afterEach(() => {
    for (const name of VARIABLES) delete process.env[name];
  });

  it("goes to the test mailbox, the reviewer named in the subject, when delivery is redirected", async () => {
    process.env.EMAIL_REDIRECT_TO = "recette@test.invalid";

    const result = await sendApprovalReviewRequestNotification(input);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      from: "noreply@example.com",
      to: "recette@test.invalid",
      subject: "[TEST → validateur@exemple.invalid] Validation requise - Affaire inventée V2",
    });
    // What the caller records is the subject as written.
    expect(result).toEqual({ message_id: "email-1", subject: "Validation requise - Affaire inventée V2" });
  });

  it("calls no provider when redirecting has no mailbox", async () => {
    await expect(sendApprovalReviewRequestNotification(input)).rejects.toMatchObject({ code: "EMAIL_REDIRECT_NOT_CONFIGURED" });
    expect(send).not.toHaveBeenCalled();
  });

  it("reaches the reviewer only when delivery is live", async () => {
    process.env.EMAIL_DELIVERY_MODE = "live";

    await sendApprovalReviewRequestNotification(input);

    expect(send.mock.calls[0]![0]).toMatchObject({
      to: "validateur@exemple.invalid",
      subject: "Validation requise - Affaire inventée V2",
    });
  });
});
