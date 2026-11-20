import { describe, expect, it } from "vitest";

import { __securityTesting__ } from "@/lib/affaires/intake-upload-server";

describe("affaire intake resource budgets", () => {
  it("rejects an excessive file count before creating upload state", () => {
    const files = Array.from(
      { length: 21 },
      (_value, index) => new File(["x"], `piece-${index}.pdf`)
    );

    expect(() =>
      __securityTesting__.validateAffaireIntakeUploadBatch(files)
    ).toThrow(/ne peut pas dépasser 20 fichiers/);
  });

  it("rejects an excessive cumulative batch while preserving ordinary batches", () => {
    const first = new File(["x"], "lot-a.pdf");
    const second = new File(["x"], "lot-b.pdf");
    Object.defineProperty(first, "size", { value: 60 * 1024 * 1024 });
    Object.defineProperty(second, "size", { value: 50 * 1024 * 1024 });

    expect(() =>
      __securityTesting__.validateAffaireIntakeUploadBatch([first, second])
    ).toThrow(/volume cumule.*depasse 100 Mo/);
    expect(() =>
      __securityTesting__.validateAffaireIntakeUploadBatch([
        new File(["contenu"], "lot-legitime.pdf"),
      ])
    ).not.toThrow();
  });
});
