import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { recordEvidence } from "../critical/fixtures";

const UNSOURCED_TEXT = "ARMY calorifuge sans justificatif";
const ASSOCIATED_TEXT = "ARMY supportage associé au document";
const EDITED_TEXT = "ARMY supportage corrigé sans justificatif";
const FILE_NAME = "ARMY-CCTP-reference.txt";
const UNCERTAIN_LABEL = "Inférence / sans preuve directe";

// Seed contract and failure modes: docs/testing/brief-evidence.md.
// The owned native runner provisions this brief and its source document for each run.
test("brief document associations remain distinct from proof after edit and reload", {
  session: "army",
  tags: ["critical", "local", "brief-evidence"],
  trace: "off",
  timeout: 120_000,
}, async ({ app, browser, screen }) => {
  const projectId = process.env.E2E_BRIEF_EVIDENCE_PROJECT_ID;
  const documentId = process.env.E2E_BRIEF_EVIDENCE_DOCUMENT_ID;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!projectId || !documentId || !uuid.test(projectId) || !uuid.test(documentId)) {
    throw new Error("A preseeded ARMY brief and document are required; provide E2E_BRIEF_EVIDENCE_PROJECT_ID and E2E_BRIEF_EVIDENCE_DOCUMENT_ID.");
  }
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!(["127.0.0.1", "localhost", "[::1]"].includes(backend.hostname))) {
    throw new Error("The brief evidence journey requires an isolated loopback Supabase.");
  }
  const origin = new URL(app.baseUrl!).origin;
  await browser.route("**/*", async (route) => {
    const url = new URL(route.request.url);
    if (url.hostname === "api.fontshare.com" && route.request.method === "GET") {
      await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
      return;
    }
    const localRead = url.origin === backend.origin && ["GET", "HEAD", "OPTIONS"].includes(route.request.method);
    const localAuth = url.origin === backend.origin && url.pathname.startsWith("/auth/v1/");
    if (url.origin !== origin && !localRead && !localAuth) {
      await route.abort();
      throw new Error("Brief evidence journey blocked a request outside the isolated application.");
    }
    await route.continue();
  });

  const brief = screen.getByRole("region", "Brief affaire", { exact: true });
  const unsourcedRow = brief.getByRole("listitem").filter({ hasText: UNSOURCED_TEXT });
  const associatedRow = brief.getByRole("listitem").filter({ hasText: ASSOCIATED_TEXT });
  const editedRow = brief.getByRole("listitem").filter({ hasText: EDITED_TEXT });
  await app.open(`/dashboard/affaires/${projectId}#brief`);
  await expect(brief).toBeVisible();
  await expect(brief.getByText("Brief de référence", { exact: true })).toBeVisible();
  await expect(unsourcedRow).toContainText(UNCERTAIN_LABEL);
  await expect(unsourcedRow.getByRole("link")).toHaveCount(0);
  await expect(associatedRow).toContainText("Passage non vérifié");
  const associatedLink = associatedRow.getByRole("link", `Document associé · ${FILE_NAME}`, { exact: true });
  await expect(associatedLink).toHaveAttribute(
    "href",
    `/dashboard/affaires/${projectId}?intakeDocument=${documentId}&briefBlock=scope&briefEntry=1#intake`
  );
  await associatedLink.tap();
  await expect(browser).toHaveURL(new RegExp(`intakeDocument=${documentId}.*briefEntry=1#intake$`));
  await expect(screen.getByRole("dialog", "Documents du dossier", { exact: true }).getByRole("button", FILE_NAME, { exact: true })).toBeVisible();

  await screen.getByRole("dialog", "Documents du dossier", { exact: true }).getByRole("button", "Fermer", { exact: true }).tap();
  await brief.getByRole("button", "Modifier", { exact: true }).tap();
  await brief.getByDisplayValue(ASSOCIATED_TEXT, { exact: true }).fill(EDITED_TEXT);
  await brief.getByRole("button", "Enregistrer et revalider", { exact: true }).tap();
  await expect(editedRow).toContainText(UNCERTAIN_LABEL);
  await expect(editedRow.getByRole("link")).toHaveCount(0);
  await browser.reload();
  await expect(editedRow).toContainText(UNCERTAIN_LABEL);
  await expect(editedRow.getByRole("link")).toHaveCount(0);
  await expect(unsourcedRow).toContainText(UNCERTAIN_LABEL);
  await expect(brief.getByText("À confirmer", { exact: true })).toBeVisible();

  const confirmButton = screen.getByRole("button", /^Confirmer le brief(?: affaire)?$/).first();
  if (await confirmButton.isVisible()) {
    await confirmButton.tap();
  } else {
    await screen.getByRole("link", "Confirmer le brief", { exact: true }).first().tap();
  }
  await brief.getByRole("button", "Oui, confirmer", { exact: true }).tap();
  await expect(brief.getByText("Brief de référence", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(brief.getByText("Brief de référence", { exact: true })).toBeVisible();
  await expect(editedRow).toContainText(UNCERTAIN_LABEL);
  await expect(editedRow.getByRole("link")).toHaveCount(0);
  await expect(unsourcedRow).toContainText(UNCERTAIN_LABEL);

  await recordEvidence({ runPrefix: `ARMY-brief-${Date.now()}`, projectName: "ARMY brief evidence", ownedEstimates: [] }, "brief-evidence", {
    projectId, documentId, sourceFileName: FILE_NAME,
    expected: { editedText: EDITED_TEXT, editedDocumentLinks: 0, uncertaintyAfterConfirmation: true },
    actual: { editedText: await editedRow.textContent(), editedDocumentLinks: await editedRow.getByRole("link").count(), unsourcedText: await unsourcedRow.textContent(), confirmed: await brief.getByText("Brief de référence", { exact: true }).isVisible() },
    environment: "isolated-loopback", backendOrigin: backend.origin,
  });
});
