import { isDeepStrictEqual } from "node:util";
import { componentsTitles } from "./generated-components-plan.mjs";
import { requireValue } from "./local-recipe-common.mjs";
export function validateComponentResults(report, selection) {
  requireValue(["entry", "full"].includes(selection), "Exact component selection required.");
  const titles = ["authenticate the existing E2E account without provisioning memberships", ...componentsTitles.slice(0, selection === "entry" ? 1 : 4)];
  requireValue(report.schemaVersion === "report-1" && isDeepStrictEqual(report.run.results.map((r) => r.titlePath.join(" > ")), titles), "Exact selected component titles required.");
  const red = report.run.status === "failed";
  requireValue(!red || selection === "entry", "Full component failures are missing proof.");
  const count = titles.length;
  for (const k of ["id", "testId"]) requireValue(new Set(report.run.results.map((r) => r[k])).size === count, "Unique component result identities required.");
  requireValue(["discovered", "selected", "executed"].every((k) => report.run.summary[k] === count) && report.run.summary.passed === count - Number(red) &&
    report.run.summary.failed === Number(red) && report.run.summary.skipped === 0 && report.run.summary.flaky === 0 &&
    // e2e 0.20 counts interrupted tests apart; earlier reports counted them as failed.
    (report.run.summary.interrupted ?? 0) === 0 &&
    report.run.exitCode === Number(red) && report.run.usage.modelTokens === 0 && report.run.usage.maxModelCallsInStep === 0 &&
    report.run.usage.downloads === (red ? 0 : selection === "entry" ? 4 : 6), "Executed component outcomes/model/downloads differ.");
  for (const [i, r] of report.run.results.entries()) {
    const expected = red && i === 1 ? "failed" : "passed";
    requireValue(r.selected === true && r.repeat === 0 && r.status === expected && r.platform === "web" && r.targetId === "chromium-desktop" &&
      r.kind === (i === 0 ? "setup" : "test") && r.file === (i === 0 ? "e2e/army/critical/auth.setup.e2e.ts" : "e2e/army/local/generated-ouvrage-components.e2e.ts") &&
      r.attempts.length === 1 && r.attempts[0].index === 0 && r.attempts[0].status === expected && r.attempts[0].cleanup === "complete" &&
      !r.skip && !r.attempts[0].secondaryErrors?.length, "Component setup/attempt/retry contract differs.");
    if (expected === "failed") requireValue(/[ÉE]carter/i.test(JSON.stringify(r.attempts[0].error)) && /ASSERTION_FAILED|LOCATOR_NOT_FOUND/.test(JSON.stringify(r.attempts[0].error)), "Expected missing Écarter assertion required for product RED.");
    else requireValue(!r.attempts[0].error, "Unexpected component attempt error.");
  }
  return { red, count };
}
export function validateComponentRedObservation(data) {
  requireValue(data.index === 2 && data.decision === "Écarter" && data.articles?.length === 4 &&
    data.articles.every((a) => a.text.includes("Suggéré")) && !data.articles[2].buttons.some((b) => b.name?.trim() === "Écarter") &&
    data.state.components.length === 4 && data.state.components.every((c) => c.status === "suggested") &&
    ["applications", "snapshots", "assemblies", "libraryComponents"].every((k) => data.state[k].length === 0), "Real visible absence and pristine proposed component state required.");
}
export function validateComponentApplied(data, scenario, totals, cost, owner) {
  const e = data.estimate, objects = data.objects, indices = scenario.label === "GC02" ? [1, 2] : [0, 1];
  const retained = indices.map((i) => ({ ...scenario.components[i], unitCostHtCents: scenario.label === "GC02" && i === 1 ? 0 : scenario.components[i].unitCostHtCents }));
  const ids = retained.map((c) => c.componentId), rejected = scenario.components.filter((_, i) => !indices.includes(i));
  requireValue(isDeepStrictEqual([e.version.total_ht_cents, e.version.total_tax_cents, e.version.total_ttc_cents], totals), "Retained component totals differ.");
  const lines = e.items.filter((r) => r.item_type === "line");
  requireValue(lines.length === 1 && lines[0].quantity === 1 && lines[0].h_mo === 1 && lines[0].pu_ht_cents === cost && lines[0].labor_role_id === owner.laborRoleId &&
    isDeepStrictEqual([lines[0].line_total_ht_cents, lines[0].line_tax_cents, lines[0].line_total_ttc_cents], totals), "Retained parent values/hours/RMO differ.");
  requireValue(objects.components.length === 4 && objects.componentSources.length === 4 &&
    isDeepStrictEqual(objects.components.filter((r) => r.status === "rejected").map((r) => r.id).sort(), rejected.map((c) => c.componentId).sort()) &&
    ["applications", "snapshots", "assemblies"].every((k) => objects[k].length === 1) && objects.libraryComponents.length === 2, "Retained/proposed component composition differs.");
  const snapshot = objects.snapshots[0], summary = snapshot.summary;
  requireValue(isDeepStrictEqual(snapshot.components.map((c) => c.componentId), ids) &&
    isDeepStrictEqual([summary.componentCount, summary.dsCents, summary.indicativeTargetPriceCents], [2, cost, cost]) &&
    isDeepStrictEqual(objects.libraryComponents.map((c) => c.title), retained.map((c) => c.designation)), "Applied snapshot/library selection differs.");
  for (const [i, c] of retained.entries()) {
    const snap = snapshot.components[i], library = objects.libraryComponents[i];
    requireValue(snap.costType === c.costType && snap.quantity === c.quantity && snap.unit === c.unit && snap.unitCostHtCents === c.unitCostHtCents &&
      snap.dsCents === c.quantity * c.unitCostHtCents && isDeepStrictEqual(snap.sources.map((s) => s.sourceFragmentId), [c.fragmentId]) &&
      library.cost_type === c.costType && library.unit_cost_ht_cents === c.unitCostHtCents && library.source_metadata.component_id === c.componentId &&
      isDeepStrictEqual(library.source_metadata.sources.map((s) => s.sourceFragmentId), [c.fragmentId]), "Retained component cost/identity/citation association differs.");
  }
  const labor = objects.libraryComponents.find((c) => c.cost_type === "labor");
  requireValue(labor && labor.unit_cost_ht_cents === (scenario.label === "GC02" ? 0 : 4000) && labor.h_mo === 1 && labor.labor_role_id === owner.laborRoleId, "Retained zero/labor library identity/hours/RMO differ.");
  const provenance = lines[0].source_metadata;
  requireValue(provenance.kind === "generated_ouvrage" && provenance.draft_id === scenario.draftId && provenance.candidate_id === scenario.candidateId &&
    provenance.application_id === objects.applications[0].id && provenance.snapshot_id === snapshot.id && provenance.assembly_id === objects.assemblies[0].id &&
    provenance.subdetail_summary.componentCount === 2 && provenance.subdetail_summary.dsCents === cost, "Retained parent provenance differs.");
}
export function validateComponentReuse(data, scenario, totals) {
  const after = data.after, lines = after.items.filter((r) => r.item_type === "line");
  const indices = scenario.label === "GC02" ? [1, 2] : [0, 1];
  requireValue(isDeepStrictEqual([after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents], totals) && lines.length === 2 &&
    isDeepStrictEqual(lines.map((r) => r.title), indices.map((i) => scenario.components[i].designation)) &&
    lines.reduce((h, r) => h + Number(r.h_mo ?? 0), 0) === 1, "Library reuse must preserve exact retained values and total hours.");
}

export function validateLibraryReuseProvenance(lines, assemblyId, library) {
  requireValue(Array.isArray(lines) && Array.isArray(library) && lines.length === library.length && library.length > 0 &&
    new Set(library.map((item) => item.id)).size === library.length && new Set(lines.map((line) => line.id)).size === lines.length,
  "Distinct library and reused line identities required.");
  const byId = new Map(library.map((item) => [item.id, item])), seen = new Set();
  for (const line of lines) {
    const origin = line.source_metadata?.library_origin, item = origin && byId.get(origin.assembly_item_id);
    requireValue(line.source_provider === "assembly_library" && item && origin.assembly_id === assemblyId && item.assembly_id === assemblyId && !seen.has(item.id),
    "Reused line must point to its exact library leaf/item identity.");
    seen.add(item.id);
    requireValue(isDeepStrictEqual(line.source_metadata, { kind: "assembly_library", library_origin: { assembly_id: assemblyId, assembly_item_id: item.id, source_metadata: item.source_metadata } }),
    "Original library JSON must be copied exactly inside its wrapper, without flattened attribution.");
    requireValue(line.title === item.title && line.description === item.unit && line.quantity === item.default_quantity &&
      line.unit_price_ht_cents === (item.cost_type === "labor" ? 0 : item.unit_cost_ht_cents) && line.h_mo === item.h_mo && line.k_fo === item.k_fo && line.k_mo === item.k_mo && line.labor_role_id === item.labor_role_id,
    "Reused cost/hour/type mapping must stay associated to the exact originating item.");
  }
}
