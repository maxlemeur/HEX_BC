// Lecture seule : dump compact des VALEURS (tab), option formules pour colonnes listées.
// Usage : node values.js <fichier> <feuille> <plage> [colsAvecFormule ex "J,L"]
const XLSX = require("C:/Users/maxim/Projects/miaouffrage/node_modules/xlsx");
const [, , file, sheetName, range, fcols] = process.argv;
const wb = XLSX.readFile(file, { cellFormula: true, bookVBA: false });
const ws = wb.Sheets[sheetName];
const r = XLSX.utils.decode_range(range || ws["!ref"]);
const fset = new Set((fcols || "").split(",").filter(Boolean));
for (let R = r.s.r; R <= r.e.r; R++) {
  const parts = [];
  let any = false;
  for (let C = r.s.c; C <= r.e.c; C++) {
    const col = XLSX.utils.encode_col(C);
    const c = ws[`${col}${R + 1}`];
    let s = "";
    if (c && c.v !== "" && c.v != null) {
      any = true;
      s = typeof c.v === "number" ? String(Math.round(c.v * 10000) / 10000) : String(c.v).slice(0, 70);
      if (fset.has(col) && c.f) s += ` {=${c.f.slice(0, 160)}}`;
    }
    parts.push(s);
  }
  if (any) console.log(`${R + 1}\t${parts.join("\t")}`);
}
