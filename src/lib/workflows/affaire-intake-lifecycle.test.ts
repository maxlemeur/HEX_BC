import { describe, expect, it, vi } from "vitest";

import {
  AffaireIntakeLeaseUnavailableError,
  AffaireIntakeProviderCallError,
  claimAffaireIntakeUpload,
  releaseAffaireIntakeUploadAfterError,
  renewAffaireIntakeUploadLease,
  runAffaireIntakeLeasedProviderEffect,
  type AffaireIntakeClaim,
} from "@/lib/workflows/affaire-intake-lifecycle";

const UPLOAD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-08-12T09:00:00.000Z");

const CLAIM: AffaireIntakeClaim = {
  uploadId: UPLOAD_ID,
  leaseToken: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  tenantId: TENANT_ID,
  projectId: PROJECT_ID,
  attemptCount: 1,
};

describe("affaire intake durable lifecycle", () => {
  it("normalizes a successful atomic claim", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            claimed: true,
            reason: "claimed",
            tenant_id: TENANT_ID,
            project_id: PROJECT_ID,
            upload_status: "processing",
            attempt_count: 1,
          },
        ],
        error: null,
      }),
    };

    const result = await claimAffaireIntakeUpload({
      client,
      uploadId: UPLOAD_ID,
      now: NOW,
    });

    expect(result.claimed).toBe(true);
    expect(result).toMatchObject({
      claim: {
        uploadId: UPLOAD_ID,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        attemptCount: 1,
      },
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "claim_affaire_intake_upload",
      expect.objectContaining({
        p_upload_id: UPLOAD_ID,
        p_now: NOW.toISOString(),
        p_max_attempts: 3,
      })
    );
  });

  it("returns inactive without acquiring a lease", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            claimed: false,
            reason: "tenant_inactive",
            tenant_id: TENANT_ID,
            project_id: PROJECT_ID,
            upload_status: "queued",
            attempt_count: 0,
          },
        ],
        error: null,
      }),
    };

    await expect(
      claimAffaireIntakeUpload({ client, uploadId: UPLOAD_ID, now: NOW })
    ).resolves.toEqual({
      claimed: false,
      reason: "tenant_inactive",
      status: "queued",
    });
  });

  it("does not invoke an external effect after a failed active-tenant lease renewal", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    };
    const effect = vi.fn();

    await expect(
      renewAffaireIntakeUploadLease({ client, claim: CLAIM, now: NOW }).then(
        effect
      )
    ).rejects.toBeInstanceOf(AffaireIntakeLeaseUnavailableError);
    expect(effect).not.toHaveBeenCalled();
  });

  it("renews before and after a provider effect and never swallows lease loss", async () => {
    const renewLease = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(
      new AffaireIntakeLeaseUnavailableError(UPLOAD_ID)
    );
    const effect = vi.fn().mockResolvedValue("generated");

    await expect(runAffaireIntakeLeasedProviderEffect({ renewLease, effect }))
      .rejects.toBeInstanceOf(AffaireIntakeLeaseUnavailableError);
    expect(effect).toHaveBeenCalledOnce();
    expect(renewLease).toHaveBeenCalledTimes(2);
  });

  it("does not invoke the provider when the pre-call lease renewal fails", async () => {
    const effect = vi.fn();
    await expect(runAffaireIntakeLeasedProviderEffect({
      renewLease: vi.fn().mockRejectedValue(new AffaireIntakeLeaseUnavailableError(UPLOAD_ID)),
      effect,
    })).rejects.toBeInstanceOf(AffaireIntakeLeaseUnavailableError);
    expect(effect).not.toHaveBeenCalled();
  });

  it("wraps provider failures separately so only those can use a fallback", async () => {
    const renewLease = vi.fn().mockResolvedValue(undefined);
    await expect(
      runAffaireIntakeLeasedProviderEffect({
        renewLease,
        effect: vi.fn().mockRejectedValue(new Error("provider down")),
      })
    ).rejects.toBeInstanceOf(AffaireIntakeProviderCallError);
    expect(renewLease).toHaveBeenCalledTimes(2);
  });

  it("prioritizes a lost lease over a provider failure so stale workers cannot persist fallbacks", async () => {
    const leaseError = new AffaireIntakeLeaseUnavailableError(UPLOAD_ID);
    const renewLease = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(leaseError);
    const effect = vi.fn().mockRejectedValue(new Error("provider down"));

    await expect(
      runAffaireIntakeLeasedProviderEffect({ renewLease, effect })
    ).rejects.toBe(leaseError);
    expect(effect).toHaveBeenCalledOnce();
    expect(renewLease).toHaveBeenCalledTimes(2);
  });

  it("requeues a failed first attempt with bounded backoff", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    };

    await expect(
      releaseAffaireIntakeUploadAfterError({
        client,
        claim: CLAIM,
        now: NOW,
        error: new Error("provider unavailable"),
      })
    ).resolves.toBe(true);

    expect(client.rpc).toHaveBeenCalledWith(
      "finish_affaire_intake_upload_attempt",
      expect.objectContaining({
        p_status: "queued",
        p_next_retry_at: "2026-08-12T09:00:30.000Z",
        p_last_error: "provider unavailable",
      })
    );
  });
});
