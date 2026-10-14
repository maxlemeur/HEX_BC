import { expect } from "e2e";
import { armyTest, createEstimateViaWizard } from "../critical/fixtures";
import { componentArticle, componentSection, openComponents, prepareComponents } from "./generated-ouvrage-components-support";
import { numericBaseline, numericCounts, numericField, numericInput, numericParent, numericSave, numericWitness,
  persistNumeric, retainNumeric, reuseNumeric, typeNumeric, type NumericContext, type NumericOracle } from "./numeric-entry-support";

// Declared before the product fix in docs/testing/generated-ouvrage-numeric-entry.md.
const selection = process.env.E2E_GENERATED_COMPONENTS_SELECTION;
if (!["numeric-price", "numeric-decimals", "numeric-loss", "numeric-all"].includes(selection ?? "")) throw new Error("Explicit numeric selection required; no default.");
const options = { session: "army", trace: "off" as const, tags: ["source-coverage", "generated-components", "numeric-entry"], timeout: 420000 };
const price: NumericOracle = {
  retainedIndices: [0], components: [{ index: 0, costType: "material", quantity: 1, unit: "u", unitCostHtCents: 1250,
    lossCoeffBp: 0, yieldValue: null, yieldUnit: null, derivedHours: 0, dsCents: 1250 }],
  parent: { quantity: 1, dsCents: 1250, effectiveUnitPriceHtCents: 1250, totalHours: 0 }, totals: [1250, 250, 1500],
};
const decimals: NumericOracle = {
  retainedIndices: [0, 1], components: [
    { index: 0, costType: "material", quantity: 1.25, unit: "u", unitCostHtCents: 4000, lossCoeffBp: 0, yieldValue: null, yieldUnit: null, derivedHours: 0, dsCents: 5000 },
    { index: 1, costType: "labor", quantity: 1, unit: "u", unitCostHtCents: 0, lossCoeffBp: 0, yieldValue: 0.25, yieldUnit: "h/u", derivedHours: 0.5, dsCents: 0 },
  ], parent: { quantity: 2, dsCents: 5000, effectiveUnitPriceHtCents: 2500, totalHours: 0.5 }, totals: [5000, 1000, 6000],
};
const loss = (basisPoints: number, totals: number[]): NumericOracle => ({
  retainedIndices: [0], components: [{ index: 0, costType: "material", quantity: 2.5, unit: "u", unitCostHtCents: 4000,
    lossCoeffBp: basisPoints, yieldValue: null, yieldUnit: null, derivedHours: 0, dsCents: totals[0] }],
  parent: { quantity: 1, dsCents: totals[0], effectiveUnitPriceHtCents: totals[0], totalHours: 0 }, totals,
});

if (selection === "numeric-price" || selection === "numeric-all") armyTest("NI01 euro unit cost preserves typed decimal and blocks invalid save", options, async (ui) => {
  const p = await prepareComponents(ui, "GC01"), c: NumericContext = { ui, p, caseId: "NI01", oracle: price };
  try {
    await openComponents(ui, p); await retainNumeric(c);
    const field = await numericField(c, 0, /^Coût unitaire HT/); await numericBaseline(c, field, 0);
    const entered = await typeNumeric(c, field, 0, "price", "12,", "50");
    expect(entered.label).toContain("€"); expect(Number(String(entered.input).replace(",", "."))).toBe(12.5);
    await expect(componentSection(ui, p.s)).toContainText(/DS\s*12[,.]50/);
    await field.fill("12.50"); await field.press("Tab");
    const pasted = await numericInput(c, field, 0);
    await numericWitness(c, "price-paste-blur", { submitted: "12.50", unitCostHtCents: 1250, dsCents: 1250 }, { ...pasted, method: "fill", submitted: "12.50" });
    expect(Number(String(pasted.input).replace(",", "."))).toBe(12.5); await expect(componentSection(ui, p.s)).toContainText(/DS\s*12[,.]50/);
    await expect(numericSave(c)).toBeEnabled();
    // Embedded currency markers and malformed thousands separators may not
    // silently become a different amount when pasted into the EUR field.
    const malformedBefore = await p.capture("numeric-NI01-malformed-before"), malformedCounts = numericCounts(c);
    for (const [index, submitted] of ["12EUR50", "12€50", "12.50.00,10"].entries()) {
      await field.fill(submitted); await field.press("Tab");
      const input = await numericInput(c, field, 0), state = await p.capture("numeric-NI01-malformed-" + index);
      await numericWitness(c, "malformed-price-" + index, { input: submitted, invalid: true, unchanged: true },
        { ...input, submitted, method: "fill", state, counts: numericCounts(c) });
      expect(input.input).toBe(submitted); expect(input.ariaInvalid).toBe(true); expect(input.linkedErrorText.length > 0).toBe(true);
      await expect(numericSave(c)).toBeDisabled(); await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
      await expect(componentSection(ui, p.s)).toContainText(/DS\s*12[,.]50/);
      expect(state).toEqual(malformedBefore); expect(numericCounts(c)).toEqual(malformedCounts);
      await field.fill("12.50"); await field.press("Tab"); await expect(numericSave(c)).toBeEnabled();
    }
    const before = await p.capture("numeric-NI01-invalid-before"), counts = numericCounts(c), valid = await numericInput(c, field, 0);
    await numericWitness(c, "invalid-before", { saveEnabled: true, inputValueEuros: 12.5 }, { ...valid, state: before, counts });
    await typeNumeric(c, field, 0, "price-invalid", "12,50x");
    const invalid = await numericInput(c, field, 0), after = await p.capture("numeric-NI01-invalid-after");
    await numericWitness(c, "invalid-after", { input: "12,50x", ariaInvalid: true, saveEnabled: false, insertEnabled: false, linkedError: true, unchanged: true },
      { ...invalid, state: after, counts: numericCounts(c) });
    expect(invalid.input).toBe("12,50x"); expect(invalid.ariaInvalid).toBe(true);
    expect(invalid.linkedErrorText).toMatch(/invalide|nombre|montant|décimal|chiffre|numérique|format|sais/i);
    await expect(numericSave(c)).toBeDisabled(); await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
    expect(numericCounts(c)).toEqual(counts); expect(after.objects).toEqual(before.objects); expect(after.estimate).toEqual(before.estimate);
    // An invalid retained field must not remove the human exclusion decision.
    // Keep the transient all-rejected composition local: no save is requested.
    const material = componentArticle(ui, p.s, 0), exclude = material.getByRole("button", "Écarter", { exact: true });
    const excludeBefore = await p.capture("numeric-NI01-invalid-exclude-before");
    await numericWitness(c, "invalid-exclude-before", { input: "12,50x", excludeEnabled: true, excludedCount: 3, saveEnabled: false, unchanged: true },
      { ...await numericInput(c, field, 0), state: excludeBefore, counts: numericCounts(c), excludeEnabled: await exclude.isEnabled(),
        excludedCount: await componentSection(ui, p.s).getByText("Écarté", { exact: true }).count(), saveLabel: await numericSave(c).textContent(),
        fieldDisabled: await field.isDisabled(), fieldReadOnly: await field.getAttribute("readonly") !== null });
    expect(excludeBefore).toEqual(after); expect(numericCounts(c)).toEqual(counts);
    await expect(exclude).toBeEnabled(); await exclude.click();
    const section = componentSection(ui, p.s), pendingSave = section.getByRole("button", "Enregistrer les décisions", { exact: true });
    const restore = material.getByRole("button", "Rétablir", { exact: true });
    const excludedState = await p.capture("numeric-NI01-invalid-excluded");
    // The editor opens one accordion at a time. Observe each actual readonly
    // panel through its real toggle rather than assuming collapsed inputs exist.
    const excludedFields: Array<{ componentIndex: number; fields: Array<{ value: string; disabled: boolean; readOnly: boolean }> }> = [];
    for (let componentIndex = 0; componentIndex < p.s.components.length; componentIndex += 1) {
      await numericField(c, componentIndex, "Quantité");
      excludedFields.push(JSON.parse(await ui.browser.evaluate(({ candidateId, componentIndex }) => {
        const article = document.querySelectorAll(`[data-testid="candidate-card-${candidateId}"] section article`)[componentIndex];
        return JSON.stringify({ componentIndex, fields: [...article.querySelectorAll("input,textarea,select")].map((element) => ({
          value: (element as HTMLInputElement).value, disabled: element.matches(":disabled"), readOnly: (element as HTMLInputElement).readOnly === true,
        })) });
      }, { candidateId: p.s.candidateId, componentIndex })));
    }
    await numericField(c, 0, /^Coût unitaire HT/);
    await numericWitness(c, "invalid-excluded", { input: "12,50x", excludedCount: 4, saveEnabled: true, fieldEditable: false, restoreEnabled: true, unchanged: true },
      { ...await numericInput(c, field, 0), state: excludedState, counts: numericCounts(c), excludedCount: await section.getByText("Écarté", { exact: true }).count(),
        fieldDisabled: await field.isDisabled(), fieldReadOnly: await field.getAttribute("readonly") !== null,
        restoreEnabled: await restore.isEnabled(), saveLabel: await pendingSave.textContent(), excludedFields });
    await expect(field).toHaveValue("12,50x"); await expect(field).toBeDisabled(); await expect(pendingSave).toBeEnabled(); await expect(restore).toBeEnabled();
    await expect(section.getByText("Écarté", { exact: true })).toHaveCount(4);
    expect(excludedFields).toHaveLength(4); expect(excludedFields.every((article) => article.fields.length > 0 && article.fields.every((input) => input.disabled || input.readOnly))).toBe(true);
    expect(excludedState).toEqual(after); expect(numericCounts(c)).toEqual(counts);
    await restore.click();
    const restoredState = await p.capture("numeric-NI01-invalid-restored"), restoredInput = await numericInput(c, field, 0);
    await numericWitness(c, "invalid-restored", { input: "12,50x", ariaInvalid: true, saveEnabled: false, insertEnabled: false, excludedCount: 3, fieldEditable: true, unchanged: true },
      { ...restoredInput, state: restoredState, counts: numericCounts(c), excludedCount: await section.getByText("Écarté", { exact: true }).count(),
        fieldDisabled: await field.isDisabled(), fieldReadOnly: await field.getAttribute("readonly") !== null, excludeEnabled: await exclude.isEnabled(), saveLabel: await numericSave(c).textContent() });
    await expect(field).toHaveValue("12,50x"); await expect(field).toBeEnabled(); expect(await field.getAttribute("readonly")).toBe(null); expect(restoredInput.ariaInvalid).toBe(true);
    await expect(numericSave(c)).toBeDisabled(); await expect(ui.screen.getByTestId("generated-ouvrage-insert-button")).toBeDisabled();
    await expect(section.getByText("Écarté", { exact: true })).toHaveCount(3); expect(restoredState).toEqual(after); expect(numericCounts(c)).toEqual(counts);
    await typeNumeric(c, field, 0, "price-corrected", "12,", "50"); await expect(numericSave(c)).toBeEnabled();
    await persistNumeric(c); await reuseNumeric(c, p.fixture.reuse.versionId, p.fixture.reuse.projectId);
  } finally { await p.close(); }
});

if (selection === "numeric-decimals" || selection === "numeric-all") armyTest("NI02 typed quantity and yield preserve decimals and retained zero labor hours", options, async (ui) => {
  const p = await prepareComponents(ui, "GC02"), c: NumericContext = { ui, p, caseId: "NI02", oracle: decimals };
  try {
    await openComponents(ui, p); await numericParent(c, "2"); await retainNumeric(c);
    const quantity = await numericField(c, 0, "Quantité"); await numericBaseline(c, quantity, 0);
    const comma = await typeNumeric(c, quantity, 0, "quantity-comma", "1,", "25"); expect(Number(String(comma.input).replace(",", "."))).toBe(1.25);
    const point = await typeNumeric(c, quantity, 0, "quantity-point", "1.", "25"); expect(Number(String(point.input).replace(",", "."))).toBe(1.25);
    const zero = await numericField(c, 1, /^Coût unitaire HT/), zeroEntered = await typeNumeric(c, zero, 1, "zero-price", "0");
    expect(Number(String(zeroEntered.input).replace(",", "."))).toBe(0);
    await (await numericField(c, 1, "Unité")).fill("u"); await ui.browser.keyboard.press("Tab");
    await (await numericField(c, 1, "Unité rendement")).fill("h/u"); await ui.browser.keyboard.press("Tab");
    const yieldField = await numericField(c, 1, "Rendement"), yieldEntered = await typeNumeric(c, yieldField, 1, "yield", "0,", "25");
    expect(Number(String(yieldEntered.input).replace(",", "."))).toBe(0.25);
    await expect(componentSection(ui, p.s)).toContainText(/DS\s*50[,.]00/); await expect(componentSection(ui, p.s)).toContainText(/MO\s*0[,.]5\s*h/);
    await persistNumeric(c);
    const fresh = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-NI02-REUSE`, title: "NI02 reuse zero labor half hour" }, ui.army);
    await reuseNumeric(c, fresh.versionId, fresh.projectId);
  } finally { await p.close(); }
});

if (selection === "numeric-loss" || selection === "numeric-all") armyTest("NI03 percentage loss preserves typed decimal through reuse and exports", options, async (ui) => {
  for (const phase of [
    { caseId: "NI03-A", fixture: "GC03", prefix: "5", tail: undefined, oracle: loss(500, [10500, 2100, 12600]) },
    { caseId: "NI03-B", fixture: "GC04", prefix: "2,", tail: "5", oracle: loss(250, [10250, 2050, 12300]) },
  ]) {
    const p = await prepareComponents(ui, phase.fixture), c: NumericContext = { ui, p, caseId: phase.caseId, oracle: phase.oracle };
    try {
      await openComponents(ui, p); await retainNumeric(c);
      await (await numericField(c, 0, "Quantité")).fill("2.5"); await ui.browser.keyboard.press("Tab");
      const field = await numericField(c, 0, /^Pertes/); await numericBaseline(c, field, 0);
      await expect(componentSection(ui, p.s)).toContainText(/DS\s*100[,.]00/);
      const entered = await typeNumeric(c, field, 0, "loss", phase.prefix, phase.tail);
      // The actual pre-correction label and wrong DS are already archived here.
      expect(entered.label).toContain("%"); expect(Number(String(entered.input).replace(",", "."))).toBe(phase.oracle.components[0].lossCoeffBp / 100);
      await expect(componentSection(ui, p.s)).toContainText(phase.caseId === "NI03-A" ? /DS\s*105[,.]00/ : /DS\s*102[,.]50/);
      await persistNumeric(c);
      const fresh = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${phase.caseId}-REUSE`, title: `${phase.caseId} reuse percentage loss` }, ui.army);
      await reuseNumeric(c, fresh.versionId, fresh.projectId);
    } finally { await p.close(); }
  }
});
