// Rejoue l'heuristique d'import DPGF (guessTargetFieldWithScore, src/lib/mappings/server.ts:780-892, extraite telle quelle).
import { guessTargetFieldWithScore as g } from "./tmp/guess.mjs";
const sets = {
  "OPTIMA xlsx": ["N°","Désignation","Uté","Qté","Prix Unitaire","Prix Total","PR Fourniture unitaire","PR Total fourniture","Tps pose unitaire","Tps pose unitaire majoré","Tps pose total","Coeff FO","Coeff MO","Majoration MO","Taux horaire"],
  "DPGF client HEX": ["Description","Famille Achat","FO / MO","LOT","n° LOT","U","COMMENTAIRES STT ","Qté Atelier ","Qté Chantier ","PU FO ","PU MO Atelier ","PU MO Chantier ","TOTAL FO ","Total MO Atelier ","Total MO Chantier ","TOTAL HT "],
  "Bible DB_*": ["ID","Matériau","Dimension","Caractéristique","Précision","Qté","Unité","PR. FO","Type FO","K FO","h MO","Type MO","K MO","h / \"","soudure (\")"],
};
for (const [k, hs] of Object.entries(sets)) { console.log("==", k); for (const h of hs) { const r = g(h); console.log(`  ${JSON.stringify(h)} -> ${r ? r.target + " (" + r.score + ")" : "—"}`); } }
