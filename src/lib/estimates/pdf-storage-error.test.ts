import { describe, expect, it } from "vitest";

import { classifyEstimatePdfStorageFailure } from "@/lib/estimates/pdf-storage-error";

describe("classifyEstimatePdfStorageFailure", () => {
  it("maps missing buckets to a provisioning error", () => {
    expect(
      classifyEstimatePdfStorageFailure(
        {
          statusCode: "404",
          error: "Bucket not found",
          message: "Bucket not found",
        },
        "upload"
      )
    ).toEqual({
      reason: "bucket_missing",
      message: "Le stockage PDF n'est pas configure pour cet environnement.",
    });
  });

  it("maps rejected service credentials to a server configuration error", () => {
    expect(
      classifyEstimatePdfStorageFailure(
        {
          statusCode: "403",
          error: "Unauthorized",
          message: "signature verification failed",
        },
        "upload"
      )
    ).toEqual({
      reason: "server_auth_invalid",
      message:
        "La configuration serveur Supabase du stockage PDF est invalide.",
    });
  });

  it("keeps generic upload and signing failures actionable", () => {
    expect(
      classifyEstimatePdfStorageFailure({ message: "storage down" }, "upload")
    ).toMatchObject({
      reason: "storage_unavailable",
      message: "Impossible d'enregistrer le PDF. Reessayez ou contactez un administrateur.",
    });
    expect(
      classifyEstimatePdfStorageFailure({ message: "storage down" }, "sign")
    ).toMatchObject({
      reason: "storage_unavailable",
      message:
        "Impossible de preparer le telechargement du PDF. Reessayez ou contactez un administrateur.",
    });
  });
});
