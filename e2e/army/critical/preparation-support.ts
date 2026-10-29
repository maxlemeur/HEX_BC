import { expect } from "e2e";

import { type ArmyState, type createEstimateViaWizard } from "./fixtures";

type Ui = Parameters<typeof createEstimateViaWizard>[0] & { army: ArmyState };

export async function openTakeoffPreparation(ui: Ui) {
  await ui.screen.getByRole("button", "Plus", { exact: true }).click();
  await ui.screen.getByRole("menuitem", "Préparer le métré", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Préparer le métré", { exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", /Mes documents$/)).toBeVisible();
  return dialog;
}

export async function fillTakeoffPreparation(
  ui: Ui,
  input: {
    sources: string[];
    objective?: "count" | "measure_length" | "compare_dpgf" | "prepare_purchase" | "extract_quantities";
    unit?: string;
    exclusions?: string;
    inclusions?: string;
    levels?: string;
    zones?: string;
  },
  container?: ReturnType<Ui["screen"]["getByRole"]>
) {
  const dialog = container ?? ui.screen.getByRole("dialog", "Préparer le métré", { exact: true });
  await dialog.getByRole("button", /Mes documents$/).click();
  for (const source of input.sources) {
    await dialog.getByLabel(`Utiliser ${source}`, { exact: true }).check();
    await dialog.getByLabel(`Révision de ${source}`, { exact: true }).fill("A");
  }
  await dialog.getByLabel("Je confirme les pièces actives et leurs révisions", { exact: true }).check();
  await dialog.getByRole("button", /Ce que je veux mesurer$/).click();
  await dialog.getByLabel("Objectif du métré", { exact: true }).selectOption({ value: input.objective ?? "count" });
  await dialog.getByLabel("Je confirme cet objectif", { exact: true }).check();
  await dialog.getByLabel("Lots", { exact: true }).fill("Plomberie");
  await dialog.getByLabel("Niveaux", { exact: true }).fill(input.levels ?? "R+1");
  await dialog.getByLabel("Zones", { exact: true }).fill(input.zones ?? "Zone 1");
  await dialog.getByLabel("Inclusions", { exact: true }).fill(input.inclusions ?? "Vannes repérées");
  await dialog.getByLabel("Exclusions", { exact: true }).fill(input.exclusions ?? "RDC, Zone 2");
  await dialog.getByLabel("Je confirme ce périmètre", { exact: true }).check();
  await dialog.getByRole("button", /Points à préciser$/).click();
  await dialog.getByLabel("Unité de restitution", { exact: true }).fill(input.unit ?? "u");
  await dialog.getByLabel("Base de mesure", { exact: true }).selectOption({ value: "documented" });
  await dialog.getByLabel("Je confirme les conventions de mesure", { exact: true }).check();
  await dialog.getByRole("button", /Vérifier et lancer$/).click();
  await dialog.getByLabel("Responsable de la revue", { exact: true }).fill("Réviseur ARMY");
  await dialog.getByLabel("Je confirme la destination et la revue des résultats", { exact: true }).check();
  return dialog;
}

export async function saveTakeoffPreparation(ui: Ui) {
  const dialog = ui.screen.getByRole("dialog", "Préparer le métré", { exact: true });
  await dialog.getByRole("button", "Enregistrer maintenant", { exact: true }).click();
  await expect(dialog.getByText(/^Préparation enregistrée(?: · révision \d+)?$/)).toBeVisible();
}
