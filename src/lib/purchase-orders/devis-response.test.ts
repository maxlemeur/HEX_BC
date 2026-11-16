import { describe, expect, it } from "vitest";

import { toDevisResponseItem, type DevisRecord } from "@/lib/purchase-orders/devis-response";

const record: DevisRecord = {
  id: "devis-1",
  created_at: "2026-11-16T09:30:00.000Z",
  name: "Devis fournisseur fictif",
  original_filename: "devis-fictif.pdf",
  storage_path: "tenant-1/order-1/devis-1.pdf",
  file_size_bytes: 20480,
  mime_type: "application/pdf",
  position: 2,
};

describe("toDevisResponseItem", () => {
  it("maps the row to the camelCase response and never exposes the storage path", () => {
    const item = toDevisResponseItem(record, "https://storage.test/signed/devis-1");

    expect(item).toEqual({
      id: "devis-1",
      name: "Devis fournisseur fictif",
      originalFilename: "devis-fictif.pdf",
      fileSizeBytes: 20480,
      mimeType: "application/pdf",
      createdAt: "2026-11-16T09:30:00.000Z",
      position: 2,
      downloadUrl: "https://storage.test/signed/devis-1",
    });
    expect(JSON.stringify(item)).not.toContain(record.storage_path);
  });

  it("keeps a null download URL when signing failed", () => {
    expect(toDevisResponseItem(record, null).downloadUrl).toBeNull();
  });
});
