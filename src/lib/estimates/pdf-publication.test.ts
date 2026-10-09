import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/estimates/errors";
import { beginEstimatePdfGeneration, buildContentAddressedEstimatePdfPath, buildLegacyEstimatePdfPath, failEstimatePdfGeneration, isCanonicalEstimatePdfPath, isImmutableStorageObjectAlreadyPresent, type EstimatePdfGenerationClaim } from "@/lib/estimates/pdf-publication";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DISPATCH_ID = "55555555-5555-4555-8555-555555555555";
const GENERATION_TOKEN = "66666666-6666-4666-8666-666666666666";
const SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const claim: EstimatePdfGenerationClaim = {
  token: GENERATION_TOKEN,
  purpose: "email",
  dispatchId: DISPATCH_ID,
  contentRevision: 8,
};

describe("estimate PDF path builders", () => {
  it("builds content-addressed and legacy paths with the expected prefix and extension", () => {
    const contentAddressed = buildContentAddressedEstimatePdfPath({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      sha256Hash: SHA256.toUpperCase(),
    });
    const legacy = buildLegacyEstimatePdfPath({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
    });

    expect(contentAddressed).toBe(
      `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}/${SHA256}.pdf`,
    );
    expect(contentAddressed.endsWith(".pdf")).toBe(true);
    expect(legacy).toBe(`${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`);
    expect(() =>
      buildContentAddressedEstimatePdfPath({
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
        sha256Hash: "not-a-hash",
      }),
    ).toThrow("Invalid estimate PDF SHA-256 hash.");
  });

  it("accepts legacy filenames and matching content-addressed objects as canonical", () => {
    const contentAddressed = buildContentAddressedEstimatePdfPath({
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      sha256Hash: SHA256,
    });

    expect(
      isCanonicalEstimatePdfPath({
        filePath: `${TENANT_ID}/${PROJECT_ID}/${VERSION_ID}.pdf`,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
      }),
    ).toBe(true);
    expect(
      isCanonicalEstimatePdfPath({
        filePath: contentAddressed,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
        sha256Hash: SHA256.toUpperCase(),
      }),
    ).toBe(true);
    expect(
      isCanonicalEstimatePdfPath({
        filePath: `${TENANT_ID}/${PROJECT_ID}/other/${VERSION_ID}.pdf`,
        tenantId: TENANT_ID,
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
        sha256Hash: SHA256,
      }),
    ).toBe(false);
  });

  it("detects immutable storage collisions from status and message", () => {
    expect(
      isImmutableStorageObjectAlreadyPresent({
        statusCode: "409",
        error: "Duplicate",
        message: "The resource already exists",
      }),
    ).toBe(true);
    expect(
      isImmutableStorageObjectAlreadyPresent({
        status: 400,
        message: "Duplicate object key",
      }),
    ).toBe(true);
    expect(
      isImmutableStorageObjectAlreadyPresent({
        status: 500,
        message: "already exists",
      }),
    ).toBe(false);
    expect(isImmutableStorageObjectAlreadyPresent("already exists")).toBe(false);
  });
});

describe("estimate PDF generation RPCs", () => {
  const rpc = vi.fn();
  const client = { rpc } as never;

  beforeEach(() => {
    rpc.mockReset();
  });

  it("maps superseded and forbidden publication errors", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: {
        message: "ESTIMATE_PDF_GENERATION_SUPERSEDED",
        code: "P0001",
      },
    });

    await expect(
      beginEstimatePdfGeneration({
        client,
        versionId: VERSION_ID,
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        purpose: "manual",
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "ESTIMATE_PDF_GENERATION_SUPERSEDED",
    } satisfies Partial<ApiError>);

    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "SERVICE_ROLE_REQUIRED", code: "42501" },
    });

    await expect(
      failEstimatePdfGeneration({
        client,
        versionId: VERSION_ID,
        tenantId: TENANT_ID,
        actorUserId: USER_ID,
        claim,
        message: "renderer timeout",
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "ESTIMATE_PDF_CONTRACT_IMMUTABLE",
    });
  });
});
