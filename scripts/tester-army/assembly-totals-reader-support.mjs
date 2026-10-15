import { isDeepStrictEqual } from "node:util";
import { requireValue } from "./local-recipe-common.mjs";
import { validateNumericApplied } from "./generated-numeric-reader-support.mjs";
import { numericContracts } from "./generated-numeric-plan.mjs";
const same = (a, b, label) => requireValue(isDeepStrictEqual(a, b), label);
export const assemblyTotalsTitles = ["AT01 assembly insertion persists nonempty fixed footer before any save", "AT02 assembly insertion persists V2 global discount allocation before any save"];
export function validateAssemblyTotalsResults(report) {
  const run = report.run, titles = ["authenticate the existing E2E account without provisioning memberships", ...assemblyTotalsTitles];
  same(run.results.map((result) => result.titlePath.join(" > ")), titles, "Exact Auth+AT01+AT02 titles required.");
  requireValue(report.schemaVersion === "report-1" && run.status === "passed" && run.exitCode === 0 && run.summary.discovered === 3 && run.summary.selected === 3 &&
    run.summary.executed === 3 && run.summary.passed === 3 && run.summary.failed === 0 && run.summary.skipped === 0 && run.summary.flaky === 0 &&
    // e2e 0.20 counts interrupted tests apart; earlier reports counted them as failed.
    (run.summary.interrupted ?? 0) === 0 &&
    run.usage.downloads === 8 && run.usage.modelTokens === 0 && run.usage.maxModelCallsInStep === 0, "Complete AT successes/downloads required; failed/unreached cases are missing proof.");
  for (const [index, result] of run.results.entries()) requireValue(result.selected && result.status === "passed" && result.repeat === 0 && result.platform === "web" &&
    result.targetId === "chromium-desktop" && result.kind === (index ? "test" : "setup") && result.file === (index ? "e2e/army/local/assembly-totals.e2e.ts" : "e2e/army/critical/auth.setup.e2e.ts") &&
    result.attempts.length === 1 && result.attempts[0].status === "passed" && result.attempts[0].cleanup === "complete" && !result.skip && !result.attempts[0].error && !result.attempts[0].secondaryErrors?.length,
  "Exact AT file/attempt/cleanup required.");
  requireValue(["id", "testId"].every((key) => new Set(run.results.map((result) => result[key])).size === 3) &&
    run.results.every((result) => result.attempts[0].index === 0), "Unique AT result identities/attempts required.");
  return { red: false, count: 3 };
}
const totals = (row) => [row.total_ht_cents, row.total_tax_cents, row.total_ttc_cents];
const lineTotals = (row) => [row.line_total_ht_cents, row.line_tax_cents, row.line_total_ttc_cents];
const business = (row) => Object.fromEntries(["id", "parent_id", "position", "title", "description", "quantity", "unit_price_ht_cents", "tax_rate_bp", "k_fo", "h_mo", "h_mo_majoration", "k_mo", "labor_role_id", "source_provider", "source_metadata"].map((key) => [key, row[key]]));
export function validateAssemblyTotalsBusiness(find, fixture) {
  const targets = [];
  for (const [index, caseId] of ["AT01", "AT02"].entries()) {
    const expected = index ? { discount: 1000, old: [1800, 360, 2160], added: [1125, 225, 1350], footer: [2925, 585, 3510], ui: /29[,.]25\s*€/ }
      : { discount: 0, old: [2000, 400, 2400], added: [1250, 250, 1500], footer: [3250, 650, 3900], ui: /32[,.]50\s*€/ };
    const source = find(`${caseId}-applied-reload`).actual.state;
    validateNumericApplied(source, fixture.scenarios[index], numericContracts.NI01, fixture.owner);
    const baseline = find(`${caseId}-baseline`), immediate = find(`${caseId}-immediate`), reload = find(`${caseId}-reload`), ui = find(`${caseId}-ui`);
    for (const witness of [baseline, immediate, reload, ui]) requireValue(witness.schemaVersion === "army-assembly-totals-witness-1" && witness.caseId === caseId &&
      witness.source.versionId === fixture.scenarios[index].versionId && witness.target.versionId !== witness.source.versionId && witness.assemblyId === source.objects.assemblies[0].id,
    "Exact owned source/target/library witness required.");
    for (const witness of [immediate, reload, ui]) same(witness.target, baseline.target, "AT target identity changed across observations.");
    targets.push(baseline.target.versionId); same(baseline.actual.requests, [], "No insertion in AT baseline.");
    const creation = find(`${caseId}-creation`), pending = find(`${caseId}-parent-pending`);
    same(creation.target, baseline.target, "AT confirmed creation target differs."); same(pending.target, baseline.target, "AT pending creation target differs.");
    requireValue(pending.parentHeld === true && pending.pendingButtonEnabled === false && pending.creationRequests === 1 &&
      creation.parentHeld === true && creation.pendingButtonEnabled === false && creation.creationRequests === 2 &&
      creation.parentStatus === 201 && creation.lineStatus === 201 && creation.childParentId === creation.parentId &&
      /^[a-f0-9-]{36}$/i.test(creation.parentId) && /^[a-f0-9-]{36}$/i.test(creation.lineId), "Real parent barrier and confirmed child creation required.");
    const old = baseline.actual.api.items.filter((row) => row.item_type === "line"); requireValue(old.length === 1 && baseline.actual.api.version.calc_engine_version === 2 &&
      baseline.actual.api.version.discount_bp === expected.discount && old[0].quantity === 1 && old[0].unit_price_ht_cents === 2000, "Real nonempty V2 precondition required.");
    requireValue(old[0].id === creation.lineId && old[0].parent_id === creation.parentId, "AT priced row is the confirmed child.");
    same(totals(baseline.actual.api.version), expected.old, "AT baseline footer differs.");
    if (!index) same(lineTotals(old[0]), expected.old, "AT fixed baseline row differs.");
    requireValue(old[0].tax_rate_bp === 2000, "Exact AT baseline tax required.");
    const baselineRow = baseline.actual.ordinary.items.find((row) => row.id === old[0].id);
    same(business(baselineRow), business(old[0]), "AT baseline business API/RLS differs."); same(lineTotals(baselineRow), lineTotals(old[0]), "AT observed baseline allocation API/RLS differs.");
    same(totals(baseline.actual.ordinary.version), expected.old, "AT baseline ordinary version footer differs.");
    requireValue(immediate.actual.status === 200 && immediate.actual.reply.ok === true, "Real insertion200 required.");
    requireValue(immediate.actual.reply.data.version.id === baseline.target.versionId, "AT reply belongs to another version.");
    same(totals(immediate.actual.reply.data.totals), expected.footer, "AT success reply footer differs.");
    const library = source.objects.libraryComponents[0];
    for (const witness of [immediate, reload]) {
      const actual = witness.actual, lines = actual.api.items.filter((row) => row.item_type === "line"); requireValue(lines.length === 2, "Exact old/new AT rows required.");
      requireValue(actual.api.version.id === baseline.target.versionId && actual.ordinary.version.id === baseline.target.versionId, "AT API/RLS version identity differs.");
      same(totals(actual.api.version), expected.footer, "Immediate/reloaded API footer differs."); same(totals(actual.ordinary.version), expected.footer, "Immediate/reloaded RLS footer differs.");
      same(actual.requests, ["POST"], "AT insertion replay observed.");
      const previous = lines.find((row) => row.id === old[0].id), added = lines.find((row) => row.id !== old[0].id);
      if (witness === immediate) same(immediate.actual.reply.data.items.filter((row) => row.item_type === "line").map((row) => row.id), [added.id], "AT reply inserted IDs differ.");
      same(business(previous), business(old[0]), "Old business fields changed during financial finalization."); same(lineTotals(previous), expected.old, "Old V2 allocation differs."); same(lineTotals(added), expected.added, "New V2 allocation differs.");
      requireValue(added.source_provider === "assembly_library" && added.quantity === 1 && added.unit_price_ht_cents === 1250 && added.h_mo === 0, "Inserted raw business fields differ.");
      same(added.source_metadata, { kind: "assembly_library", library_origin: { assembly_id: source.objects.assemblies[0].id, assembly_item_id: library.id, source_metadata: library.source_metadata } }, "AT library identity/provenance differs.");
      for (const line of lines) { const row = actual.ordinary.items.find((item) => item.id === line.id); same(business(row), business(line), "AT API/RLS business differs."); same(lineTotals(row), lineTotals(line), "AT API/RLS financial differs."); }
      same(lines.reduce((sum, row) => sum.map((value, index) => value + lineTotals(row)[index]), [0, 0, 0]), expected.footer, "AT allocations do not reconcile to footer.");
    }
    requireValue(expected.ui.test(ui.actual.footerText) && (index ? /18[,.]00\s*€/ : /20[,.]00\s*€/).test(ui.actual.oldRowText), "Actual AT UI footer/old row differs.");
    requireValue(/^(À jour|Sauvegardé)$/.test(ui.actual.statusText), "AT canonical header is visibly synchronized before reload.");
    if (index) {
      const discount = find(`${caseId}-discount-synchronized`);
      requireValue(discount.caseId === caseId && discount.target.versionId === baseline.target.versionId &&
        discount.actual.equivalentInput === "3.25" && discount.actual.expectedBp === 1000, "AT saved percentage discount equivalent must be synchronized in actual settings.");
    }
    same(ui.actual.requests, ["POST"], "AT UI caused a replay."); same(reload.actual.api.items, immediate.actual.api.items, "AT identities/data changed on reload.");
    const reloadedUi = find(`${caseId}-ui-reload`);
    requireValue(reloadedUi.caseId === caseId && reloadedUi.target.versionId === baseline.target.versionId &&
      expected.ui.test(reloadedUi.actual.footerText) && (index ? /18[,.]00\s*€/ : /20[,.]00\s*€/).test(reloadedUi.actual.oldRowText) &&
      reloadedUi.actual.reloadedDiscount === (index ? "3.25" : null), "AT actual UI footer/row/discount must survive reload.");
    same(reloadedUi.actual.requests, ["POST"], "AT reloaded UI replayed insertion.");
    same(reload.actual.ordinary.items, immediate.actual.ordinary.items, "AT ordinary rows changed on reload.");
    const synchronized = find(`${caseId}-synchronized`);
    requireValue(synchronized.schemaVersion === "army-assembly-totals-witness-1" && synchronized.caseId === caseId &&
      synchronized.target.versionId === baseline.target.versionId && typeof synchronized.actual.statusText === "string" &&
      !synchronized.actual.statusText.includes("Totaux à synchroniser"), "AT committed footer must remain synchronized in UI.");
    same(synchronized.actual.financialWrites, [], "AT success armed a redundant financial write.");
    same(synchronized.actual.requests, ["POST"], "AT synchronization replayed insertion.");
  }
  requireValue(new Set(targets).size === 2, "AT journeys must have distinct fresh target versions.");
}
