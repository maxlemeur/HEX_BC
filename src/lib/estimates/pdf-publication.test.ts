import { describe, expect, it } from "vitest";

import { buildContentAddressedEstimatePdfPath, isCanonicalEstimatePdfPath, isImmutableStorageObjectAlreadyPresent } from "@/lib/estimates/pdf-publication";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const SHA256 =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("estimate PDF path builders", () => {
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
