// Génère, depuis src/lib/units/units.json, le bloc de données de la migration M3 et le bloc attendu
// de supabase/tests/database/measurement-units.test.sql (lot 2, sous-lot 2.4, D9).
//
//   npm run units:sql              contrôle (défaut) : échoue si un bloc diffère du JSON
//   npm run units:sql -- --check   idem
//   npm run units:sql -- --write   réécrit les deux blocs balisés
//
// M3 devient immuable une fois publiée : après publication, toute modification de units.json exige
// une nouvelle migration, et ce script devra alors viser le dernier état publié.
import fs from "node:fs";
import path from "node:path";

import {
  buildUnitsReferential,
  type UnitsReferential,
  type UnitsSource,
} from "../../src/lib/units/normalize";
import unitsSource from "../../src/lib/units/units.json";

export { buildUnitsReferential };

export const UNITS_MIGRATION_PATH = path.join(
  "supabase",
  "migrations",
  "20261017134443_estimate_engine_v3_functions_and_units.sql"
);
export const UNITS_PGTAP_PATH = path.join(
  "supabase",
  "tests",
  "database",
  "measurement-units.test.sql"
);

const GENERATED_NOTICE =
  "-- Généré par scripts/units/generate-units-sql.ts depuis src/lib/units/units.json : ne pas modifier à la main.";
const DATA_MARKERS = ["-- <units.json:data>", "-- </units.json:data>"] as const;
const EXPECTED_MARKERS = ["-- <units.json:expected>", "-- </units.json:expected>"] as const;

function sqlText(value: string | null): string {
  return value === null ? "null" : `'${value.replace(/'/g, "''")}'`;
}

function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function renderUnitsMigrationBlock(referential: UnitsReferential): string {
  const unitRows = referential.units.map(
    (unit) =>
      `  (${sqlText(unit.code)}, ${sqlText(unit.label)}, ${sqlText(unit.symbol)}, ${sqlText(unit.dimension)}, ${unit.sortOrder}, ${unit.active})`
  );
  const byToken = new Map<string, (typeof referential.aliases)[number]>();
  for (const alias of referential.aliases) {
    if (!byToken.has(alias.token)) byToken.set(alias.token, alias);
  }
  const aliasRows = [...byToken.values()]
    .sort((left, right) => compareCodeUnits(left.token, right.token))
    .map((alias) => {
      const status =
        alias.pricingStatus === null
          ? "null"
          : `${sqlText(alias.pricingStatus)}::public.estimate_line_pricing_status`;
      return `  (${sqlText(alias.token)}, ${sqlText(alias.unitCode)}, ${status})`;
    });
  return [
    DATA_MARKERS[0],
    GENERATED_NOTICE,
    "insert into public.measurement_units (code, label, symbol, dimension, sort_order, active)",
    "values",
    `${unitRows.join(",\n")};`,
    "insert into public.measurement_unit_aliases (token, unit_code, pricing_status)",
    "values",
    `${aliasRows.join(",\n")};`,
    DATA_MARKERS[1],
  ].join("\n");
}

export function renderUnitsExpectedBlock(referential: UnitsReferential): string {
  const unitRows = referential.units.map(
    (unit) =>
      `  (${sqlText(unit.code)}, ${sqlText(unit.label)}, ${sqlText(unit.symbol)}, ${sqlText(unit.dimension)}, ${unit.sortOrder}, ${unit.active})`
  );
  const aliasRows = referential.aliases.map(
    (alias) =>
      `  (${sqlText(alias.raw)}, ${sqlText(alias.token)}, ${sqlText(alias.unitCode)}, ${sqlText(alias.pricingStatus)})`
  );
  return [
    EXPECTED_MARKERS[0],
    GENERATED_NOTICE,
    "create temporary table expected_measurement_units (",
    "  code text primary key,",
    "  label text not null,",
    "  symbol text not null,",
    "  dimension text not null,",
    "  sort_order integer not null,",
    "  active boolean not null",
    ") on commit drop;",
    "insert into expected_measurement_units (code, label, symbol, dimension, sort_order, active)",
    "values",
    `${unitRows.join(",\n")};`,
    "create temporary table expected_measurement_unit_aliases (",
    "  raw text primary key,",
    "  token text not null,",
    "  unit_code text,",
    "  pricing_status text",
    ") on commit drop;",
    "insert into expected_measurement_unit_aliases (raw, token, unit_code, pricing_status)",
    "values",
    `${aliasRows.join(",\n")};`,
    EXPECTED_MARKERS[1],
  ].join("\n");
}

function locateBlock(content: string, markers: readonly [string, string]) {
  const start = content.indexOf(markers[0]);
  const end = content.indexOf(markers[1]);
  if (start < 0 || end < start || content.indexOf(markers[0], start + 1) >= 0) return null;
  return { start, end: end + markers[1].length };
}

type BlockTarget = {
  relativePath: string;
  markers: readonly [string, string];
  render: (referential: UnitsReferential) => string;
};

const TARGETS: readonly BlockTarget[] = [
  { relativePath: UNITS_MIGRATION_PATH, markers: DATA_MARKERS, render: renderUnitsMigrationBlock },
  { relativePath: UNITS_PGTAP_PATH, markers: EXPECTED_MARKERS, render: renderUnitsExpectedBlock },
];

/** Liste les dérives entre units.json et les blocs générés ; vide si tout est aligné. */
export function checkUnitsSqlBlocks(
  rootDirectory: string = process.cwd(),
  source: UnitsSource = unitsSource
): string[] {
  const referential = buildUnitsReferential(source);
  const problems: string[] = [];
  for (const target of TARGETS) {
    const filePath = path.join(rootDirectory, target.relativePath);
    if (!fs.existsSync(filePath)) {
      problems.push(`${target.relativePath} : fichier absent`);
      continue;
    }
    const content = fs.readFileSync(filePath, "utf8");
    const block = locateBlock(content, target.markers);
    if (!block) {
      problems.push(`${target.relativePath} : balises ${target.markers.join(" … ")} absentes ou répétées`);
      continue;
    }
    if (content.slice(block.start, block.end) !== target.render(referential)) {
      problems.push(`${target.relativePath} : le bloc généré diffère de units.json`);
    }
  }
  return problems;
}

/** Réécrit les deux blocs balisés depuis units.json ; rend les fichiers modifiés. */
export function writeUnitsSqlBlocks(rootDirectory: string = process.cwd()): string[] {
  const referential = buildUnitsReferential(unitsSource);
  const written: string[] = [];
  for (const target of TARGETS) {
    const filePath = path.join(rootDirectory, target.relativePath);
    const content = fs.readFileSync(filePath, "utf8");
    const block = locateBlock(content, target.markers);
    if (!block) throw new Error(`${target.relativePath} : balises ${target.markers.join(" … ")} absentes ou répétées`);
    const next = `${content.slice(0, block.start)}${target.render(referential)}${content.slice(block.end)}`;
    if (next !== content) {
      fs.writeFileSync(filePath, next, "utf8");
      written.push(target.relativePath);
    }
  }
  return written;
}

function runCli(args: readonly string[]): number {
  const mode = args.includes("--write") ? "write" : "check";
  if (args.some((arg) => arg !== "--write" && arg !== "--check")) {
    console.error("Usage : generate-units-sql.ts [--check | --write]");
    return 2;
  }
  if (mode === "write") {
    const written = writeUnitsSqlBlocks();
    console.log(
      written.length === 0
        ? "Blocs d'unités déjà alignés sur units.json."
        : `Blocs d'unités réécrits : ${written.join(", ")}.`
    );
    return 0;
  }
  const problems = checkUnitsSqlBlocks();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`- ${problem}`);
    console.error("Corriger units.json ou relancer npm run units:sql -- --write (avant publication de M3).");
    return 1;
  }
  console.log("Blocs d'unités alignés sur units.json (migration M3 et suite pgTAP).");
  return 0;
}

const executedAsCli =
  typeof process.argv[1] === "string" &&
  /generate-units-sql\.(?:[cm]?[jt]s)$/.test(path.basename(process.argv[1]));

if (executedAsCli) {
  process.exitCode = runCli(process.argv.slice(2));
}
