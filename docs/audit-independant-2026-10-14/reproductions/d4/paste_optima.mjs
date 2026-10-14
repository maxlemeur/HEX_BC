// Rejoue la détection/le mapping de collage de l'appli (clipboard.ts transpilé) sur l'en-tête réel OPTIMA et HEX.
import * as cb from "./tmp/clipboard.mjs";
const optima = ["N°","Désignation","Uté","Qté","Prix\nUnitaire","Prix\nTotal","PR Fourniture unitaire","PR Total\nfourniture","Tps pose unitaire","Tps pose unitaire majoré","Tps pose total","Coeff FO","Coeff MO","Majoration MO","Taux horaire"];
const optima1 = optima.map(h=>h.replace(/\n/g," "));
const bible = ["Fiabilité (/10)","ID","Matériau","Dimension","Caractéristique","Précision","norme","Qté","Unité","PR. FO","Type FO","K FO","h MO","Type MO","K MO","Commentaire ","h / \"","soudure (\")"];
const devis = ["position","ID","Désignation","Qte","U","PR. FO","Type FO","K FO","h MO","Type MO","K MO","P.U.","Prix total"];
const hex = ["Description","Famille Achat","FO / MO","LOT","n° LOT","U","COMMENTAIRES STT ","Qté Atelier ","Qté Chantier ","PU FO ","PU MO Atelier ","PU MO Chantier ","TOTAL FO ","Total MO Atelier ","Total MO Chantier ","TOTAL HT "];
for (const [name,h] of [["OPTIMA xlsx",optima1],["Bible DB_*",bible],["Devis vierge",devis],["DPGF client HEX",hex]]) {
  console.log("==", name, "format détecté:", cb.detectClipboardFormat(h));
  console.log(JSON.stringify(cb.suggestClipboardColumnMapping(h)));
}
// ligne OPTIMA réelle (tube T10 DN125) collée
const tsv = optima1.join("\t")+"\n"+["","Tube acier noir T10 en local technique DN 125","ml","20","174,59","3491,8","54,66","1093,2","1,991","1,991","39,82","","","",""].join("\t");
try { const m = cb.parseTsvMatrix(tsv); const map = cb.suggestClipboardColumnMapping(m.headers ?? m.rows?.[0] ?? optima1); const prev = cb.buildClipboardPreviewRows(m, map, {}); console.log(JSON.stringify(prev).slice(0,1500)); } catch(e) { console.log("preview err", e.message); }
