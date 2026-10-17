# Éditeur et réglages v3 (sous-lot 2.6) — parcours E2E `engine-v3-editor` (rouge d'abord)

Statut : **phase rouge seulement** (17/10/2026). Aucun code de production. Ce document fixe les scénarios, les
défaillances observables qu'ils exposent et le **contrat d'écran et d'API** que l'implémentation de 2.6 doit tenir
pour que le parcours passe au vert sans modifier une assertion. Il complète
[estimate-engine-v3-2.6.md](estimate-engine-v3-2.6.md) (défaillances `F26-01` à `F26-19`, isolation Vitest
`V3S-01` à `V3S-04`, contrat du hook et du module pur), qui renvoie ici pour les sélecteurs et libellés. Source :
[conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), §0, D4 à D9, D11, §4,
§5 (S2, S4, S5, EUHIST, CAP, T-STAT), §8.1 et §8.2 (lignes 2.6), §9, §14 « 2.6 ». Là où ce document résume la
conception, la conception fait foi ; là où il **choisit** (signalé « Choix »), il fixe le contrat du rouge.

Branche `lot2/2.6-editeur-v3`, base `f1d94213` (pointe de `lot2/2.5-persistance-v3`). Préalables repris de `V3P01`
(`engine-v3-persistence.e2e.ts`, doc 2.5 §9) : propriétaire dédié par parcours, politique 3 (1,30 / 1,20) posée
par le transport SQL possédé le temps de la création puis remise à 2, rôle « Tuyauteur » 40 €/h par l'API.

## 1. Fichiers et commande

| Fichier | Rôle |
|---|---|
| `e2e/army/local/engine-v3-editor.e2e.ts` | Parcours `V3E01`, `V3E02`, `V3E03` (sélection critique locale : motif `engine-v3-*.e2e.ts` d'`e2e.config.ts`) |
| `e2e/army/local/engine-v3-editor-support.ts` | Préalables (propriétaire, v3, section, lignes par lot), mode Expert, préréglage « Standard », lectures d'écran et d'API, relevé `checkpoint` |
| `scripts/tester-army/army-impact-map.json` | Parcours ajouté à `suite.journeys`, aux groupes `editor`, `affaires-list`, `print` et à la règle `estimate-detail` |

```bash
# WSL, clone Linux ~/miaouffrage-lot2-26 (au plus deux exécutions natives possédées en parallèle)
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3E0"
# Windows ou WSL
npx vitest run --project=node src/test/army-impact-map.test.ts
```

## 2. Scénarios et défaillances observables

`V3E-nn` = scénario n du §14 « 2.6 » de la conception (11 : présélection, demandée en plus). Les `F26-xx` sont
ceux de [estimate-engine-v3-2.6.md](estimate-engine-v3-2.6.md) §2.

| Id | Scénario (§14) | Défaillance observable | F26 | Parcours |
|---|---|---|---|---|
| V3E-01 | 7 lignes **par la grille** (désignation, U, Q, PR FO, h/u) ; PU O1 166,63 € ; 1,3 / 1,3 → 174,59 € | l'éditeur ne s'ouvre pas sur une v3 (bandeau 2.1) ; PU, PT, heures totales ou totaux ≠ §5.1 / S1 ; « h MO total » saisissable ; aide « heures totales de la ligne » en v3 ; marge v2 « 0% » au pied | 11, 14, 15, 16 | V3E01 |
| V3E-02 | coefficient FO vidé | 0 envoyé, ou ancienne valeur reprise sans message | 05 | V3E01 |
| V3E-03 | remise 1,01 € → 1,01 €, `discount_bp` 0 ; 10 % → 1 000 pb ; c_FO doublé → toujours 10 % | taux dérivé d'un montant, deux intentions, taux converti en montant en passant par le champ montant, remise appliquée qui ne suit pas le brut | 01, 02, 03 | V3E01 |
| V3E-04 | 500 € demandés sur une assiette de 400 € | montant demandé remplacé par l'appliqué ; « demandé / appliqué » absent | 04 | V3E02 |
| V3E-05 | TVA 20 → 10 % : dialogue ; « Non » garde 20 % ; « Oui » → 7 lignes à 10 % ; S5 : deux taux au pied | pas de dialogue ; « Non » touche les lignes ; « Oui » en oublie ; réglages et lignes en deux sauvegardes ; TVA ligne à ligne (1 325 527 c) ; un seul taux au pied | 07, 08 | V3E01 |
| V3E-06 | ligne de 500 € « Hors lot » → HT −500,00 € ; retour à « Chiffrée » → restaurée | ligne non chiffrée comptée ; saisies perdues au retour | 09 | V3E02 |
| V3E-07 | « ML » → « ml — mètre linéaire » ; une suggestion catalogue ne change pas l'unité | « ML » texte libre ou millilitre ; unité remplacée par la désignation ou par l'unité de l'article | 10 | V3E01, V3E03 |
| V3E-08 | Q d'une ligne avec heures doublée → MO et PT doublés | `h_mo` non dérivé, PT non proportionnel | 11 | V3E01 |
| V3E-09 | pas de « Barème par défaut » en v3 ; repère du barème d'entreprise non appliqué | barème codé en dur (×1,60) ou « barème par défaut est appliqué » affiché ; barème appliqué aux montants | 12 | V3E01 |
| V3E-10 | arrondi au pas de 100 € inférieur → S4 | arrondi traité hors remise HT, ajustement ≠ 0, modes `up`/`nearest` proposés | 13 | V3E01 |
| V3E-11 | présélection fournisseurs appliquée sur une v3 | lignes écrites sans recalcul (totaux périmés, « Totaux à synchroniser » : défaut v2 connu de 2.2), écriture partielle, bandeau générique du moteur 3 | 17 | V3E03 |

En plus (périmètre du §14 « 2.6 ») : fiche et impression du brouillon v3 sans bandeau (F26-15), dans V3E01.

## 3. Déroulé et valeurs attendues

Chaque relevé (`checkpoint`) se fait **après l'état sauvegardé** (Ctrl+S par `saveLineEditsWithShortcut` puis
`waitForAutoSave` pour la grille ; « Enregistrer le paramétrage » puis relecture API pour les réglages) et lit
trois fois : la valeur persistée (API), la valeur affichée par l'éditeur qui l'a sauvegardée, puis la valeur
affichée **et** relue par l'API après rechargement. Tolérance : 0 c. Preuves `recordEvidence` `v3e-*`.

### 3.1 `V3E01` (un brouillon v3, l'ancre v2 n'est jamais éditée)

1. Mode Expert ; éditeur ouvert sur la v3 (**premier rouge** avant 2.6) ; préréglage de colonnes « Standard ».
2. Les 7 lignes par la grille, une sauvegarde par ligne (O4 saisi « ML ») :

   | Ligne | U saisie → affichée | Q | PR FO | h/u | h MO total | PU | PT |
   |---|---|---|---|---|---|---|---|
   | O1 | ml → ml — mètre linéaire | 20 | 54,66 | 1,991 | 39,82 | 166,63 | 3 332,60 € |
   | O2 | u → u — unité | 3 | 95,63 | 1,75 | 5,25 | 208,32 | 624,96 € |
   | O3 | m2 → m2 — mètre carré | 21 | 58,50 | 0 | 0 | 76,05 | 1 597,05 € |
   | O4 | ML → ml — mètre linéaire | 1139 | 3,02 | 0,2 | 227,8 | 13,53 | 15 410,67 € |
   | O5 | u → u — unité | 1 | 20,00 | 6 | 6 | 314,00 | 314,00 € |
   | O6 | ml → ml — mètre linéaire | 282 | 91,86 | 0,998 | 281,436 | 167,32 | 47 184,24 € |
   | O7 | ml → ml — mètre linéaire | 8 | 8,83 | 1,30 | 10,4 | 73,88 | 591,04 € |

   S1 : HT 69 054,56 €, TVA 13 810,91 €, TTC 82 865,47 € ; API : `unit_code`, `pricing_status` `priced`,
   `h_mo_per_unit`, `h_mo` = Q × h/u, `pu_ht_cents`, net = PT, `tax_rate_bp` 2 000, rôle « Tuyauteur ».
3. Aide des colonnes : contient « h MO / u », pas « heures totales de la ligne ».
4. O5 à Q 2 : h MO total 12, PT 628,00 €, HT 69 368,56 € / TVA 13 873,71 € / TTC 83 242,27 € ; retour à Q 1 → S1.
5. Réglages sans barème d'entreprise : FO « 1,30 », MO « 1,20 », remises vides, TVA par défaut « 20 » ; aucun
   « barème par défaut » ni « ×1,60 ». FO vidé → refus explicite, 1,30 relu (API et champ).
6. MO 1,30 → PU O1 174,59 €, PT O1 3 491,80 €, HT 71 336,74 € / TVA 14 267,35 € / TTC 85 604,09 € ; MO 1,20 → S1.
7. Barème d'entreprise créé par l'API (0 € → ×1,15 ; 50 000 € → ×1,10) : repère « ×1,10 … non appliqué » pour un
   déboursé de 54 871,77 € ; montants S1 inchangés.
8. S2 (remise 1,01 €) : HT 69 053,55 €, TVA 13 810,71 €, TTC 82 864,26 €, remise −1,01 € ; API montant 101,
   `discount_bp` 0, appliqué 101, nets [333 255, 62 495, 159 703, 1 541 044, 31 400, 4 718 355, 59 103] ;
   « demandé 1,01 € / appliqué 1,01 € ».
9. S4 (arrondi 100 € inférieur) : options d'arrondi exactement `none`, `100`, `1000`, `5000`, `10000` ; HT
   69 000,00 €, TVA 13 800,00 €, TTC 82 800,00 €, arrondi commercial −53,55 €, `rounding_adjustment_cents` 0 ;
   retour à « Aucun » → S2.
10. S3 (10 %) : HT 62 149,10 €, TVA 12 429,82 €, TTC 74 578,92 €, remise −6 905,46 € ; API `discount_bp` 1 000,
    montant nul ; champ montant vide, champ taux « 10 ». c_FO 2,60, curseur passé par le champ montant : brut
    110 704,73 €, remise −11 070,47 €, HT 99 634,26 €, TVA 19 926,85 €, TTC 119 561,11 €, PU O1 237,68 €,
    toujours 1 000 pb. Retour à c_FO 1,30 et 1,01 € → S2.
11. TVA par défaut 20 → 10, « Non » : version 1 000 pb, 7 lignes à 2 000 pb, pied « TVA 20 % » seul (S2) ;
    10 → 20 : aucun dialogue (toutes les lignes ont déjà 20 %) ; 20 → 10, « Oui » : 7 lignes à 1 000 pb, TVA
    6 905,36 €, TTC 75 958,91 €.
12. S5 : O4–O7 remis à 20 % par la cellule « TVA % » : TVA 10 % 555,45 €, TVA 20 % 12 699,80 €, TVA 13 255,25 €,
    TTC 82 308,80 €, HT 69 053,55 € ; API bases 555 453 c (10 %) et 6 349 902 c (20 %).
13. Fiche `/dashboard/estimates/{id}` : sans bandeau, Total HT 69 053,55 €, Total TTC 82 308,80 € ; impression :
    sans bandeau, titre « Devis » (le pied v3 imprimé relève de 2.7).

### 3.2 `V3E02` (un brouillon v3, lignes posées par un lot)

Ligne A : 4 u, PR 76,92 €, h/u 0 → PU 100,00 €, PT 400,00 € ; ligne B : 1 u, PR 200,00 €, 5 h/u → PU 500,00 €.
Initial : HT 900,00 € / TVA 180,00 € / TTC 1 080,00 €. B « Hors lot » : HT 400,00 € (−500,00 €), TVA 80,00 €,
TTC 480,00 €, B net 0 et TVA 0, Q, PR et h/u conservés. B « Chiffrée » : 900,00 €, PT de B 500,00 €. B « Hors
lot » puis remise 500 € : brut 400,00 €, appliqué 400,00 €, HT, TVA et TTC à 0,00 €, montant demandé 50 000 c,
`discount_bp` 0, « demandé 500,00 € / appliqué 400,00 € ».

### 3.3 `V3E03` (un brouillon v3, une ligne posée par un lot)

Ligne L : 2 ml, PR 15,00 € → PU 19,50 €, PT 39,00 €. Article « … cuivre 22 » en « ML », offre A 15,00 € (API du
catalogue). Désignation saisie dans la ligne, suggestion appliquée par Entrée : article et offre A liés, unité `ml`
inchangée (« ml — mètre linéaire »), 39,00 € / 7,80 € / 46,80 €. Offre B 12,40 € ajoutée, présélection ouverte
(mode Expert), puis **exactement une** des deux issues (§4.6) :

| Issue | API | Écran après rechargement |
|---|---|---|
| recalcul persisté | PR 1 240, offre B, PU 1 612, net 3 224 ; 3 224 / 645 / 3 869 | PU 16,12, PT 32,24 €, HT 32,24 €, TTC 38,69 € |
| refus nommé | inchangée (`content_revision`, offre A, 3 900 / 780 / 4 680) | message du §4.6 dans le dialogue, « Appliquer la sélection » désactivé ; puis 39,00 € |

Dans les deux cas, jamais « Totaux à synchroniser ». La conception implique le **refus** (D16, P-14 : « mise à
jour groupée directe » refusée en v3 pendant le lot 2 avec un message nommé ; la présélection passe aujourd'hui par
`POST /api/estimates/{id}/items/bulk`). Le document 2.6 retient le **recalcul** (F26-17, choix), le refus nommé
en repli : le parcours admet l'un ou l'autre et consigne lequel (`v3e-preselection`).

## 4. Contrat d'écran

Libellés exacts après normalisation des espaces (espaces insécables et fines → espace) ; signe moins `−` ou `-`
indifférent ; apostrophe `’` ou `'` indifférente pour le message du §4.6 seulement. Montants au format
`formatCurrency` fr-FR (« 69 054,56 € »).

### 4.1 Éditeur ouvert sur une v3

Route `/dashboard/estimates/{id}/edit` : pas de `data-testid="estimate-engine-unavailable"` ni du texte
`ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE` ; titre « Éditer le chiffrage » (`h1`/`h2`) ; `role="grid"`
`aria-label="Lignes de devis"` ; `role="region"` `aria-label="Résumé du paramétrage"`. Restent tels quels (mode
Expert) : onglet « Affichage & contrôle » (`/^Affichage & contrôle(?: \d+)?$/`), `estimate-editor-display-button`,
bouton « Standard », `estimate-columns-help-button`, `estimate-columns-help-panel`, « Fermer l’aide des colonnes »,
`estimate-page-toolbar-autosave-status` (« En attente », « Synchronisation… », « Sauvegardé », « À jour »), Ctrl+S.

### 4.2 Grille v3 (préréglage « Standard », mode Expert)

Ajout de ligne : bouton « Ajouter dans {titre de section} » puis `estimate-section-add-line-button`
(`POST /api/estimates/{id}/items` → 201 `{item}`). Ligne : `data-estimate-item-id="{id}"`, champ titre
`data-testid="estimate-line-title-input"` (combobox des suggestions du catalogue). Contrôles par leur
`aria-label`, `{t}` = titre de la ligne :

| Contrôle | `aria-label` | Saisie | Affichage |
|---|---|---|---|
| Unité (référentiel) | `Unité pour {t}` | texte ; un alias unique validé par Tab (« ML », « m2 ») | après validation, valeur du champ `{code} — {libellé en minuscule}` : « ml — mètre linéaire », « u — unité », « m2 — mètre carré » ; `unit_code` = code |
| Quantité | `Quantité pour {t}` | inchangé | inchangé |
| PR FO | `Prix d’achat unitaire HT pour {t}` | inchangé (Ctrl+S depuis ce champ) | inchangé |
| h MO / u | `Heures de main-d’œuvre par unité pour {t}` | 4 décimales au plus, virgule | — ; écrit `h_mo_per_unit`, jamais `h_mo` |
| h MO total | `Heures de main-d’œuvre totales pour {t}` | **lecture seule** (pas d'`input` modifiable) | Q × h/u, fr-FR, 0 à 3 décimales (« 39,82 », « 281,436 », « 0 ») |
| Rôle MO | `Rôle de main-d'œuvre pour {t}` | combobox existante (nom unique + Tab) | inchangé |
| Statut | `Statut de chiffrage pour {t}` | `<select>`, valeurs = `estimate_line_pricing_status` | libellés : `priced` « Chiffrée », `out_of_scope` « Hors lot » (exigés) ; proposés : `included` « Inclus », `for_memory` « Pour mémoire », `not_priced` « Non chiffrée », `not_applicable` « Sans objet » |
| TVA % | `Taux de TVA pour {t}` | `<select>`, valeurs en pb (`2000`, `1000`, `550`, `210` : taux de la politique) | `select.value` = pb de la ligne |
| PU | `Prix de vente unitaire HT pour {t}` | lecture seule | PU v3 publié, 2 décimales (« 166,63 ») |
| PT | cellule `[data-estimate-column="total_price"]` de la ligne | — | brut ⌈Q × PU⌋ (« 3 332,60 € ») pour une ligne chiffrée ; libre pour une ligne non chiffrée |

L'éditeur v2 garde ses contrôles (`Heures de main-d’œuvre pour {t}` saisissable) ; ils n'apparaissent pas en v3.

### 4.3 Pied « Résumé du paramétrage » (mode Expert)

Boutons de la région, lus par `aria-label` (sinon texte). Chaque relevé exige la présence exacte de :

- `Total HT : {HT net}` ; `TVA : {TVA totale}` ; une entrée `TVA {taux} % : {T_r}` par taux présent (« TVA 20 % »,
  « TVA 10 % », taux fr-FR « 5,5 ») ; `TTC à payer : {HT + TVA}` ;
- `Remise commerciale : −{appliquée}` dès qu'une remise est appliquée ;
- `Arrondi commercial : −{A}` dès qu'un arrondi commercial est appliqué.

Interdits : `Marge : 0%` (marge v2 d'un multiplicateur ×1) ; toute entrée `TVA {r} %` d'un taux absent des lignes
chiffrées (après « Non » : pas de « TVA 10 % » ; après « Oui » : pas de « TVA 20 % »). L'ordre est libre ; une
autre entrée (coefficient réalisé, brut) est admise.

### 4.4 Réglages v3 (tiroir `role="dialog"` « Paramétrage du devis »)

Ouverture : `/dashboard/estimates/{id}/edit?openSettings=general` ; enregistrement : bouton « Enregistrer le
paramétrage » (inchangé). Champs par libellé exact (`getByLabel`) :

| Libellé | Contrat |
|---|---|
| `Coefficient de vente FO`, `Coefficient de vente MO` | valeur fr-FR, 2 décimales au moins (« 1,30 ») ; vidé puis Tab → `aria-invalid="true"` et un texte visible commençant par « Coefficient de vente FO obligatoire » (message proposé par le doc 2.6 §1.2) ; aucune écriture (bouton désactivé, ou sauvegarde refusée) ; rechargement → « 1,30 » |
| `Remise (EUR HT)` | intention en montant ; vide si l'intention est un taux ; le quitter sans saisie ne change rien |
| `Remise (%)` | intention en taux (« 10 ») ; vide si l'intention est un montant |
| `TVA par défaut des nouvelles lignes` | taux de version fr-FR (« 20 ») |
| `Arrondi` | `<select>`, options exactement `none`, `100`, `1000`, `5000`, `10000` (aucun « Réglage conservé », ni `up`/`nearest`) |

Les deux champs de remise sont visibles ensemble, sans sélecteur de mode (doc 2.6 §1.2) : une saisie valide dans
l'un remplace l'intention de l'autre.

- `data-testid="estimate-v3-discount-applied"` : texte contenant `demandé {M} / appliqué {R}` pour un montant
  (« demandé 1,01 € / appliqué 1,01 € », « demandé 500,00 € / appliqué 400,00 € ») et `appliqué {R}` pour un taux.
- `data-testid="estimate-v3-margin-tier-hint"` : avec un barème d'entreprise, texte contenant `×{k}` (fr-FR, deux
  décimales : « ×1,10 ») du palier atteint par le déboursé, et « non appliqué ». Sans barème d'entreprise, ni
  « barème par défaut » (casse indifférente) ni « ×1,60 » dans tout le tiroir.
- Dialogue de propagation : `role="alertdialog"`, nom `Appliquer ce taux à toutes les lignes ?`, boutons « Oui » et
  « Non ». **Choix** : il s'ouvre au clic sur « Enregistrer le paramétrage » quand le taux par défaut a changé
  **et** qu'au moins une ligne porte un autre taux (doc 2.6 §1.3) ; rien n'est envoyé avant la réponse ; « Oui »
  envoie `apply_tax_rate_to_lines: true` dans la même sauvegarde, « Non » n'envoie que le taux de version.

### 4.5 Fiche et impression d'un brouillon v3

`/dashboard/estimates/{id}` : sans bandeau, `dt` « Total HT » et « Total TTC » suivis des montants stockés.
`/dashboard/estimates/{id}/print?price_mode=unit_and_total&detail_level=lines` : sans bandeau, titre « Devis ».

### 4.6 Présélection fournisseurs sur une v3

Entrée inchangée : onglet « Affichage & contrôle », `estimate-editor-display-button`,
`estimate-editor-supplier-preselection-button` (activé), dialogue `role="dialog"` « Présélection fournisseurs »,
case `Sélectionner {titre de ligne}`, bouton « Appliquer la sélection ».

- **Recalcul persisté** (F26-17, choix du doc 2.6) : seuls `unit_price_ht_cents` et `selected_supplier_price_id`
  partent par l'écrivain v3 ; totaux et lignes relus égalent le §3.3.
- **Refus nommé** (repli) : avant toute écriture, le dialogue affiche exactement
  « La présélection fournisseurs n’est pas disponible pour un devis au moteur de calcul 3. » (**Choix** du texte ;
  code `ESTIMATE_V3_SUPPLIER_PRESELECTION_UNSUPPORTED` si une route répond) et « Appliquer la sélection » est
  désactivé ; `content_revision` inchangée.
- Échecs : lignes écrites avec totaux périmés, écriture partielle, bandeau générique
  `ESTIMATE_ENGINE_UNAVAILABLE_MESSAGE`, ni l'un ni l'autre en 60 s.

## 5. Contrat d'API

| Route | Usage par le parcours | Attendu |
|---|---|---|
| `POST /api/estimates` | ancre v2 puis v3 avec `version.expected_calc_engine_version: 3` (politique 3) | 201 ; v3 à 1,30 / 1,20 (contrat 2.5) |
| `POST /api/estimates/{id}/lock`, `POST …/items` (section), `POST …/batch` (lignes de V3E02, V3E03) | préalables | contrat 2.5 (§9.3.2 du doc 2.5) |
| `POST /api/estimates/{ancre}/labor-roles` | « Tuyauteur » 4 000 c/h | 201 |
| `POST /api/margin-tiers` | `{threshold_cents, multiplier, position}` (deux paliers) | 201 |
| `POST /api/products`, `POST /api/suppliers`, `POST /api/prices` | `action: "create"` : article `unit: "ML"`, fournisseurs A et B, offres A (15,00 €, « ML ») et B (12,40 €, « ml ») avec SKU, quantité minimale 1, EUR, validité du jour (chemin de `bulk-edit-sync-sources`) ; lectures catalogue de l'affaire autorisées (`ownedPriceLookupProjects`) | 201 `{item}` ; offre : `{id, product_id, supplier_id, unit_price_cents}` |
| `GET /api/estimates/{id}` | toutes les relectures (409 `VERSION_CONFLICT` d'une lecture pendant une sauvegarde relu, comme `waitForAutoSave`) | `version` : `total_*`, `gross_ht_cents`, `discount_applied_cents`, `commercial_rounding_cents`, `rounding_adjustment_cents`, `sale_coefficient_fo/mo`, `discount_bp`, `discount_amount_cents`, `tax_rate_bp`, `rounding_mode`, `rounding_step_cents`, `content_revision` ; `items[]` : `unit_code`, `pricing_status`, `quantity`, `unit_price_ht_cents`, `h_mo_per_unit`, `h_mo`, `pu_ht_cents`, `line_total_ht_cents`, `line_tax_cents`, `tax_rate_bp`, `labor_role_id`, `product_id`, `selected_supplier_price_id`, `title` |

Écrits **par l'éditeur** (aucun appel direct du parcours) : lignes par la sauvegarde de la grille (lot v3 de 2.5),
réglages par `PATCH /api/estimates/{id}` (charge du doc 2.6 §1.2). Les colonnes numériques sont comparées après
`Number()`.

## 6. Origine des attendus

PU, bruts, déboursé et totaux S1 à S5 : conception §5.1 et §5.2 (CAP, T-STAT, EUHIST : §5.3, transposés). États
intermédiaires (1,3 / 1,3, O5 à Q 2, c_FO 2,60 à 10 %, S2 à 10 %, V3E02, V3E03), nets par ligne et bases par taux :
moteur pur 2.4 (`computeEstimateV3Breakdown`, 40 €/h), dont les totaux égalent la conception là où elle les donne.
La grille tire des `id` au hasard, or D13 départage les ex aequo par `id` croissant : un script hors dépôt a rejoué
chaque état sur les **5 040** ordres d'`id` des 7 lignes. Totaux, bases par taux et nets par ligne n'en dépendent
jamais ; la TVA par ligne en dépend en S2 (O3, O7) et en S4 (O1, O2, O7) : le parcours ne l'asserte donc que par
taux (`taxByRate`), jamais ligne à ligne.

## 7. Hypothèses, choix, limites

- **Un brouillon par parcours** (verrou d'édition) : trois parcours, chacun avec son propriétaire, son ancre v2 non
  éditée et sa v3. CAP et T-STAT ont leur propre brouillon (V3E02) plutôt qu'une assiette construite dans l'oracle.
- **Mode Expert** et préréglage **Standard** (rôle MO visible) : le contrat du §4.2 et du §4.3 vaut dans ce mode ; le
  mode simplifié n'est pas qualifié ici (la présélection y est masquée).
- **MO doublée (V3E-08)** : la grille v3 n'affiche pas de MO en € par ligne ; le parcours asserte les heures totales
  et le PT (exacts, Q entier), la répartition FO/MO étant prouvée par le gel de 2.5 et le moteur 2.4.
- **Impression** : seulement l'absence de bandeau ; le pied v3 imprimé, la remise et la TVA par taux sont de 2.7.
- Les messages exacts imposés sont ceux du §4 ; « Coefficient de vente FO obligatoire… » reprend la proposition
  du doc 2.6 ; le texte du refus de présélection est un choix de ce document.
- `V3P-06` (`engine-v3-persistence.e2e.ts`) et le volet éditeur et fiche de `V3FC` (`engine-v3-fail-closed.e2e.ts`)
  attendent encore le bandeau sur l'éditeur et la fiche d'une v3 : ils deviennent faux par construction en 2.6
  (doc 2.6 §1.4) et se réécrivent avec l'implémentation, pas dans ce rouge.
- Durée : V3E01 a un délai de 15 min (7 sauvegardes de ligne, 11 relevés avec rechargement, une quinzaine
  d'ouvertures du tiroir), V3E02 et V3E03 7 min ; à mesurer au vert dans la campagne critique (`maxDuration`
  30 min, deux workers).

## 8. Preuve rouge (17/10/2026)

WSL Ubuntu 24.04, Node 24.14.0, TesterArmy `e2e` 0.21.0, clone `~/miaouffrage-lot2-26` remis à `2338757a`
(`git reset --hard` sur la branche, diff local vide : `diffSha256` `e3b0c442…b855`), au plus deux exécutions natives
possédées en parallèle (attente du verrou avant chaque lancement).

```bash
E2E_ARMY_WORKERS=2 NODE_OPTIONS=--max-old-space-size=4096 npm run e2e:army:local -- --grep "V3E0"
```

Sortie 1. En amont : 248 migrations, pgTAP `Files=19, Tests=1833, Result: PASS`, « Behavioral RLS matrix passed. »,
build passé. Parcours : configuration 1/1 ; **3/3 rouges pour la raison visée**, après des préalables réussis
(propriétaire dédié, ancre v2, « Tuyauteur », fenêtre de politique 3, v3 créée, section, lot de lignes pour V3E02 et
V3E03, article, fournisseur et offre A pour V3E03) :

```text
× V3E01 … 63.14s   × V3E02 … 64.62s   × V3E03 … 64.92s
ASSERTION_FAILED: the v3 editor opens instead of the 2.1 engine-unavailable banner:
expected {"banner":true,"heading":false,"grid":false,"summary":false}
to equal {"banner":false,"heading":true,"grid":true,"summary":true}
 ❯ e2e/army/local/engine-v3-editor-support.ts:212:86
 ❯ at http://localhost:3107/dashboard/estimates/<v3>/edit
```

Archive : `.e2e/army/ci/2026-10-17T19-08-52-516Z-critical/` du clone WSL (manifeste : `failed`,
`filtered-critical`, `grep: V3E0`, 2 workers, révision `2338757a`, confidentialité `passed` ; SHA-256 du manifeste
`418a172dc56f78efd8c7ad0a02763a2360b86ca48a07c47f620b879e649908c6`). Preuves `v3e-*-editor-open`, sous
`critical/runs/2026-10-17T19-10-00-180Z/artifacts/business/` :

| Parcours | v3 | SHA-256 |
|---|---|---|
| V3E01 | `b1c6d8b8-cf69-40b4-8834-4342dcf66e2c` | `af4ce68571fbc62084a5fd0859b710f5415926987726a29cbb166f6ddb764b6c` |
| V3E02 | `13c8ff5c-82ca-40f3-aace-707126eb2cda` | `206e53c953eceec96bb4a1492107eedcd803a72b3768ab0528fab1241e4b0b4c` |
| V3E03 | `2849d99e-dedd-435e-af4e-426942fc7469` | `dcebc40b7652438eef52bae04e84ed88bad4f8d597bf2c49e97f2faa9d35dafb` |

Deux essais précédents échouaient au **préalable**, pas sur l'éditeur, et ne comptent pas comme rouge :
`2026-10-17T18-58-33-251Z-critical` (`a09e2f25`) : motif de politique non ASCII refusé par
`setTenantCalcPolicy` (« Invalid tenant calc policy fixture input. »), corrigé par `b8db6f52` ;
`2026-10-17T19-03-15-370Z-critical` (`b8db6f52`) : V3E01 et V3E02 déjà rouges pour la raison visée, V3E03 arrêté par
`POST /api/prices` 400 (offre créée avec un nouvel article et un nouveau fournisseur), corrigé par `2338757a` (chemin
de `bulk-edit-sync-sources`).

Carte d'impact (Windows) : `npx vitest run --project=node src/test/army-impact-map.test.ts
src/test/ci-guardrails.test.ts` → 23/23. `npm run typecheck`, `npx eslint --max-warnings=0` sur les deux fichiers du
parcours et `npm run check:architecture` : sortie 0.

## 9. Au vert

La même commande, sans modifier une assertion : `V3E01`, `V3E02`, `V3E03` verts, issue de la présélection
consignée ; `V3P01` et `V3FC` réécrits (§7) ; carte d'impact verte ; `npm run verify:pr`.
