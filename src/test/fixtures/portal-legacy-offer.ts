import { createHash } from "node:crypto";

import legacyVectors from "@/test/fixtures/offer-contract-legacy-vectors.json";

/** Synthetic Storage bytes and a fixed historical seal; not a rendered PDF. */
export function createPortalLegacyOfferFixture() {
  const vector = legacyVectors.vectors.find(
    (entry) => entry.id === "source-defaults/engine1/payload2"
  );
  if (!vector) throw new Error("Historical offer vector is missing.");

  const { input, sha256 } = structuredClone(vector);
  const version = {
    ...input.version,
    status: "sent",
    content_revision: 7,
    updated_at: "2026-08-12T08:00:00.000Z",
    seal_payload_version: 2,
    seal_hash: sha256,
  };
  const bytes = Buffer.from("%PDF-1.4\n% Synthetic route-test fixture\n%%EOF\n");
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const document = {
    id: "55555555-5555-4555-8555-555555555555",
    tenant_id: version.tenant_id,
    version_id: version.id,
    status: "ready",
    file_path: `${version.tenant_id}/${version.project_id}/${version.id}/${fileHash}.pdf`,
    sha256_hash: fileHash,
    file_size_bytes: bytes.byteLength,
    generated_at: "2026-08-12T08:01:00.000Z",
    generated_by: "66666666-6666-4666-8666-666666666666",
    published_generation_token: null,
    published_purpose: "legacy",
    published_dispatch_id: null,
    published_content_revision: version.content_revision,
    client_contract_version: null,
    client_contract_snapshot: null,
    layout_options: {
      preset: "client_detailed",
      detailLevel: "lines",
      priceMode: "unit_and_total",
      density: "standard",
      showNumbering: true,
      showSectionSubtotals: true,
      conditionsPlacement: "auto",
      includeTerms: true,
    },
    terms_snapshot: {
      templateId: "11111111-1111-4111-8111-111111111111",
      title: "CGV",
      body: "Conditions contractuelles",
      version: 3,
      legalReviewedAt: "2026-07-01T00:00:00.000Z",
      capturedAt: "2026-07-20T00:00:00.000Z",
    },
  };

  return { version, items: input.items, document, blob: new Blob([bytes]) };
}
