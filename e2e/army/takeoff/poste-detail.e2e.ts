import { PDFDocument, StandardFonts } from "pdf-lib";

import { querySql } from "../local/calculation-gate-support";
import { recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { readOwnedDecisions, readOwnedRows, seedPublishedItemTable, type SeededAnswer } from "./item-table-support";
import { describe, expect, nativeTest as test } from "./native-ui";

// Lot 5, the detail of an item on its plan, opened from the table of items, on the owned stack: an affaire whose plan
// (fictional bytes of nine pages, sealed by their digest) was read against its list and published (item-table-support.ts).
// A member opens a measured item from its line, its plan drawn from the sealed bytes, then an uncertain one and an
// absence; moves with the keyboard without filling the history; accepts an item through the table's command; comes
// back to the table on the item shown, then opens it again and closes it with the browser's back. A second affaire whose
// analysis was sent shows its plan read only; a director of the tenant reads the first one and decides nothing.
// Fictional values; no AI call, no e-mail.

const options = { session: "army", trace: "off" as const, tags: ["critical", "local"], timeout: 240_000 };
const LABELS = ["Lavabo", "Vanne DN32", "Siphon de sol", "Évier"];
const ANSWERS: SeededAnswer[] = ["measured", "uncertain", "not_found", "measured"];

/** A fictional plan of nine pages, each saying its number. */
async function fictionalPlanPdf(label: string) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= 9; page += 1) document.addPage([595, 842]).drawText(`${label} — page ${page} (fictif)`, { x: 60, y: 760, size: 18, font });
  return Buffer.from(await document.save());
}

describe("Détail du poste", () => {
  test("POSTE-DETAIL01 ouvre un poste depuis le tableau sur son plan, décide par la commande du tableau et y revient", options,
    async ({ ui }) => {
      const { app, screen, army } = ui;
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PDETAIL" });
      const planPdf = await fictionalPlanPdf(`${army.runPrefix} plan du détail`);
      const seeded = await seedPublishedItemTable(owner, { name: `${army.runPrefix}-POSTE-DETAIL`, labels: LABELS, answers: ANSWERS, planPdf });
      const item = (index: number) => seeded.itemIds[index];
      const detail = ui.locator('[data-testid="poste-detail"]');
      const evidence = screen.getByRole("complementary", "Preuve et décisions du poste", { exact: true });
      const list = screen.getByRole("listbox", "Postes", { exact: true });
      const option = (label: string) => list.getByRole("option", new RegExp(`^${label}`));
      const detailLink = (label: string) => screen.getByRole("link", `Détail de « ${label} » sur le plan`, { exact: true });
      const table = screen.getByRole("table", "Postes du métré", { exact: true });
      const search = async () => new URL(await ui.browser.url()).searchParams;
      const shots: Record<string, string> = {};

      const tableAddress = `/dashboard/affaires/${seeded.projectId}/takeoff?posteLimit=25`;
      await app.open(tableAddress);
      await waitForHydration(ui.browser);
      await expect(table).toBeVisible();

      // 1. A measured item, from its line: its plan drawn from the bytes the analysis read, its observation's page.
      await detailLink(LABELS[0]).click();
      await expect(detail).toBeVisible();
      expect((await search()).get("poste")).toBe(item(0));
      expect((await search()).get("posteLimit")).toBe("25");
      await expect(evidence.getByRole("heading", LABELS[0], { exact: true })).toBeVisible();
      await expect(evidence).toContainText("Mesuré · 1 u");
      await expect(screen.getByRole("img", "plan-1.pdf, page 2", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(evidence).toContainText("Octets lus par cette analyse, servis et vérifiés (empreinte conforme).");
      shots.measured = await app.screenshot("poste-detail-measured");

      // 2. The keyboard moves between the items of the frozen order in place: the history does not grow per arrow.
      const historyLength = await ui.browser.evaluate(() => history.length);
      await expect(detail).toContainText("Poste 1 sur 4");
      await list.press("ArrowDown");
      await expect(detail).toContainText("Poste 2 sur 4");
      await expect(evidence.getByRole("heading", LABELS[0], { exact: true })).toHaveCount(0);
      expect((await search()).get("poste")).not.toBe(item(0));
      expect(await ui.browser.evaluate(() => history.length)).toBe(historyLength);

      // 3. An uncertain item and an absence: the candidate and the unreadable page; the pages searched, no point.
      await option(LABELS[1]).click();
      await expect(evidence.getByRole("heading", LABELS[1], { exact: true })).toBeVisible();
      await expect(evidence).toContainText("Incertain");
      await expect(evidence).toContainText("Valeur candidate (non mesurée) : 1 u");
      await expect(evidence).toContainText("Pages illisibles : 7");
      shots.uncertain = await app.screenshot("poste-detail-uncertain");
      await option(LABELS[2]).click();
      await expect(ui.locator('[data-testid="poste-detail-not-found"]')).toContainText("Non trouvé sur les pages cherchées : 2, 7.");
      await expect(evidence.getByRole("table", "Observations", { exact: true })).toHaveCount(0);
      shots.notFound = await app.screenshot("poste-detail-not-found");
      expect(await ui.browser.evaluate(() => history.length)).toBe(historyLength);

      // 4. A decision through the table's confirmation and its one command, stored in the member's name.
      await option(LABELS[3]).click();
      await expect(evidence.getByRole("heading", LABELS[3], { exact: true })).toBeVisible();
      await evidence.getByRole("button", "Accepter", { exact: true }).click();
      const confirm = screen.getByRole("dialog");
      await expect(confirm).toContainText("Portée : toute l’affaire");
      await confirm.getByRole("button", "Accepter 1 poste", { exact: true }).click();
      await expect(ui.locator('[data-testid="poste-detail-decision"]')).toContainText("Poste accepté.");
      await expect(evidence).toContainText(/Accepté\s+par .+, le /);
      expect((await readOwnedDecisions(seeded.projectId)).map(({ item_id, kind, actor_id }) => [item_id, kind, actor_id]))
        .toEqual([[item(3), "accepted", owner.userId]]);
      const rows = new Map((await readOwnedRows(seeded.jobId)).map((value) => [value.id, value]));
      expect(rows.get(seeded.rowIds[3]!)).toMatchObject({ is_verified: true, verified_by: owner.userId });

      // 5. Escape comes back to the table on the item shown, its line in focus and its « Détail » holding the keyboard.
      await list.press("Escape");
      await expect(table).toBeVisible();
      await expect(detail).toHaveCount(0);
      expect((await search()).get("posteFocus")).toBe(item(3));
      expect((await search()).get("posteLimit")).toBe("25");
      await expect(ui.locator(`[data-testid="poste-${item(3)}"]`)).toHaveAttribute("aria-current", "true");
      await expect(detailLink(LABELS[3])).toBeFocused();

      // 6. Opened again, the browser's back closes it.
      await detailLink(LABELS[2]).click();
      await expect(detail).toBeVisible();
      await ui.browser.back();
      await expect(table).toBeVisible();
      await expect(detail).toHaveCount(0);

      // 7. A plan already sent to the estimate: read in the detail, no decision offered. (The send is another pull
      // request's: the state it leaves on the analysis is written here, its job marked applied.)
      const sent = await seedPublishedItemTable(owner, { name: `${army.runPrefix}-POSTE-ENVOYE`, labels: ["Lavabo envoyé"],
        answers: ["measured"], planPdf });
      await querySql(`begin; set local session_replication_role = replica;
update public.takeoff_jobs set status = 'applied' where id = '${sent.jobId}'; commit;`);
      await app.open(`/dashboard/affaires/${sent.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await detailLink("Lavabo envoyé").click();
      await expect(ui.locator('[data-testid="poste-detail-sent"]')).toContainText("Ce plan est envoyé au devis");
      await expect(evidence.getByRole("group", "Décider du poste", { exact: true })).toHaveCount(0);
      await expect(evidence).toContainText("Aucune décision ne s’applique à ce poste : plan déjà envoyé au devis.");
      await expect(screen.getByRole("img", "plan-1.pdf, page 2", { exact: true })).toBeVisible({ timeout: 30_000 });
      shots.sent = await app.screenshot("poste-detail-sent");

      // 8. A director of the tenant reads the first affaire's items on their plan and decides nothing.
      const reader = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PDREAD" });
      await querySql(`update public.tenant_memberships set is_default = false where user_id = '${reader.userId}';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default) values ('${owner.tenantId}', '${reader.userId}', 'director', true);`);
      await app.open(tableAddress);
      await waitForHydration(ui.browser);
      await detailLink(LABELS[0]).click();
      await expect(evidence.getByRole("heading", LABELS[0], { exact: true })).toBeVisible();
      await expect(ui.locator('[data-testid="poste-detail-read-only"]'))
        .toContainText("Lecture seule : un opérateur du métré de l’affaire décide de ce poste.");
      await expect(evidence.getByRole("group", "Décider du poste", { exact: true })).toHaveCount(0);
      await list.press("v");
      await expect(ui.locator('[data-testid="poste-detail-notice"]')).toContainText("Un opérateur du métré de l’affaire peut revoir ce poste.");
      await expect(screen.getByRole("dialog")).toHaveCount(0);
      await expect(screen.getByRole("img", "plan-1.pdf, page 2", { exact: true })).toBeVisible({ timeout: 30_000 });
      shots.reader = await app.screenshot("poste-detail-reader");
      expect(await readOwnedDecisions(seeded.projectId)).toHaveLength(1);

      await recordEvidence(army, "POSTE-DETAIL01", { projectId: seeded.projectId, sentProjectId: sent.projectId,
        decisions: await readOwnedDecisions(seeded.projectId), screenshots: shots,
        boundary: "Owned stack; fictional PDF and answers seeded by the database's functions; no AI call, no e-mail. The sent "
          + "plan is a job whose status the seed sets to applied (triggers off for that write), with no send receipt: the send "
          + "itself is another pull request's." });
    });
});
