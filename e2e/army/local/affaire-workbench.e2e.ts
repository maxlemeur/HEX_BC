import { test } from "@e2e-dev/web";
import { expect } from "e2e";

// The owned runner seeds a dossier with a real document and brief. Navigation
// must expose the requested domain without exposing all the other domains or
// starting a confirmation. Reloads, old links and narrow screens must agree.
test("affaire workbench separates dossier, pricing and review without losing deep links", {
  session: "army",
  tags: ["critical", "local", "affaire-workbench"],
  trace: "off",
  timeout: 120_000,
}, async ({ app, browser, screen }) => {
  const projectId = process.env.E2E_BRIEF_EVIDENCE_PROJECT_ID;
  if (!projectId) throw new Error("The owned brief evidence fixture is required.");
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)) {
    throw new Error("Workbench qualification requires the owned loopback stack.");
  }
  // Opening the affaire reconciles its plans and refreshes the page when they changed. An
  // address written during that refresh has once left the documents closed and the loading
  // indicator on (a race of the page, open and outside this journey's subject), so the
  // navigation below starts once the reconciliation and its refresh have landed.
  const reconciled = browser.waitForResponse(/\/api\/affaires\/[^/]+\/intake\/reconcile-plans$/, { timeout: 30_000 });
  await app.open(`/dashboard/affaires/${projectId}`);
  const reconciliation = await (await reconciled).json<{ data?: { changed?: boolean } }>();
  if (reconciliation.data?.changed) {
    // Watched in the page: an indicator shown and gone between two reads would be missed.
    await browser.evaluate(() => new Promise<boolean>((resolve) => {
      const indicator = { appeared: document.querySelector(".navigation-feedback") !== null };
      const observer = new MutationObserver(() => {
        if (document.querySelector(".navigation-feedback")) indicator.appeared = true;
        else if (indicator.appeared) { observer.disconnect(); resolve(true); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(false); }, 5_000);
    }));
  }
  await expect(screen.getByRole("status", "Chargement en cours…", { exact: true })).not.toBeVisible();
  const navigation = screen.getByRole("navigation", "Navigation de l'affaire", { exact: true });
  await navigation.getByRole("button", "Dossier", { exact: true }).click();
  await expect(screen.getByRole("heading", "Préparer le dossier", { exact: true })).toBeVisible();
  const documentButton = screen.getByRole("button", "ARMY-CCTP-reference.txt", { exact: true });
  await expect(documentButton).toBeVisible();
  await documentButton.click();
  const drawer = screen.getByRole("dialog", "Documents du dossier", { exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", "ARMY-CCTP-reference.txt", { exact: true })).toBeVisible();
  await drawer.getByRole("button", "Fermer", { exact: true }).click();
  await expect(drawer).not.toBeVisible();
  // Opening a document leaves its deep link in the history. Start this separate
  // dossier/brief history check from an explicit dossier navigation.
  await navigation.getByRole("button", "Dossier", { exact: true }).click();
  await expect(browser).toHaveURL(new RegExp(`${projectId}\\?view=dossier$`));
  const brief = screen.getByRole("region", "Brief affaire", { exact: true });
  await expect(brief).not.toBeVisible();
  await screen.getByRole("button", "Revoir le brief", { exact: true }).click();
  await expect(brief).toBeVisible();
  await expect(screen.getByRole("alertdialog", "Confirmer ce brief ?", { exact: true })).not.toBeVisible();
  // The brief is now an exclusive dossier surface. Its URL and visible state
  // must agree in both directions of the browser history, not only on reload.
  await browser.back();
  await expect(screen.getByRole("heading", "Préparer le dossier", { exact: true })).toBeVisible();
  await expect(brief).not.toBeVisible();
  await browser.forward();
  await expect(brief).toBeVisible();
  await brief.getByRole("button", "Retour au dossier", { exact: true }).click();
  await expect(screen.getByRole("heading", "Préparer le dossier", { exact: true })).toBeVisible();
  await browser.back();
  await expect(brief).toBeVisible();
  await browser.forward();
  await expect(brief).not.toBeVisible();
  await screen.getByRole("button", "Revoir le brief", { exact: true }).click();
  await navigation.getByRole("button", "Chiffrage", { exact: true }).click();
  await expect(screen.getByRole("heading", "Résumé financier", { exact: true })).toBeVisible();
  await expect(brief).not.toBeVisible();
  await browser.reload();
  await expect(screen.getByRole("heading", "Résumé financier", { exact: true })).toBeVisible();
  await app.open(`/dashboard/affaires/${projectId}?registerStatus=open&registerSeverity=critical#register`);
  await expect(screen.getByRole("heading", "Registre hypothèses & pièces manquantes", { exact: true })).toBeVisible();
  await expect(screen.getByRole("heading", "Résumé financier", { exact: true })).not.toBeVisible();
  await app.open(`/dashboard/affaires/${projectId}#finish-line-orders`);
  await expect(screen.getByRole("heading", "Brouillons par fournisseur, sans ressaisie", { exact: true })).toBeVisible();
  await app.open(`/dashboard/affaires/${projectId}#brief`);
  await expect(brief).toBeVisible();
  await browser.setViewport({ width: 390, height: 844 });
  await expect.poll(() => browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await navigation.getByRole("button", "Dossier", { exact: true }).click();
  await expect(screen.getByRole("button", "Revoir le brief", { exact: true })).toBeVisible();
  await expect.poll(() => browser.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
