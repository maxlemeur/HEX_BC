import { isDeepStrictEqual } from "node:util";
import { requireValue } from "./local-recipe-common.mjs";
import { numericJourneys, numericTitles, numericDownloads, numericContracts, numericTypingContract } from "./generated-numeric-plan.mjs";
import { validateLibraryReuseProvenance } from "./generated-components-reader-support.mjs";
const same = (a, b, message) => requireValue(isDeepStrictEqual(a, b), message);
export function validateNumericResults(report, selection) {
  const journeys = numericJourneys(selection), titles = ["authenticate the existing E2E account without provisioning memberships", ...journeys.map((id) => numericTitles[id])];
  const run = report.run, red = run?.status === "failed", count = titles.length;
  requireValue(report.schemaVersion === "report-1" && ["passed", "failed"].includes(run?.status) && (!red || selection !== "numeric-all"), "Numeric terminal proof missing.");
  same(run.results.map((r) => r.titlePath.join(" > ")), titles, "Exact numeric titles required.");
  requireValue(["id", "testId"].every((key) => new Set(run.results.map((r) => r[key])).size === count && run.results.every((r) => typeof r[key] === "string" && r[key])) &&
    ["discovered", "selected", "executed"].every((key) => run.summary[key] === count) && run.summary.passed === count - Number(red) && run.summary.failed === Number(red) &&
    // e2e 0.20 counts interrupted tests apart; earlier reports counted them as failed.
    run.summary.skipped === 0 && run.summary.flaky === 0 && (run.summary.interrupted ?? 0) === 0 && run.exitCode === Number(red) && run.usage.modelTokens === 0 && run.usage.maxModelCallsInStep === 0 &&
    run.usage.downloads === (red ? 0 : numericDownloads(selection)), "Numeric selection, attempts, models or downloads differ.");
  for (const [index, r] of run.results.entries()) {
    const status = red && index === 1 ? "failed" : "passed";
    requireValue(r.selected === true && r.repeat === 0 && r.status === status && r.platform === "web" && r.targetId === "chromium-desktop" &&
      r.kind === (index ? "test" : "setup") && r.file === (index ? "e2e/army/local/generated-ouvrage-numeric-entry.e2e.ts" : "e2e/army/critical/auth.setup.e2e.ts") &&
      r.attempts?.length === 1 && r.attempts[0].index === 0 && r.attempts[0].status === status && r.attempts[0].cleanup === "complete" && !r.skip && !r.attempts[0].secondaryErrors?.length,
    "Numeric setup, file or attempt differs.");
    if (status === "failed") requireValue(r.attempts[0].error?.code === "ASSERTION_FAILED" && r.attempts[0].error.category === "test" && r.attempts[0].error.phase === "body", "Only observed business assertions may qualify RED.");
    else requireValue(!r.attempts[0].error, "Unexpected numeric attempt error.");
  }
  return { red, count, journeys };
}
export function validateNumericWitness(w, s) {
  requireValue(w.schemaVersion === "army-numeric-entry-witness-1" && numericContracts[w.caseId]?.fixtureLabel === s.label && typeof w.phase === "string", "Exact numeric witness required.");
  for (const key of ["label", "projectId", "versionId", "draftId", "candidateId"]) same(w.fixture?.[key], s[key], "Numeric witness fixture differs.");
  same(w.fixture.componentIds, s.components.map((c) => c.componentId), "Numeric proposal identity/order differs.");
}
function keyboard(w, s) {
  validateNumericWitness(w, s);
  const phase = w.phase.replace("typed-price-corrected-", "typed-price-"), typed = numericTypingContract(w.caseId, phase);
  requireValue(w.expected?.input === typed.input && w.actual?.method === "pressSequentially" && w.actual.submitted === typed.input && w.actual.fieldIndex === typed.fieldIndex &&
    w.actual.focused === true && typeof w.actual.input === "string" && typeof w.actual.label === "string" && w.actual.label.startsWith(typed.labelPrefix), "Real exact numeric keyboard witness required.");
  return typed;
}
export function validateNumericTyping(w, s) {
  const typed = keyboard(w, s); requireValue(w.actual.input === typed.input, "Typed decimal prefix/value lost.");
  if (typed.field === "price") requireValue(w.actual.label.includes("€"), "Unit cost must announce euros.");
  if (typed.field === "loss") requireValue(w.actual.label.includes("%") && !/\bbp\b/i.test(w.actual.label), "Loss input must announce percent.");
}
export function validateNumericRed(w, result, s) {
  const typed = keyboard(w, s), a = result.attempts[0], message = String(a.error?.message ?? "");
  requireValue(a.error?.code === "ASSERTION_FAILED" && a.error.category === "test" && a.error.phase === "body" &&
    a.steps.some((step) => step.status === "passed" && step.api === "locator.pressSequentially" && String(step.label).includes(typed.labelPrefix)), "RED requires the corresponding executed keyboard step.");
  requireValue(w.actual.input !== typed.input || (typed.field === "price" && !w.actual.label.includes("€")) || (typed.field === "loss" && /\bbp\b/i.test(w.actual.label)), "No observed known numeric contradiction.");
  const inputFailure = message.includes("expect.toHaveValue failed") && message.includes(typed.input);
  const unitFailure = (typed.field === "price" || typed.field === "loss") && message.includes(typed.field === "price" ? "€" : "%") && message.includes(typed.labelPrefix);
  requireValue(inputFailure || unitFailure, "Failed assertion does not match the observed numeric value/unit matcher.");
  return { caseId: w.caseId, phase: w.phase, expectedInput: typed.input, actualInput: w.actual.input, label: w.actual.label };
}
export function validateNumericInvalid(before, after, s) {
  for (const w of [before, after]) validateNumericWitness(w, s);
  requireValue(before.phase === "invalid-before" && after.phase === "invalid-after" && before.actual.saveEnabled === true && after.actual.saveEnabled === false &&
    after.actual.insertEnabled === false && after.actual.input === "12,50x" && after.actual.ariaInvalid === true && typeof after.actual.errorText === "string" && after.actual.errorText.trim(), "Actual valid-to-invalid blocking transition required.");
  same(before.actual.state, after.actual.state, "Invalid input changed API/RLS state or action ledger.");
  const counts = (a) => a.counts ?? { update: a.updateCalls, insert: a.insertCalls };
  requireValue(before.actual.state?.estimate?.version?.id === s.versionId && Array.isArray(before.actual.state.estimate.items) && Array.isArray(before.actual.state.calls) &&
    [counts(before.actual).update, counts(before.actual).insert, counts(after.actual).update, counts(after.actual).insert].every((value) => Number.isSafeInteger(value) && value >= 0), "Actual invalid API/RLS/action observations required.");
  same(before.actual.state.objects.components.map((row) => row.id).sort(), s.components.map((component) => component.componentId).sort(), "Invalid RLS observation must retain all four proposal identities.");
  same(counts(before.actual), counts(after.actual), "Invalid input submitted a save/application.");
}
export function validateNumericInvalidDecision(witnesses, invalid, s) {
  same(witnesses.map((w) => w.phase), ["invalid-exclude-before", "invalid-excluded", "invalid-restored"], "Invalid decision order/phases differ.");
  let previous = -Infinity, previousSequence = 0;
  for (const [index, w] of witnesses.entries()) {
    validateNumericWitness(w, s);
    const timestamp = Date.parse(w.observedAt); requireValue(Number.isFinite(timestamp) && timestamp >= previous && Number.isSafeInteger(w.observedSequence) && w.observedSequence > previousSequence,
      "Observed invalid decision ordering required."); previous = timestamp; previousSequence = w.observedSequence;
    const a = w.actual; requireValue(a.input === "12,50x" && a.excludedCount === (index === 1 ? 4 : 3) && a.insertEnabled === false,
      "Invalid input/real exclusion count was lost.");
    if (index === 1) requireValue(a.saveEnabled === true && a.saveLabel?.trim() === "Enregistrer les décisions" && (a.fieldDisabled === true || a.fieldReadOnly === true) && a.restoreEnabled === true,
      "Excluded garbage must allow decisions and remain noneditable.");
    else requireValue(a.saveEnabled === false && a.ariaInvalid === true && a.fieldDisabled === false && a.fieldReadOnly === false && a.excludeEnabled === true,
      "Retained/restored garbage must remain invalid and excludable.");
    requireValue(a.state?.estimate?.version?.id === s.versionId && Array.isArray(a.state.calls), "Actual invalid decision API/RLS observation required.");
    same(a.state, invalid.actual.state, "Local invalid exclusion/restoration changed persistent state or ledger.");
    same(a.counts ?? { update: a.updateCalls, insert: a.insertCalls }, invalid.actual.counts ?? { update: invalid.actual.updateCalls, insert: invalid.actual.insertCalls }, "Invalid decision submitted a write.");
  }
}
export function validateNumericInitial(state, s) {
  requireValue(state.estimate.version.id === s.versionId && state.estimate.items.length === 1 && state.estimate.items[0].id === s.sectionId && state.calls.length === 0,
    "Fresh numeric estimate/ledger required.");
  same([state.estimate.version.total_ht_cents, state.estimate.version.total_tax_cents, state.estimate.version.total_ttc_cents], [0, 0, 0], "Fresh numeric financial zero required.");
  same(state.objects.components.map((r) => r.id).sort(), s.components.map((c) => c.componentId).sort(), "Four exact proposed component identities required.");
  requireValue(state.objects.components.every((r) => r.status === "suggested") && ["applications", "snapshots", "assemblies", "libraryComponents"].every((key) => state.objects[key].length === 0), "Numeric results/decisions may not be preinserted.");
}
export function validateNumericReviewed(state, s, c, status = "reviewed") {
  requireValue(state.objects.subdetails?.length === 1 && state.objects.subdetails[0].status === status, "Numeric sub-detail phase/status differs.");
  requireValue(state.objects.components.length === 4 && state.objects.componentSources.length === 4, "Exact numeric proposed rows and sources required.");
  for (const [index, original] of s.components.entries()) {
    const row = state.objects.components.find((r) => r.id === original.componentId), expected = c.components.find((x) => x.index === index);
    requireValue(row, "Numeric proposal missing.");
    if (expected) same([row.cost_type, row.quantity, row.unit, row.unit_cost_ht_cents, row.loss_coeff_bp, row.yield_value, row.yield_unit, row.status],
      [expected.costType, expected.quantity, expected.unit, expected.unitCostHtCents, expected.lossCoeffBp, expected.yieldValue ?? null, expected.yieldUnit ?? null, "manual"], "Stored numeric cents/bp/quantity/yield/status differ.");
    else requireValue(row.status === "rejected" && row.metadata?.rejected_from_status === "suggested", "Unretained proposal decision/origin differs.");
    const sources = state.objects.componentSources.filter((r) => r.component_id === original.componentId);
    requireValue(sources.length === 1 && sources[0].source_fragment_id === original.fragmentId && sources[0].source_rank === 0, "Numeric ordinary component citation identity differs.");
  }
}
export function validateNumericApplied(state, s, c, owner) {
  validateNumericReviewed(state, s, c, "applied");
  const e = state.estimate, o = state.objects, lines = e.items.filter((r) => r.item_type === "line");
  same([e.version.total_ht_cents, e.version.total_tax_cents, e.version.total_ttc_cents], c.totals, "Numeric canonical totals differ.");
  requireValue(e.version.id === s.versionId && lines.length === 1 && lines[0].quantity === c.parentQuantity && lines[0].h_mo === c.hours && lines[0].pu_ht_cents === c.effectiveUnitPriceHtCents,
    "Numeric parent quantity/effective price/physical hours differ.");
  same([lines[0].line_total_ht_cents, lines[0].line_tax_cents, lines[0].line_total_ttc_cents], c.totals, "Numeric parent line totals differ.");
  requireValue(["applications", "snapshots", "assemblies"].every((key) => o[key].length === 1) && o.libraryComponents.length === c.components.length, "Exact numeric application/snapshot/library required.");
  const snapshot = o.snapshots[0], ids = c.retainedIndices.map((index) => s.components[index].componentId);
  same(snapshot.components.map((r) => r.componentId), ids, "Numeric snapshot includes omitted/rejected or wrong identity.");
  same([snapshot.summary.componentCount, snapshot.summary.dsCents, snapshot.summary.indicativeTargetPriceCents], [ids.length, c.dsCents, c.dsCents], "Numeric snapshot summary differs.");
  requireValue(snapshot.assembly_id === o.assemblies[0].id, "Numeric snapshot/library association differs.");
  for (const [index, expected] of c.components.entries()) {
    const original = s.components[expected.index], snap = snapshot.components[index], lib = o.libraryComponents[index];
    same([snap.costType, snap.quantity, snap.unit, snap.unitCostHtCents, snap.lossCoeffBp], [expected.costType, expected.quantity, expected.unit, expected.unitCostHtCents, expected.lossCoeffBp], "Numeric snapshot canonical fields differ.");
    requireValue(snap.status !== "rejected" && snap.dsCents === Math.round(expected.quantity * expected.unitCostHtCents * (1 + expected.lossCoeffBp / 10000)), "Numeric snapshot retained cost differs.");
    same(snap.sources.map((r) => r.sourceFragmentId), [original.fragmentId], "Numeric snapshot citation differs.");
    same([lib.cost_type, lib.default_quantity, lib.unit, lib.unit_cost_ht_cents, lib.h_mo, lib.source_metadata?.component_id],
      [expected.costType, expected.quantity, expected.unit, expected.unitCostHtCents, expected.hours, original.componentId], "Numeric library price/physical hours/identity differ.");
    same(lib.source_metadata.sources.map((r) => r.sourceFragmentId), [original.fragmentId], "Numeric library citation differs.");
    requireValue(lib.assembly_id === o.assemblies[0].id && (expected.costType !== "labor" || (lib.labor_role_id === owner.laborRoleId && lib.k_mo === 0)) &&
      (expected.costType === "labor" || lib.k_fo === 1 + expected.lossCoeffBp / 10000), "Numeric library zero-MO role or percentage allocation differs.");
  }
  const provenance = lines[0].source_metadata;
  requireValue(provenance.kind === "generated_ouvrage" && provenance.draft_id === s.draftId && provenance.candidate_id === s.candidateId && provenance.application_id === o.applications[0].id &&
    provenance.snapshot_id === snapshot.id && provenance.assembly_id === o.assemblies[0].id && provenance.subdetail_summary.componentCount === ids.length && provenance.subdetail_summary.dsCents === c.dsCents,
  "Numeric applied parent provenance differs.");
}
export function validateNumericReuse(actual, c, primary) {
  const state = actual.state, e = state.estimate, lines = e.items.filter((r) => r.item_type === "line"), ordinary = actual.ordinaryRows.filter((r) => r.item_type === "line");
  requireValue(e.version.id !== primary.estimate.version.id && lines.length === c.components.length && lines.reduce((sum, r) => sum + Number(r.h_mo ?? 0), 0) === c.hours, "Numeric distinct reuse/physical hours differ.");
  same([e.version.total_ht_cents, e.version.total_tax_cents, e.version.total_ttc_cents], c.totals, "Numeric reused canonical totals differ.");
  validateLibraryReuseProvenance(lines, primary.objects.assemblies[0].id, primary.objects.libraryComponents);
  validateLibraryReuseProvenance(ordinary, primary.objects.assemblies[0].id, primary.objects.libraryComponents);
  same(ordinary.map((r) => r.id).sort(), lines.map((r) => r.id).sort(), "Numeric reused API/RLS line identities differ.");
}
export function validateNumericExportCells(data, api, totals) {
  requireValue(data.versionId === api.version.id && ["standard", "dpgf"].includes(data.mode), "Numeric export belongs to another version/mode."); same(data.api, api, "Numeric export own API differs.");
  same([api.version.total_ht_cents, api.version.total_tax_cents, api.version.total_ttc_cents], totals, "Numeric export financial totals differ.");
  for (const line of api.items.filter((r) => r.item_type === "line")) {
    if (data.mode === "standard") {
      const rows = data.sheets.Devis.filter((r) => String(r[1]).trim() === line.title); requireValue(rows.length === 1, "Numeric standard row missing/duplicated.");
      same(rows[0].slice(2, 8), [line.description, line.quantity, line.pu_ht_cents / 100, line.line_total_ht_cents / 100, line.line_tax_cents / 100, line.line_total_ttc_cents / 100], "Numeric standard own API cells differ.");
    } else {
      const rows = data.sheets.Données.filter((r) => r[1] === line.id); requireValue(rows.length === 1, "Numeric DPGF row missing/duplicated.");
      same([rows[0][3], rows[0][4], rows[0][5], rows[0][7], rows[0][8], rows[0][9], rows[0][10]], [line.quantity, line.description, line.unit_price_ht_cents / 100, line.k_fo ?? 1, line.h_mo ?? 0, line.k_mo ?? 1, line.h_mo_majoration ?? 1], "Numeric DPGF own API base/cost/hour cells differ.");
    }
  }
  if (data.mode === "standard") for (const [index, label] of ["Total HT", "Total TVA", "Total TTC"].entries()) same(data.sheets.Resume.filter((r) => r[0] === label).map((r) => r[1]), [totals[index] / 100], "Numeric standard summary differs.");
}
