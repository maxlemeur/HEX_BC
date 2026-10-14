// Lecture seule : apparie les lignes du PDF DPGF (PU) avec le xlsx (G=PR FO, I=tps) et ajuste PU = a*G + b*I (moindres carrés).
const fs=require("fs");const XLSX=require("C:/Users/maxim/Projects/miaouffrage/node_modules/xlsx");
const [, , xlsx, txt] = process.argv;
const ws=XLSX.readFile(xlsx).Sheets["Feuil1"];
const rows=[]; for(let r=3;r<=3000;r++){ const b=ws["B"+r]?.v; const d=ws["D"+r]?.v; if(typeof b==="string"&&typeof d==="number"&&d>0&&ws["E"+r]?.v>0) rows.push({r,b:b.replace(/\s+/g," ").trim(),u:ws["C"+r]?.v,d,G:ws["G"+r]?.v||0,I:ws["I"+r]?.v||0,E:ws["E"+r]?.v,F:ws["F"+r]?.v}); }
const num=s=>Number(s.replace(/[\s\u202f€]/g,"").replace(",","."));
const lines=fs.readFileSync(txt,"utf8").split(/\n/);
const pdf=[]; for(const l of lines){ const p=l.split(" | "); if(p.length>=5 && /€$/.test(p[p.length-1]) && /€$/.test(p[p.length-2])) pdf.push({b:p[0].replace(/\s+/g," ").trim(),u:p[1],q:num(p[2]),pu:num(p[3]),pt:num(p[4])}); }
// appariement séquentiel par préfixe de désignation
let j=0; const pairs=[]; for(const x of pdf){ for(let k=j;k<Math.min(j+40,rows.length);k++){ if(rows[k].b.startsWith(x.b.slice(0,40))&&rows[k].d===x.q){ pairs.push({x,y:rows[k]}); j=k+1; break; } } }
// moindres carrés 2 variables
let sGG=0,sGI=0,sII=0,sGP=0,sIP=0; for(const {x,y} of pairs){ sGG+=y.G*y.G; sGI+=y.G*y.I; sII+=y.I*y.I; sGP+=y.G*x.pu; sIP+=y.I*x.pu; }
const det=sGG*sII-sGI*sGI; const a=(sGP*sII-sIP*sGI)/det; const b=(sIP*sGG-sGP*sGI)/det;
let maxe=0, n1=0; for(const {x,y} of pairs){ const e=Math.abs(a*y.G+b*y.I-x.pu); maxe=Math.max(maxe,e); if(e>0.02) n1++; }
console.log({pdfLines:pdf.length, paired:pairs.length, a:a.toFixed(5), b_per_h:b.toFixed(4), coeffMO_si_taux40:(b/40).toFixed(4), maxAbsErr:maxe.toFixed(3), nErr_gt_2cts:n1});
// examples
for (const {x,y} of pairs.slice(0,6)) console.log(y.r, y.b.slice(0,45), "PDF PU",x.pu,"PT",x.pt,"| xlsx G",y.G,"I",y.I,"E",+y.E.toFixed(3),"F",y.F, "| recalc", (a*y.G+b*y.I).toFixed(3), "round(q*PU)", Math.round(x.q*x.pu*100)/100);
