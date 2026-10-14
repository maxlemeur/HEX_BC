// Lignes-oracle D4 : valeurs attendues issues des classeurs/PDF du porteur, et rejeu de la formule
// de ligne de l'application (src/lib/estimate-calculations.ts:198-251, copie fidèle, lecture seule).
// Usage : node oracle.js [out.json]
const fs = require("fs");

function bankersRound(value) { // src/lib/money.ts:122-130
  if (!Number.isFinite(value)) return 0;
  const truncated = Math.trunc(value);
  const remainder = Math.abs(value - truncated);
  if (Math.abs(remainder - 0.5) < 1e-9) {
    const even = truncated % 2 === 0 ? truncated : truncated + Math.sign(value);
    return even === 0 ? 0 : even;
  }
  return Math.round(value);
}
const r3 = (x) => Math.round(x * 1000) / 1000; // numeric(12,3) en base
function appLine({ q, unitPriceCents, kFo = 1, hMo = 0, hMaj = 1, rateCents = 0, kMo = 1, margin = 1 }) {
  const quantity = r3(q), kfo = r3(kFo), hmo = r3(hMo), kmo = r3(kMo);
  const mo = hMaj * hmo * rateCents * kmo;
  const cost = Math.round(quantity * unitPriceCents * kfo + mo);
  const sale = Math.round(cost * margin);
  const pu = quantity > 0 ? bankersRound(sale / quantity) : 0;
  return { costCents: cost, saleCents: sale, puCents: pu };
}
const eur = (c) => Math.round(c) / 100;

// Lignes-oracle (désignations génériques, sources : dossier « exemple chiffrage OPTIMA »)
const lines = [
  { id: "O1", lot: "hydraulique", designation: "Tube acier noir T10 DN125 en local technique", unite: "ml", q: 20,
    prfo: 54.66, tps_u: 1.991, src: { xlsx: "DPGF HYDRAULIQUE.xlsx Feuil1!A30:K30", debourse: "Déboursé HYDRAULIQUE.pdf p.1", offre: "DPGF HYDRAULIQUE.pdf p.1" },
    detail: "PR FO = Px public 34,70 x (1 - remise code B21) x K Acc 1,75 ; tps 1,991 h/ml = k MO 1,81 x 1,1 h",
    attendu: { debourse_u: 134.30, pv_u_xlsx: 174.59, pt_xlsx: 3491.80, pv_u_debourse_pdf: 174.59, pt_debourse_pdf: 698.36 * 5, pv_u_offre: 166.63, pt_offre: 3332.52 } },
  { id: "O2", lot: "hydraulique", designation: "Vanne papillon à brides PN16 DN125", unite: "U", q: 3,
    prfo: 95.63, prfo_exact: 95.625, px_net: 42.50, k_acc: 2.25, tps_u: 1.75, src: { xlsx: "DPGF HYDRAULIQUE.xlsx Feuil1!A13:K13", debourse: "Déboursé HYDRAULIQUE.pdf p.1", offre: "DPGF HYDRAULIQUE.pdf p.1" },
    detail: "PR FO = 125,00 x (1 - remise) x K Acc 2,25 = 95,625 (affiché 95,63)",
    attendu: { debourse_u: 165.63, pv_u_xlsx: 215.319, pt_xlsx: 645.96, pv_u_debourse_pdf: 215.31, pt_debourse_pdf: 645.93, pv_u_offre: 208.32, pt_offre: 624.96 } },
  { id: "O3", lot: "hydraulique", designation: "Calorifuge coquille laine 50 mm finition tôle isoxal", unite: "m2", q: 21,
    prfo: 58.50, tps_u: 0, src: { xlsx: "DPGF HYDRAULIQUE.xlsx Feuil1!A35:K35", debourse: "Déboursé HYDRAULIQUE.pdf p.2", offre: "DPGF HYDRAULIQUE.pdf p.1" },
    detail: "FO seule (sous-traitance calorifuge) : 45,00 x K Acc 1,30 ; aucune heure",
    attendu: { debourse_u: 58.50, pv_u_xlsx: 76.05, pt_xlsx: 1597.05, pv_u_debourse_pdf: 76.05, pt_debourse_pdf: 1597.05, pv_u_offre: 76.05, pt_offre: 1597.05 } },
  { id: "O4", lot: "hydraulique", designation: "Calorifuge eau glacée manchon élastomère 19x27 avec entoilage (ouvrage composé)", unite: "ml", q: 1139,
    prfo: 3.02, tps_u: 0.20, src: { xlsx: "DPGF HYDRAULIQUE.xlsx Feuil1!A718:K718", debourse: "Déboursé HYDRAULIQUE.pdf (ligne 2031-2034 du texte extrait)", offre: "DPGF HYDRAULIQUE.pdf p.15-16" },
    detail: "3 articles par ml : isolant 1 m (1,31 €, 0,15 h) + toile de verre 0,04 rouleau (1,39 €, 0,04 h) + enduit 0,1 kg (0,32 €, 0,01 h)",
    attendu: { debourse_u: 11.02, pv_u_xlsx: 14.326, pt_xlsx: 16317.31, pv_u_debourse_pdf: 14.34, pt_debourse_pdf: 16333.26, pv_u_offre: 13.53, pt_offre: 15406.11 } },
  { id: "O5", lot: "hydraulique", designation: "Pose seule pompe double à débit variable (matériel fourni par tiers)", unite: "U", q: 1,
    prfo: 20.00, tps_u: 6, src: { xlsx: "DPGF HYDRAULIQUE.xlsx Feuil1!A20:K20", debourse: "Déboursé HYDRAULIQUE.pdf p.1", offre: "DPGF HYDRAULIQUE.pdf p.1" },
    detail: "petite fourniture forfaitaire 20 € + 6 h",
    attendu: { debourse_u: 260.00, pv_u_xlsx: 338.00, pt_xlsx: 338.00, pv_u_debourse_pdf: 338.00, pt_debourse_pdf: 338.00, pv_u_offre: 314.00, pt_offre: 314.00 } },
  { id: "O6", lot: "plomberie", designation: "Tube fonte SMU DN100 pour collecteur", unite: "ml", q: 282,
    prfo: 91.86, tps_u: 0.998, src: { xlsx: "DPGF PLOMBERIE.xlsx Feuil1!A986:K986", debourse: "Déboursé PLOMBERIE.pdf (ligne 2531-2532 du texte extrait)", offre: "DPGF PLOMBERIE MC.pdf" },
    detail: "article acheté en barre de 3 m : 0,35 barre par ml (1/3 + ~5 %), PR barre 262,45 €, K Acc 2,00, tps barre 2,85 h",
    attendu: { debourse_u: 131.76, pv_u_xlsx: 171.314, pt_xlsx: 48310.55, pv_u_debourse_pdf: 171.28, pt_debourse_pdf: 48300.96, pv_u_offre: 167.32, pt_offre: 47184.80 } },
  { id: "O7", lot: "hydraulique", designation: "Tube acier noir T1 DN40 (expansion), avec 10 % de chute", unite: "ml", q: 8,
    prfo: 8.83, tps_u: 1.30, src: { xlsx: "DPGF HYDRAULIQUE.xlsx Feuil1!A29:K29", debourse: "Déboursé HYDRAULIQUE.pdf p.1", offre: "DPGF HYDRAULIQUE.pdf p.1" },
    detail: "article 1,1 m par ml : PR 8,03 x 1,1 = 8,83 ; tps 1,182 x 1,1 = 1,30",
    attendu: { debourse_u: 60.84, pv_u_xlsx: 79.079, pt_xlsx: 632.63, pv_u_debourse_pdf: 79.09, pt_debourse_pdf: 632.72, pv_u_offre: 73.88, pt_offre: 591.03 } },
];
lines[0].attendu.pt_debourse_pdf = 3491.80; // ligne DPGF 20 ml (le sous-article à 4 m vaut 698,36)

const RATE = 4000; // 40 €/h en centimes
const out = [];
for (const l of lines) {
  const unitPriceCents = Math.round(l.prfo * 100);
  const hMoTotal = l.q * l.tps_u; // h_mo est un TOTAL de ligne dans le moteur
  const A = appLine({ q: l.q, unitPriceCents, hMo: hMoTotal, rateCents: RATE, margin: 1.3 });
  const Aerr = appLine({ q: l.q, unitPriceCents, hMo: l.tps_u, rateCents: RATE, margin: 1.3 }); // erreur de saisie h/u
  const B = appLine({ q: l.q, unitPriceCents, kFo: 1.3, hMo: hMoTotal, rateCents: RATE, kMo: 1.2, margin: 1.0 });
  const C = appLine({ q: l.q, unitPriceCents, hMo: hMoTotal, rateCents: RATE, kMo: 1.2 / 1.3, margin: 1.3 });
  const rec = {
    ...l,
    app: {
      A_marge_unique_1_30: { cout: eur(A.costCents), pv_total: eur(A.saleCents), pu: eur(A.puCents),
        ecart_vs_xlsx: +(eur(A.saleCents) - l.attendu.pt_xlsx).toFixed(2), ecart_vs_debourse_pdf: +(eur(A.saleCents) - l.attendu.pt_debourse_pdf).toFixed(2) },
      A_bis_h_mo_saisi_par_unite: { pv_total: eur(Aerr.saleCents), ecart_vs_xlsx: +(eur(Aerr.saleCents) - l.attendu.pt_xlsx).toFixed(2) },
      B_kfo_1_30_kmo_1_20_marge_1: { cout_affiche: eur(B.costCents), pv_total: eur(B.saleCents), pu: eur(B.puCents),
        ecart_vs_offre: +(eur(B.saleCents) - l.attendu.pt_offre).toFixed(2), marque_affichee_pct: 0 },
      C_marge_1_30_kmo_0_923: { pv_total: eur(C.saleCents), ecart_vs_offre: +(eur(C.saleCents) - l.attendu.pt_offre).toFixed(2) },
    },
  };
  if (l.px_net) {
    const Ap = appLine({ q: l.q, unitPriceCents: Math.round(l.px_net * 100), kFo: l.k_acc, hMo: hMoTotal, rateCents: RATE, margin: 1.3 });
    rec.app.A_prime_kfo_porte_K_Acc = { pv_total: eur(Ap.saleCents), ecart_vs_debourse_pdf: +(eur(Ap.saleCents) - l.attendu.pt_debourse_pdf).toFixed(2) };
  }
  out.push(rec);
}

// Barèmes : appli (défaut) vs cibles du porteur (devis_vierge_v1.xlsx Renseignement!D8)
const appTiers = [[0, 1.6], [100000, 1.45], [1000000, 1.4]];
const porteur = [[0, 1.6], [100000, 1.55], [250000, 1.5], [500000, 1.45], [1000000, 1.4]];
const pick = (t, cost) => { let m = t[0][1]; for (const [s, k] of t) if (cost >= s) m = k; return m; };
const bareme = [50000, 99999.99, 100000, 150000, 249999.99, 250000, 300000, 499999.99, 500000, 790490.05, 999999.99, 1000000, 1264749.15].map((c) => ({
  cout_total_eur: c, coef_appli_defaut: pick(appTiers, c), coef_cible_porteur: pick(porteur, c),
  pv_appli: Math.round(c * pick(appTiers, c) * 100) / 100, pv_porteur: Math.round(c * pick(porteur, c) * 100) / 100,
}));
const lots = {
  hydraulique: { fo: 545767.95, heures: 17974.528, taux: 40, pv_xlsx_1_3_1_3: 1644173.89, pv_debourse_pdf: 1644263.38, pv_offre_pdf: 1572275.75 },
  plomberie: { fo: 332875.37, heures: 11440.367, taux: 40, pv_xlsx_1_3_1_3: 1027637.33, pv_offre_pdf: 981875.83 },
};
for (const k of Object.keys(lots)) {
  const L = lots[k]; L.debourse = Math.round((L.fo + L.heures * L.taux) * 100) / 100;
  L.coef_global_offre = +(L.pv_offre_pdf / L.debourse).toFixed(4);
  L.coef_appli_defaut = pick(appTiers, L.debourse); L.coef_cible_porteur = pick(porteur, L.debourse);
  L.pv_si_bareme_appli = Math.round(L.debourse * L.coef_appli_defaut * 100) / 100;
}
const result = { lignes: out, bareme, lots };
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
for (const r of out) console.log(r.id, JSON.stringify(r.app));
console.table(bareme);
console.log(JSON.stringify(lots, null, 1));
