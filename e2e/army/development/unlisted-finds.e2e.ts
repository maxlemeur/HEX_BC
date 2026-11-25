import { randomUUID } from "node:crypto";
import { expect } from "e2e";
import { apiRequest, armyTest, recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { activateOwnedPlanDispatch, deactivateOwnedPlanDispatch, readOwnedPlanJobs, runOwnedPlanDispatch,
  runOwnedTakeoffCommand, seedPlanDossier } from "../takeoff/plan-dispatch-support";
import { activateOwnedItemListOrder, deactivateOwnedItemListOrder, publishOwnedItemTemplate } from "../takeoff/poste-reading-support";
import { ownedWorkerHostId, signUpWorkerOwner } from "../takeoff/worker-support";

armyTest("TKFIND01 les ouvrages hors liste sont décidés, mesurés sur le forfait du membre et reconnus à la relecture",
  { session: "army", trace: "off", tags: ["critical","development","takeoff-worker","local"], timeout: 300000 }, async ui => {
    await ui.app.open("/dashboard/affaires");
    const owner = await signUpWorkerOwner(ui,"TF1");
    await activateOwnedPlanDispatch();
    await activateOwnedItemListOrder();
    try {
      const dossier = await seedPlanDossier(ui,owner,[{ name: "ventilation.pdf", pages: 2 }]);
      const project = dossier.projectId;
      const profile = await dossier.setup.from("profiles").update({ full_name: "Camille Exemple" }).eq("id",owner.userId);
      expect(profile.error).toBeNull();
      const [plan] = dossier.plans;
      await publishOwnedItemTemplate(dossier.setup,owner,["Lavabo","Vanne","Robinet"].map((label,i) =>
        ({ id: `poste-${i}`, label, expectedUnit: "u" })));
      const launch = await runOwnedTakeoffCommand(owner,["launch",project,dossier.planSetId,randomUUID(),"1",plan.id]);
      expect(launch.result?.outcome).toBe("admitted");
      const [initial] = await readOwnedPlanJobs(project);
      const finds = ["Grille à ailettes","Diffuseur carré","Trappe de visite"].map((designation,i) =>
        ({ designation, page: 2, evidence: `Repère fictif V${i + 1}` }));
      await runOwnedPlanDispatch(ui,owner,project,{ itemAnswers: { [initial.id]: { finds, findsTruncated: true,
        items: { Lavabo: { quantity: 1, unit: "u", page: 1 } } } } });
      const address = `/dashboard/affaires/${project}/takeoff?postes=liste`;
      const open = async () => { await ui.app.open(address); await waitForHydration(ui.browser); };
      await open();
      const block = ui.browser.locator("#ouvrages-hors-liste");
      const row = (name: string) => ui.browser.locator("#ouvrages-hors-liste li").filter({ hasText: name });
      const button = (name: string) => ui.screen.getByRole("button",name,{ exact: true });
      for (const width of [1440,390]) {
        await ui.browser.setViewport({ width,height: 844 });
        await expect(block).toContainText("Ouvrages vus sur le plan, hors liste (3)");
        await expect(row(finds[0].designation)).toContainText("Repère fictif V1");
        await expect(row(finds[0].designation)).toContainText("ventilation.pdf · page 2");
        await expect(block).toContainText("davantage d’ouvrages");
        await expect(ui.screen.getByText(/2 postes sur 3 non trouvés et 3 ouvrages vus hors liste/)).toBeVisible();
        await expect(ui.screen.getByText(/Aucun DPGF dans le dossier : liste issue du gabarit Plomberie, version 2 \(3 postes\)/)).toHaveCount(2);
      }
      const attestedPage = `/api/takeoff/jobs/${initial.id}/vector-plans/${plan.id}#page=2`;
      await expect(row(finds[0].designation).getByRole("link", /Voir le plan/)).toHaveAttribute("href", attestedPage);
      await row(finds[2].designation).getByRole("button","Écarter",{ exact: true }).click();
      await ui.screen.getByLabel("Motif",{ exact: true }).selectOption({ value: "other" });
      await ui.screen.getByLabel("Précisez le motif").fill("Lot entretien fictif");
      await button("Confirmer la mise à l’écart").click();
      await expect(block).toContainText("1 écarté");
      const ownerCookies = await ui.browser.cookies();
      const reader = await signUpWorkerOwner(ui,"TF2");
      await querySql(`update public.tenant_memberships set is_default=false where user_id='${reader.userId}';
        insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values ('${owner.tenantId}','${reader.userId}','director',true);`);
      await open();
      await block.getByText("1 écarté",{ exact: true }).click();
      await expect(block).toContainText("Lot entretien fictif");
      await expect(block).toContainText("Camille Exemple");
      const directorProof = row(finds[0].designation).getByRole("link", /Voir le plan/);
      await expect(directorProof).toHaveAttribute("href", attestedPage);
      const pdf = await ui.browser.evaluate(async url => {
        const response = await fetch(url);
        const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
        return { status: response.status, hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("") };
      }, (await directorProof.getAttribute("href"))!);
      expect(pdf).toEqual({ status: 200, hash: plan.hash });
      await expect(block.getByRole("button","Ajouter à la liste",{ exact: true })).toHaveCount(0);
      await expect(block.getByRole("button","Annuler la mise à l’écart",{ exact: true })).toHaveCount(0);
      expect((await apiRequest(ui.browser,"POST",`/api/affaires/${project}/takeoff/items/finds`,{ kind: "dismiss",
        intentKey: randomUUID(),jobId: initial.id,index: 0,reason: "outside_scope" })).status).toBe(403);
      await ui.browser.setCookies(ownerCookies);
      await open();
      for (const f of finds.slice(0,2)) await row(f.designation).getByRole("checkbox").check();
      await button("Ajouter les 2 ouvrages à la liste").click();
      const dialog = ui.screen.getByRole("dialog","Ajouter à la liste",{ exact: true });
      for (const f of finds.slice(0,2)) {
        const fields = dialog.getByRole("group",f.designation,{ exact: true });
        await fields.getByLabel("Unité").fill("u");
        await fields.getByLabel("Section",{ exact: true }).selectOption({ value: "new" });
        await fields.getByLabel("Nom de la nouvelle section").fill("Ventilation");
      }
      await button("Confirmer l’ajout").click();
      await expect.poll(async () => (await dossier.setup.from("takeoff_find_decisions").select("item_id")
        .eq("project_id",project).not("item_id","is",null)).data?.length).toBe(2);
      await expect(ui.screen.getByText("Liste enregistrée · révision 2 · 5 postes", { exact: false })).toBeVisible();
      await ui.screen.getByText("Ajouter un poste", { exact: true }).click();
      const manual = ui.screen.getByRole("form", "Ajouter un poste", { exact: true });
      await manual.getByRole("textbox", "Désignation", { exact: true }).fill("Poste manuel témoin");
      await manual.getByLabel("Section", { exact: true }).selectOption({ label: "Ventilation" });
      await manual.getByRole("button", "Ajouter le poste", { exact: true }).click();
      await expect(ui.screen.getByText("Liste enregistrée · révision 3 · 6 postes", { exact: false })).toBeVisible();
      expect(await readOwnedPlanJobs(project)).toHaveLength(1);
      await button("Mesurer les postes ajoutés sur ventilation.pdf (2)").click();
      await expect(ui.screen.getByTestId("poste-remeasure-reading")).toContainText("Lecture de 2 postes sur 1 plan");
      // Reserve the owned host until its browser-triggered dispatcher yields. The fixture dispatcher then supplies
      // the controlled answers, through the real ledger, worker and publication.
      const host = await ownedWorkerHostId();
      const holder = randomUUID();
      await querySql(`update private.takeoff_host_slots set job_id='${initial.id}',holder_token='${holder}',acquired_at=now(),
        expires_at=now()+interval '3 minutes' where host_id='${host}' and holder_token is null;`);
      await button("Confirmer la demande sur mon forfait").click();
      await expect(ui.screen.getByTestId("poste-remeasure-preview")).toHaveCount(0);
      const measured = (await readOwnedPlanJobs(project)).find(j => j.id !== initial.id)!;
      const request = await dossier.setup.from("takeoff_launch_requests").select("payer_id,manifest").eq("id",measured.launch_request_id).single();
      expect(request.data?.payer_id).toBe(owner.userId);
      expect(request.data?.manifest.order.list.asked_item_ids).toHaveLength(2);
      await querySql(`update private.takeoff_host_slots set job_id=null, holder_token=null, acquired_at=null, expires_at=null
        where host_id='${host}' and holder_token='${holder}';`);
      await runOwnedPlanDispatch(ui,owner,project,{ itemAnswers: { [measured.id]: { items: {
        [finds[0].designation]: { quantity: 4,unit: "u",page: 2 }, [finds[1].designation]: { quantity: 6,unit: "u",page: 2 },
      } } } });
      await open();
      const item = ui.browser.locator('table[aria-label="Postes du métré"] tr').filter({ hasText: finds[0].designation });
      await expect(item).toContainText("4 u");
      await item.getByText("Vu sur le plan",{ exact: true }).click();
      await expect(item).toContainText("Repère fictif V1");
      const reread = await runOwnedTakeoffCommand(owner,["launch",project,dossier.planSetId,randomUUID(),"1","-",initial.id]);
      expect(reread.result?.outcome).toBe("admitted");
      const next = (await readOwnedPlanJobs(project)).find(j => j.launch_request_id === reread.result?.requestId)!;
      const changed = finds.map(f => ({ ...f, designation: f.designation.toUpperCase().normalize("NFD").replace(/\p{M}/gu,"").replaceAll(" ","  ") }));
      await runOwnedPlanDispatch(ui,owner,project,{ itemAnswers: { [next.id]: { finds: [...changed,
        { designation: "Registre circulaire", evidence: "Repère fictif V4", page: 1 }] } } });
      await open();
      await expect(block).toContainText("Ouvrages vus sur le plan, hors liste (1)");
      await expect(block).toContainText("Registre circulaire");
      await block.getByText("1 écarté",{ exact: true }).click();
      await button("Annuler la mise à l’écart").click();
      await expect(block).toContainText("Ouvrages vus sur le plan, hors liste (2)");
      await expect(block).toContainText(changed[2].designation);
      await recordEvidence(ui.army,"unlisted-finds",{ project, plan: plan.id, initial: initial.id, targeted: measured.id,
        reread: next.id, widths: [1440,390], observedQuantity: 4, added: 2, availableAfterUndo: 2 });
    } finally {
      await deactivateOwnedItemListOrder();
      await deactivateOwnedPlanDispatch();
    }
  });

armyTest("TKFIND02 relire une seule page conserve les ouvrages des autres pages et ne conclut pas sur le plan entier",
  { session: "army", trace: "off", tags: ["critical", "development", "takeoff-worker", "local"], timeout: 300000 }, async ui => {
    await ui.app.open("/dashboard/affaires");
    const owner = await signUpWorkerOwner(ui, "TFP");
    await activateOwnedPlanDispatch();
    await activateOwnedItemListOrder();
    try {
      const dossier = await seedPlanDossier(ui, owner, [{ name: "deux-pages.pdf", pages: 2 }]);
      const [plan] = dossier.plans;
      await publishOwnedItemTemplate(dossier.setup, owner, ["Lavabo", "Vanne", "Robinet"].map((label, i) =>
        ({ id: `poste-${i}`, label, expectedUnit: "u" })));
      const read = async (revision: number, finds: Array<{ designation: string; page: number; evidence: string }>, predecessor?: string) => {
        const launch = await runOwnedTakeoffCommand(owner, ["launch", dossier.projectId, dossier.planSetId, randomUUID(),
          String(revision), predecessor ? "-" : plan.id, ...(predecessor ? [predecessor] : [])]);
        expect(launch.result?.outcome).toBe("admitted");
        const job = (await readOwnedPlanJobs(dossier.projectId)).find(job => job.launch_request_id === launch.result?.requestId)!;
        await runOwnedPlanDispatch(ui, owner, dossier.projectId, { itemAnswers: { [job.id]: { finds,
          items: { Lavabo: { quantity: 1, unit: "u", page: 1 } } } } });
        return job.id;
      };
      const first = await read(1, [{ designation: "Ancienne bouche", page: 1, evidence: "B1" },
        { designation: "Clapet conservé", page: 2, evidence: "C2" }]);
      const address = `/dashboard/affaires/${dossier.projectId}/takeoff?postes=liste`;
      await ui.app.open(address);
      const block = ui.browser.locator("#ouvrages-hors-liste");
      await expect(block).toContainText("Ancienne bouche");
      await expect(ui.screen.getByText(/2 postes sur 3 non trouvés et 2 ouvrages vus hors liste/)).toBeVisible();
      await dossier.confirm([{ ...plan, pages: [1], inactive: false }], 2);
      const second = await read(2, [{ designation: "Nouvelle bouche", page: 1, evidence: "N1" }], first);
      const pages = await dossier.setup.from("takeoff_item_answer_publications").select("pages,answer_count").eq("job_id", second).single();
      expect(pages.data).toEqual({ pages: [1], answer_count: 3 });
      await ui.app.open(address);
      await expect(block).toContainText("Nouvelle bouche");
      await expect(block).toContainText("Clapet conservé");
      await expect(block).not.toContainText("Ancienne bouche");
      await expect(ui.screen.getByText(/cette liste ne correspond probablement pas à ce plan/)).toHaveCount(0);
      await recordEvidence(ui.army, "finds-partial-plan", { first, second, retainedPages: [1], olderFindPage: 2, visibleFinds: 2 });
    } finally {
      await deactivateOwnedItemListOrder();
      await deactivateOwnedPlanDispatch();
    }
  });
