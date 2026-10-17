import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyItem } from "../critical/fixtures";
import { basisLaborRole, expectStoredTotalsMatchLines, type StoredTotals } from "../critical/version-totals-support";
import { ownedEstimateContext } from "./calculation-gate-support";
import { assertOwnedLocalBackend, createdData, insertLegacyV1Draft, setUiMode, type Envelope } from "./legacy-v1-draft-support";

// Stored version totals after a bulk majoration on a legacy V1 draft
// (docs/testing/version-totals-after-bulk-actions.md, BT6). The critical bulk-edit-sync journeys are
// the V2 guards; the V1 path is only reachable on a draft seeded in SQL (legacy-v1-draft-support).
// Like V1PT01, the journey reads the affaires list in Expert mode, switched on the shared account's
// profile and restored: it belongs to the nightly full selection (one worker), not to critical.
const options = { session: "army", tags: ["critical", "local", "version-totals"], timeout: 240_000 } as const;
// Fixed margin x1, 20 % VAT, no discount, no rounding: 2 u at 10,00 € plus 1 h at the owned 40 €/h
// role (seeded, consistent), then the hour at 150 %: 20,00 € + 60,00 € = 80,00 € HT.
const SEEDED: StoredTotals = [6000, 1200, 7200];
const EXPECTED: StoredTotals = [8000, 1600, 9600];

armyTest("V1BT01 a bulk majoration on a legacy V1 draft stores the version totals with its lines", options,
  async ({ app, screen, browser, army }) => {
    assertOwnedLocalBackend();
    await app.open("/dashboard/affaires");
    // An owned project made by the ordinary creation path; its V2 draft stays version 1.
    const created = await createdData(await apiRequest<Envelope<{ project: { id: string }; version: { id: string } }>>(
      browser, "POST", "/api/estimates", {
        project: { name: army.projectName },
        version: {
          title: `${army.runPrefix} v2 anchor`, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000,
          rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR",
        },
      }));
    const projectId = created.project.id;
    ownEstimate(army, { projectId, versionId: created.version.id });
    const owner = await ownedEstimateContext(projectId);
    const role = await basisLaborRole(browser, created.version.id);

    const title = `${army.runPrefix} V1 bulk`;
    const draft = await insertLegacyV1Draft({ projectId, tenantId: owner.tenantId, userId: owner.userId }, {
      title, description: null, productId: null, lineNature: "supply_and_labor",
      quantity: 2, unitPriceCents: 1000, hMo: 1, laborRoleId: role.id, puHtCents: 3000,
    }, SEEDED);
    const estimate = { projectId, versionId: draft.versionId };
    ownEstimate(army, estimate);

    const lineOf = (items: ArmyItem[]) => items.find((item) => item.id === draft.lineId);
    const before = await readEstimate(browser, draft.versionId);
    await recordEvidence(army, "v1-bulk-fixtures", {
      ...draft, anchorVersionId: created.version.id, laborRole: role, insertedBy: "postgres (owned native stack)",
      quantity: 2, unitPriceCents: 1000, hMo: 1, seeded: SEEDED,
      before: {
        engine: before.version.calc_engine_version ?? null, versionNumber: before.version.version_number ?? null,
        totals: [before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents],
        line: lineOf(before.items) ?? null,
      },
    });
    expect(before.version.calc_engine_version, "legacy V1 draft").toBe(1);
    expect([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]).toEqual(SEEDED);
    expect(lineOf(before.items)).toMatchObject({
      h_mo: 1, h_mo_majoration: 1, labor_role_id: role.id, line_total_ht_cents: SEEDED[0],
    });

    const initialMode = await setUiMode(owner.userId, "expert");
    try {
      await app.open(`/dashboard/estimates/${draft.versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
      const select = screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true });
      await select.check();
      const bulkBar = screen.getByTestId("estimate-editor-bulk-selection-bar");
      await expect(bulkBar).toBeVisible();
      await bulkBar.getByText("Modifier les attributs", { exact: true }).click();
      await screen.getByLabel("Majoration MO en pourcentage", { exact: true }).fill("150");
      await screen.getByTestId("estimate-editor-bulk-majoration-apply-button").click();
      // The bulk write is committed once the line is read back at 150 %; the totals are then read
      // once, without waiting for any later save.
      await expect.poll(async () => lineOf((await readEstimate(browser, draft.versionId)).items)?.h_mo_majoration,
        { timeout: 30_000, interval: 500 }).toBe(1.5);
      await expectStoredTotalsMatchLines({ app, screen, browser }, army, {
        estimate, projectName: army.projectName, step: "v1-bulk-majoration", expected: EXPECTED,
      });
    } finally {
      const restoredFrom = await setUiMode(owner.userId, initialMode);
      await recordEvidence(army, "v1-bulk-restored", { initialMode, restoredFrom });
    }
  });
