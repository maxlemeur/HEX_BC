import { isDeepStrictEqual } from "node:util";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export const cctpScenarioNames = ["nominal", "reference", "register", "l2_quantity", "l1_quantity", "l4_quantity", "l2_price", "recovery", "read_failure", "stale", "form_change"];
export const cctpResultTitles = [
  "authenticate the existing E2E account without provisioning memberships",
  "SC01-03 eight explicit requirements use real applied work and register without changing 71000/14200/85200 cents or eight hours",
  "SC04 activating B invalidates seven decisions and only a newly verified B citation revalidates E4",
  "SC05 register validation and reopening invalidate only linked provisional decisions",
  ...["l2_quantity", "l1_quantity", "l4_quantity", "l2_price"].map((name) => `SC06 ${name} preserves unrelated decisions and exact stored amounts`),
  "SC08 committed decision response lost then reload replays the same event without an automatic POST",
  "SC09 unavailable workspace never becomes an empty or current coverage decision",
  "SC02 technical edits require a new human completeness declaration before another decision",
  "SC07 rejects a stale decision without changing its current history",
];
const requireValue = (condition) => { if (!condition) throw new Error("CCTP evidence contract differs from its exact oracle."); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateCctpResults(report, args) {
  requireValue(report.schemaVersion === "report-1" && report.run?.status === "passed" && report.run.exitCode === 0);
  requireValue(isDeepStrictEqual(report.run.results.map((r) => r.titlePath.join(" > ")), cctpResultTitles));
  for (const key of ["id", "testId"]) requireValue(new Set(report.run.results.map((r) => r[key])).size === 12 && report.run.results.every((r) => typeof r[key] === "string" && r[key]));
  requireValue(report.run.results.every((r) => r.selected === true && r.status === "passed" && r.repeat === 0 && r.platform === "web" &&
    r.targetId === "chromium-desktop" && r.agent === "default" && ["setup", "test"].includes(r.kind) &&
    r.file === (r.kind === "setup" ? "e2e/army/critical/auth.setup.e2e.ts" : "e2e/army/local/source-coverage.e2e.ts") &&
    r.attempts?.length === 1 && r.attempts[0].index === 0 && r.attempts[0].status === "passed" && r.attempts[0].cleanup === "complete" &&
    !r.skip && !r.attempts[0].error && !r.attempts[0].secondaryErrors?.length));
  requireValue(report.run.results.filter((r) => r.kind === "setup").length === 1 && report.run.results[0].kind === "setup" &&
    ["discovered", "selected", "executed", "passed"].every((k) => report.run.summary[k] === 12) &&
    ["failed", "skipped", "flaky"].every((k) => report.run.summary[k] === 0) &&
    // e2e 0.20 counts interrupted tests apart; earlier reports counted them as failed.
    (report.run.summary.interrupted ?? 0) === 0);
  const allowed = new Set(["--headed", "--no-cache", "--debug"]);
  requireValue(isDeepStrictEqual(args.filter((arg) => !allowed.has(arg)), ["run", "--config", "e2e.config.ts", "--tag", "source-coverage", "--exclude-tag", "agent", "--target", "chromium-desktop", "--max-failures", "1"]));
  requireValue(report.run.usage.modelTokens === 0 && report.run.usage.maxModelCallsInStep === 0 && report.run.usage.downloads === 26);
}

export function validateCctpScenarios(fixture) {
  requireValue(fixture.schemaVersion === "source-coverage-fixture-1" && fixture.status === "ready" && fixture.prefix?.startsWith("ARMY-COVERAGE-"));
  requireValue(isDeepStrictEqual(Object.keys(fixture.scenarios).sort(), [...cctpScenarioNames].sort()));
  const ids = [];
  for (const scenario of Object.values(fixture.scenarios)) {
    requireValue(scenario.designation === "ARMY Réseau CH-A avec calorifuge");
    const values = [scenario.projectId, scenario.versionId, scenario.sectionA, scenario.sectionB, scenario.draftId, scenario.candidateId, scenario.documents?.A, scenario.documents?.B];
    requireValue(values.every((v) => uuid.test(v ?? ""))); ids.push(...values);
  }
  requireValue(new Set(ids).size === 88);
}

const configuredSecrets = (environment) => [...new Set(Object.entries(environment).filter(([key, secret]) => secret &&
    (/PASSWORD|SECRET|TOKEN|(?:^|_)KEY(?:_|$)|APIKEY|CREDENTIAL|AUTHORIZATION/i.test(key) || /^E2E_.*EMAIL$/i.test(key)))
    .flatMap(([, secret]) => [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]))];

export function assertCctpPrivateBytes(value, environment = process.env) {
  const bytes = Buffer.from(value), text = bytes.toString("utf8"), secrets = configuredSecrets(environment);
  requireValue(!secrets.some((secret) => bytes.includes(Buffer.from(secret))) && !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text) &&
    !/(?:draftLockSessionId|session_id|sessionId)(?:\\*["'])?\s*:\s*(?:\\*["'])?[0-9a-f]{8}-[0-9a-f-]{27}/i.test(text));
}

// Diagnostics can fail before the archive privacy scan. Scrub every returned
// metadata string, including paths and command arguments, at the output boundary.
export function redactCctpMetadata(value, environment = process.env) {
  const secrets = configuredSecrets(environment);
  const mask = secrets.some((secret) => "[REDACTED]".includes(secret)) ? "" : "[REDACTED]";
  const redact = (input) => {
    let text = input;
    for (const secret of secrets) text = text.replaceAll(secret, mask);
    return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, mask)
      .replace(/((?:draftLockSessionId|session_id|sessionId)(?:\\*["'])?\s*:\s*(?:\\*["'])?)[0-9a-f]{8}-[0-9a-f-]{27}/gi, `$1${mask}`);
  };
  const visit = (entry) => typeof entry === "string" ? redact(entry) : Array.isArray(entry) ? entry.map(visit) :
    entry && typeof entry === "object" ? Object.fromEntries(Object.entries(entry).map(([key, child]) => [redact(key), visit(child)])) : entry;
  return visit(value);
}

const xmlText = (text) => text.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (entity) => {
  const key = entity.slice(1, -1).toLowerCase();
  if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(key.startsWith("#x") ? 2 : 1), key.startsWith("#x") ? 16 : 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[key];
});

// XLSX is compressed. Scan each decompressed ZIP entry as well as the container,
// then reconstruct cells using exactly the journey's ExcelJS representation.
export async function inspectCctpWorkbook(value, declaredSheets, forbiddenStrings, environment = process.env) {
  const bytes = Buffer.from(value); assertCctpPrivateBytes(bytes, environment);
  const zip = await JSZip.loadAsync(bytes);
  requireValue(Object.keys(zip.files).length > 0);
  for (const entry of Object.values(zip.files)) if (!entry.dir) {
    const decoded = await entry.async("nodebuffer"); assertCctpPrivateBytes(decoded, environment);
    const text = xmlText(decoded.toString("utf8")); assertCctpPrivateBytes(Buffer.from(text), environment);
    requireValue(forbiddenStrings.every((clause) => !text.includes(clause)));
  }
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  const sheets = {};
  for (const worksheet of workbook.worksheets) {
    requireValue(!(worksheet.name in sheets)); sheets[worksheet.name] = [];
    worksheet.eachRow((row) => sheets[worksheet.name].push(Array.from({ length: worksheet.columnCount }, (_, index) => {
      const cell = row.getCell(index + 1); return typeof cell.value === "number" ? cell.value : cell.text || null;
    })));
  }
  requireValue(isDeepStrictEqual(sheets, declaredSheets) && forbiddenStrings.every((v) => !JSON.stringify(sheets).includes(v)));
  return sheets;
}

export function verifyCctpWorkbookValues(sheets, mode, scenario, items) {
  requireValue(items.length === 6 && new Set(items.map((r) => r.id)).size === 6 && items.filter((r) => r.item_type === "line").length === 4);
  requireValue(isDeepStrictEqual(items.filter((r) => r.item_type === "section").map((r) => r.id).sort(), [scenario.sectionA, scenario.sectionB].sort()));
  const names = [scenario.designation, "ARMY Protection parties droites CH-A", "ARMY Protection démontable des raccords CH-A", "ARMY Canalisation ECS-B sans calorifuge"];
  if (mode === "standard") {
    requireValue(isDeepStrictEqual(Object.keys(sheets), ["Devis", "Resume"]) && sheets.Devis.length === 7);
    const values = [["m", 10, 40, 400, 80, 480], ["m", 4, 20, 80, 16, 96], ["u", 2, 25, 50, 10, 60], ["m", 6, 30, 180, 36, 216]];
    for (const [index, name] of names.entries()) {
      const rows = sheets.Devis.filter((r) => typeof r[1] === "string" && r[1].trim() === name);
      requireValue(rows.length === 1 && isDeepStrictEqual(rows[0].slice(2, 8), values[index]));
    }
    for (const [name, value] of [["Total HT", 710], ["Total TVA", 142], ["Total TTC", 852], ["Version ID", scenario.versionId]]) {
      requireValue(isDeepStrictEqual(sheets.Resume.filter((r) => r[0] === name).map((r) => r[1]), [value]));
    }
  } else {
    requireValue(mode === "dpgf" && isDeepStrictEqual(Object.keys(sheets), ["Données", "Metadata"]) && sheets.Données.length === 7);
    const rows = sheets.Données.slice(1); requireValue(isDeepStrictEqual(rows.map((r) => r[1]).sort(), items.map((r) => r.id).sort()));
    for (const row of rows) { const item = items.find((i) => i.id === row[1]); requireValue(item && row[0] === item.item_type && String(row[2]).trim() === item.title); }
    const values = [[10, "m", 40, 0.5, 5, 1, 1], [4, "m", 10, 1, 1, 1, 1], [2, "u", 15, 1, 0.5, 1, 1], [6, "m", 20, 1, 1.5, 1, 1]];
    for (const [index, name] of names.entries()) {
      const found = rows.filter((r) => String(r[2]).trim() === name);
      requireValue(found.length === 1 && isDeepStrictEqual([...found[0].slice(3, 6), ...found[0].slice(7, 11)], values[index]));
    }
  }
}
