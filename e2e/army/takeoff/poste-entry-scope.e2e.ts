import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { expect, nativeTest as test, type NativeUi } from "./native-ui";
import { countOwnedReceipts, fictionalSendPlanPdf, readOwnedLines, readOwnedParts, seedItemSendAffaire } from "./poste-send-support";
import { readOwnedEntries } from "./item-table-support";

const options = { session: "army", trace: "off" as const, tags: ["critical", "local"], timeout: 240_000 };
const label = "Robinet laiton";
const attach = "Rattacher cette saisie à un plan";
const withdraw = "Retirer la saisie de l’affaire";

async function storedPlan(project: string) {
  return (await querySql(`select plan_logical_id from public.takeoff_item_entries where project_id='${project}'`)).at(-1);
}

async function prepare(ui: NativeUi, names: string[]) {
  const owner = await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, ui.army.runPrefix, { tag: "SCOPE", calcPolicy: "absent" });
  const seeded = await seedItemSendAffaire(owner, { name: ui.army.runPrefix + "-portée", labels: [label],
    plans: await Promise.all(names.map(async name => ({ name, pdf: await fictionalSendPlanPdf(name), measures: {} }))) });
  const url = `/dashboard/affaires/${seeded.projectId}/takeoff`;
  const open = async (filter = "") => { await ui.app.open(url + filter); await waitForHydration(ui.browser); };
  const dialog = ui.screen.getByRole("dialog");
  const button = (name: string) => ui.screen.getByRole("button", name, { exact: true });
  const entry = async (value: string) => {
    await ui.screen.getByRole("textbox", `Quantité saisie pour « ${label} »`).fill(value);
    await button("Enregistrer les saisies (1)").click();
    await dialog.getByLabel("Ce qui fonde ces quantités").selectOption({ value: "site_survey" });
  };
  const save = async () => { await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
    await expect(ui.screen.getByTestId("poste-notice")).toContainText("saisi"); };
  const send = async () => {
    const plan = seeded.plans[0];
    await button(`Envoyer ce plan au devis : « ${plan.name} »`).click();
    await dialog.getByRole("button", `Créer le devis et y envoyer « ${plan.name} »`).click();
    await expect(ui.browser).toHaveURL(/\/dashboard\/estimates\/.+\/edit/, { timeout: 60_000 });
    const line = (await readOwnedLines(seeded.projectId)).find(row => row.item_type === "line");
    expect(line?.quantity).toBe(4);
    expect(await readOwnedParts(seeded.projectId)).toEqual([{ estimate_item_id: line!.id, job_id: plan.jobId,
      item_id: seeded.items[label], quantity: 4, state: "live" }]);
    expect(await countOwnedReceipts(seeded.projectId)).toBe(1);
  };
  await open();
  return { seeded, owner, open, entry, save, send, dialog, button, scope: dialog.getByLabel("Portée de la saisie"),
    expand: () => button(`Détail du poste « ${label} »`).click() };
}

test("POSTE-PORTEE01 plusieurs plans imposent un choix et la saisie part avec le plan choisi sans filtre", options, async ({ ui }) => {
  const flow = await prepare(ui, ["niveau-a.pdf", "niveau-b.pdf"]);
  await flow.entry("4");
  await expect(flow.dialog.getByRole("button", "Enregistrer", { exact: true })).toBeDisabled();
  expect(await readOwnedEntries(flow.seeded.projectId)).toEqual([]);
  await flow.scope.selectOption({ label: "niveau-a.pdf" });
  await flow.save();
  await flow.send();
});

test("POSTE-PORTEE02 rattache le total, puis envoie sa quantité sur le plan", options, async ({ ui }) => {
  const f = await prepare(ui, ["sanitaires.pdf"]);
  await f.entry("4");
  await expect(f.scope).toHaveValue(f.seeded.plans[0].fileId);
  await f.scope.selectOption({ label: "Total de toute l’affaire" });
  await f.save();
  await f.expand();
  await f.button(attach).click();
  await f.dialog.getByLabel("Plan de destination").selectOption({ label: "sanitaires.pdf" });
  await f.dialog.getByRole("button", "Rattacher", { exact: true }).click();
  await expect(ui.screen.getByText(/Saisie rattachée au plan/).first()).toBeVisible();
  expect(await readOwnedEntries(f.seeded.projectId)).toEqual([expect.objectContaining({ quantity: 4, unit: "u", category: "site_survey", included: true })]);
  expect(await storedPlan(f.seeded.projectId)).toBe(f.seeded.plans[0].fileId);
  await f.send();
});

test("POSTE-PORTEE03 la collision présente la saisie en place avant un remplacement explicite", options, async ({ ui }) => {
  const f = await prepare(ui, ["est.pdf", "ouest.pdf"]);
  await querySql(`update public.profiles set full_name='Camille du métré' where id='${f.owner.userId}'`);
  await f.open("?postePlan=" + f.seeded.plans[0].fileId);
  await f.entry("2");
  await expect(f.scope).toHaveValue(f.seeded.plans[0].fileId);
  await f.save();
  await f.open();
  await f.entry("4");
  await f.scope.selectOption({ label: "Total de toute l’affaire" });
  await f.save();
  await f.expand();
  await f.button(attach).click();
  await f.dialog.getByLabel("Plan de destination").selectOption({ label: "est.pdf" });
  await f.dialog.getByRole("button", "Rattacher", { exact: true }).click();
  await expect(f.dialog).toContainText("2 u");
  await expect(f.dialog).toContainText("Relevé chantier");
  await expect(f.dialog).toContainText("Camille du métré");
  await expect(f.dialog).toContainText(/\d{2}\/\d{2}\/\d{4}/);
  expect(await readOwnedEntries(f.seeded.projectId)).toHaveLength(2);
  await f.dialog.getByRole("button", "Remplacer la saisie du plan", { exact: true }).click();
  await expect(ui.screen.getByText(/Saisie du plan remplacée/).first()).toBeVisible();
  expect(await readOwnedEntries(f.seeded.projectId)).toEqual([expect.objectContaining({ quantity: 4 })]);
  expect(await storedPlan(f.seeded.projectId)).toBe(f.seeded.plans[0].fileId);
});

test("POSTE-PORTEE04 une saisie modifiée reste en place, puis son retrait rend le poste aux lectures", options, async ({ ui }) => {
  const f = await prepare(ui, ["nord.pdf"]);
  await f.open("?postePlan=" + f.seeded.plans[0].fileId);
  await ui.screen.getByRole("link", `Détail de « ${label} » sur le plan`, { exact: true }).click();
  await expect(f.button("Saisir une quantité")).toBeEnabled();
  await ui.screen.getByRole("listbox", "Postes", { exact: true }).press("F2");
  await f.dialog.getByLabel("Quantité", { exact: true }).fill("4");
  await f.dialog.getByRole("button", "Continuer").click();
  await f.dialog.getByLabel("Ce qui fonde ces quantités").selectOption({ value: "site_survey" });
  await expect(f.scope).toHaveValue(f.seeded.plans[0].fileId);
  await f.scope.selectOption({ label: "Total de toute l’affaire" });
  await f.dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(ui.screen.getByTestId("poste-detail-decision")).toContainText("Poste saisi.");
  await f.button(withdraw).click();
  await querySql(`update public.takeoff_item_entries set quantity=5,revision=revision+1 where project_id='${f.seeded.projectId}'`);
  await f.dialog.getByRole("button", "Retirer", { exact: true }).click();
  await expect(f.dialog).toContainText("La saisie a changé");
  expect(await readOwnedEntries(f.seeded.projectId)).toEqual([expect.objectContaining({ quantity: 5 })]);
  await f.open();
  await f.expand();
  await f.button(withdraw).click();
  await f.dialog.getByRole("button", "Retirer", { exact: true }).click();
  await expect(ui.screen.getByText(/Saisie de l’affaire retirée/).first()).toBeVisible();
  expect(await readOwnedEntries(f.seeded.projectId)).toEqual([]);
});

test("POSTE-PORTEE05 une part au devis empêche le retrait et le rattachement du total", options, async ({ ui }) => {
  const f = await prepare(ui, ["sud.pdf"]);
  await f.entry("4");
  await expect(f.scope).toHaveValue(f.seeded.plans[0].fileId);
  await f.save();
  await f.send();
  await seedLegacyTotal(f.seeded.projectId);
  await f.open();
  await f.expand();
  await f.button(withdraw).click();
  await f.dialog.getByRole("button", "Retirer", { exact: true }).click();
  await expect(f.dialog).toContainText("Une part de ce poste est déjà au devis");
  await f.dialog.getByRole("button", "Fermer", { exact: true }).click();
  await f.button(attach).click();
  await f.dialog.getByLabel("Plan de destination").selectOption({ label: "sud.pdf" });
  await f.dialog.getByRole("button", "Rattacher", { exact: true }).click();
  await expect(f.dialog).toContainText("Une part de ce poste est déjà au devis");
  expect(await readOwnedEntries(f.seeded.projectId)).toHaveLength(2);
  expect(await countOwnedReceipts(f.seeded.projectId)).toBe(1);
});

async function seedLegacyTotal(project: string) {
  // Historical coexistence of a whole entry and a live part, as in the SQL regression fixture.
  await querySql(`insert into public.takeoff_item_entries(tenant_id,project_id,item_id,quantity,unit,category,included,
    revision,actor_id,entered_at,command_id) select tenant_id,project_id,item_id,6,unit,category,included,1,actor_id,now(),command_id
    from public.takeoff_item_entries where project_id='${project}' and plan_logical_id is not null`);
}

test("POSTE-PORTEE06 le retrait confirmé du dernier apport libère le rattachement à un plan éligible", options, async ({ ui }) => {
  const f = await prepare(ui, ["aile-a.pdf", "aile-b.pdf"]);
  await f.entry("4");
  await f.scope.selectOption({ label: "aile-a.pdf" });
  await f.save();
  await f.send();
  await f.open("?postePlan=" + f.seeded.plans[0].fileId);
  await ui.screen.getByRole("link", `Détail de « ${label} » sur le plan`, { exact: true }).click();
  await ui.screen.getByText("Retirer cet apport du devis", { exact: true }).click();
  await ui.screen.getByLabel("Motif du retrait").selectOption({ value: "duplicate" });
  await f.button("Préparer le retrait").click();
  await f.button("Prévisualiser la correction").click();
  await f.button("Confirmer la correction").click();
  await expect(ui.screen.getByText(/Correction confirmée/).first()).toBeVisible();
  expect((await readOwnedParts(f.seeded.projectId)).filter(row => row.state === "live")).toEqual([]);
  await seedLegacyTotal(f.seeded.projectId);
  await f.open();
  await f.expand();
  await f.button(attach).click();
  await f.dialog.getByLabel("Plan de destination").selectOption({ label: "aile-b.pdf" });
  await f.dialog.getByRole("button", "Rattacher", { exact: true }).click();
  await expect(ui.screen.getByText(/Saisie rattachée au plan/).first()).toBeVisible();
  expect((await querySql(`select quantity from public.takeoff_item_entries where project_id='${f.seeded.projectId}'
    and plan_logical_id='${f.seeded.plans[1].fileId}'`)).at(-1)).toMatch(/^6(?:\.0+)?$/);
});
