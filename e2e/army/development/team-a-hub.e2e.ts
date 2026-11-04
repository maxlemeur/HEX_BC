import { describe, expect } from "e2e";
import { nativeTest as test, buildEstimateName, loginWithUi, type NativeUi } from "../takeoff/native-ui";


async function createTeamAHubEstimateViaApi(ui: NativeUi, options: { projectName: string; title: string }) {
 const response = await ui.request.post("/api/estimates", { data: { project: { name: options.projectName }, version: { title: options.title } } });
 expect(response.status()).toBe(201);
 const payload = await response.json() as { data: { project: {id:string}; version: {id:string} } };
 return { projectId: payload.data.project.id, versionId: payload.data.version.id };
}
async function openTeamADevHubScenario(ui: NativeUi, input: { projectId: string; scenario: string }) {
 await ui.goto(`/dashboard/affaires/${input.projectId}?devHubScenario=${input.scenario}`);
 await expect(ui.getByRole("heading", { name: "Pilotage de l'affaire" })).toBeVisible();
}
function getTeamARegisterSection(ui: NativeUi) {
 return ui.locator("section").filter({ has: ui.getByRole("heading", { name: "Registre hypothèses & pièces manquantes" }) });
}
// Since f63d9cd6 the study panel (status, hero and dominant action) is folded in the current Étude stage.
async function openTeamAStudyPanel(ui: NativeUi) {
 const pilotage = ui.getByRole("region", { name: "Pilotage de l'affaire" });
 await expect(pilotage.getByRole("button", { name: /Étude/ })).toHaveAttribute("aria-expanded", "true");
 const studyPanel = ui.locator("details").filter({ has: ui.getByText("Choisir la base du devis et les métrés", { exact: true }) });
 await studyPanel.getByText("Choisir la base du devis et les métrés", { exact: true }).click();
 await expect(studyPanel.getByText("Prochaine étape", { exact: true })).toBeVisible();
 return studyPanel;
}
// f63d9cd6 also folds the register with the other dossier cards under « Détails du dossier et du devis ».
async function openTeamARegisterSection(ui: NativeUi) {
 await ui.getByText("Détails du dossier et du devis", { exact: true }).click();
 await expect(ui.getByRole("heading", { name: "Registre hypothèses & pièces manquantes" })).toBeVisible();
 return getTeamARegisterSection(ui);
}



describe("Team A hub synthetic dev scenarios", { session: "army", tags: ["critical", "development"], timeout: 180_000 }, () => {


  test.beforeEach(async ({ ui: page }) => {
    await loginWithUi(page);
  });

  test("keeps a readable under-reservations path with explicit register trace", async ({ ui: page }) => {
    const { projectId } = await createTeamAHubEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-HYP"),
      title: "Team A accepted with hypothesis",
    });

    await openTeamADevHubScenario(page, {
      projectId,
      scenario: "accepted-with-hypothesis",
    });
    const studyPanel = await openTeamAStudyPanel(page);

    // 1234d5db renamed the analysis status « Analyse sous réserves » to « Préparation à confirmer »;
    // the reservations stay readable in the readiness badge.
    await expect(studyPanel.getByText("Préparation à confirmer", { exact: true })).toBeVisible();
    await expect(studyPanel.getByText("Avancer sous réserves", { exact: true })).toBeVisible();
    const registerSection = await openTeamARegisterSection(page);
    await expect(
      registerSection.getByText(
        "Prix fournisseurs à confirmer après la première passe de chiffrage.",
        { exact: true },
      ).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Traiter 1 hypothèse ouverte" }),
    ).toBeVisible();
    await expect(page.getByText("Nadia Martin")).toHaveCount(0);
    await expect(page.getByText("Affaire test")).toHaveCount(0);
  });

  test("prioritises the clarification CTA and removes competing plan launch actions", async ({ ui: page }) => {
    const { projectId } = await createTeamAHubEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-CLARIFY"),
      title: "Team A clarify with client",
    });

    await openTeamADevHubScenario(page, {
      projectId,
      scenario: "clarify-client",
    });
    const studyPanel = await openTeamAStudyPanel(page);

    await expect(studyPanel.getByText("Clarification client requise")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Traiter 1 clarification client" }).last(),
    ).toBeVisible();
    const registerSection = await openTeamARegisterSection(page);
    await expect(
      registerSection.getByText(
        "Le client doit confirmer le phasage et la variante retenue avant remise.",
        { exact: true },
      ).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Préparer le métré" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Démarrer l'analyse" })).toHaveCount(0);
    await expect(page.getByText("Nadia Martin")).toHaveCount(0);
    await expect(page.getByText("Affaire test")).toHaveCount(0);
  });

  test("keeps the revalidation CTA dominant and removes competing plan launch actions", async ({ ui: page }) => {
    const { projectId } = await createTeamAHubEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-REVAL"),
      title: "Team A revalidation required",
    });

    await openTeamADevHubScenario(page, {
      projectId,
      scenario: "revalidation-required",
    });
    const studyPanel = await openTeamAStudyPanel(page);

    await expect(studyPanel.getByText("Revalidation requise").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Relancer 1 revalidation critique" }).last(),
    ).toBeVisible();
    const registerSection = await openTeamARegisterSection(page);
    await expect(
      registerSection.getByText(
        "Le dossier a change; la revue documentaire et la pré-remise doivent être rejouees.",
        { exact: true },
      ).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Préparer le métré" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Démarrer l'analyse" })).toHaveCount(0);
    await expect(page.getByText("Nadia Martin")).toHaveCount(0);
    await expect(page.getByText("Affaire test")).toHaveCount(0);
  });
});
