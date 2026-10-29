import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import { armyTest, createEstimateViaWizard, readEstimate, recordEvidence } from "../critical/fixtures";
import { readPlanFiles, readPlanSets } from "../critical/plans-support";
import { localClient } from "./native-ui";

armyTest("INT01 real dossier upload survives unavailable AI and manual classification primary selection and brief confirmation persist", {
  session: "army", trace: "off", tags: ["critical", "intake-dossier", "local"], timeout: 240_000,
}, async (ui) => {
  const { army, app, screen, browser } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-INT01`, title: "Dossier de consultation" }, army);
  const { client } = await localClient();
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
  await mkdir(directory, { recursive: true });
  const fixtures = [
    { name: `${army.runPrefix}-DPGF.csv`, bytes: Buffer.from("designation;quantity;unit\nTube cuivre;12;m\n") },
    { name: `${army.runPrefix}-plan.pdf`, bytes: await readFile(path.resolve("e2e/fixtures/sample-plan.pdf")) },
    { name: `${army.runPrefix}-CCTP-original.txt`, bytes: Buffer.from("CCTP plomberie : tube cuivre et calorifuge.") },
    { name: `${army.runPrefix}-piece-a-classer.txt`, bytes: Buffer.from("CCTP corrige : calorifuge et supports a confirmer.") },
  ];
  const empty = path.join(directory, "vide.csv");
  await writeFile(empty, "");
  for (const file of fixtures) await writeFile(path.join(directory, file.name), file.bytes);
  const documents = async () => {
    const result = await client.from("affaire_intake_documents").select("id,file_name,storage_path,size_bytes,upload_status,classification_status,classification_source,document_kind,document_priority")
      .eq("project_id", ids.projectId).order("file_name");
    if (result.error) throw new Error(`Owned dossier read failed: ${result.error.code}`);
    return result.data;
  };
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  await expect(screen.getByRole("heading", "Ajoutez le dossier de consultation", { exact: true })).toBeVisible();
  const upload = browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first();
  await upload.setInputFiles(empty);
  await expect(screen.getByText('"vide.csv" est vide.', { exact: true })).toBeVisible();
  expect(await documents()).toEqual([]);
  await upload.setInputFiles(fixtures.map((file) => path.join(directory, file.name)));
  await expect.poll(async () => {
    const found = await documents();
    return found.length === fixtures.length && found.every((doc) => !["queued", "processing"].includes(doc.classification_status));
  }, { timeout: 60_000 }).toBe(true);
  const uploaded = await documents();
  expect(uploaded.map((doc) => doc.file_name).sort()).toEqual(fixtures.map((file) => file.name).sort());
  for (const doc of uploaded) {
    const fixture = fixtures.find((file) => file.name === doc.file_name)!;
    expect(doc).toMatchObject({ upload_status: "uploaded", size_bytes: fixture.bytes.length, classification_source: "heuristic" });
    const stored = await client.storage.from("affaire-intake").download(doc.storage_path!);
    expect(stored.error).toBe(null);
    expect(createHash("sha256").update(Buffer.from(await stored.data!.arrayBuffer())).digest("hex"))
      .toBe(createHash("sha256").update(fixture.bytes).digest("hex"));
  }
  const ambiguous = uploaded.find((doc) => doc.file_name.endsWith("-piece-a-classer.txt"))!;
  expect(ambiguous.document_kind).toBe("a_classer");
  // The deep link highlights the piece's row in the dossier table; its actions live in the row's details dialog.
  const row = browser.locator(`[aria-label="Dossier de consultation"] tr[data-document-id="${ambiguous.id}"]`);
  const openDetails = async () => {
    await expect(row).toHaveAttribute("aria-selected", "true");
    await row.getByRole("button", `Détails de ${ambiguous.file_name}`, { exact: true }).click();
    return screen.getByRole("dialog", "Document et détails", { exact: true });
  };
  await app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${ambiguous.id}#intake`);
  let details = await openDetails();
  await details.getByRole("button", "Reclasser", { exact: true }).click();
  await details.getByLabel("Nouvelle catégorie", { exact: true }).selectOption({ value: "cctp" });
  await details.getByRole("button", "Valider", { exact: true }).click();
  await expect.poll(async () => (await documents()).find((doc) => doc.id === ambiguous.id)).toMatchObject({
    document_kind: "cctp", classification_status: "classified", classification_source: "manual",
  });
  // Reopening the same deep link is an in-page hash navigation that keeps the modal open: reload instead,
  // which also shows the manual category after a fresh read.
  await browser.reload();
  details = await openDetails();
  await expect(details.getByText("CCTP", { exact: true })).toBeVisible();
  await details.getByRole("button", "Définir comme principal", { exact: true }).click();
  await expect.poll(async () => (await documents()).filter((doc) => doc.document_kind === "cctp" && doc.document_priority === "primary").map((doc) => doc.id)).toEqual([ambiguous.id]);
  const sets = await readPlanSets(browser, ids.projectId);
  expect(sets).toHaveLength(1);
  const plans = await readPlanFiles(browser, sets[0].id);
  expect(plans).toHaveLength(1);
  expect(plans[0]).toMatchObject({ file_name: fixtures[1].name, file_size_bytes: fixtures[1].bytes.length });

  await app.open(`/dashboard/affaires/${ids.projectId}#brief`);
  const brief = screen.getByRole("region", "Brief affaire", { exact: true });
  await expect(brief).toBeVisible();
  const confirm = screen.getByRole("button", /^Confirmer le brief(?: affaire)?$/).first();
  if (await confirm.isVisible()) await confirm.click();
  else await screen.getByRole("link", "Confirmer le brief", { exact: true }).first().click();
  await brief.getByRole("button", "Oui, confirmer", { exact: true }).click();
  await expect(brief.getByText("Brief de référence", { exact: true })).toBeVisible();
  await browser.reload();
  await expect(brief.getByText("Brief de référence", { exact: true })).toBeVisible();
  const persisted = await client.from("affaire_briefs").select("id,status,confirmed_at").eq("project_id", ids.projectId).single();
  expect(persisted.error).toBe(null);
  expect(persisted.data?.status).toBe("confirme");
  expect(persisted.data?.confirmed_at).toBeTruthy();
  expect((await documents()).filter((doc) => doc.document_kind === "cctp" && doc.document_priority === "primary").map((doc) => doc.id)).toEqual([ambiguous.id]);
  expect(await readPlanFiles(browser, sets[0].id)).toEqual(plans);
  expect((await readEstimate(browser, ids.versionId)).items).toEqual([]);

  // Deleting the last plan reopens its gap wherever the dossier is derived: the register's
  // critical question, the synced plan set and the confirmed brief that listed it.
  const plan = (await documents()).find((doc) => doc.file_name === fixtures[1].name)!;
  const plansGap = async () => (await client.from("affaire_register_entries").select("severity,is_active")
    .eq("project_id", ids.projectId).eq("kind", "missing_piece").eq("code", "missing_plans").eq("is_active", true)).data;
  const readBrief = async () => (await client.from("affaire_briefs").select("status,confirmed_at,received_pieces")
    .eq("project_id", ids.projectId).single()).data!;
  expect(await plansGap()).toEqual([]);
  expect((await readBrief()).received_pieces).toContain(`Plans · ${plan.file_name}`);
  const planRow = browser.locator(`[aria-label="Dossier de consultation"] tr[data-document-id="${plan.id}"]`);
  await planRow.getByRole("button", `Détails de ${plan.file_name}`, { exact: true }).click();
  await screen.getByRole("dialog", "Document et détails", { exact: true }).getByRole("button", "Supprimer la copie", { exact: true }).click();
  await screen.getByRole("button", "Confirmer la suppression", { exact: true }).click();
  await expect(planRow).toHaveCount(0);
  expect((await documents()).find((doc) => doc.id === plan.id)).toMatchObject({ upload_status: "rejected", storage_path: null });
  await expect.poll(plansGap).toEqual([{ severity: "critical", is_active: true }]);
  await expect.poll(async () => (await readBrief()).status).toBe("a_confirmer");
  const reopened = await readBrief();
  expect(reopened.confirmed_at).toBeNull();
  expect(reopened.received_pieces.filter((entry: string) => entry.includes(plan.file_name))).toEqual([]);
  expect(await readPlanFiles(browser, sets[0].id)).toEqual([]);

  // Deleting the principal CCTP while another CCTP remains hands it the principal role.
  const remainingCctp = (await documents()).find((doc) => doc.file_name === fixtures[2].name)!;
  const primaryRow = browser.locator(`[aria-label="Dossier de consultation"] tr[data-document-id="${ambiguous.id}"]`);
  await primaryRow.getByRole("button", `Détails de ${ambiguous.file_name}`, { exact: true }).click();
  await screen.getByRole("dialog", "Document et détails", { exact: true }).getByRole("button", "Supprimer la copie", { exact: true }).click();
  await screen.getByRole("button", "Confirmer la suppression", { exact: true }).click();
  await expect(primaryRow).toHaveCount(0);
  expect((await documents()).find((doc) => doc.id === ambiguous.id)).toMatchObject({ upload_status: "rejected", document_priority: "secondary", storage_path: null });
  const primaryCctp = (await documents()).filter((doc) => doc.document_kind === "cctp" && doc.document_priority === "primary").map((doc) => doc.id);
  expect(primaryCctp).toEqual([remainingCctp.id]);
  await recordEvidence(army, "INT01-dossier-complete", { ids, documents: await documents(), planSetId: sets[0].id, plans, brief: persisted.data,
    afterPlanDeletion: { deletedDocumentId: plan.id, plansGap: await plansGap(), brief: reopened },
    afterPrimaryCctpDeletion: { deletedDocumentId: ambiguous.id, primaryCctp },
    uploadedBytesVerified: true, emptyFileRejected: true, boundary: "Real upload, Storage, heuristic fallback, manual classification/primary, brief confirmation, last-plan and principal-CCTP deletion. External AI disabled by owned campaign." });
});
