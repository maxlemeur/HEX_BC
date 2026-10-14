// Lecture seule : analyse des lignes article du « déboursé détaillé » extrait en texte (tmp/*.txt).
// Repère les lignes contenant un type MO (P1, P2...) et reconstruit les champs numériques.
// Usage : node parse_debourse.js tmp/<fichier>.txt
const fs = require("fs");
const file = process.argv[2];
const lines = fs.readFileSync(file, "utf8").split(/\n/).map((l) => l.replace(/g \| f \| e \| d \| c \| ?/g, "").trim());
const num = (s) => Number(String(s).replace(/[\s €]/g, "").replace(",", "."));
const isNum = (s) => /^-?[\d\s ]+(,\d+)?( €)?$/.test(String(s).trim());
const arts = [];
for (const l of lines) {
  const p = l.split(" | ").map((x) => x.trim());
  const iT = p.findIndex((x) => /^P\d+$/.test(x));
  if (iT < 0) continue;
  // après type MO : PR unit, PR tot, PV unit, PV tot €, pv/pr
  const after = p.slice(iT + 1);
  // avant : ... Tps, TpsTot, k (num) ; on remonte
  const before = p.slice(0, iT);
  // trouver l'unité : premier token court non numérique après la désignation suivi d'un nombre
  let iU = before.findIndex((x, i) => i > 0 && /^(m|ml|m²|m2|u|U|ens|kg|ft|l|h|jr|forfait|m3|ens\.)$/i.test(x) && isNum(before[i + 1] || ""));
  const rec = { line: l.slice(0, 200), typeMO: p[iT] };
  if (iU > 0) {
    rec.designation = before.slice(0, iU).join(" ");
    rec.unite = before[iU];
    rec.qte = num(before[iU + 1]);
    rec.pxpublic = num(before[iU + 2]);
    rec.prfo_u = num(before[iU + 3]);
    rec.prfo_t = num(before[iU + 4]);
    rec.kacc = num(before[iU + 5]);
    const rest = before.slice(iU + 6);
    // rest = marque, ref?, code, type, [tps, tpstot], k
    rec.rest = rest;
    const nums = rest.filter(isNum).map(num);
    rec.k_mo = nums.length ? nums[nums.length - 1] : null;
    if (nums.length >= 3) { rec.tps = nums[nums.length - 3]; rec.tps_t = nums[nums.length - 2]; }
  }
  rec.pr_u = num(after[0]); rec.pr_t = num(after[1]); rec.pv_u = num(after[2]); rec.pv_t = num(after[3]); rec.pv_pr = num(after[4]);
  arts.push(rec);
}
const out = { n: arts.length, typeMO: {}, unite: {}, kacc: {}, k_mo: {}, pv_pr: {}, tauxImplicite: {} };
for (const a of arts) {
  out.typeMO[a.typeMO] = (out.typeMO[a.typeMO] || 0) + 1;
  out.unite[a.unite] = (out.unite[a.unite] || 0) + 1;
  out.kacc[a.kacc] = (out.kacc[a.kacc] || 0) + 1;
  out.k_mo[a.k_mo] = (out.k_mo[a.k_mo] || 0) + 1;
  out.pv_pr[a.pv_pr] = (out.pv_pr[a.pv_pr] || 0) + 1;
  if (a.tps > 0) {
    const t = Math.round(((a.pr_u - a.prfo_u) / a.tps) * 100) / 100;
    const key = `${a.typeMO}:${t}`;
    out.tauxImplicite[key] = (out.tauxImplicite[key] || 0) + 1;
  }
}
console.log(JSON.stringify(out, null, 0));
if (process.argv[3] === "dump") for (const a of arts.slice(0, Number(process.argv[4] || 40))) console.log(JSON.stringify(a));
if (process.argv[3] === "grep") for (const a of arts.filter((a) => new RegExp(process.argv[4], "i").test(a.line))) console.log(JSON.stringify(a));
