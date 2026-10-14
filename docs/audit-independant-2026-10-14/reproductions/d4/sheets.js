// Lecture seule : liste les feuilles d'un classeur, dimensions, et dump optionnel d'une plage avec formules.
// Usage : node sheets.js <fichier> [feuille] [plage A1:Z50] [maxRows]
const XLSX = require("C:/Users/maxim/Projects/miaouffrage/node_modules/xlsx");
const [, , file, sheetName, range, maxRowsArg] = process.argv;
const wb = XLSX.readFile(file, { cellFormula: true, cellNF: false, bookVBA: false, cellStyles: false });
if (!sheetName) {
  for (const n of wb.SheetNames) {
    const ws = wb.Sheets[n];
    const ref = ws["!ref"];
    let nf = 0, nv = 0;
    for (const k of Object.keys(ws)) {
      if (k[0] === "!") continue;
      nv++;
      if (ws[k].f) nf++;
    }
    console.log(`${n}\t${ref}\tcells=${nv}\tformulas=${nf}`);
  }
  if (wb.Workbook && wb.Workbook.Names) {
    console.log("--- Noms définis ---");
    for (const d of wb.Workbook.Names) console.log(`${d.Name}\t${d.Ref}\t${d.Sheet ?? ""}`);
  }
  process.exit(0);
}
const ws = wb.Sheets[sheetName];
if (!ws) { console.error("feuille inconnue", wb.SheetNames); process.exit(1); }
const r = XLSX.utils.decode_range(range || ws["!ref"]);
const maxRows = Number(maxRowsArg || 100000);
let rows = 0;
for (let R = r.s.r; R <= r.e.r; R++) {
  const parts = [];
  for (let C = r.s.c; C <= r.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: R, c: C });
    const c = ws[addr];
    if (!c) continue;
    let s = `${addr}=${JSON.stringify(c.v)}`;
    if (c.f) s += ` {=${c.f}}`;
    parts.push(s);
  }
  if (parts.length) { console.log(parts.join(" | ")); rows++; if (rows >= maxRows) break; }
}
