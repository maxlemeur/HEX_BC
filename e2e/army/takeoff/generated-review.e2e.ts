import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import type { GeneratedOuvrageSubdetailSummary } from "@/lib/estimates/generated-ouvrages";

import { armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence } from "../critical/fixtures";
import { resumeDialog, type Scenario } from "../local/generated-ouvrage-recovery-support";
import { localTakeoffFixture } from "./fixtures";
import { seedGeneratedReviewPrerequisites } from "./generated-prerequisites";
import { localClient } from "./native-ui";

// The same prerequisite records as the existing generated-components campaign
// replace the live provider prerequisite of the old browser specs. Decisions,
// insertion and snapshots still go through the real interface and server.
for (const mode of ["reject", "fallback", "provenance"] as const) {
  armyTest(`GEN01 ${mode} retains human review and actual generated-work provenance`, {
    session: "army", tags: ["critical", "generated", "local"], timeout: 180_000,
  }, async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser, army };
    const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: `ARMY generated ${mode}` }, army);
    const line = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} manual target`);
    const fixture = await localTakeoffFixture(army, ids);
    const { userId } = await localClient();
    const preferredRole = await fixture.client.from("labor_roles")
      .select("id, user_id, tenant_id, hourly_rate_cents, position, is_active")
      .eq("tenant_id", fixture.tenantId).eq("user_id", userId).eq("is_active", true)
      .order("position", { ascending: true }).order("id", { ascending: true }).limit(1).single();
    if (preferredRole.error) throw new Error("Cannot read the preferred owned GEN labor-role prerequisite.");
    await recordEvidence(army, "generated-labor-basis", { ...ids, preferredRole: preferredRole.data,
      expectedHourlyRateCents: 4000, selectionOrder: ["position ASC", "id ASC"] });
    expect(preferredRole.data.hourly_rate_cents).toBe(4000);
    const candidateId = randomUUID(), draftId = randomUUID(), subdetailId = randomUUID();
    const designation = `${army.runPrefix} generated ceiling`;
    const components = ["material", "labor"].map((costType, index) => ({
      componentId: randomUUID(), fragmentId: randomUUID(), sourceLinkId: randomUUID(),
      designation: `${army.runPrefix} ${costType}`, costType, quantity: 1, unit: index ? "h" : "u", unitCostHtCents: 4000,
    }));
    const prepared = { label: mode, ...ids, sectionId: line.parent_id,
      draftId, candidateId, subdetailId, designation, components };
    await recordEvidence(army, "generated-prerequisites", { ...prepared, userId, tenantId: fixture.tenantId, laborRole: preferredRole.data,
      boundary: "Synthetic unreviewed proposals; decisions and application still require the actual user interface." });
    await seedGeneratedReviewPrerequisites({ army, ids, userId, scenario: prepared });
    const scenario: Scenario = { label: mode, ...ids, sectionId: line.parent_id!, draftId, candidates: [{
      candidateId, subdetailId, componentId: components[0].componentId, fragmentId: components[0].fragmentId,
      designation, componentDesignation: components[0].designation, unitCostHtCents: 4000,
    }] };
    await browser.reload();
    await resumeDialog(ui, scenario);
    const card = screen.getByTestId(`candidate-card-${candidateId}`);
    const before = await readEstimate(browser, ids.versionId);
    if (mode === "reject") {
      await card.getByRole("button", "Rejeter", { exact: true }).tap();
      await expect(screen.getByText(/Toutes les propositions ont été écartées/i)).toBeVisible();
      await expect(screen.getByRole("button", "Insérer les ouvrages sélectionnés", { exact: true })).toHaveCount(0);
      const draft = await fixture.client.from("estimate_generated_ouvrage_drafts").select("status").eq("id", draftId).single();
      expect(draft.error).toBe(null);
      expect(draft.data?.status).toBe("discarded");
      expect((await readEstimate(browser, ids.versionId)).items).toEqual(before.items);
      await recordEvidence(army, "generated-discard", { ids, draftId, candidateId, draftStatus: draft.data?.status, unchangedItems: true });
      return;
    }
    if (mode === "fallback") {
      await card.getByRole("button", "Modifier", { exact: true }).tap();
      await screen.getByTestId("edit-lot").first().selectOption({ value: "" });
      await card.getByRole("button", /^Valider(?: la ligne)?$/i).tap();
    }
    await card.getByRole("button", "Valider le sous-détail", { exact: true }).tap();
    const editor = browser.locator(`[data-testid="candidate-card-${candidateId}"] section`);
    await expect(editor.getByText("Sous-détail composé", { exact: true })).toBeVisible();
    for (const component of components) await expect(editor.getByRole("button", new RegExp(component.designation))).toBeVisible();
    await editor.getByRole("button", "Valider le sous-détail", { exact: true }).tap();
    await card.getByRole("checkbox", `Sélectionner ${designation}`, { exact: true }).check();
    await screen.getByRole("button", "Insérer les ouvrages sélectionnés", { exact: true }).tap();
    await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeHidden();
    const after = await readEstimate(browser, ids.versionId);
    const inserted = after.items.find(item => item.title === designation);
    await recordEvidence(army, `generated-${mode}-insertion-observed`, { ids, draftId, candidateId, inserted,
      totals: [after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents] });
    expect(inserted?.source_provider).toBe("generated_ouvrage");
    expect(inserted?.quantity).toBe(1);
    if (mode === "fallback") {
      const fallback = after.items.find(item => item.id === inserted?.parent_id);
      expect([fallback?.item_type, fallback?.title]).toEqual(["section", "À classer"]);
      expect(fallback?.source_provider).toBe("generated_ouvrage");
      expect((inserted?.source_metadata as { kind?: string } | undefined)?.kind).toBe("generated_ouvrage");
    } else {
      expect(Number(inserted?.h_mo)).toBeGreaterThan(0);
      expect(inserted?.labor_role_id).toBeTruthy();
      const metadata = inserted?.source_metadata as {
        kind?: string;
        subdetail_summary?: GeneratedOuvrageSubdetailSummary;
        estimate_item_mapping?: { mode?: string; hMo?: number; laborRoleId?: string };
      };
      expect(metadata.kind).toBe("generated_ouvrage");
      expect(metadata.subdetail_summary?.dsCents).toBe(8000);
      expect(metadata.subdetail_summary?.indicativeTargetPriceCents).toBeGreaterThanOrEqual(8000);
      expect(metadata.estimate_item_mapping?.mode).toBeTruthy();
      expect(metadata.estimate_item_mapping?.hMo ?? 0).toBeGreaterThan(0);
      expect(metadata.estimate_item_mapping?.laborRoleId).toBeTruthy();
      const expectInsertedProvenance = async (viewport: "desktop" | "mobile") => {
        await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
        const row = browser.locator(`[data-estimate-item-id="${inserted!.id}"]`);
        await expect(row).toHaveCount(1);
        await row.getByTestId("estimate-line-more-trigger").tap();
        const menu = browser.locator(".estimate-line-more__menu");
        await expect(menu).toHaveCount(1);
        await expect(menu).toBeVisible();
        const provenance = menu.getByRole("button", "Afficher la provenance IA", { exact: true });
        await expect(provenance).toBeVisible();
        await recordEvidence(army, `generated-provenance-${viewport}`, { ...ids, itemId: inserted!.id,
          button: "Afficher la provenance IA", visibleAfterReload: true });
      };
      await browser.reload();
      await expectInsertedProvenance("desktop");
      await browser.setViewport({ width: 390, height: 844 });
      await browser.reload();
      await screen.getByTestId("estimate-mobile-display-button").tap();
      const displayOptions = screen.getByRole("dialog", "Options d’affichage", { exact: true });
      await expect(displayOptions).toBeVisible();
      await displayOptions.getByRole("button", "Tableau complet Contrôle détaillé", { exact: true }).tap();
      await expect(displayOptions).toBeHidden();
      await expectInsertedProvenance("mobile");
    }
    await recordEvidence(army, `generated-${mode}`, { ids, draftId, candidateId, inserted, totals: [after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents] });
  });
}
