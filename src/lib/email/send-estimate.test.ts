import { beforeEach, describe, expect, it, vi } from "vitest";

const resendMocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: resendMocks.send };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/estimates/pdf-generator", () => ({
  generateEstimatePdfNow: vi.fn(),
}));
vi.mock("@/lib/estimates/server", () => ({
  patchEstimateStatus: vi.fn(),
  verifyEstimateSeal: vi.fn(),
}));

import { sendEstimateEmail } from "@/lib/email/send-estimate";
import { badRequest } from "@/lib/estimates/errors";
import { generateEstimatePdfNow } from "@/lib/estimates/pdf-generator";
import {
  patchEstimateStatus,
  verifyEstimateSeal,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const UPDATED_AT = "2026-07-13T12:00:00.000Z";

function createSupabaseMock(status: "draft" | "sent" | "accepted" | "archived") {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: VERSION_ID,
                  tenant_id: TENANT_ID,
                  version_number: 2,
                  total_ttc_cents: 12000,
                  currency: "EUR",
                  status,
                  updated_at: UPDATED_AT,
                  estimate_projects: { name: "Projet test" },
                },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { role: "engineer" },
                  error: null,
                }),
              })),
            })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
    storage: {
      from: vi.fn(() => ({
        download: vi.fn().mockResolvedValue({
          data: new Blob(["pdf"]),
          error: null,
        }),
      })),
    },
  };
}

const request = {
  versionId: VERSION_ID,
  payload: {
    to: "client@example.com",
    subject: "Devis",
    message: "Bonjour",
  },
  requestUrl: "https://app.example.test/api/send",
};

describe("sendEstimateEmail workflow security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
    process.env.EMAIL_FROM = "noreply@example.com";
    vi.mocked(generateEstimatePdfNow).mockResolvedValue({
      file_path: `${TENANT_ID}/${VERSION_ID}.pdf`,
    } as never);
    resendMocks.send.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  it("does not generate or send when draft gating rejects the transition", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock("draft") as never
    );
    vi.mocked(patchEstimateStatus).mockRejectedValue(
      badRequest("Envoi bloque.", undefined, "ESTIMATE_GATING_BLOCKED")
    );

    await expect(sendEstimateEmail(request)).rejects.toMatchObject({
      code: "ESTIMATE_GATING_BLOCKED",
    });
    expect(generateEstimatePdfNow).not.toHaveBeenCalled();
    expect(resendMocks.send).not.toHaveBeenCalled();
  });

  it("rejects a finalized estimate before any PDF or provider call", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock("accepted") as never
    );

    await expect(sendEstimateEmail(request)).rejects.toMatchObject({
      code: "ESTIMATE_EMAIL_STATUS_FORBIDDEN",
    });
    expect(patchEstimateStatus).not.toHaveBeenCalled();
    expect(generateEstimatePdfNow).not.toHaveBeenCalled();
    expect(resendMocks.send).not.toHaveBeenCalled();
  });

  it("rejects a sent estimate whose seal no longer verifies", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock("sent") as never
    );
    vi.mocked(verifyEstimateSeal).mockResolvedValue({ valid: false } as never);

    await expect(sendEstimateEmail(request)).rejects.toMatchObject({
      code: "ESTIMATE_SEAL_INVALID",
    });
    expect(generateEstimatePdfNow).not.toHaveBeenCalled();
    expect(resendMocks.send).not.toHaveBeenCalled();
  });

  it("transitions a legitimate draft, regenerates its PDF, then sends it", async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue(
      createSupabaseMock("draft") as never
    );
    vi.mocked(patchEstimateStatus).mockResolvedValue({} as never);

    await expect(sendEstimateEmail(request)).resolves.toEqual({
      message_id: "email-1",
    });
    expect(patchEstimateStatus).toHaveBeenCalledWith(
      VERSION_ID,
      { status: "sent" },
      UPDATED_AT
    );
    expect(generateEstimatePdfNow).toHaveBeenCalledWith(VERSION_ID, {
      force: true,
      triggeredBy: "send",
    });
    expect(resendMocks.send).toHaveBeenCalledTimes(1);
  });
});
