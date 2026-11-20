import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { DevisPreviewModal } from "./DevisPreviewModal";

it("previews the sender, text and attachment of an existing supplier email", async () => {
  const email = [
    "From: Fournisseur Exemple <devis@example.test>",
    "To: achats@example.test",
    "Subject: Disponibilite du materiel",
    "MIME-Version: 1.0",
    "Content-Type: multipart/mixed; boundary=confirmation",
    "",
    "--confirmation",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Les pièces sont disponibles lundi.",
    "--confirmation",
    "Content-Type: text/plain",
    'Content-Disposition: attachment; filename="delai.txt"',
    "",
    "Lundi",
    "--confirmation--",
    "",
  ].join("\r\n");

  render(<DevisPreviewModal open onClose={vi.fn()} devis={{
    id: "email",
    name: "Courrier du fournisseur",
    originalFilename: "confirmation.eml",
    mimeType: "message/rfc822",
    fileSizeBytes: new TextEncoder().encode(email).byteLength,
    createdAt: "2026-11-20T12:00:00Z",
    position: 0,
    downloadUrl: `data:message/rfc822;charset=utf-8,${encodeURIComponent(email)}`,
  }} />);

  const preview = within(screen.getByRole("dialog", { name: "Courrier du fournisseur" }));
  expect(await preview.findByText("Disponibilite du materiel")).toBeVisible();
  expect(preview.getByText("Fournisseur Exemple <devis@example.test>")).toBeVisible();
  expect(preview.getByText("Les pièces sont disponibles lundi.")).toBeVisible();
  expect(preview.getByText("delai.txt")).toBeVisible();
});
