import { randomUUID } from "node:crypto";
import { extractPdfText } from "../../../scripts/tester-army/pdf-text";
import { ESTIMATE_PDF_PRESETS } from "@/lib/estimates/pdf-layout";
import { expect } from "e2e";
import {
  armyTest,
  apiRequest,
  readEstimate,
  saveLineEditsWithShortcut,
  recordEvidence,
} from "../critical/fixtures";
import { connectedApi } from "../extended/connected-support";
import {
  prepareV3Draft,
  seedLines,
  lockVersion,
  releaseVersion,
  showStandardColumns,
  waitForDraftLease,
} from "./engine-v3-editor-support";
import { querySql } from "./calculation-gate-support";
import { instantiateTemplate } from "./engine-v3-creators-support";
import { setTenantCalcPolicy } from "./engine-v3-persistence-support";
import { generatePdf, pdfText, storedPdfBytes } from "./engine-v3-emission-support";

const options = {
  session: "army",
  tags: ["critical", "local", "fo-provision"],
  timeout: 240_000,
} as const;

armyTest(
  "FO53410 one editable K FO includes supply losses transport and volume without compounding",
  options,
  async (ui) => {
    const draft = await prepareV3Draft(ui, ui.army, "FO534UNIFIED");
    const typeId = await querySql(
      `insert into public.supply_types(tenant_id,code,name) values ('${draft.owner.tenantId}','tube','Tube') on conflict (tenant_id,code) do nothing returning id;`,
    );
    const details = await connectedApi<{
      supply_types: Array<{ id: string; code: string }>;
    }>(ui, "GET", `/api/estimates/${draft.versionId}`);
    const tube = details.supply_types.find((row) => row.code === "tube")!.id;
    const title = `${ui.army.runPrefix} tube coefficient unique`;
    const [created] = await seedLines(ui, ui.army, draft, "unified", [
      {
        title,
        unit_code: "ml",
        pricing_status: "priced",
        quantity: 101,
        unit_price_ht_cents: 10000,
        h_mo_per_unit: 0,
        k_fo: 1,
        k_mo: 1,
        supply_type_id: tube,
      },
    ]);
    expect(created).toMatchObject({
      k_fo: 1.13,
      fo_provision: 1,
      pu_ht_cents: 14690,
      line_total_ht_cents: 1483690,
    });
    await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await showStandardColumns(ui);
    await expect(
      ui.browser.locator('[data-estimate-column="fo_provision"]'),
    ).toHaveCount(0);
    const coefficient = ui.screen.getByLabel(
      `Coefficient fourniture K FO pour ${title}`,
      { exact: true },
    );
    const saveResponse = ui.browser.waitForResponse(
      new URL(`/api/estimates/${draft.versionId}/batch`, ui.app.baseUrl!).href,
    );
    await coefficient.fill("1,017");
    await coefficient.press("Tab");
    await saveLineEditsWithShortcut(ui, draft.versionId, title, ui.army);
    const saved = await saveResponse;
    const savedBody = await saved.json();
    await recordEvidence(ui.army, "fo534-save-response", {
      status: saved.status,
      body: savedBody,
    });
    expect(saved.status).toBe(200);
    await expect
      .poll(
        async () =>
          (await readEstimate(ui.browser, draft.versionId)).items.find(
            (row) => row.id === created.id,
          )?.k_fo,
      )
      .toBe(1.017);
    let stored = (await readEstimate(ui.browser, draft.versionId)).items.find(
      (row) => row.id === created.id,
    )!;
    expect(stored).toMatchObject({
      k_fo: 1.017,
      fo_provision: 1,
      pu_ht_cents: 13221,
      line_total_ht_cents: 1335321,
    });
    await expect(
      ui.screen.getByTestId("estimate-page-toolbar-autosave-status"),
    ).toHaveText(/^(Sauvegardé|À jour)$/);
    const secondSaveResponse = ui.browser.waitForResponse(
      new URL(`/api/estimates/${draft.versionId}/batch`, ui.app.baseUrl!).href,
    );
    await coefficient.fill("1,0735");
    await coefficient.press("Tab");
    await saveLineEditsWithShortcut(ui, draft.versionId, title, ui.army);
    const secondSaved = await secondSaveResponse;
    await recordEvidence(ui.army, "fo534-second-save-response", {
      status: secondSaved.status,
      body: await secondSaved.json(),
    });
    expect(secondSaved.status).toBe(200);
    await expect
      .poll(
        async () =>
          (await readEstimate(ui.browser, draft.versionId)).items.find(
            (row) => row.id === created.id,
          )?.k_fo,
      )
      .toBe(1.0735);
    stored = (await readEstimate(ui.browser, draft.versionId)).items.find(
      (row) => row.id === created.id,
    )!;
    expect(stored).toMatchObject({
      k_fo: 1.0735,
      fo_provision: 1,
      pu_ht_cents: 13956,
    });
    await expect(
      ui.screen.getByTestId("estimate-page-toolbar-autosave-status"),
    ).toHaveText(/^(Sauvegardé|À jour)$/);
    await ui.browser.reload();
    await waitForDraftLease(ui);
    expect(
      (await readEstimate(ui.browser, draft.versionId)).items.find(
        (row) => row.id === created.id,
      )?.k_fo,
    ).toBe(1.0735);
    await ui.screen
      .getByRole("button", "Aide colonnes", { exact: true })
      .click();
    const help = ui.screen.getByTestId("estimate-columns-help-panel");
    await expect(help).toContainText(
      "pertes, le transport et l’ajustement lié au volume acheté",
    );

    await expect(help).toContainText(
      "d’autres éléments prévus dans votre chiffrage",
    );
    await recordEvidence(ui.army, "fo534-unified-precision-and-help", {
      typeId,
      created,
      stored,
    });
  },
);

armyTest(
  "FO53411 company and user defaults reprice automatic drafts while manual neutrality is preserved",
  options,
  async (ui) => {
    const draft = await prepareV3Draft(ui, ui.army, "FO534PREF");
    await querySql(
      `insert into public.supply_types(tenant_id,code,name) values ('${draft.owner.tenantId}','tube','Tube') on conflict (tenant_id,code) do nothing;`,
    );
    const details = await connectedApi<{
      supply_types: Array<{ id: string; code: string }>;
    }>(ui, "GET", `/api/estimates/${draft.versionId}`);
    const tube = details.supply_types.find((row) => row.code === "tube")!.id;
    const base = {
      unit_code: "ml",
      pricing_status: "priced",
      quantity: 1,
      unit_price_ht_cents: 10000,
      h_mo_per_unit: 0,
      k_mo: 1,
      supply_type_id: tube,
    };
    const [automatic, manual] = await seedLines(
      ui,
      ui.army,
      draft,
      "preference",
      [
        { ...base, title: `${ui.army.runPrefix} tube automatique`, k_fo: 1 },
        { ...base, title: `${ui.army.runPrefix} tube manuel`, k_fo: 1 },
      ],
    );
    await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await showStandardColumns(ui);
    const field = ui.screen.getByLabel(
      `Coefficient fourniture K FO pour ${manual.title}`,
      { exact: true },
    );
    await field.fill("1");
    await field.press("Tab");
    await saveLineEditsWithShortcut(ui, draft.versionId, manual.title, ui.army);
    await expect
      .poll(
        async () =>
          (await readEstimate(ui.browser, draft.versionId)).items.find(
            (row) => row.id === manual.id,
          )?.k_fo,
      )
      .toBe(1);
    await expect(
      ui.screen.getByTestId("estimate-page-toolbar-autosave-status"),
    ).toHaveText(/^(Sauvegardé|À jour)$/);
    await ui.app.open("/dashboard/profile");
    const company = ui.screen.getByLabel("Base entreprise — Tube", {
      exact: true,
    });
    await company.fill("1,0735");
    await company.press("Enter");
    await expect(
      ui.screen
        .getByRole("status")
        .filter({ hasText: "Coefficient enregistré" }),
    ).toBeVisible();
    await ui.browser.reload();
    await expect(
      ui.screen.getByLabel("Base entreprise — Tube", { exact: true }),
    ).toHaveValue("1,0735");
    await ui.screen
      .getByLabel("Base entreprise — Tube", { exact: true })
      .fill("1,13");
    await ui.screen
      .getByLabel("Base entreprise — Tube", { exact: true })
      .press("Enter");
    await expect(
      ui.screen
        .getByRole("status")
        .filter({ hasText: "Coefficient enregistré" }),
    ).toBeVisible();
    const preference = ui.screen.getByLabel("Ma préférence — Tube", {
      exact: true,
    });
    await preference.fill("1,15");
    await preference.press("Enter");
    await expect(
      ui.screen
        .getByRole("status")
        .filter({ hasText: "Coefficient enregistré" }),
    ).toBeVisible();
    await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await ui.screen.getByTestId("estimate-editor-controls-button", { visible: true }).click();
    await ui.screen
      .getByTestId("estimate-editor-kfo-refresh-button", { visible: true })
      .click();
    await saveLineEditsWithShortcut(
      ui,
      draft.versionId,
      automatic.title,
      ui.army,
    );
    await expect
      .poll(async () => {
        const items = (await readEstimate(ui.browser, draft.versionId)).items;
        return [
          items.find((row) => row.id === automatic.id)?.k_fo,
          items.find((row) => row.id === manual.id)?.k_fo,
        ];
      })
      .toEqual([1.15, 1]);
    await recordEvidence(
      ui.army,
      "fo534-preference-manual-priority",
      await readEstimate(ui.browser, draft.versionId),
    );
    await ui.app.open("/dashboard/profile");
    const resetPreference = ui.screen.getByLabel("Ma préférence — Tube", {
      exact: true,
    });
    await resetPreference.fill("");
    await resetPreference.press("Enter");
    await expect(
      ui.screen
        .getByRole("status")
        .filter({ hasText: "Coefficient enregistré" }),
    ).toBeVisible();
  },
);

armyTest(
  "FO53412 kit components stay in calculation but remain hidden in the editor and downloaded PDF",
  options,
  async (ui) => {
    const draft = await prepareV3Draft(ui, ui.army, "FO534KIT");
    await querySql(
      `insert into public.supply_types(tenant_id,code,name) values ('${draft.owner.tenantId}','tube','Tube'),('${draft.owner.tenantId}','raccord','Raccord') on conflict (tenant_id,code) do nothing;`,
    );
    const details = await connectedApi<{
      supply_types: Array<{ id: string; code: string }>;
    }>(ui, "GET", `/api/estimates/${draft.versionId}`);
    const family = (code: string) =>
      details.supply_types.find((row) => row.code === code)!.id;
    const tubeTitle = `${ui.army.runPrefix} composant tube interne`;
    const fittingTitle = `${ui.army.runPrefix} composant raccord interne`;
    const lines = await seedLines(ui, ui.army, draft, "kit", [
      {
        title: tubeTitle,
        quantity: 1,
        unit_code: "ml",
        unit_price_ht_cents: 10000,
        supply_type_id: family("tube"),
        k_fo: 1,
        k_mo: 1,
        h_mo_per_unit: 0,
        pricing_status: "priced",
      },
      {
        title: fittingTitle,
        quantity: 1,
        unit_code: "u",
        unit_price_ht_cents: 3000,
        supply_type_id: family("raccord"),
        k_fo: 1,
        k_mo: 1,
        h_mo_per_unit: 0,
        pricing_status: "priced",
      },
    ]);
    expect(lines.map((row) => [row.k_fo, row.line_total_ht_cents])).toEqual([
      [1.13, 14690],
      [1.02, 3978],
    ]);
    // Fixture of the persisted materializer marker; component quantities and amounts remain untouched.
    await querySql(
      `select set_config('miaouffrage.estimate_v3_writer','${draft.versionId}',false); update public.estimate_items set source_metadata='{"kit_metier":true}'::jsonb where id='${draft.sectionId}';`,
    );
    await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await expect(
      ui.screen.getByTestId("estimate-section-title-input"),
    ).toHaveValue(draft.sectionTitle);
    await expect(
      ui.screen.getByLabel(`Coefficient fourniture K FO pour ${tubeTitle}`, {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      ui.screen.getByLabel(`Coefficient fourniture K FO pour ${fittingTitle}`, {
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      (await readEstimate(ui.browser, draft.versionId)).version.total_ht_cents,
    ).toBe(18668);
    await ui.app.open("/dashboard/affaires");
    await lockVersion(ui.browser, draft.versionId);
    const generated = await apiRequest(
      ui.browser,
      "POST",
      `/api/estimates/${draft.versionId}/pdf?force=1`,
      {
        layout: {
          ...ESTIMATE_PDF_PRESETS.client_detailed,
          showSectionSubtotals: false,
          includeTerms: false,
        },
      },
    );
    expect([200, 202]).toContain(generated.status);
    await expect
      .poll(
        async () => {
          const state = await apiRequest<{ data?: { status?: string } }>(
            ui.browser,
            "GET",
            `/api/estimates/${draft.versionId}/pdf?format=json`,
          );
          return state.body.data?.status;
        },
        { timeout: 120_000 },
      )
      .toBe("ready");
    const state = await apiRequest<{ data: { download_url: string } }>(
      ui.browser,
      "GET",
      `/api/estimates/${draft.versionId}/pdf?format=json`,
    );
    const encoded = await ui.browser.evaluate(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`PDF download: ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }, state.body.data.download_url);
    const pdf = await extractPdfText(Buffer.from(encoded, "base64"), {
      root: process.cwd(),
    });
    const text = pdf.pages.join(" ").replace(/\s+/g, " ");
    expect(text).toContain(draft.sectionTitle);
    expect(text).not.toContain(tubeTitle);
    expect(text).not.toContain(fittingTitle);
    expect(text).toMatch(/186[,.]68/);
    await releaseVersion(ui.browser, draft.versionId);
    await recordEvidence(ui.army, "fo534-kit-pdf", {
      text,
      lines,
      total: 18668,
    });
  },
);

armyTest(
  "FO53413 flagless API coefficient edits remain manual including neutrality",
  options,
  async (ui) => {
    const draft = await prepareV3Draft(ui, ui.army, "FO534API");
    const base = {
      quantity: 1,
      unit_code: "u",
      unit_price_ht_cents: 10000,
      k_fo: 1,
      k_mo: 1,
      h_mo_per_unit: 0,
      pricing_status: "priced",
    };
    const [adjusted, neutral] = await seedLines(ui, ui.army, draft, "api", [
      { ...base, title: `${ui.army.runPrefix} API ajustement` },
      { ...base, title: `${ui.army.runPrefix} API neutre` },
    ]);
    await lockVersion(ui.browser, draft.versionId);
    const before = await readEstimate(ui.browser, draft.versionId);
    const saved = await apiRequest<{
      ok: boolean;
      data: { committed: boolean };
    }>(
      ui.browser,
      "POST",
      `/api/estimates/${draft.versionId}/batch`,
      {
        operation_key: randomUUID(),
        operations: [
          { op: "update", id: adjusted.id, data: { k_fo: 1.2 } },
          { op: "update", id: neutral.id, data: { k_fo: 1 } },
        ],
      },
      { "if-match": before.version.updated_at },
    );
    expect([saved.status, saved.body.ok, saved.body.data?.committed]).toEqual([
      200,
      true,
      true,
    ]);
    const after = await readEstimate(ui.browser, draft.versionId);
    expect(after.items.find((row) => row.id === adjusted.id)).toMatchObject({
      k_fo: 1.2,
      k_fo_manual: true,
      fo_provision: 1,
      pu_ht_cents: 15600,
    });
    expect(after.items.find((row) => row.id === neutral.id)).toMatchObject({
      k_fo: 1,
      k_fo_manual: true,
      fo_provision: 1,
      pu_ht_cents: 13000,
    });
    expect(after.version.total_ht_cents).toBe(28600);
    await releaseVersion(ui.browser, draft.versionId);
    await recordEvidence(ui.army, "fo534-flagless-api", { saved, after });
  },
);

armyTest("FO53414 an unrelated draft edit preserves an unknown historical coefficient before an explicit K FO edit", options, async ui => {
  const draft = await prepareV3Draft(ui, ui.army, "FO534LEGACY");
  const id = randomUUID();
  const title = `${ui.army.runPrefix} historical supply`;
  await querySql(`select set_config('miaouffrage.estimate_v3_writer','${draft.versionId}',false);
    insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,quantity,unit_price_ht_cents,k_fo,fo_provision,unit_code,pricing_status,tax_rate_bp,k_mo,h_mo_per_unit,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
    values('${id}','${draft.versionId}','${draft.sectionId}','line',1,'${title}',1,10000,1,1.03,'u','priced',2000,1,0,0,0,0,0);`);
  await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
  await waitForDraftLease(ui);
  await showStandardColumns(ui);
  const quantity = ui.screen.getByLabel(`Quantité pour ${title}`, { exact: true });
  await quantity.fill("2");
  await quantity.press("Tab");
  await saveLineEditsWithShortcut(ui, draft.versionId, title, ui.army);
  await expect.poll(async () => {
    const line = (await readEstimate(ui.browser, draft.versionId)).items.find(row => row.id === id)!;
    return [line.quantity, line.k_fo, line.fo_provision, line.k_fo_manual, line.line_total_ht_cents];
  }).toEqual([2, 1, 1.03, null, 26780]);
  const coefficient = ui.screen.getByLabel(`Coefficient fourniture K FO pour ${title}`, { exact: true });
  await coefficient.fill("1,017");
  await coefficient.press("Tab");
  await saveLineEditsWithShortcut(ui, draft.versionId, title, ui.army);
  await expect.poll(async () => {
    const line = (await readEstimate(ui.browser, draft.versionId)).items.find(row => row.id === id)!;
    return [line.k_fo, line.fo_provision, line.k_fo_manual, line.line_total_ht_cents];
  }).toEqual([1.017, 1, true, 26442]);
  await recordEvidence(ui.army, "fo534-legacy-draft", { item: (await readEstimate(ui.browser, draft.versionId)).items.find(row => row.id === id) });
});

armyTest("FO53416 POSE SEULE keeps a neutral editable K FO and its site source through a saved template", options, async (ui) => {
  const draft = await prepareV3Draft(ui, ui.army, "FO534POSE");
  await querySql(`insert into public.supply_types(tenant_id,code,name) values ('${draft.owner.tenantId}','tube','Tube') on conflict (tenant_id,code) do nothing;`);
  const types = await connectedApi<{ supply_types: Array<{ id: string; code: string }> }>(ui, "GET", `/api/estimates/${draft.versionId}`);
  const selectionId = randomUUID();
  const origin = { selection_id: selectionId, source_id: selectionId, kind: "site", transport_mode: null,
    site: { supplier: "Négoce Fictif", offer_reference: "POSE-534", offer_date: "2026-11-03", document: null } };
  const title = `${ui.army.runPrefix} pose avec supportage`;
  const [created] = await seedLines(ui, ui.army, draft, "pose", [{ title, line_nature: "pose_only", unit_code: "ens",
    pricing_status: "priced", quantity: 1, unit_price_ht_cents: 350, h_mo_per_unit: 0.5, labor_role_id: draft.tuyauteurId,
    k_fo: 1, k_mo: 1, supply_type_id: types.supply_types.find(row => row.code === "tube")!.id, fo_price_origin: origin }]);
  expect(created).toMatchObject({ line_nature: "pose_only", k_fo: 1, k_fo_manual: false, fo_provision: 1,
    pu_ht_cents: 2855, line_total_ht_cents: 2855, fo_price_origin: origin });
  await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
  await waitForDraftLease(ui);
  await showStandardColumns(ui);
  const input = ui.screen.getByLabel(`Coefficient fourniture K FO pour ${title}`, { exact: true });
  for (const [value, price] of [["1,1", 2901], ["1", 2855]] as const) {
    await input.fill(value);
    await input.press("Tab");
    await saveLineEditsWithShortcut(ui, draft.versionId, title, ui.army);
    await expect.poll(async () => {
      const line = (await readEstimate(ui.browser, draft.versionId)).items.find(row => row.id === created.id)!;
      return [line.line_nature, line.k_fo, line.k_fo_manual, line.fo_provision, line.pu_ht_cents, line.h_mo_per_unit];
    }).toEqual(["pose_only", Number(value.replace(",", ".")), true, 1, price, 0.5]);
  }
  await releaseVersion(ui.browser, draft.versionId);
  const saved = await connectedApi<{ template: { id: string } }>(ui, "POST", "/api/estimates/templates",
    { source_version_id: draft.versionId, name: `${ui.army.runPrefix} modèle pose` });
  const copy = await connectedApi<{ template: { id: string } }>(ui, "POST", `/api/estimates/templates/${saved.template.id}/duplicate`,
    { name: `${ui.army.runPrefix} copie modèle pose` });
  // prepareV3Draft restores policy2 after creation. Open policy3 explicitly for this new canonical version.
  const reason = `${ui.army.runPrefix} pose template v3`;
  await setTenantCalcPolicy(draft.owner, { engine: 3, fo: "1.30", mo: "1.20", reason });
  const instantiated = await instantiateTemplate(ui, ui.army, copy.template.id,
    { project_id: draft.projectId, expected_calc_engine_version: 3 }, "fo534-pose-site").finally(() =>
      setTenantCalcPolicy(draft.owner, { engine: 2, fo: "1.30", mo: "1.20", reason: `${reason} fin` }));
  expect([instantiated.status, instantiated.body.ok]).toEqual([201, true]);
  const estimate = await readEstimate(ui.browser, instantiated.body.data!.versionId!);
  expect(estimate.items.find(row => row.item_type === "line")).toMatchObject({ title, line_nature: "pose_only",
    k_fo: 1, k_fo_manual: true, fo_provision: 1, fo_price_origin: origin, unit_price_ht_cents: 350,
    h_mo_per_unit: 0.5, pu_ht_cents: 2855, line_total_ht_cents: 2855 });
  await recordEvidence(ui.army, "fo534-pose-site-template", { original: created, copied: estimate.items });
});

// The production acceptance of TI-534 reported a library ouvrage whose preview announced a direct
// cost and whose amount read 0 € once inserted. FO53412 marks its kit by SQL and LEGASM01 inserts
// into an engine 2 draft: this journey follows the estimator on an engine 3 draft, from the preview
// of a real library entry (supplies of two families and labour) to the amount of the inserted kit
// on its row, in the footer, after a reload and in the downloaded PDF. The picker used to print the
// missing target price of that entry as « 0,00 € »; it now reads « sans prix cible ».
armyTest("FO53417 a library ouvrage inserted in a v3 draft keeps the amount its preview announced", { ...options, timeout: 300_000 }, async (ui) => {
  const draft = await prepareV3Draft(ui, ui.army, "FO534LIB");
  await querySql(
    `insert into public.supply_types(tenant_id,code,name) values ('${draft.owner.tenantId}','tube','Tube'),('${draft.owner.tenantId}','raccord','Raccord') on conflict (tenant_id,code) do nothing;`,
  );
  const details = await connectedApi<{ supply_types: Array<{ id: string; code: string }> }>(ui, "GET", `/api/estimates/${draft.versionId}`);
  const family = (code: string) => details.supply_types.find((row) => row.code === code)!.id;
  const anchorTitle = `${ui.army.runPrefix} ligne voisine`;
  const [anchor] = await seedLines(ui, ui.army, draft, "library-anchor", [{ title: anchorTitle, quantity: 1, unit_code: "u",
    unit_price_ht_cents: 1000, k_fo: 1, k_fo_manual: true, k_mo: 1, h_mo_per_unit: 0, pricing_status: "priced" }]);
  expect(anchor.line_total_ht_cents).toBe(1300);
  // The production kit sat inside a lot, after a line: the draft allows that second section level.
  await querySql(`select set_config('miaouffrage.estimate_v3_writer','${draft.versionId}',false); update public.estimate_versions set max_section_depth=3 where id='${draft.versionId}';`);
  const name = `${ui.army.runPrefix} tuyauterie complete`;
  const tubeTitle = `${ui.army.runPrefix} tube de bibliotheque`;
  const fittingTitle = `${ui.army.runPrefix} raccord de bibliotheque`;
  // Direct cost 100 + 30 + 0.2 h at the 40 EUR/h of the draft owner's role = 138 EUR.
  const created = await connectedApi<{ assembly: { id: string; ds_cents: number } }>(ui, "POST", "/api/estimates/assemblies", { name, unit: "ens", items: [
    { title: tubeTitle, unit: "ml", default_quantity: 1, unit_cost_ht_cents: 10000, supply_type_id: family("tube"), h_mo: 0.2,
      labor_role_id: draft.tuyauteurId, position: 1, cost_type: "material" },
    { title: fittingTitle, unit: "u", default_quantity: 1, unit_cost_ht_cents: 3000, supply_type_id: family("raccord"), position: 2, cost_type: "material" },
  ] });
  expect(created.assembly.ds_cents).toBe(13800);
  await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
  await waitForDraftLease(ui);
  await ui.browser.locator(`[data-estimate-item-id="${anchor.id}"] [data-testid="estimate-line-title-input"]`).click();
  await ui.screen.getByTestId("estimate-editor-insert-button", { visible: true }).click();
  await ui.screen.getByTestId("estimate-editor-assemblies-button", { visible: true }).click();
  const picker = ui.screen.getByRole("dialog", "Ajouter un ouvrage", { exact: true });
  await picker.getByLabel("Rechercher", { exact: true }).fill(name);
  // An ouvrage built by hand has no target price: the picker says so, never « 0,00 € » next to its
  // 138 EUR direct cost, in its list entry, its preview and its insert button.
  const entry = picker.getByRole("button", name, { exact: false });
  await expect(entry).toContainText("sans prix cible");
  await expect(entry).not.toContainText("0,00");
  await entry.click();
  await expect(picker.getByRole("region", "Composants de l’ouvrage", { exact: true })).toContainText(tubeTitle);
  await expect(picker).toContainText(/Coût direct\s*138[,.]00/);
  await expect(picker).toContainText(/Prix cible HT\s*sans prix cible/);
  const insert = picker.getByRole("button", `Ajouter « ${name} » — sans prix cible`, { exact: false });
  await expect(insert).toBeEnabled();
  await expect(insert).not.toContainText("0,00");
  const insertion = ui.browser.waitForResponse(`**/api/estimates/assemblies/${created.assembly.id}/insert?versionId=${draft.versionId}`);
  await insert.click();
  const response = await insertion;
  const receipt = await response.json<{ ok: boolean; error?: unknown; data?: { totals: Record<string, number> } }>();
  await recordEvidence(ui.army, "fo534-library-kit-receipt", { created, status: response.status, receipt });
  expect([response.status, receipt.ok, receipt.data?.totals.total_ht_cents]).toEqual([200, true, 20928]);
  await expect(picker).toBeHidden();
  const inserted = await readEstimate(ui.browser, draft.versionId);
  const kit = inserted.items.find((row) => row.item_type === "section" && row.title === name)!;
  // TI-718 persists the aggregate's editable quantity and library unit, while
  // preserving its assembly provenance and every amount announced by the preview.
  expect([kit.parent_id, kit.source_metadata]).toEqual([draft.sectionId, {
    kit_metier: true, assembly_id: created.assembly.id, ouvrage_unit: "ens", ouvrage_quantity: 1,
  }]);
  // 100 x 1.13 x 1.30 + 0.2 h x 40 x 1.20 = 156.50 ; 30 x 1.02 x 1.30 = 39.78 ; kit 196.28 ; with the 13.00 neighbour 209.28.
  expect(inserted.items.filter((row) => row.parent_id === kit.id)
    .map((row) => [row.title, row.unit_code, row.k_fo, row.k_fo_manual, row.h_mo_per_unit, row.line_total_ht_cents])).toEqual([
    [tubeTitle, "ml", 1.13, false, 0.2, 15650], [fittingTitle, "u", 1.02, false, 0, 3978]]);
  expect(inserted.version.total_ht_cents).toBe(20928);
  const kitRow = ui.browser.locator(`[data-estimate-item-id="${kit.id}"]`);
  await expect(kitRow.getByLabel(`Quantité de l’ouvrage ${name}`, { exact: true })).toHaveValue("1");
  await expect(ui.browser.locator(`[data-estimate-item-id="${kit.id}"] [data-estimate-column="unit"]`)).toHaveText("ens");
  const footer = ui.browser.locator('[data-testid="estimate-editor-table-footer"] [data-estimate-column="total_price"]');
  await expect(kitRow).toContainText(/HT\s*196[,.]28/);
  await expect(footer).toHaveText(/209[,.]28/);
  await expect(ui.screen.getByTestId("estimate-line-title-input")).toHaveCount(1);
  await ui.browser.reload();
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await expect(kitRow).toContainText(/HT\s*196[,.]28/);
  await expect(footer).toHaveText(/209[,.]28/);
  expect((await readEstimate(ui.browser, draft.versionId)).items).toEqual(inserted.items);
  await ui.app.open("/dashboard/affaires");
  await generatePdf(ui.browser, (label, data) => recordEvidence(ui.army, label, data), "fo534-library-kit", draft.versionId,
    { ...ESTIMATE_PDF_PRESETS.client_detailed, showSectionSubtotals: false, includeTerms: false });
  const downloaded = await pdfText(await storedPdfBytes(ui.browser, draft.versionId));
  expect(downloaded.text).toContain(name);
  expect(downloaded.text).not.toContain(tubeTitle);
  expect(downloaded.text).not.toContain(fittingTitle);
  expect(downloaded.text).toMatch(/196[,.]28/);
  expect(downloaded.text).toMatch(/209[,.]28/);
  await recordEvidence(ui.army, "fo534-library-kit", { kitId: kit.id, components: inserted.items.filter((row) => row.parent_id === kit.id), pdf: downloaded });
});
