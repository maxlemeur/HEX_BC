import { expect } from "e2e";

import { armyTest, readEstimate, recordEvidence } from "../critical/fixtures";
import { signUpCreatorOwner, type Ui } from "./engine-v3-creators-support";
import { lineView, normalized, readConsistent } from "./engine-v3-editor-support";
import {
  openAndCompare, preparePriceReuseFixture, readRows, renameReferenceLine, rowCheckbox, verifyAppliedPrices,
} from "./engine-v3-price-reuse-support";

// Reprise des prix d'un devis de référence (docs/metier/reprise-des-prix.md), sans IA : l'application ne fait
// aucun appel Decisions ni ChatGPT sans l'activation du serveur ; le rapprochement et l'écriture restent disponibles.
const options = (timeout: number) => ({ session: "army", tags: ["critical", "local", "engine-v3"], timeout }) as const;
const SUMMARY = "Identiques : 3 · À vérifier : 1 · Sans correspondance : 2";

armyTest("PRX01 reference prices are reused on identical articles after review, never on another diameter, unit or a manual price",
  options(480_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const fixture = await preparePriceReuseFixture(ui, army, owner, "PRX01");
    const { T1, T2, T3, T4, T5, T6 } = fixture.lines;
    const { R1, R2, R3, R5 } = fixture.references;
    const dialog = await openAndCompare(ui, army, fixture, "prx01");

    const compared = { summary: normalized(await dialog.getByTestId("price-reuse-summary").textContent()), rows: await readRows(ui) };
    await recordEvidence(army, "prx01-compared", compared);
    expect(compared).toEqual({
      summary: SUMMARY,
      rows: {
        // Identiques sans prix : retenues d'office. T6 porte déjà un prix saisi : jamais écrasée d'office.
        [T1.id]: { status: "identical", checked: true, reference: R1.id, origin: "Identique" },
        [T2.id]: { status: "identical", checked: true, reference: R2.id, origin: "Identique" },
        [T6.id]: { status: "identical", checked: false, reference: R2.id, origin: "Identique" },
        // « RBS » ou « papillon » en plus dans la référence : à confirmer ; le DN32 n'est jamais proposé pour un DN40.
        [T3.id]: { status: "to_review", checked: false, reference: R3.id, origin: "À confirmer" },
        // La pompe de la référence est « compris » (sans prix) ; le calorifuge y est au m², la ligne en ml.
        [T4.id]: { status: "new", checked: null, reference: null, origin: "" },
        [T5.id]: { status: "new", checked: null, reference: null, origin: "" },
      },
    });
    // Sans activation serveur, les arbitres IA sont présentés mais inaccessibles : aucun appel facturé possible.
    await expect(dialog.getByRole("button", "Départager avec Decisions", { exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", "Départager avec ChatGPT", { exact: true })).toBeDisabled();
    const unitNote = await browser.evaluate((id) =>
      document.querySelector(`[data-testid="price-reuse-row"][data-line-id="${id}"]`)?.textContent ?? "", T5.id);
    expect(unitNote).toContain("en m2 dans la référence");

    // La référence change après la comparaison : la reprise est refusée sans rien écrire, il faut comparer à nouveau.
    await renameReferenceLine(ui, army, fixture.reference.versionId, R5.id, "Pompe de relevage (fourniture entreprise générale)");
    const referenceBefore = await readEstimate(browser, fixture.reference.versionId);
    await rowCheckbox(dialog, T3.title).check();
    await dialog.getByRole("button", "Appliquer 3 reprises", { exact: true }).tap();
    await expect(dialog.getByText("Le devis de référence a changé depuis la comparaison. Relancez la comparaison.", { exact: true }))
      .toBeVisible({ timeout: 60_000 });
    const refused = await readConsistent(ui, fixture.target.versionId);
    expect([T1, T2, T3].map((line) => lineView(refused.items.find((item) => item.id === line.id)!).prFo)).toEqual([0, 0, 0]);

    await dialog.getByRole("button", "Comparer", { exact: true }).tap();
    await expect(dialog.getByTestId("price-reuse-summary")).toHaveText(SUMMARY, { timeout: 90_000 });
    await rowCheckbox(dialog, T3.title).check();
    await dialog.getByRole("button", "Appliquer 3 reprises", { exact: true }).tap();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await verifyAppliedPrices(ui, army, fixture, "prx01", referenceBefore);
  });
