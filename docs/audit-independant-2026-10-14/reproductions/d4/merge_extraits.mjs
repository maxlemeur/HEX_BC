// Assemble D4-extraits.json (aucune donnée personnelle) : oracle, barèmes, rejeux d'import/collage.
import fs from "node:fs";
import { guessTargetFieldWithScore as g } from "./tmp/guess.mjs";
import * as cb from "./tmp/clipboard.mjs";
const oracle = JSON.parse(fs.readFileSync("tmp/oracle.json", "utf8"));
const heads = {
  optima_xlsx: ["N°","Désignation","Uté","Qté","Prix Unitaire","Prix Total","PR Fourniture unitaire","PR Total fourniture","Tps pose unitaire","Tps pose unitaire majoré","Tps pose total","Coeff FO","Coeff MO","Majoration MO","Taux horaire"],
  dpgf_client_hex: ["Description","Famille Achat","FO / MO","LOT","n° LOT","U","COMMENTAIRES STT ","Qté Atelier ","Qté Chantier ","PU FO ","PU MO Atelier ","PU MO Chantier ","TOTAL FO ","Total MO Atelier ","Total MO Chantier ","TOTAL HT "],
  bible_db: ["ID","Matériau","Dimension","Caractéristique","Précision","Qté","Unité","PR. FO","Type FO","K FO","h MO","Type MO","K MO","h / \"","soudure (\")"],
  devis_vierge: ["position","ID","Désignation","Qte","U","PR. FO","Type FO","K FO","h MO","Type MO","K MO","P.U.","Prix total"],
};
const rejeu = {};
for (const [k, h] of Object.entries(heads)) {
  rejeu[k] = {
    import_dpgf_heuristique: Object.fromEntries(h.map((x) => [x, g(x)?.target ?? null])),
    collage_format_detecte: cb.detectClipboardFormat(h),
    collage_mapping: cb.suggestClipboardColumnMapping(h),
  };
}
const extraits = {
  meta: { axe: "D4", date: "2026-10-14", methode: "lecture seule SheetJS/pdfjs-dist ; rejeu de fonctions pures de l'appli transpilées par esbuild (aucune macro exécutée)" },
  conventions: {
    optima_xlsx: { coeff_fo: 1.3, coeff_mo: 1.3, majoration_mo: 0, taux_horaire_eur: 40, formule_pu: "(G*$L$2)+(J*$M$2*$O$2)", formule_pt: "ROUND(D*E,2)", tva: "ROUND(total*20/100,2)", cellules: "Feuil1!L2:O2, E7, F7, F2947:F2949" },
    optima_offre_pdf: { k_vente_fo: 1.3, k_vente_mo: 1.2, taux_mo_vendu_eur_h: 48, ajustement: "moindres carrés sur 785 (hydraulique) et 656 (plomberie) lignes appariées, erreur max 0,6 centime" },
    devis_vierge_cibles: [[0, 1.6], [100000, 1.55], [250000, 1.5], [500000, 1.45], [1000000, 1.4]],
    appli_bareme_defaut: [[0, 1.6], [100000, 1.45], [1000000, 1.4]],
    bible_bloc_fo_ml: { tube: 1.2, coude90_par_ml: 0.3, te_par_ml: 0.15, reduction_par_ml: 0.2, manchon_par_ml_serti: 0.2, lt: 1.6, supportage: 1.3, mo_bloc: 1.1, cellules: "DB_I4Lsoude!J255:P266, DB_ILserti!J160:M168, DB_MCserti!J132:K140" },
    appro_cuivre: { majo_cu: 1.05, majo_isolant: 1.1, coude90_par_m: "ROUNDUP(0,3 x métré) puis 0,2 au-delà de 1\"1/8", coude45_et_manchon_par_m: 0.25, brasure_kg: "somme métré x coefficient par diamètre (0,04 à 2,5)", sac: "kg/35", cellules: "cuivre_isolant!C2:C3, C10:AC14, AH8:AI8" },
  },
  bible_couverture: { articles: 1239, avec_prix: 366, avec_h_mo: 54, avec_h_par_pouce: 14, avec_pouces: 174, k_fo_renseignes: 4, k_mo_renseignes: 0, lignes_prix_sans_id_exclues: { DB_Rob: 5, DB_T10: 33 }, collisions_id_insensibles_casse: 117 },
  oracle,
  rejeu_import_collage: rejeu,
  arrondis_offres: {
    hydraulique: { lignes: 785, pt_different_de_q_x_pu_affiche: 420, max_ecart_eur: 7.94, tva_par_ligne_moins_tva_sur_total_cts: -11, ecart_xlsx_vs_logiciel_source_eur: -89.49 },
    plomberie: { lignes: 656, pt_different_de_q_x_pu_affiche: 341, max_ecart_eur: 2.03, tva_par_ligne_moins_tva_sur_total_cts: -10, ecart_xlsx_vs_logiciel_source_eur: 18.88 },
  },
};
fs.writeFileSync(process.argv[2], JSON.stringify(extraits, null, 2));
console.log("ok", process.argv[2]);
