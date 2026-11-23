import type { RevisionVersion, RevisionPreview } from "@/lib/takeoff/contribution-revision-contracts";
import { randomUUID } from "node:crypto";

import { apiRequest, readEstimate, recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { readCountAnswers } from "./count-marks-support";
import { describe, expect, nativeTest as test } from "./native-ui";
import { acceptOnPlan, fictionalSendPlanPdf, readOwnedLines, seedItemSendAffaire } from "./poste-send-support";

describe("Correction d’un apport de plan au devis", () => {
  test(
    "POSTE-REVISION01 corrige trois repères à deux dans le devis chiffré et bloque le changement d’unité",
    { session: "army", trace: "off", tags: ["critical", "local"], timeout: 240_000 },
    async ({ ui }) => {
      const { app, army, screen } = ui;
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, {
        tag: "POSTEREV",
        calcPolicy: "absent",
      });
      const name = "plan-comptage.pdf";
      const seeded = await seedItemSendAffaire(owner, {
        name: `${army.runPrefix}-POSTE-REVISION`,
        labels: ["Lavabo"],
        plans: [
          { name, measures: { Lavabo: { quantity: 2, page: 2 } }, pdf: await fictionalSendPlanPdf("Comptage") },
        ],
      });
      const plan = seeded.plans[0];
      const itemId = seeded.items.Lavabo;
      const answerId = (await readCountAnswers(seeded.projectId))[itemId];
      const table = `/dashboard/affaires/${seeded.projectId}/takeoff?postePlan=${plan.fileId}`;
      await app.open(table);
      await waitForHydration(ui.browser);
      const marked = await apiRequest(
        ui.browser,
        "POST",
        `/api/affaires/${seeded.projectId}/takeoff/count-marks`,
        {
          intentKey: randomUUID(),
          revisions: { [answerId]: 0 },
          gestures: [
            ...[0.2, 0.4, 0.6].map((x) => ({
              op: "add",
              answer_id: answerId,
              key: randomUUID(),
              page: 2,
              x,
              y: 0.5,
              geometry: {
                version: 1,
                view_box: [0, 0, 595, 842],
                rotation: 0,
                user_unit: 1,
                width: 595,
                height: 842,
              },
            })),
            { op: "verify", answer_id: answerId, pages: [2, 7] },
          ],
        },
      );
      expect(marked.status).toBe(200);
      await screen.getByRole("link", "Détail de « Lavabo » sur le plan", { exact: true }).click();
      const detail = ui.locator('[data-testid="poste-detail"]');
      await expect(detail.getByRole("button", "Conserver la mesure (2 u)", { exact: true })).toBeVisible();
      await expect(detail.getByTestId("reperes-decompte")).toContainText(
        "Le comptage vérifié peut être retenu pour le devis",
      );
      await detail.getByRole("button", "Retenir le comptage vérifié (3 u)", { exact: true }).click();
      await expect(detail).toContainText("Comptage vérifié retenu");
      await app.open(table);
      await waitForHydration(ui.browser);
      await ui
        .locator('[data-testid="poste-plan-send"]')
        .getByRole("button", "Envoyer ce plan au devis", { exact: true })
        .click();
      await screen.getByRole("dialog").getByRole("button", `Créer le devis et y envoyer « ${name} »`).click();
      await expect(ui.browser).toHaveURL(/\/edit\?focusItemId=/, { timeout: 60_000 });
      const [line] = (await readOwnedLines(seeded.projectId)).filter((l) => l.item_type === "line");
      expect(line.quantity).toBe(3);
      await app.open(table);
      await waitForHydration(ui.browser);
      const saveLine = async (fields: Record<string, unknown>) => {
        const lock = `/api/estimates/${line.version_id}/lock`;
        expect([200, 201]).toContain((await apiRequest(ui.browser, "POST", lock)).status);
        const current = await readEstimate(ui.browser, line.version_id);
        const wrote = await apiRequest(
          ui.browser,
          "POST",
          `/api/estimates/${line.version_id}/batch`,
          { operation_key: randomUUID(), operations: [{ op: "update", id: line.id, data: fields }] },
          { "if-match": current.version.updated_at },
        );
        expect(wrote.status, JSON.stringify(wrote.body)).toBe(200);
        expect((await apiRequest(ui.browser, "DELETE", lock)).status).toBe(200);
      };
      await saveLine({ unit_price_ht_cents: 4200, pricing_status: "priced" });
      // Ten storeys with twelve trade or zone sheets per floor. The peers are
      // completed readings with answers and rows, in this same owned affaire.
      await querySql(`do $peers$
        declare t uuid:='${owner.tenantId}'; proj uuid:='${seeded.projectId}'; j uuid:='${plan.jobId}'; base_job public.takeoff_jobs;
          f uuid; peer uuid; answer_ public.takeoff_item_answers; row_ public.takeoff_items;
        begin
          select * into strict base_job from public.takeoff_jobs where id=j;
  set local session_replication_role=replica;
  for i in 1..120 loop
   f:=gen_random_uuid(); peer:=gen_random_uuid();
   insert into public.plan_files(id,tenant_id,plan_set_id,file_name,file_path,file_type,file_size_bytes,page_count)
     values(f,t,base_job.plan_set_id,'peer-'||i||'.pdf',concat_ws('/',t,base_job.plan_set_id,f,'peer.pdf'),'application/pdf',100,9);
   insert into public.takeoff_jobs(id,tenant_id,project_id,created_by,level,status,source_file_name,launch_request_id,launch_unit_key,preparation_snapshot)
     values(peer,t,proj,base_job.created_by,'A','completed','peer.pdf',base_job.launch_request_id,'plan:'||f,
       jsonb_set(base_job.preparation_snapshot,'{preparation,sources,0,document_id}',to_jsonb(f)));
   for answer_ in select a.* from public.takeoff_item_answers a where a.job_id=j loop
    answer_.id:=gen_random_uuid(); answer_.job_id:=peer; answer_.plan_file_id:=f; answer_.plan_logical_id:=f;
    insert into public.takeoff_item_answers select answer_.*;
   end loop;
   for row_ in select r.* from public.takeoff_items r where r.job_id=j loop
    row_.id:=gen_random_uuid();row_.job_id:=peer;
    insert into public.takeoff_items select row_.*;
   end loop;
  end loop;
  set local session_replication_role=origin;


          if jsonb_array_length(private.takeoff_send_context(t,proj,j,'${line.version_id}')->'peers')<>120 then
            raise exception 'Expected 120 other readings in the context of the preview'; end if;
        end $peers$;`);
      const openDetail = () =>
        screen.getByRole("link", "Détail de « Lavabo » sur le plan", { exact: true }).click();
      await openDetail();
      await expect(detail).toContainText("Déjà envoyé");
      await expect(screen.getByRole("img", `${name}, page 2`, { exact: true })).toBeVisible({ timeout: 30_000 });
      const grid = screen.getByRole("grid", "Repères du poste sur la page");
      await detail.getByTestId("repere-ligne").first().click();
      await grid.press("Delete");
      await screen.getByRole("dialog").getByRole("radio", "Légende ou détail").click();
      await screen.getByRole("dialog").getByRole("button", "Retirer le repère", { exact: true }).click();
      await grid.press("p");
      await screen.getByRole("button", "Enregistrer (2)").click();
      const expectQuantities = async (container: typeof detail) => {
        await expect(container.getByRole("group", "Déjà envoyé · V1", { exact: true })).toContainText("3 u · comptage vérifié");
        await expect(container.getByRole("group", "Correction à confirmer", { exact: true })).toContainText("2 u · comptage vérifié");
      };
      await expectQuantities(detail.getByTestId("revision-detail"));
      await app.open(table);
      await waitForHydration(ui.browser);
      const row = ui.locator(`[data-testid="poste-${itemId}"]`);
      await expectQuantities(row);
      await openDetail();
      const openPreview = screen.getByRole("button", "Prévisualiser la correction");
      await expect(openPreview).toBeVisible();
      await ui.browser.evaluate(() => {
        const seen = window as typeof window & {
          revisionStart?: number;
          revisionMs?: number;
          revisionConfirms?: number;
        };
        seen.revisionConfirms = 0;
        document.addEventListener(
          "click",
          (e) => {
            if ((e.target as Element).closest("button")?.textContent?.includes("Prévisualiser la correction"))
              seen.revisionStart = performance.now();
          },
          true,
        );
        const observer = new MutationObserver(() => {
          if (
            seen.revisionStart &&
            Array.from(document.querySelectorAll("button")).some(
              (b) => b.textContent === "Confirmer la correction" && !b.disabled,
            )
          ) {
            seen.revisionMs = performance.now() - seen.revisionStart;
            observer.disconnect();
          }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        const original = window.fetch.bind(window);
        window.fetch = (input, init) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (
            url.includes("/item-send/revision") &&
            typeof init?.body === "string" &&
            JSON.parse(init.body).action === "confirm"
          )
            seen.revisionConfirms!++;
          return original(input, init);
        };
        return true;
      });
      await openPreview.click();
      const confirm = screen.getByRole("button", "Confirmer la correction");
      await expect(confirm).toBeEnabled();
      const previewMs = await ui.browser.evaluate(
        () => (window as typeof window & { revisionMs?: number }).revisionMs ?? null,
      );
      expect(previewMs).not.toBeNull();
      expect(previewMs!).toBeLessThan(1000);
      await confirm.dblclick();
      await expect(detail).toContainText("Correction confirmée");
      expect(
        await ui.browser.evaluate(
          () => (window as typeof window & { revisionConfirms?: number }).revisionConfirms ?? null,
        ),
      ).toBe(1);
      const changed = (await readOwnedLines(seeded.projectId)).find((l) => l.id === line.id)!;
      expect(changed.quantity).toBe(2);
      expect(changed.inputs.unit_price_ht_cents).toBe(4200);
      await app.open(`/dashboard/estimates/${line.version_id}/edit?focusItemId=${line.id}`);
      await expect(
        ui.browser.locator(`[data-estimate-item-id="${line.id}"] input[aria-label="Quantité pour Lavabo"]`),
      ).toHaveValue("2");
      await app.open(table);
      await waitForHydration(ui.browser);
      await saveLine({ unit_code: "m" });
      await openDetail();
      await detail
        .getByTestId("revision-detail")
        .getByRole("button", "Retenir la mesure (2 u)", { exact: true })
        .click();
      await openPreview.click();
      await expect(detail).toContainText("Vérifiez son unité dans le devis");
      await expect(confirm).toBeDisabled();
      expect((await readOwnedLines(seeded.projectId)).find((l) => l.id === line.id)?.quantity).toBe(2);
      expect(
        await querySql(
          `select count(*) from public.takeoff_item_send_receipts where version_id='${line.version_id}' and command_kind='revise';`,
        ),
      ).toEqual(["1"]);
      const copy = await apiRequest<{ data: { version_id: string } }>(
        ui.browser,
        "POST",
        `/api/estimates/${line.version_id}/duplicate`,
      );
      expect(copy.status).toBe(201);
      const versionsFor = async (jobId: string) => {
        const url = `/api/takeoff/jobs/${jobId}/item-send/revision`;
        const read = await apiRequest<{ data: { versions: RevisionVersion[] } }>(ui.browser, "POST", url, {
          action: "read",
          items: [itemId],
        });
        expect(read.status).toBe(200);
        const versions = read.body.data.versions.map(({ version_id, receipt_id }) => ({ version_id, receipt_id }));
        for (const scope of versions) {
          const next = await apiRequest(ui.browser, "POST", url, { action: "preview", ...scope, choices: {} });
          expect(next.status, JSON.stringify(next.body)).toBe(200);
        }
        return versions;
      };
      const destinations = await versionsFor(plan.jobId);
      expect(destinations.map((v) => v.version_id).sort()).toEqual(
        [line.version_id, copy.body.data.version_id].sort(),
      );
      expect(await versionsFor(plan.jobId.toUpperCase())).toEqual(destinations);
      const upper = await ui.browser.evaluate(
        ({ jobId, versionId }) => {
          const address = new URL(location.href);
          address.searchParams.set("lecture", jobId.toUpperCase());
          address.searchParams.set("versionId", versionId.toUpperCase());
          return address.pathname + address.search;
        },
        { jobId: plan.jobId, versionId: copy.body.data.version_id },
      );
      await app.open(upper);
      await waitForHydration(ui.browser);
      await expect(detail.getByLabel("Devis à consulter ou corriger")).toHaveValue(copy.body.data.version_id);
      await detail.getByRole("button", "Prévisualiser la correction").click();
      await expect(detail.getByRole("group", "Aperçu de la correction")).toBeVisible();
      await recordEvidence(army, "POSTE-REVISION01", {
        projectId: seeded.projectId,
        line: line.id,
        previewMs,
        priceCents: 4200,
      });
    },
  );
});

describe("Ajout d’un poste à un envoi", () => {
  test(
    "POSTE-REVISION02 inclut l’hypothèse, refuse la précision excessive et rejoue le reçu après émission",
    {
      session: "army",
      trace: "off",
      tags: ["critical", "local"],
      timeout: 180_000,
    },
    async ({ ui }) => {
      const { app, army } = ui;
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, {
        tag: "PREVA",
        calcPolicy: "absent",
      });
      const seeded = await seedItemSendAffaire(owner, {
        name: `${army.runPrefix}-REVISION-AJOUT`,
        labels: ["Lavabo", "Vanne"],
        plans: [
          {
            name: "sanitaires.pdf",
            measures: { Lavabo: { quantity: 2, page: 2 }, Vanne: { quantity: 1, page: 7 } },
          },
        ],
      });
      const [plan] = seeded.plans;
      const item = seeded.items.Vanne;
      await acceptOnPlan(owner, seeded.projectId, plan, [seeded.items.Lavabo]);
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      const send = `/api/takeoff/jobs/${plan.jobId}/item-send`;
      const post = async <T>(route: string, body: unknown) => {
        const r = await apiRequest<{ data: T }>(ui.browser, "POST", route, body);
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        return r.body.data;
      };
      const first = await post<{ plan_digest: string }>(send + "/preview", {});
      await post(send + "/confirm", { request_id: randomUUID(), plan_digest: first.plan_digest });
      const before = (await readOwnedLines(seeded.projectId)).filter((l) => l.item_type === "line");
      expect(before.map((l) => l.quantity)).toEqual([2]);
      const route = send + "/revision";
      const read = async () =>
        (await post<{ versions: RevisionVersion[] }>(route, { action: "read", items: [item] })).versions[0];
      let v = await read();
      const scope = { version_id: v.version_id, receipt_id: v.receipt_id };
      const edit = async (value: number) => {
        await post(route, {
          action: "entry",
          ...scope,
          answer_id: v.items[0].answer_id,
          expected_revision: v.items[0].sources.plan_entry_revision ?? 0,
          intent_id: randomUUID(),
          entry: {
            quantity: value,
            unit: "u",
            category: "hypothesis",
            note: "Vanne à confirmer sur le chantier.",
          },
        });
        v = await read();
      };
      const showItem = async () => {
        await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff?postePlan=${plan.fileId}`);
        await waitForHydration(ui.browser);
        await ui.screen.getByRole("link", "Détail de « Vanne » sur le plan", { exact: true }).click();
        return ui.locator('[data-testid="revision-detail"]');
      };
      const include = async (amount: string) => {
        const panel = await showItem();
        await expect(panel).toContainText("Cette hypothèse attend votre décision.");
        await panel.getByRole("button", "Inclure l’hypothèse du plan").click();
        const entry = panel.getByRole("button", `Conserver la saisie du plan (${amount} u)`, { exact: true });
        await expect(entry).toBeEnabled();
        await entry.click();
        await expect(panel).toContainText("Correction préparée.");
        v = await read();
        return panel;
      };
      const preview = async () =>
        (await post<{ preview: RevisionPreview }>(route, { action: "preview", ...scope, choices: {} })).preview;
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff?postePlan=${plan.fileId}`);
      await waitForHydration(ui.browser);
      await ui.screen.getByRole("link", "Détail de « Lavabo » sur le plan", { exact: true }).click();
      const basin = ui.locator('[data-testid="revision-detail"]');
      await basin.getByText("Corriger la saisie du plan", { exact: true }).click();
      await basin.getByLabel("Quantité du plan").fill("3");
      await basin.getByLabel("Origine").selectOption({ value: "hypothesis" });
      await expect(basin.getByText(/Une hypothèse doit dire/)).toBeVisible();
      const save = basin.getByRole("button", "Enregistrer la saisie du plan");
      await expect(save).toBeDisabled();
      await basin.getByLabel("Origine").selectOption({ value: "site_survey" });
      await expect(basin.getByRole("textbox", /^Justification/)).toHaveValue("");
      await save.click();
      const keep = basin.getByRole("button", "Conserver la saisie du plan (3 u)", { exact: true });
      await expect(keep).toBeEnabled();
      await keep.click();
      await expect(basin).toContainText("Correction préparée.");
      const basinRead = await post<{ versions: RevisionVersion[] }>(route, { action: "read", items: [seeded.items.Lavabo] });
      expect(basinRead.versions[0].items[0].sources.entry).toMatchObject({ quantity: 3, category: "site_survey", note: null });
      expect((await readOwnedLines(seeded.projectId)).find((l) => l.id === before[0].id)?.quantity).toBe(2);

      await edit(4.00001);
      expect(v.items[0].sources.entry?.included).toBe(false);
      const panel = await include("4,00001");
      await panel.getByRole("button", "Prévisualiser la correction").click();
      await expect(panel).toContainText("comporter au plus trois décimales");
      await expect(panel.getByRole("button", "Confirmer la correction")).toBeDisabled();
      const precision = await preview();
      expect(precision.blockers.map((b) => b.reason)).toContain("quantity_unwritable");
      await edit(4.5);
      await include("4,5");
      const add = await preview();
      expect(add.blockers).toEqual([]);
      expect(add.additions).toEqual([item]);
      expect(add.addition_preview?.lines.map((l) => l.quantity_after)).toEqual([4.5]);
      const lease = `/api/estimates/${v.version_id}/lock`;
      expect([200, 201]).toContain((await apiRequest(ui.browser, "POST", lease)).status);
      const intent = { action: "confirm", ...scope, choices: {}, intent_id: randomUUID(), digest: add.digest };
      const confirmed = await post<{ receipt_id: string; replayed: boolean }>(route, intent);
      expect(confirmed.replayed).toBe(false);
      await apiRequest(ui.browser, "DELETE", lease);
      expect(
        (await readOwnedLines(seeded.projectId))
          .filter((l) => l.item_type === "line")
          .map((l) => l.quantity)
          .sort(),
      ).toEqual([3, 4.5]);
      // The SQL race suite exercises the issuance lock. Here a previously
      // confirmed intent must recover its receipt over HTTP on the issued draft.
      await querySql(`begin; set local session_replication_role=replica; update public.estimate_versions set status='sent',seal_hash=repeat('1',64)
      where id='${v.version_id}'; commit;`);
      expect(await post(route, intent)).toMatchObject({ receipt_id: confirmed.receipt_id, replayed: true });
      await ui.browser.evaluate(
        ({ key, command }) => {
          sessionStorage.setItem(key, JSON.stringify(command));
          return true;
        },
        { key: `takeoff:revise:${owner.tenantId}:${owner.userId}:${plan.jobId}:${v.version_id}`, command: intent },
      );
      const issued = await showItem();
      await expect(issued).toContainText("lecture seule");
      await issued.getByRole("button", "Retrouver la confirmation précédente").click();
      await expect(issued).toContainText("Le reçu initial est retrouvé, même après émission du devis.");
    },
  );
});
