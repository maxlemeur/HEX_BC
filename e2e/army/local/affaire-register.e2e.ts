import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect } from "e2e";

import { apiRequest, armyTest, createLineViaApi, ownEstimate, recordEvidence, resolveDownload } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "./calculation-gate-support";
import { assertOwnedLocalBackend } from "./legacy-v1-draft-support";

type Ui = Parameters<Parameters<typeof armyTest>[2]>[0];
type Entry = { id: string; text: string; kind: string; severity: string; status: string; metadata: object; updated_at: string };
const options = { session: "army", tags: ["critical", "local", "affaire-register"], trace: "off" as const, timeout: 180_000 };
const texts = ["DPGF manquant", "Plan des niveaux à compléter", "CCTP à recevoir", "Diamètres à confirmer", "Cheminement à valider"];

async function fixture(ui: Ui) {
  assertOwnedLocalBackend();
  await ui.app.open("/dashboard/affaires");
  const response = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(
    ui.browser, "POST", "/api/estimates", { project: { name: "ARMY-" + ui.army.runPrefix.slice(-4) }, version: { title: "Revue compacte" } },
  );
  expect(response.status).toBe(201);
  expect(response.body.ok).toBe(true);
  const ids = { projectId: response.body.data.project.id, versionId: response.body.data.version.id };
  ownEstimate(ui.army, ids);
  await createLineViaApi(ui.browser, ids.versionId, "Base de travail du registre");
  const owner = await ownedEstimateContext(ids.projectId);
  const entries: Entry[] = texts.map((text, index) => ({
    id: randomUUID(), text, kind: index < 3 ? "missing_piece" : "assumption",
    severity: index === 0 ? "critical" : "warning", status: "open", metadata: {},
    updated_at: new Date(Date.now() - index * 1000).toISOString(),
  }));
  const result = { ...ids, ...owner, entries };
  await insertEntries(result, entries);
  return result;
}

async function insertEntries(owner: { projectId: string; tenantId: string; userId: string }, entries: Entry[]) {
  const literal = "'" + JSON.stringify(entries).replaceAll("'", "''") + "'::jsonb";
  await querySql(
    "INSERT INTO public.affaire_register_entries(id, tenant_id, project_id, kind, text, severity, status, scope_type, scope_label, created_by, updated_by, metadata, updated_at) " +
    "SELECT r.id, '" + owner.tenantId + "', '" + owner.projectId + "', r.kind, r.text, r.severity, r.status, 'project', 'Affaire ARMY', '" +
    owner.userId + "', '" + owner.userId + "', r.metadata, r.updated_at FROM jsonb_to_recordset(" + literal +
    ") AS r(id uuid, text text, kind text, severity text, status text, metadata jsonb, updated_at timestamptz);",
  );
}

armyTest("REG01 compact register reveals details, filters and exports without changing its decisions", options, async (ui) => {
  const f = await fixture(ui);
  const path = "/dashboard/affaires/" + f.projectId + "?view=register";
  await ui.browser.setViewport({ width: 805, height: 954 });
  await ui.app.open(path);
  const register = ui.screen.getByRole("region", "Points à traiter", { exact: true });
  await expect(register).toBeVisible();
  await expect(register.getByTestId("register-open-count")).toHaveText("5 points ouverts");
  await expect(register.getByText("1 point bloque la remise", { exact: true })).toBeVisible();
  await expect(register.getByRole("article")).toHaveCount(5);
  const desktopShot = await ui.app.screenshot("register-compact-805");
  const critical = register.getByRole("button", "Traiter DPGF manquant", { exact: true });
  const criticalCard = register.getByRole("article").filter({ hasText: texts[0] });
  await expect(critical).toHaveAttribute("aria-expanded", "false");
  await expect(criticalCard.getByText("Décision à prendre", { exact: true })).not.toBeVisible();
  await critical.click();
  await expect(critical).toHaveAttribute("aria-expanded", "true");
  await expect(criticalCard.getByText("Ce point concerne toute l'affaire Affaire ARMY.", { exact: true })).toBeVisible();
  await critical.click();

  await register.getByRole("button", "Bloquants 1", { exact: true }).click();
  await expect(register.getByRole("article")).toHaveCount(1);
  await expect(ui.browser).toHaveURL(/registerBlocking=1/);
  await ui.browser.reload();
  await expect(register.getByRole("button", "Bloquants 1", { exact: true })).toHaveAttribute("aria-pressed", "true");
  await register.getByRole("button", "Tous", { exact: true }).click();
  await expect(register.getByRole("article")).toHaveCount(5);
  await register.getByRole("button", "Filtres du registre", { exact: true }).click();
  await register.getByRole("combobox", "Filtrer par type", { exact: true }).selectOption({ value: "assumption" });
  await expect(register.getByRole("article")).toHaveCount(2);
  await register.getByRole("button", "Réinitialiser", { exact: true }).click();
  await expect(register.getByRole("article")).toHaveCount(5);
  await register.getByRole("button", "Filtres du registre", { exact: true }).click();

  await register.getByRole("button", "Actions du registre", { exact: true }).press("Enter");
  const exportItem = ui.screen.getByRole("menuitem", "Exporter la revue", { exact: true });
  await expect(exportItem).toBeVisible();
  await ui.browser.evaluate(async () => {
    await Promise.all(document.getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => null)));
    return true;
  });
  const menuShot = await ui.app.screenshot("register-export-menu");
  const downloads = await ui.browser.waitForDownloads(() => exportItem.click(), { count: 2 });
  expect(downloads.map((download) => download.suggestedFilename.split(".").at(-1)).sort()).toEqual(["csv", "txt"]);
  const contents = await Promise.all(downloads.map(async (download) => readFile(await resolveDownload(download), "utf8")));
  for (const text of texts) expect(contents.join("\n")).toContain(text);

  // Legacy links have no view parameter: clearing their filters must keep the
  // register selected, including after a real server reload.
  await ui.app.open("/dashboard/affaires/" + f.projectId + "?registerStatus=open&registerSeverity=critical#register");
  await expect(critical).toBeVisible();
  await register.getByRole("button", "Tous", { exact: true }).click();
  await expect(ui.browser).toHaveURL(/view=register/);
  await expect(register.getByRole("article")).toHaveCount(5);
  await ui.browser.reload();
  await expect(register).toBeVisible();

  const assumption = register.getByRole("article").filter({ hasText: texts[3] });
  await assumption.getByRole("button", "Traiter " + texts[3], { exact: true }).click();
  await assumption.getByRole("button", "Marquer comme traité Le point est considéré comme levé ou accepté.", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Marquer ce point comme traité", { exact: true });
  await dialog.getByRole("textbox").fill("Pièce et hypothèse vérifiées pendant la recette ARMY.");
  await dialog.getByRole("button", "Marquer comme traité", { exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(register.getByTestId("register-open-count")).toHaveText("4 points ouverts");
  const [status] = await querySql("SELECT status FROM public.affaire_register_entries WHERE id = '" + f.entries[3].id + "' AND tenant_id = '" + f.tenantId + "';");
  expect(status).toBe("validated");
  await ui.browser.reload();
  await expect(register.getByTestId("register-open-count")).toHaveText("4 points ouverts");
  await assumption.getByRole("button", "Traiter " + texts[3], { exact: true }).click();
  await assumption.getByRole("button", "Rouvrir le point Le point redevient actif dans le registre.", { exact: true }).click();
  const reopen = ui.screen.getByRole("dialog", "Rouvrir cette entrée", { exact: true });
  await reopen.getByRole("button", "Confirmer la réouverture", { exact: true }).click();
  await expect(reopen).toBeHidden();
  await expect(register.getByTestId("register-open-count")).toHaveText("5 points ouverts");

  await ui.app.open(path + "&registerFocus=" + f.entries[0].id);
  await expect(critical).toHaveAttribute("aria-expanded", "true");
  await ui.browser.reload();
  await expect(critical).toHaveAttribute("aria-expanded", "true");
  await critical.click();
  await register.getByRole("button", "Ajouter un point", { exact: true }).click();
  await expect(register.getByRole("heading", "Ajouter un point manuel", { exact: true })).toBeVisible();
  await register.getByRole("button", "Fermer", { exact: true }).click();
  await ui.browser.setViewport({ width: 390, height: 844 });
  await ui.app.open(path);
  await expect(critical).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => ui.browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobileShot = await ui.app.screenshot("register-compact-mobile");
  await critical.click();
  await expect(critical).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => ui.browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await recordEvidence(ui.army, "register-compact", { ...f, downloads: downloads.map((d) => d.path), screenshots: { desktopShot, menuShot, mobileShot }, persistedStatus: status, mobileOverflow: false });
});

armyTest("REG02 blocking register includes old client decisions and revalidations before pagination", options, async (ui) => {
  const f = await fixture(ui);
  const old = "2026-01-01T12:00:00.000Z";
  const extra: Entry[] = Array.from({ length: 12 }, (_, index) => ({
    id: randomUUID(), text: "Point non bloquant " + index, kind: "assumption", severity: "warning", status: "open", metadata: {},
    updated_at: new Date(Date.now() + index * 1000).toISOString(),
  }));
  extra.push(
    { id: randomUUID(), text: "Retour client critique ancien", kind: "assumption", severity: "critical", status: "clarify_with_client", metadata: {}, updated_at: old },
    { id: randomUUID(), text: "Revalidation ancienne non critique", kind: "assumption", severity: "warning", status: "open", updated_at: old,
      metadata: { revalidationRequest: { status: "required", requestedAt: old, requestedByUserId: f.userId, previousStatus: "validated", cause: "addendum_received", impactedStages: ["submission_readiness"] } } },
    { id: randomUUID(), text: "Critique déjà traité", kind: "assumption", severity: "critical", status: "validated", metadata: {}, updated_at: new Date().toISOString() },
  );
  await insertEntries(f, extra);
  await ui.app.open("/dashboard/affaires/" + f.projectId + "?view=register");
  const register = ui.screen.getByRole("region", "Points à traiter", { exact: true });
  await expect(register.getByRole("button", "Charger les points suivants", { exact: true })).toBeEnabled();
  await expect(register.getByRole("button", "Traiter Retour client critique ancien", { exact: true })).toHaveCount(0);
  await register.getByRole("button", "Bloquants 3", { exact: true }).click();
  await expect(register.getByRole("article")).toHaveCount(3);
  await expect(register.getByRole("button", "Traiter DPGF manquant", { exact: true })).toBeVisible();
  await expect(register.getByRole("button", "Traiter Retour client critique ancien", { exact: true })).toBeVisible();
  await expect(register.getByRole("button", "Traiter Revalidation ancienne non critique", { exact: true })).toBeVisible();
  await expect(register.getByRole("button", "Traiter Critique déjà traité", { exact: true })).toHaveCount(0);
  await ui.browser.reload();
  await expect(register.getByRole("article")).toHaveCount(3);
  await expect(register.getByText("3 points bloquent la remise", { exact: true })).toBeVisible();
  await recordEvidence(ui.army, "register-blocking-pages", { projectId: f.projectId, oldBlockers: extra.slice(12, 14).map((entry) => entry.id), expectedBlockers: 3, excludesResolvedCritical: true });
});
