import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { countOwnedReceipts, fictionalSendPlanPdf, readOwnedLines, seedItemSendAffaire } from "./poste-send-support";
import { describe, expect, nativeTest as test, type NativeUi } from "./native-ui";

const options = { session: "army", trace: "off" as const, tags: ["critical", "local"], timeout: 240_000 };

describe("Décision individuelle sur une mesure", () => {
  test("POSTE-RETENIR01 retient un écart DPGF", options, async ({ ui }) => retainAndSend(ui, "gap"));
  test("POSTE-RETENIR02 retient une règle justifiée", options, async ({ ui }) => retainAndSend(ui, "rule"));
  test("POSTE-RETENIR03 retient une règle justifiée et un écart DPGF", options, async ({ ui }) => retainAndSend(ui, "both"));
});

async function retainAndSend(ui: NativeUi, scenario: "rule" | "gap" | "both") {
  const { app, screen, army } = ui;
  const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PRETAIN", calcPolicy: "absent" });
  const label = "Lavabo";
  const reference = scenario === "rule" ? 3 : 1;
  const seeded = await seedItemSendAffaire(owner, { name: `${army.runPrefix}-RETENIR-${scenario}`, labels: [label],
    dpgfLabels: [label], referenceQuantities: { [label]: reference },
    plans: [{ name: "sanitaires.pdf", pdf: await fictionalSendPlanPdf("Plan sanitaire"), measures: { [label]: { quantity: 3, page: 2 } } }] });
  const plan = seeded.plans[0];
  const item = seeded.items[label];
  if (scenario !== "gap") {
    await querySql(`update public.takeoff_items set rule_results =
      '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_NETWORK_MISSING","version":2,"reason":"Réseau non indiqué","acceptable":true}]'
      where job_id='${plan.jobId}';`);
  }
  const address = `/dashboard/affaires/${seeded.projectId}/takeoff`;
  const dialog = screen.getByRole("dialog");
  const retain = screen.getByRole("button", "Retenir cette mesure", { exact: true });
  await app.open(address);
  await waitForHydration(ui.browser);
  await screen.getByRole("link", `Détail de « ${label} » sur le plan`, { exact: true }).click();
  async function justify(renew = false) {
    await screen.getByRole("link", /Justifier la contribution/).click();
    if (renew) {
      await screen.getByRole("button", "Rouvrir la contribution pour la justifier à nouveau").click();
    }
    await screen.getByRole("button", /^Accepter/).click();
    await dialog.getByLabel("Motif").selectOption({ value: "system_documented" });
    await dialog.getByLabel("Référence du système").fill("Système fictif documenté dans la notice sanitaire.");
    await dialog.getByRole("button", "Confirmer l’acceptation").click();
    await expect(screen.getByText(/poste reste à retenir/)).toBeVisible();
    await screen.getByRole("link", /Revenir au poste/).click();
    expect(new URL(await ui.browser.url()).searchParams.get("poste")).toBe(item);
  }
  if (scenario !== "gap") await justify();
  if (scenario === "both") {
    // A review on different evidence has to be renewed, even when the row still carries its original verification.
    await querySql(`update public.takeoff_items set evidence='Précision fictive sur la localisation du relevé' where job_id='${plan.jobId}';`);
    await app.open(await ui.browser.url());
    await justify(true);
  }
  await retain.click();
  await expect(dialog).toContainText("3 u");
  await expect(dialog).toContainText(`${reference} u`);
  if (scenario !== "gap") {
    await expect(dialog).toContainText("Système et conditions d’emploi documentés");
    await dialog.getByRole("checkbox", /contrôles en échec/).check();
  }
  if (scenario !== "rule") await dialog.getByRole("checkbox", /écart/).check();
  await dialog.getByRole("button", "Retenir cette mesure", { exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(screen.getByText("Retenu : 3 u", { exact: true })).toBeVisible();
  const line = await seedRetainDestination(seeded.projectId, item, owner.tenantId, owner.userId, scenario === "both" ? 2 : reference);
  await app.open(address);
  await screen.getByRole("button", "Envoyer ce plan au devis : « sanitaires.pdf »", { exact: true }).click();
  await expect(dialog.getByTestId(`item-send-line-${item}-dpgf`)).toContainText("3 u");
  if (scenario === "both") {
    await expect(dialog).toContainText("Référence DPGF · 2 u · Quantité cumulée · 3 u · Écart · 1 u");
    await expect(dialog.getByRole("button", /^Envoyer « sanitaires.pdf »/)).toBeDisabled();
    expect(await countOwnedReceipts(seeded.projectId)).toBe(0);
    expect((await readOwnedLines(seeded.projectId)).find(row => row.id === line)?.quantity).toBe(2);
    await dialog.getByRole("checkbox", /vérifié le rapprochement/).check();
  }
  await dialog.getByRole("button", /^Envoyer « sanitaires.pdf »/).click();
  await expect(ui.browser).toHaveURL(new RegExp(`focusItemId=${line}$`), { timeout: 60_000 });
  expect((await readOwnedLines(seeded.projectId)).find(({ id }) => id === line)?.quantity).toBe(3);
  expect(await countOwnedReceipts(seeded.projectId)).toBe(1);
}

/** The imported draft has the same raw and mapped row as the item the worker read. */
async function seedRetainDestination(project: string, item: string, tenant: string, actor: string, reference: number) {
  const { randomUUID } = await import("node:crypto");
  const version = randomUUID(), section = randomUUID(), line = randomUUID();
  await querySql(`begin;
    insert into public.estimate_versions(id,tenant_id,project_id,version_number,calc_engine_version,status,
      max_section_depth,currency,margin_mode,margin_multiplier,margin_bp,global_coefficient,discount_bp,discount_mode,tax_rate_bp,
      rounding_mode,rounding_step_cents,sale_coefficient_fo,sale_coefficient_mo,gross_ht_cents,discount_applied_cents,
      commercial_rounding_cents,total_ht_cents,total_tax_cents,total_ttc_cents)
    values ('${version}','${tenant}','${project}',1,3,'draft',3,'EUR','fixed',1,0,1,0,'simple',2000,'none',1,1.3,1.2,0,0,0,0,0,0);
    insert into public.dpgf_imports(id,tenant_id,project_id,user_id,filename,source_format,status,row_count,parse_mode)
      select (origin->>'importId')::uuid,'${tenant}','${project}','${actor}','sanitaires.xlsx','xlsx','completed',1,'server'
      from public.takeoff_list_revision_entries where item_id='${item}';
    insert into public.dpgf_rows_raw(id,tenant_id,import_id,row_index,payload)
      select (origin->>'rawRowId')::uuid,'${tenant}',(origin->>'importId')::uuid,1,'{"designation":"Lavabo"}'
      from public.takeoff_list_revision_entries where item_id='${item}';
    insert into public.dpgf_rows_mapped(id,tenant_id,import_id,raw_row_id,payload,status)
      select (origin->>'mappedRowId')::uuid,'${tenant}',(origin->>'importId')::uuid,(origin->>'rawRowId')::uuid,
        jsonb_build_object('designation','Lavabo','quantity',${reference},'unit','u'),'mapped'
      from public.takeoff_list_revision_entries where item_id='${item}';
    select set_config('miaouffrage.estimate_v3_writer','${version}',true);
    insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title)
      values ('${section}','${tenant}','${version}','section',1,'Appareils sanitaires');
    insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,quantity,unit_code,source_provider,source_metadata)
      select '${line}','${tenant}','${version}','${section}','line',1,'Lavabo',${reference},'u','dpgf',
        jsonb_build_object('import_id',origin->>'importId','mapped_row_id',origin->>'mappedRowId','dpgf_source_quantity',${reference})
      from public.takeoff_list_revision_entries where item_id='${item}';
    select public.estimate_v3_complete_entry_for_writer('${version}',array['${line}'::uuid]);
    commit;`);
  return line;
}

test("POSTE-RETENIR04 refuse un échec bloquant et une justification absente, puis rouvre une mesure modifiée", options, async ({ ui }) => {
  const { app, screen, army } = ui;
  const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PREFUS" });
  const labels = ["Réseau bloqué", "Réseau à justifier", "Compteur"];
  const seeded = await seedItemSendAffaire(owner, { name: `${army.runPrefix}-RETENIR-REFUS`, labels,
    referenceQuantities: { Compteur: 1 }, plans: [{ name: "refus.pdf", pdf: await fictionalSendPlanPdf("Plan des réseaux"),
      measures: Object.fromEntries(labels.map(label => [label, { quantity: 3, page: 2 }])) }] });
  const { jobId } = seeded.plans[0];
  await querySql(`update public.takeoff_items set rule_results=jsonb_build_array(jsonb_build_object('rule','dn_network',
    'version',2,'status','fail','code',case designation when 'Réseau bloqué' then 'DN_NETWORK_MATERIAL_BLOCKED' else 'DN_NETWORK_NETWORK_MISSING' end,
    'reason','Contrôle du réseau fictif','acceptable',designation='Réseau à justifier')) where job_id='${jobId}' and designation <> 'Compteur';
    update public.takeoff_items set confidence=0.1 where job_id='${jobId}' and designation='Compteur';`);
  async function openItem(label: string) {
    await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
    await waitForHydration(ui.browser);
    await screen.getByRole("link", `Détail de « ${label} » sur le plan`, { exact: true }).click();
  }
  const retain = screen.getByRole("button", "Retenir cette mesure", { exact: true });
  await openItem(labels[0]);
  await expect(retain).toHaveCount(0);
  await expect(screen.getByText(/corrigez la contribution/i)).toBeVisible();
  await openItem(labels[1]);
  await expect(retain).toBeEnabled();
  await expect(screen.getByRole("link", /Justifier la contribution/)).toBeVisible();
  await openItem(labels[2]);
  await retain.click();
  const dialog = screen.getByRole("dialog");
  await dialog.getByRole("checkbox", /écart/).check();
  await expect(dialog.getByRole("button", "Retenir cette mesure", { exact: true })).toBeDisabled();
  await dialog.getByRole("checkbox", /preuve de la mesure/).check();
  await dialog.getByRole("button", "Retenir cette mesure", { exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await querySql(`update public.takeoff_items set evidence='Quantité vérifiée sur un autre repère fictif' where job_id='${jobId}' and designation='Compteur';`);
  await openItem(labels[2]);
  await expect(screen.getByText("Les éléments sur lesquels vous aviez retenu cette mesure ont changé. Vérifiez la mesure à nouveau.")).toBeVisible();
  await expect(retain).toBeEnabled();
  await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
  await screen.getByRole("button","Envoyer ce plan au devis : « refus.pdf »", { exact: true }).click();
  await expect(dialog.getByTestId(`item-send-not-sent-${seeded.items.Compteur}`)).toContainText(/accept/i);
  expect(await countOwnedReceipts(seeded.projectId)).toBe(0);
});
