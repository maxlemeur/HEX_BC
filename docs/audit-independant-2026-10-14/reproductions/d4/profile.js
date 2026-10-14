// Lecture seule : profil d'une feuille (en-tête, valeurs distinctes par colonne courte, motifs de formules normalisés).
// Usage : node profile.js <fichier> <feuille> [headerRow=1]
const XLSX = require("C:/Users/maxim/Projects/miaouffrage/node_modules/xlsx");
const [, , file, sheetName, headerRowArg] = process.argv;
const wb = XLSX.readFile(file, { cellFormula: true, bookVBA: false });
const ws = wb.Sheets[sheetName];
const r = XLSX.utils.decode_range(ws["!ref"]);
const hr = Number(headerRowArg || 1) - 1;
const header = {};
for (let C = r.s.c; C <= r.e.c; C++) {
  const c = ws[XLSX.utils.encode_cell({ r: hr, c: C })];
  header[C] = c ? String(c.v) : "";
}
const colStats = {};
const formulaPatterns = {};
for (let R = hr + 1; R <= r.e.r; R++) {
  for (let C = r.s.c; C <= r.e.c; C++) {
    const addr = XLSX.utils.encode_cell({ r: R, c: C });
    const c = ws[addr];
    if (!c) continue;
    const col = XLSX.utils.encode_col(C);
    const st = (colStats[col] ??= { n: 0, num: 0, str: 0, distinct: new Map(), min: Infinity, max: -Infinity });
    if (c.v === "" || c.v == null) continue;
    st.n++;
    if (typeof c.v === "number") { st.num++; st.min = Math.min(st.min, c.v); st.max = Math.max(st.max, c.v); }
    else st.str++;
    const key = String(c.v).slice(0, 60);
    st.distinct.set(key, (st.distinct.get(key) || 0) + 1);
    if (c.f) {
      const norm = c.f.replace(/\$?([A-Z]{1,3})\$?(\d+)/g, (m, a, b) => `${a}#`);
      const k = `${col}: ${norm}`;
      (formulaPatterns[k] ??= { count: 0, example: `${addr} =${c.f}` }).count++;
    }
  }
}
console.log("HEADER:", JSON.stringify(header));
for (const [col, st] of Object.entries(colStats)) {
  const h = header[XLSX.utils.decode_col(col)];
  let line = `${col} [${h}] n=${st.n} num=${st.num} str=${st.str}`;
  if (st.num) line += ` min=${st.min} max=${st.max}`;
  line += ` distinct=${st.distinct.size}`;
  if (st.distinct.size <= 40) line += " :: " + [...st.distinct.entries()].map(([k, v]) => `${k}(${v})`).join("; ");
  console.log(line);
}
console.log("--- FORMULES (motifs) ---");
for (const [k, v] of Object.entries(formulaPatterns)) console.log(`${v.count}x ${k}\n     ex: ${v.example}`);
