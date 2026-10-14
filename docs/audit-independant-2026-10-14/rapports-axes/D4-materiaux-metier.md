# D4 — Matériaux métier confrontés au modèle de l'application

Audit indépendant, axe D4. Date : 2026-10-14. Rédigé en français.

## Cadre et méthode

- **Copie figée auditée (R)** : `…/scratchpad/audit/snapshot/handoff-audit-independant/annexes/repository`. Tous les chemins ci-dessous sont relatifs à R.
- **Lecture seule.** Les classeurs ont été lus avec SheetJS (`XLSX.readFile(f,{cellFormula:true})`, formules `cell.f` et valeurs en cache), les PDF avec `pdfjs-dist` (texte regroupé par ligne), le `.docx` par `unzip -p word/document.xml`. **Aucune macro n'a été exécutée**, aucun fichier n'a été ouvert dans Excel ou LibreOffice, et aucun accès réseau n'a eu lieu.
- **Rejeux de code.** Deux fonctions pures de l'application ont été transpilées par esbuild hors de R et rejouées : `src/lib/estimates/clipboard.ts`, et `guessTargetFieldWithScore`, extraite telle quelle de `src/lib/mappings/server.ts:780-892`. La formule de ligne `computeEstimateLineValues` (`src/lib/estimate-calculations.ts:198-251`) a été recopiée à l'identique dans `repro/d4/oracle.js`.
- **Scripts** : `…/scratchpad/audit/repro/d4/` (`sheets.js`, `profile.js`, `values.js`, `pdftext.mjs`, `parse_debourse.js`, `fitcoef.js`, `oracle.js`, `paste_optima.mjs`, `import_guess.mjs`, `merge_extraits.mjs`). Données : `out/D4-extraits.json`.
- **Anonymisation.** Clients et projets sont désignés de façon générique. L'exemple du dossier `exemple chiffrage OPTIMA/` est appelé « projet A ». Ses fichiers sont cités sous la forme `[préfixe] - …`, le préfixe client étant masqué. La DPGF de `exemple demande DPGF client/` est appelée « client B ». Aucun nom de personne, téléphone, adresse ou e-mail n'est reproduit.
- **Valeurs du porteur.** Tous les taux, coefficients et ratios cités viennent du porteur. Aucun n'est présenté comme une norme du BTP.

### Inventaire : ce que sont réellement les matériaux

| Fichier (R) | Nature réelle | Contenu exploitable |
|---|---|---|
| `docs/MM_bible_chiffrage_hydraulique_V1.03.xlsm` | Base article/prix/temps par matériau et par DN. Un seul kit prototype. Macro VBA présente, non exécutée. | 1 239 articles consolidés dans `All_data`. Méthode MO par pouce-diamètre. Blocs « FO/ml » à coefficients codés en dur. |
| `docs/prd_file/devis_vierge_v1.xlsx` | Gabarit de devis **sans aucune formule** (0 formule) | Colonnes du devis cible, 6 catégories de MO sans taux, texte des « cibles » de coefficient |
| `docs/prd_file/MM_BDC_V1.2.csv` + `explication BDC V1.1.docx` | **Base de chiffrage** (PR FO, K FO, h MO, K MO, PV). Ce ne sont **pas des bons de commande.** | 537 articles avec h MO par article et pouces de soudure ; formule de PV décrite |
| `docs/prd_file/MM_appro.xlsm` | Outil d'approvisionnement magasin (macro non exécutée) | Colisages, longueurs de barres, ratios de raccords et de brasure (cuivre frigorifique), majorations |
| `exemple chiffrage OPTIMA/[préfixe] - DPGF HYDRAULIQUE.xlsx` / `… PLOMBERIE.xlsx` | Export tableur du chiffrage du projet A | PR FO, temps, coefficients globaux 1,3/1,3, taux 40 €/h |
| `… - Déboursé détaillé HYDRAULIQUE.pdf` / `… PLOMBERIE.pdf` | Édition du logiciel de chiffrage source : ouvrages décomposés en articles | Px public, K Acc, code remise, temps, k MO, type MO, PR, PV, pv/pr |
| `… - DPGF HYDRAULIQUE.pdf` / `… - DPGF PLOMBERIE MC.pdf` | **Offres remises** (PU et PT) | PV réellement proposés, coefficients différents de ceux du xlsx (D4-02) |
| `exemple demande DPGF client/HEX-DPGF-[…]-LOT4.xlsx` | Grille DPGF vierge d'un client (tuyauterie industrielle) | 166 lignes à chiffrer, 2 quantités et 3 prix unitaires par ligne |
| `docs/catalogues-metiers/plomberie-pilote.csv` | 12 articles rédigés pour le pilote, sans prix ni temps | Unités `m` / `u` |
| `docs/prd_file/Feuille de calcul sans titre.xlsx` | Notes personnelles | **Contient des secrets apparents** (D4-20) |

---

## 1. Conventions de chiffrage du porteur (question 1)

### 1.1 Structure du déboursé

Les sources concordent sur une structure **FO + MO**, mais avec trois niveaux de coefficients distincts :

1. **Coefficient sur la fourniture, côté coût.**
   - Dans le projet A, le déboursé détaillé donne `PR FO = Px public × (1 − remise selon un code) × K Acc`. Par exemple : tube acier T10 DN125 à 34,70 € de prix public, K Acc 1,75, PR FO 54,66 € ; vanne papillon DN125 à 125 €, K Acc 2,25, PR FO 95,625 €.
   - K Acc varie de 1 à 4,38 selon l'article (mode à 1).
   - Dans la bible, l'onglet `Infos!A3` le formule ainsi : « les coefficients K Fo notés en base intègrent les éléments liés (colle PVC, boulonnerie vanne, masques soudure,…) ». Mais **aucun K FO n'est renseigné** dans la bible (D4-12).
2. **Coefficient sur la MO, côté coût (difficulté ou rendement).**
   - Dans le projet A, le temps unitaire inclut déjà un coefficient « k ». Exemple : 1,991 h/ml = 1,1 h × 1,81 pour le tube T10 DN125. Le k varie de 1 à 3,38.
   - La bible ne le renseigne pas : `Infos!A4` reste une phrase inachevée, « Les coefficients K MO sont à ajuster en fonction de: ».
3. **Coefficient de vente, appelé « marge » ou « pv/pr ».**
   - Le gabarit (`explication BDC V1.1.docx`) écrit « PV FO = H × J × marge » et « PV MO = L × N × marge », la marge étant gérée « hors tableau ». Remarque : la formule de PV MO omet le taux horaire (D4-15).
   - Projet A : 1,30 sur le déboursé total dans le xlsx et le déboursé PDF ; **1,30 sur la FO et 1,20 sur la MO** dans les offres remises (D4-02).

**Frais généraux, frais de chantier, bénéfice et aléas.** Aucune ligne FC, FG ou B&A n'apparaît, ni dans le projet A ni dans le gabarit : ces frais sont implicitement absorbés par le coefficient. Les prestations annexes (études d'exécution, DOE, essais, échafaudage, SPET, formation) figurent en lignes du chapitre « Divers ». Dans l'exemple, elles ne sont pas chiffrées : unités `CP`, `NC`, ou `ens` sans prix.

### 1.2 Main-d'œuvre : catégories et taux

| Source | Catégories | Taux |
|---|---|---|
| `devis_vierge_v1.xlsx` `Renseignement!A11:D17` | Tuy (tuyauteur), Plb (plomberie), Cal (calorifugeur), Vig (vigie), Sup (superviseur, chef de chantier), Enc (encadrant : conducteur, chargé d'affaires) | Cellules €/h **vides** |
| Bible, colonne `Type MO` | `Sou` (soudure), `Cal` / `cal` (la casse varie) | Aucun |
| `MM_BDC_V1.2.csv` | `Sou`, `Cal`, `Ele` | Aucun ; « taux horaires par type MO … gérés hors tableau » (docx) |
| Projet A, déboursé PDF | `P1`, `P2` (hydraulique), `P5`, `P2` (plomberie) | **40 €/h pour toutes les catégories** : rapport (PR − PR FO) / tps égal à 40 sur 636 + 38 + 656 + 2 articles |
| Projet A, xlsx | Une seule colonne de taux | `O2 = 40`, `N2` (majoration MO) = 0 |

Les codes de catégorie diffèrent d'un matériau à l'autre et ne sont jamais rapprochés. L'encadrement, la vigie et la supervision n'apparaissent dans aucun chiffrage réel.

### 1.3 Coefficients de vente par tranche

`devis_vierge_v1.xlsx` `Renseignement!D8`, en texte libre à côté du libellé « Marge » : « cibles <100 000 1,6 ; <250 000 1,55 ; <500 000 1,5 ; <1 000 000 1,45 ; >1 000 000 1,4 ».

- **Coût ou prix ?** Le classeur ne contient aucune formule : rien ne le dit. Le seul texte formel, le docx BDC, applique la « marge » au coût (PR × K). L'application au coût est donc **probable**.
- **Quelle assiette pour la tranche ?** Déboursé ou PV, devis entier ou lot, barème global ou progressif : **non déterminé** (À vérifier auprès du porteur).
- **Ce que montre le projet A.** Aucune tranche n'est appliquée. Déboursé de 1 264 749 € en hydraulique (cible > 1 M€ : 1,4), mais coefficient global réellement remis de **1,2432**. Déboursé de 790 490 € en plomberie (cible 1,45), coefficient remis **1,2421** (`out/D4-extraits.json` → `oracle.lots`).

**Remise commerciale.** `Renseignement!A9:C9` : un montant en €, saisi sans formule.

### 1.4 Consommables, supportage, calorifuge, pertes

**Pertes**
- Bible, bloc « FO/ml distrib » : tube × 1,2. Formule : `DB_I4Lsoude!J255 = J2*1.2 + J21*0.3 + J61*0.15 + J101*0.2`.
- Projet A : 1,1 m d'article par ml de tube acier T1/T10 (`Déboursé HYDRAULIQUE.pdf` p.1 ; plomberie ligne 1332).
- Fonte SMU : 0,35 barre de 3 m par ml, soit 1/3 plus environ 5 %.
- Appro cuivre : « majo Cu 1,05 », « majo isol 1,1 » (`MM_appro.xlsm cuivre_isolant!C2:C3`).

**Accessoires et supportage**
- Bible, ratios au ml : 0,3 coude 90°, 0,15 té, 0,2 réduction, plus 0,2 manchon pour le serti (`DB_ILserti!J160`).
- « LT » × 1,6 et « + supp » × 1,3 (`DB_I4Lsoude!K255`, `M255`, `N255`).
- Projet A : K Acc par article.

**Consommables**
- `DB_conso` liste 108 articles (gaz, électrodes, abrasifs, EPI…), dont **4 seulement ont un prix** (boulonnerie au prix /100 × 1,05). Aucun ratio de consommation n'y figure.
- Projet A : consommables intégrés aux ouvrages composés. Pour le calorifuge d'eau glacée par ml : toile de verre 0,04 rouleau et enduit 0,1 kg.
- Appro : brasure en kg = Σ métré × coefficient par diamètre (0,04 à 2,5), sacs = kg / 35 (`cuivre_isolant!AH8:AI8`).

**Calorifuge**
- Bible : en ml, avec le périmètre extérieur `π(D+2e)/1000` stocké dans la colonne « Commentaire » (`DB_caloC!P22`, `DB_caloF!P3`), et la tôle d'habillage en kg : `ROUNDUP(périmètre × 0,62 ; 2)` (`DB_caloF!R155:R167`).
- `MM_BDC_V1.2.csv` : en m², la `Qte` portant le m²/ml.
- Projet A : en m², traité en **fourniture seule** (« CALORIFUGE », K Acc 1,30, aucune heure), ou en ml pour les manchons.

### 1.5 Temps unitaires et rendements par diamètre et matériau (bible)

**Méthode « pouce-diamètre » (`DB_I4Lsoude`, `DB_T10`)**
- La colonne `soudure (")` donne le nombre de pouces de soudure par pièce, calculé sur le diamètre extérieur / 25,4. Exemples : coude DN15 = 2 × 0,84 = 1,68 ; tube = 1 soudure tous les 6 m, soit 0,14 "/ml en DN15.
- La colonne `h / "` donne les heures par pouce selon le DN : 0,80 en DN15 jusqu'à 0,36–0,41 en DN100–DN300 (`DB_I4Lsoude!Q2:Q15`).
- Couverture : **14 valeurs h/" seulement**, toutes sur le tube inox soudé. `DB_T10` porte des pouces et un nombre de passes, mais aucun h/".

**Heures par pièce**
- `DB_ILserti` : 36 valeurs de 0,38 à 1,35 h, toutes marquées « MO à verif ».
- `DB_Rob` : 6 valeurs de 0,23 à 0,34 h.
- `DB_caloC` : 10 valeurs de 0,25 à 0,8 h.
- `DB_FRIAPHON` : 2 valeurs, 0,85 et 1,1 h/ml « yc racc / sans support ».
- Total : **54 h MO sur 1 239 articles**.

**Version antérieure (`MM_BDC_V1.2.csv`)** : h MO par article (tube inox DN15 0,75 h/ml, coude DN15 0,65 h) et colonne « soud(pou) ». Ces valeurs contredisent la bible (D4-15).

**Kit (`kit!A4:T8`)** : parent/enfants avec `XLOOKUP` dans `All_data`, un seul kit prototype, et des défauts (D4-10, D4-22).

### 1.6 Unités

| Source | Unités observées |
|---|---|
| Bible | `ml`, `U` et `u` (casse variable), `kg`, `Bout.`, `Pot`, `Bid.`, `Rl.`, `Bob.`, `Jeu`, `Kit`, `Pqt`, `Paire`, `Bte`, `Lot`. Des libellés de bloc (`DN15`…`DN200`) apparaissent aussi dans la colonne Unité (`DB_I4Lsoude!I255:I266`). |
| `MM_BDC_V1.2.csv` | `ml`, `U`, `m²` |
| DPGF du projet A | `ens`, `U`, `u`, `ml`, `m2`, plus des **statuts placés dans la colonne unité** : `HL` (hors lot), `inc`, `NC`, `PM`, `CP`, `SO` |
| Articles du déboursé | `m`, `m²`, `u`, `U`, `ens`, `kg`, `roul.` |
| DPGF client B | `ml`, `u`, `ens`, `"` (pouce de soudure) |
| Appro, colisage | texte libre : `100`, `1000`, `50m`, `4m`, `5m`, `50kg`, `10b`, `à voir` |

### 1.7 Arrondis

| Source | Règle observée |
|---|---|
| Projet A, xlsx | `F = ROUND(D*E;2)` avec un PU `E` **non arrondi** ; TVA = `ROUND(F2947*20/100;2)` sur le total (`Feuil1!F2948`) |
| Projet A, déboursé PDF | PV d'un ouvrage composé = Σ des PV de sous-articles **déjà arrondis**. Les PR FO sont tenus à plus de 2 décimales (95,625 €). |
| Offres PDF | PU affiché arrondi, PT = arrondi(Q × PU non arrondi) |
| Bible / appro | `ROUNDUP(…;2)` sur le kg de tôle ; `ROUNDUP(ratio × métré;0)` sur les raccords, soit un arrondi à l'entier supérieur |

---

## 2. Projet A : DPGF, déboursé détaillé et offres (question 2)

### 2.1 Structure des colonnes

**xlsx (`Feuil1`, en-tête ligne 1)** :
`N° | Désignation | Uté | Qté | Prix Unitaire | Prix Total | PR Fourniture unitaire | PR Total fourniture | Tps pose unitaire | Tps pose unitaire majoré | Tps pose total | Coeff FO | Coeff MO | Majoration MO | Taux horaire`.

Paramètres globaux en ligne 2 : `L2 = 1,3`, `M2 = 1,3`, `N2 = 0`, `O2 = 40`.

Formules appliquées à toutes les lignes (2 937 en hydraulique) :
- `E = (G*$L$2) + (J*$M$2*$O$2)`
- `J = I + I*$N$2`
- `H = D*G`
- `K = D*J`
- `F = ROUND(D*E;2)`

**Déboursé PDF.** La ligne DPGF est suivie de ses articles :
`Désignation | Uté | Qté (par unité de la ligne) | Px public | PR Fourniture unitaire | PR total | K Acc | Marque | Référence | Code remise | Type FO | Tps pose | Tps total | k | Type MO | PR unitaire | PR total | PV unitaire | PV total | pv/pr | % pv`.

Le « % pv » est la part de la ligne dans le PV du lot.

**Offres PDF** : `N° | Désignation | Uté | Qté | Prix Unitaire | Prix Total`, avec sous-totaux et total HT.

### 2.2 Du déboursé au prix de vente

- **Déboursé unitaire** : `PR u = PR FO u + Tps u × 40`. Vérifié sur toutes les lignes du PDF (taux implicite de 40,00).
- **xlsx et déboursé PDF** : `PV u = PR u × 1,30` (pv/pr = 1,30 sur 892 articles ; 1,31 sur 15 par arrondi).
- **Offres remises** : `PU = PR FO × 1,30 + Tps × 40 × 1,20`. L'ajustement par moindres carrés donne `a = 1,30000`, `b = 48,0000 €/h`. **L'erreur maximale est de 0,6 centime** sur les 785 lignes hydraulique et les 656 lignes plomberie appariées (`repro/d4/fitcoef.js`).

### 2.3 Sous-totaux et totaux

- Hiérarchie `1 / 1.1 / 1.2 …`, sur 24 chapitres en hydraulique.
- Lignes « Sous-total … » par sous-chapitre, emboîtées (exemple : « Sous-total Distributions hydrauliques »).
- Total HT = somme explicite des sous-totaux de chapitre (`F2947 = F211 + F411 + … + F2944`).
- TVA 20 % sur le total, puis TTC.

| Total HT | xlsx (1,3 / 1,3) | Déboursé PDF | Offre remise | Déboursé sec (FO + h × 40) |
|---|---|---|---|---|
| Hydraulique | 1 644 173,89 | 1 644 263,38 | **1 572 275,75** | 1 264 749,07 (FO 545 767,95 ; 17 974,53 h) |
| Plomberie | 1 027 637,33 | 1 027 618,45 | **981 875,83** | 790 490,05 (FO 332 875,37 ; 11 440,37 h) |

### 2.4 Lignes-oracle (projet A)

Quantités et unités de la ligne DPGF. Prix en € HT. Les données complètes figurent dans `out/D4-extraits.json` → `oracle.lignes`.

| Id | Ligne (générique) | Q / U | PR FO u | h/u | Déboursé u | PV xlsx (1,3/1,3) : PU → PT | PV logiciel source : PU → PT | **PV offre (1,3 FO / 1,2 MO) : PU → PT** | Source |
|---|---|---|---|---|---|---|---|---|---|
| O1 | Tube acier noir T10 DN125. Px public 34,70, K Acc 1,75, k MO 1,81. | 20 ml | 54,66 | 1,991 | 134,30 | 174,59 → 3 491,80 | 174,59 → 3 491,80 | **166,63 → 3 332,52** | xlsx `Feuil1!A30:K30` ; PDF p.1 |
| O2 | Vanne papillon PN16 DN125. Px public 125, K Acc 2,25 → PR 95,625. | 3 U | 95,63 (95,625) | 1,75 | 165,63 | 215,319 → 645,96 | 215,31 → 645,93 | **208,32 → 624,96** | `A13:K13` ; p.1 |
| O3 | Calorifuge laine 50 mm, finition tôle isoxal, FO seule (45 × 1,30) | 21 m2 | 58,50 | 0 | 58,50 | 76,05 → 1 597,05 | 76,05 → 1 597,05 | **76,05 → 1 597,05** | `A35:K35` ; p.2 |
| O4 | Calorifuge EG, manchon 19×27 avec entoilage, ouvrage composé de 3 articles (isolant 1 m, toile 0,04 roul., enduit 0,1 kg) | 1 139 ml | 3,02 | 0,20 | 11,02 | 14,326 → 16 317,31 | 14,34 → 16 333,26 | **13,53 → 15 406,11** | `A718:K718` ; texte PDF l.2031-2034 |
| O5 | Pose seule d'une pompe double (fourniture par un tiers, 20 € de petites fournitures) | 1 U | 20,00 | 6 | 260,00 | 338,00 → 338,00 | 338,00 → 338,00 | **314,00 → 314,00** | `A20:K20` ; p.1 |
| O6 | Tube fonte SMU DN100, acheté en barre de 3 m (0,35 barre/ml) | 282 ml | 91,86 | 0,998 | 131,76 | 171,314 → 48 310,55 | 171,28 → 48 300,96 | **167,32 → 47 184,80** | plomberie `A986:K986` |
| O7 | Tube acier noir T1 DN40 avec 10 % de chute (1,1 m/ml) | 8 ml | 8,83 | 1,30 | 60,84 | 79,079 → 632,63 | 79,09 → 632,72 | **73,88 → 591,03** | `A29:K29` ; p.1 |

**Rejeu de la formule de ligne de l'application** (`oracle.js`, centimes entiers ; taux 40 €/h ; `h_mo` = Q × h/u) :

| Mapping | Paramètres | Résultat |
|---|---|---|
| **A** | `k_fo = 1`, `k_mo = 1`, marge fixe 1,30 | Reproduit le xlsx **au centime près sur les 7 lignes**. Écart avec le logiciel source : de −15,95 € (O4) à +9,59 € (O6). |
| A′ | `unit_price` = Px net, `k_fo` = K Acc | Sur O2 (4 250 c × 2,25), écart de +0,01 € seulement avec le logiciel source |
| **B** | `k_fo = 1,30`, `k_mo = 1,20`, marge 1,0 | Reproduit **exactement** les offres, mais le coût affiché vaut le PV : marque 0 % |
| C | marge 1,30, `k_mo = 0,923` (1,2 / 1,3 arrondi à 3 décimales par `numeric(12,3)`) | Écart de −0,02 à −1,12 € par ligne |
| A-bis | `h_mo` saisi **par unité**, comme dans tous les matériaux du porteur et comme l'annonce l'info-bulle | O1 : 1 524,69 € au lieu de 3 491,80 (**−56 %**). O4 : −72,5 %. O6 : −30 %. O7 : −75 %. (D4-01) |

---

## 3. DPGF du client B : grille vide à chiffrer (question 3)

Fichier `exemple demande DPGF client/HEX-DPGF-[…]-LOT4.xlsx`, feuille unique « PROJET - DPGF TUY INDUS », zone `A1:Q174`.

- **Titre et en-tête.** Titre en `A1`, en-tête en ligne 3 : `Description | Famille Achat | FO / MO | LOT | n° LOT | U | COMMENTAIRES STT | Qté Atelier | Qté Chantier | PU FO | PU MO Atelier | PU MO Chantier | TOTAL FO | Total MO Atelier | Total MO Chantier | TOTAL HT`.
- **Formules sur 170 lignes** :
  - `TOTAL FO = (Qté Atelier + Qté Chantier) × PU FO`
  - `MO Atelier = Qté Atelier × PU MO Atelier`
  - `MO Chantier = Qté Chantier × PU MO Chantier`
  - `TOTAL HT = SUM(M:O)`
  - Ligne 174 : `SUM(P4:P173)`
- **Contenu.**
  - 166 lignes. 101 en FOURNITURE (tubes, coudes, tés, réductions, brides, fonds bombés, embouts, unions, DN15 à DN300). 65 en MAIN D'ŒUVRE (soudures tube, soudures bride et piquages au **pouce** `"`, poses de vannes, robinetterie, supportage, radio 5 %, liaisons équipotentielles, essais, serrage, études).
  - Autres lignes : transport, levage, travaux en hauteur, 3 « Option », 4 « Réserve ».
  - Familles d'achat : Tube, Embout, Soudure, Robinetterie, Supportage, Radio, MAT, Frais annexe, Études, Transport, Manutention.
  - Une seule zone : « Data hall », lot 4.
- **Lignes à chiffrer.** **Aucune cellule de quantité ou de prix n'est saisie** (0 cellule renseignée en H:L). Le soumissionnaire doit fournir les quantités **et** les prix.
- **Conversion des soudures.** `Q102:Q115` : « 1 SOUDURE = 0,5'' » en DN15, 0,75'' en DN20, 1'' en DN25 … 12'' en DN300. Ce sont des **pouces nominaux** (DN/25). La bible utilise des pouces calculés sur le diamètre extérieur, soit 0,84" en DN15 (D4-05).
- **Défauts de la grille.**
  - Le total général inclut les Options 1 à 3 et les lignes « Réserve », qui seraient donc additionnées dès qu'on les chiffre.
  - Le titre mentionne « LOT05 » alors que le nom du fichier et la colonne indiquent le lot 4.
  - « Pose Vanne DN15…DN300 » est en `ml` (`F138:F151`).
  - Noms définis en `#REF!` et lien externe `[1]Autre!`.
- **Intérêt pour les tests d'import** : quantités doubles, trois PU par ligne, unité pouce, options incluses dans le total, lignes réserve vides.

---

## 4. Appro et « BDC » : conventions d'achat (question 4)

- **« BDC » ne désigne pas des bons de commande.** `MM_BDC_V1.2.csv` (31 colonnes : Trust FO/MO, ID, … PR. FO, K FO, h MO, K MO, PV.U. total, Prix total, soud(pou), F1 à F3) et son explication décrivent une **base de chiffrage**. Les conventions d'achat proprement dites se trouvent dans `MM_appro.xlsm`.
- **Demande à l'unité.** `plan` (ligne 3) : « Tout à l'unité, 1 rubber foot, 1 seule rondelle, mètre ».
  - Les fiches `HEX_appro` et `essai-1` portent : quantité demandée, quantité au magasin, quantité commandée, code interne, désignation, modèle, code produit, marque, spécification, **colisage**, stock mini et stock d'alerte.
  - Les colisages et stocks sont saisis en texte hétérogène : `100`, `1000`, `50m`, `150m`, `50kg`, `10b`, `80m`, `à voir`.
- **Longueurs de barres et de couronnes** (`HEX_appro`) :
  - cuivre 4 m jusqu'au 7/8", 5 m à partir du 1"1/8 (lignes 1235-1244) ;
  - couronnes de cuivre isolé de 25 ou 50 m, et de 20 m en bi-tube ;
  - PVC 4 m, IRL 3 m, câble acier 50 ou 150 m ;
  - projet A : fonte SMU en barre de 3 m.
- **Arrondis de quantité** (`cuivre_isolant`) :
  - raccords = `ROUNDUP(ratio × métré;0)`, avec 0,3 coude 90°/m jusqu'au 7/8" puis 0,2, et 0,25 coude 45° ou manchon/m ;
  - brasure en kg puis en sacs (kg / 35) ;
  - majorations Cu 1,05 et isolant 1,1, déclarées en `C2:C3` mais **utilisées par aucune formule**. Probablement exploitées par la macro, non auditée.
- **Conversion pose → achat.** Projet A : 0,35 barre par ml (fonte), 0,04 rouleau par ml (toile), 0,1 kg par ml (enduit).

---

## 5. Correspondance conventions → modèle de l'application (question 5)

Éléments du modèle (R) :
- `estimate_items` (`src/types/database.ts:2835`) : `quantity`, `unit_price_ht_cents`, `k_fo`, `h_mo`, `h_mo_majoration`, `k_mo`, split atelier/chantier, `labor_role_id`, `line_nature`. **Pas d'unité.**
- `labor_roles` (`:2496`) : `name`, `hourly_rate_cents`, `user_id`.
- `products` (`:231`) : `unit` texte, défaut `u`.
- `supplier_pricebook` (`:591`) : `unit`, `min_quantity`, `unit_price_cents`. Pas de prix public, de remise ni de colisage.
- `estimate_assembly_items` (`:2586`) : `k_fo`, `k_mo`, `h_mo`, `default_quantity`, `loss_coeff_bp`, `yield_*`.
- `margin_tiers` (`:2235`), barème par défaut dans `src/lib/estimates/margin-tiers.ts:9-13`.
- Formule de ligne : `estimate-calculations.ts:232-251`.

Légende : **T** = représentable tel quel ; **C** = représentable avec contournement ; **N** = non représentable.

| # | Convention du porteur (source) | Modèle de l'application | Verdict | Note |
|---|---|---|---|---|
| 1 | PR FO = Px public × (1 − remise par code) × K Acc (projet A) | `unit_price_ht_cents` × `k_fo` | **C** | Saisir le prix net et K Acc dans `k_fo` (mapping A′). Ni prix public ni remise par code dans `supplier_pricebook`. |
| 2 | **h MO par unité** (bible, gabarit, projet A, client B) | `h_mo` = **heures totales de la ligne** ; MO non multipliée par Q (`:232-236`) | **C** | Il faut saisir Q × h/u. L'info-bulle dit pourtant « par unité » (D4-01). |
| 3 | k MO de difficulté (projet A) | `k_mo` (cost side) | **T** | Sous réserve du point 2 |
| 4 | Taux unique de 40 €/h (projet A) | `labor_roles.hourly_rate_cents` | **T** | Rôles par utilisateur : à redéfinir pour chaque propriétaire d'affaire (regles-de-calcul §8.4) |
| 5 | 6 catégories de MO avec taux propres, dont encadrement, vigie et supervision (gabarit) | 1 rôle par ligne, ou 1 paire atelier/chantier | **C** | L'encadrement proportionnel aux heures n'a pas d'équivalent : il faut des lignes dédiées calculées à la main |
| 6 | Majoration MO additive (projet A : `J = I + I×N2`, 0 = neutre) | `h_mo_majoration` multiplicatif (1 = neutre) | **C** | Une valeur 0 importée annule la MO (D4-17) |
| 7 | Coefficient de vente unique sur le déboursé (1,30) | `margin_mode = fixed`, `margin_multiplier = 1,3` | **T** | Reproduit le xlsx au centime près (lignes O1 à O7, mapping A) |
| 8 | **Coefficient de vente FO 1,30 ≠ MO 1,20** (offres du projet A) | une seule marge, appliquée à FO + MO | **C (dégradé)** | Mapping B exact mais marque à 0 % ; mapping C : jusqu'à 1,12 €/ligne d'écart (D4-02) |
| 9 | 5 tranches « cibles » (gabarit) | `margin_tiers` du tenant, N paliers, sur le **coût total de la version**, palier global | **T** si l'assiette est le déboursé total du devis ; **N** si c'est le PV, un lot ou un barème progressif | Le barème par défaut (3 paliers) diffère (D4-04) |
| 10 | Remise commerciale en € (gabarit) | remise `simple` en centimes ou en bp | **T** | — |
| 11 | Pertes : 1,1 m/ml, 0,35 barre/ml, majorations 1,05 et 1,1 | Quantité ou `k_fo` ; `loss_coeff_bp` « remains for compatibility only » (migration `20260714134334`) | **C** | Pas de traçabilité de la perte |
| 12 | Consommables en ratio (brasure kg/ml, toile, enduit) | Composants d'ouvrage (`estimate_assembly_items`) | **C** | Aplatis à l'insertion, sans lien (regles-de-calcul §7) |
| 13 | Supportage +30 %, accessoires au ml (bible) | `k_fo` ou composants d'ouvrage | **C** | Arrondi à l'entier des raccords impossible (**N**) |
| 14 | Rendements par DN et matériau (h/" × pouces, bible) | Aucun paramétrage par DN ; ouvrages statiques | **N** | Contournement : un ouvrage figé par DN et par matériau (D4-05) |
| 15 | Unité de pose (ml, m², u, ens, kg, ", roul.) | Pas de colonne `unit` ; l'unité importée va dans `description` (`import-flow.ts:483`) | **N** | Déjà relevé : `docs/metier/ecarts-standards-btp.md` §1.2 |
| 16 | Statuts dans la colonne unité : HL, PM, NC, inc, CP, SO | `line_nature` (supply_only / supply_and_labor / labor_only) | **N** | Seul le texte est conservé |
| 17 | Unité d'achat ≠ unité de pose, colisage, barre, ROUNDUP (appro) | `products.unit` unique ; PO `unit` / `price_unit` en texte ; offre écartée si l'unité diffère (`supplier-offer-eligibility.ts:18-20`) | **N** | D4-07 |
| 18 | PT = ROUND(Q × PU non arrondi), PU affiché arrondi | coût et vente en centimes avec `Math.round`, PU recalculé (`bankersRound`) | **T** | Même incohérence PU × Q ≠ PT (D4-18) |
| 19 | PV d'un ouvrage composé = Σ des PV de sous-articles arrondis ; PR FO à 3 décimales (logiciel source) | une ligne = un coût ; centimes entiers | **C / N** | O4 : 15,95 € d'écart avec le logiciel source |
| 20 | TVA arrondie sur le total (xlsx) | v2 : TVA par ligne, `Math.round` | **C** | Écart de −11 et −10 centimes sur les deux lots |
| 21 | Ouvrage composé ou kit (bible, gabarit, déboursé) | `estimate_assemblies` (imbriqués) | **C** | Copie aplatie, non liée, sans paramètre |
| 22 | Qté atelier / Qté chantier et PU MO atelier / chantier (client B) | Split atelier/chantier **sur les heures**, quantité unique | **C partiel** | Pas de PU par lieu en sortie |
| 23 | Options et réserves dans la DPGF (client B) | Aucun type de ligne option ou variante relevé | **N** (à vérifier) | Le risque d'additionner les options est porté par la grille elle-même |
| 24 | Trois prix fournisseurs moyennés et score de fiabilité (bible, BDC) | `supplier_pricebook` multi-offres, une offre retenue | **C** | Ni moyenne ni fiabilité ; l'import ne garde que fournisseur, référence, désignation, prix et devise (D4-16) |
| 25 | Identifiant sensible à la casse (`I4S` soudé ≠ `I4s` serti) | `products.reference` unique **sans tenir compte de la casse** | **N** | 117 collisions (D4-10) |
| 26 | Calorifuge sous-traité en FO seule (projet A) | catégorie « Sous-traitance » + `line_nature` | **T** | — |
| 27 | Conversion du calorifuge de ml en m² (périmètre π(D+2e)) | Aucune conversion | **C** | Quantité convertie à l'avance (D4-21) |

---

## 6. Constats

Échelle de gravité : Critique / Élevé / Moyen / Faible.

### D4-01 — `h MO` : le porteur raisonne par unité, le moteur par ligne — **Critique, Confirmé**

**Preuve**
- Côté porteur, les heures sont unitaires partout :
  - bible : colonne « h MO » à côté de « PR. FO » unitaire ;
  - gabarit `devis_vierge_v1.xlsx Devis!A1:M1` ;
  - projet A : « Tps pose unitaire » (`Feuil1!I`) ;
  - client B : « PU MO ».
- Moteur : `moCostCents = hMoMajoration × hMo × taux × kMo`, puis `coût = round(Q × PU × kFo + moCostCents)` (`src/lib/estimate-calculations.ts:232-244`). La MO **n'est pas multipliée par Q**.
- Test de référence (`src/lib/estimate-calculations.test.ts:117-139`) : Q = 3 et h = 2,5 donnent une MO de 2,5 h seulement.
- **L'info-bulle de l'appli affirme l'inverse** : « h MO : Heures de main d'œuvre par unité » et « PU = (PR FO × K FO + h MO × K MO × prix horaire MO) × coefficient de marge » (`src/components/estimates/components/ColumnHeaderHelp.tsx:11,14,18,21`).
- L'import DPGF (`src/lib/affaires/import-flow.ts:450-453`, `h_mo` lu tel quel) et le collage copient la valeur telle quelle.

**Impact.** Saisir ou importer les temps du porteur sous-évalue la MO d'un facteur Q : O1 −56 %, O4 −72,5 %, O6 −30 %, O7 −75 %. Les ouvrages multiplient bien `h_mo` par le multiplicateur d'insertion (`20260722132425…:584`), ce qui crée deux sémantiques selon le chemin de saisie.

**Recommandation.**
1. Trancher la sémantique. L'unité correspond à tous les matériaux du porteur.
2. Aligner le moteur, l'info-bulle, l'import, le collage, les exports et les tests.
3. Ajouter O1 et O4 aux tests de référence.
4. Pour les devis existants, ne rien réécrire sans gouvernance : le moteur v2 fige les montants.

### D4-02 — Coefficients de vente FO et MO différenciés dans les offres réelles — **Élevé, Confirmé**

**Preuve.** Les offres remises du projet A respectent `PU = PR FO × 1,30 + h × 40 × 1,20` : l'ajustement est exact à 0,6 centime près sur 1 441 lignes (`fitcoef.js`). Le modèle n'a qu'une seule marge, appliquée à FO + MO (`:247`). `k_fo` et `k_mo` sont côté coût et apparaissent dans le déboursé sec et dans le barème.

**Impact**
- Mapping B : PV exact, mais la marque affichée tombe à 0 %. La règle `min_margin` bloquerait probablement l'envoi (à vérifier selon la configuration).
- Mapping C : PV faux de quelques centimes à 1,12 € par ligne, car `k_mo` est stocké en `numeric(12,3)`.

**Recommandation.** Faire valider par le porteur si les coefficients de vente FO et MO distincts sont la règle. Si oui, porter deux multiplicateurs de vente au niveau de la version (ou de la ligne), distincts de `k_fo` et `k_mo`.

### D4-03 — Quatre jeux de coefficients pour une même affaire ; les « cibles » ne sont pas appliquées — **Élevé, Confirmé (écarts) / À vérifier (intention)**

**Preuve.**
- xlsx : 1,3 / 1,3.
- Déboursé PDF : pv/pr 1,30.
- Offres : 1,30 / 1,20, soit un coefficient global de 1,2432 (hydraulique) et 1,2421 (plomberie).
- Gabarit : cible 1,4 pour plus de 1 M€ et 1,45 entre 500 k€ et 1 M€. Le texte est libre, sans aucune formule (`Renseignement!D8`).

**Impact.** Ni la base de coefficient (coût ou PV) ni l'assiette de la tranche (devis, lot, palier global ou progressif) ne sont établies. Configurer `margin_tiers` sur ces cibles aurait produit +12,6 % sur l'offre hydraulique réelle (1 770 649 € contre 1 572 276 €).

**Recommandation.** Faire écrire la règle par le porteur avant tout paramétrage, et ne pas prendre les cibles comme règle de calcul.

### D4-04 — Barème par défaut de l'appli ≠ cibles du porteur ; discontinuités — **Moyen, Confirmé**

**Preuve.** `margin-tiers.ts:9-13` (0 → 1,6 ; 100 k€ → 1,45 ; 1 M€ → 1,4) contre les 5 paliers du porteur.

| Coût total | Appli | Porteur |
|---|---|---|
| 150 000 € | 217 500 € | 232 500 € |
| 300 000 € | 435 000 € | 450 000 € |

À 100 000 € de coût, le PV chute : de 159 999,98 € à 145 000 € dans l'appli, à 155 000 € chez le porteur. Le palier est global (dernier seuil ≤ coût, `:56-59`).

**Impact.** Un tenant qui n'a pas configuré son barème chiffre entre 100 et 500 k€ avec 0,05 à 0,10 de coefficient de moins que les cibles. Le PV n'est pas monotone autour des seuils.

**Recommandation.** Paramétrer les paliers du tenant après D4-03, signaler la non-monotonie à l'utilisateur, et envisager un barème progressif si le porteur le confirme.

### D4-05 — Rendements par diamètre (« pouce-diamètre ») : non représentable, et deux conventions de pouce — **Élevé, Confirmé**

**Preuve**
- Bible : `soudure (")` est calculé sur le diamètre extérieur / 25,4 (coude DN15 1,68 = 2 × 0,84), avec 1 soudure / 6 m de tube. Le `h / "` dépend du DN (`DB_I4Lsoude!Q2:Q15`, `R2:R40`).
- Client B : « 1 SOUDURE = 0,5'' » en DN15, « 1'' » en DN25 (`Q102:Q115`), c'est-à-dire des pouces nominaux. L'écart de convention va d'un facteur 1,68 (DN15) à 1,12 (DN100).
- Couverture de la bible : 14 valeurs h/" (inox soudé uniquement), 54 h MO sur 1 239 articles. Rien pour l'acier T10, le multicouche ou le PVC.
- Appli : `estimate_assemblies` et `estimate_assembly_items` ne portent ni variable ni paramètre de DN ou de matériau. Pas d'unité « pouce ».

**Impact.** La bibliothèque paramétrée du porteur ne peut pas être importée comme telle. Appliquer les h/" de la bible aux pouces du client sous-estimerait la soudure de 12 à 68 %.

**Recommandation**
- Choisir explicitement la définition du pouce, OD/25,4 ou nominal, et la stocker.
- Ouvrir un chantier « bibliothèque paramétrée » : DN × matériau → temps et quantités.
- D'ici là, générer un ouvrage figé par couple DN/matériau.

### D4-06 — Unités : absentes de la ligne, perdues à l'import du catalogue, non normalisées dans les matériaux — **Élevé, Confirmé**

**Preuve.**
- Pas de colonne d'unité dans `estimate_items` (types `:2835-2884`) ; l'unité importée est rangée dans `description` (`import-flow.ts:483`).
- Import d'un tarif `mm_bdc` : `unit: null` (`src/lib/catalogue/csv-import.ts:957`), remplacé en SQL par `'u'` (migrations `20260714181641…:400`, `20260714181702…:120`). Un tube au ml devient « u ».
- Matériaux : variantes `U`/`u`, `ml`/`m`, `m2`/`m²` ; statuts HL, PM, NC, CP, SO, inc ; pouce `"`.

**Impact.** Les DPGF sortent sans unité fiable, les offres fournisseurs sont écartées (« Unité différente du devis »), et les PU unitaires sont mal interprétés.

**Recommandation**
- Ajouter l'unité à la ligne avec un référentiel normalisé (ml, m², u, ens, kg, pouce…).
- Séparer les statuts (HL, PM, NC, inclus, SO) de l'unité.
- Mapper la colonne `Unite` dans le profil `mm_bdc`.

### D4-07 — Conditionnement et unité d'achat : non représentables — **Moyen, Confirmé**

**Preuve**
- Côté porteur : barres de 3, 4, 5 ou 6 m, couronnes de 15 à 50 m, boîtes de 100 à 1 000, kg, ROUNDUP à l'entier (`MM_appro.xlsm`), 0,35 barre/ml (projet A).
- Côté appli : `supplier_pricebook` n'a ni colisage ni facteur de conversion. `min_quantity` est un minimum, pas un multiple. Les lignes de commande portent des quantités à 3 décimales et une unité en texte (`20261011091744…:7-13`), sans arrondi au conditionnement.

**Impact.** Les bons de commande issus des devis ne peuvent pas convertir des ml en barres, ni arrondir au colis.

**Recommandation.** Ajouter à l'offre fournisseur une unité d'achat, un facteur de conversion vers l'unité de pose et une règle d'arrondi (multiple, entier supérieur).

### D4-08 — Pertes, accessoires, supportage et consommables repliés dans un seul `k_fo` — **Moyen, Confirmé**

**Preuve**
- Côté porteur : × 1,2 tube, ratios d'accessoires au ml, × 1,3 supportage, × 1,6 « LT » (`DB_I4Lsoude!J255:N266`), majorations 1,05 et 1,1, K Acc de 1 à 4,38.
- Côté appli : `loss_coeff_bp` est « compatibility only » (migration `20260714134334_use_assembly_cost_coefficients.sql:2`), et le sous-détail est perdu à l'insertion (regles-de-calcul §7).

**Impact.** Ces facteurs sont représentables numériquement mais deviennent intraçables (aucune justification d'un `k_fo` de 2,25). Le sous-détail exigible en marché public n'est pas reconstituable.

**Recommandation.** Distinguer, au moins en métadonnées, perte, accessoires et supportage dans les composants d'ouvrage, et les conserver à l'insertion.

### D4-09 — Catégories de MO incohérentes entre matériaux ; encadrement non modélisable — **Moyen, Confirmé**

**Preuve.** Gabarit Tuy, Plb, Cal, Vig, Sup, Enc, sans taux ; bible Sou, Cal, cal ; BDC Sou, Cal, Ele ; projet A P1, P2, P5, tous à 40 €/h. Appli : 1 rôle par ligne, rôles rattachés à un utilisateur (`labor_roles.user_id`).

**Impact.** L'encadrement, la vigie et la supervision, en général proportionnels au volume d'heures, demandent des lignes calculées à la main. Les rôles sont à recréer pour chaque propriétaire d'affaire.

**Recommandation.** Fixer avec le porteur une table de catégories unique, et prévoir une ligne d'encadrement exprimée en % des heures si le besoin est confirmé.

### D4-10 — Identifiants sensibles à la casse : erreur dans le kit et collision dans l'appli — **Élevé, Confirmé**

**Preuve**
- La bible distingue `I4S` (soudé) et `I4s` (serti) : `MAJbase!H7:I7` « vbBinaryCompare : I4S <> I4s ». On compte **117 groupes, soit 234 identifiants**, qui ne diffèrent que par la casse (`DB_I4Lsoude`+`DB_ILserti` : 105 ; `DB_ILserti`+`DB_Rob` : 12).
- `XLOOKUP` ignore la casse. Le kit « serti » `kit!D4` (`K_I4Ls_FP_C`) récupère donc pour `Tub.I4s.15` les données du soudé : `kit!L5 = 3,365` (`All_data!J2`, 21,3×1,6) au lieu de 2,24 (`All_data!J308`, 18×1,0).
- Appli : index unique `products (tenant_id, reference_normalized)` insensible à la casse (migration `20260819205115_case_insensitive_product_reference.sql:118`).

**Impact.** Les prix du kit sont faux. À l'import dans l'appli, deux produits distincts fusionnent ou sont rejetés.

**Recommandation.** Renommer les identifiants du porteur (par exemple `I4SS` / `I4SR`) avant toute migration de données ; ne jamais s'appuyer sur la casse.

### D4-11 — Bible enregistrée sans recalcul : valeurs en cache incohérentes avec les formules — **Élevé, Confirmé**

**Preuve.** `xl/workbook.xml` : `<calcPr calcCompleted="0" forceFullCalc="1"/>`.

| Cellule(s) | Formule | Valeur en cache |
|---|---|---|
| `DB_MCserti!J132` | porte sur des cellules vides | 15 |
| `DB_MCserti!K132` | — | constante « #VALEUR! » |
| `DB_MCserti!J139:J140` | `#REF!` | 23 |
| `DB_caloC!E24:E35` | formules dérivées produisant « C4 », « C5 »… « C15 » | « C3 » |
| `DB_caloF!AI183` | `AH183 + J35` | 15, alors que `AH183` vaut 80,017 |

Nom défini `DonnéesExternes_1` = `All_data!A1:AF1027`, alors que les données vont jusqu'à la ligne 1 240.

**Impact.** Tout import par lecture des valeurs (ETL, SheetJS, import CSV exporté) ingère des valeurs fausses ou périmées.

**Recommandation.** Recalculer et valider le classeur avant export, et exporter des valeurs contrôlées (sans erreur, avec un contrôle de cohérence formule/valeur).

### D4-12 — K FO et K MO déclarés mais vides dans la bible — **Moyen, Confirmé**

**Preuve.**
- Colonnes `L` (K FO) et `O` (K MO) vides dans les onze feuilles `DB_*`. Quatre valeurs parasites dans `All_data!L1045:L1048` (32,5 à 39,2, sur du calorifuge froid).
- `Infos!A3:A4` : intention déclarée, phrase inachevée.
- Les seuls coefficients présents sont codés en dur dans les blocs « FO/ml ».

**Impact.** La bible ne peut pas alimenter `k_fo` et `k_mo`.

**Recommandation.** Ne pas importer de K depuis la bible ; les faire définir explicitement par famille.

### D4-13 — Formules douteuses dans la bible — **Moyen, Confirmé (formules) / À vérifier (intention)**

**Preuve**
- `DB_I4Lsoude!P255:P266 = [h MO] × 1,1`, alors que la colonne `M` de ce bloc contient des **euros** (« ditri +supp » = `J × 1,3`). On multiplie donc des € comme si c'étaient des heures.
- `DB_ILserti!M160:M168 = K × 1,1` dans la colonne « h MO » (des €).
- `DB_caloF!AH170:AH183 = F1_prix × 0,25 + F1_prix × 2 × 0,15 + F1_prix × 0,15`, soit × 0,70 : non documenté.
- Les ratios 0,3 / 0,15 / 0,2 / 1,2 / 1,6 / 1,3 / 1,1 ne sont pas sourcés.

**Impact.** Les colonnes de la table n'ont pas une sémantique stable : un import par nom de colonne prendrait des € pour des heures.

**Recommandation.** Sortir ces blocs de calcul des tables de données, ou les isoler et les documenter.

### D4-14 — Prix de la bible : moyennes de produits non équivalents, extrapolations, couverture faible — **Moyen, Confirmé (chiffres) / À vérifier (valeurs)**

**Preuve**
- `J = AVERAGE(F1;F2;F3)` mélange des épaisseurs différentes. Exemple `DB_caloF` ligne 11 (Cal.F2.100, 114,3×40) : moyenne de 108×30 « ajusté à 40mm », 108×30 et 108×50.
- Sources de prix : « Modèle régression » et « Synthèse extrapolée ». La colonne fournisseur contient aussi des codes de fiabilité 1 ou 2 (`MAJbase!E13:E15`). Fiabilité moyenne 3,0/10 sur `DB_caloF` et 4,3/10 sur `DB_caloC`.
- Incohérences de niveau :
  - `DB_caloC!J3` (Cal.C2.15) 1,10 €/ml contre `J22` (Cal.C3.15) 9,14 €/ml, à épaisseur égale (20 mm) ;
  - `J49` (C4.100, 60 mm) 13,83 € inférieur à `J30` (C3.100, 40 mm) 27,10 € ;
  - `DB_I4Lsoude!J18` (DN450) 297,53 € contre `J17` (DN400) 157,79 €, soit × 1,89 pour +12 % de diamètre à épaisseur égale.
- Couverture : 366 prix sur 1 239 (29,5 %) ; `DB_MCserti` 0/90 ; `DB_PVC` 1/36 ; `DB_conso` 4/108.
- 38 lignes ont un prix mais **pas d'identifiant** (`DB_Rob` 5, `DB_T10` 33, par exemple des brides PN40) et sont exclues d'`All_data`.
- `DB_caloF` lignes 190-191 : matériau « Kingspan Kooltherm » décrit comme « manchon élastomère XG ».

**Impact.** Des prix peu fiables risquent d'être pris pour une référence. Les lignes sans identifiant sont perdues.

**Recommandation.** Importer avec la fiabilité et la source, refuser l'agrégation de références non équivalentes, faire contrôler les prix aberrants par le porteur.

### D4-15 — Temps et spécifications divergents entre versions (BDC V1.2 et bible V1.03) — **Moyen, Confirmé**

**Preuve**
- Temps :
  - `MM_BDC_V1.2.csv` : Tub.I4S.15 h MO 0,75 h/ml, C90.I4S.15 0,65 h.
  - Bible : pas de h MO ; h/" 0,8 × 0,14 = 0,11 h/ml (soudure seule) et 1,34 h par coude.
- Spécification :
  - BDC V1.2 : `Tub.I4S.20` 26,9×2, 4,50 €.
  - Bible : `Tub.I4S.20` 26,9×1,6, 4,36 €.
  - La spécification change sous **le même identifiant**.
- Le docx « V1.1 » ne correspond pas aux colonnes du CSV V1.2 et écrit « PV MO = L × N × marge », sans taux horaire.

**Impact.** On ne sait pas quelle version fait foi : le temps varie d'un facteur 2 à 7 selon la source. L'identifiant ne garantit pas la spécification.

**Recommandation.** Désigner une source unique et versionnée, et coder la spécification (épaisseur) dans l'identifiant ou dans un attribut contrôlé.

### D4-16 — Le profil d'import `mm_bdc` ne garde que le tarif — **Moyen, Confirmé**

**Preuve.** `src/lib/catalogue/csv-import.ts:10-15` (cibles : supplier_name, product_reference, product_designation, unit_price, currency) et `:522-559`. Unité, h MO, pouces, K, Trust FO/MO et `Qte` (m²/ml) sont ignorés, et `supplier_sku: null` (`:956`) fait perdre la référence fournisseur `F1_ref`. Le format est par ailleurs reconnu comme un tarif fournisseur alors que c'est une base de chiffrage.

**Impact.** Les temps et l'unité du porteur sont perdus à l'entrée dans le catalogue.

**Recommandation.** Créer un import « base de chiffrage » distinct du tarif fournisseur.

### D4-17 — Collage et import des formats du porteur mal reconnus — **Élevé, Confirmé (heuristique) / Probable (effet final)**

**Preuve (rejeux, `repro/d4/paste_optima.mjs` et `import_guess.mjs`)**
- **Collage** de l'en-tête du xlsx du projet A : format détecté « bdc_v1_1 » et non « optima ». « Prix Unitaire » part en **unité**. « Tps pose unitaire » et « Coeff FO/MO » ne sont pas mappés, donc **h MO = null** et la MO est perdue. Ligne O1 collée : `unit = "174,59"`, `h_mo = null`.
- **Heuristique d'import DPGF** (`src/lib/mappings/server.ts:835-842`) : le test `includes("unit")` passe avant le test du prix. « Prix Unitaire », « PR Fourniture unitaire », « Tps pose unitaire » et « Tps pose unitaire majoré » partent donc tous en `unit`. « Uté » n'est pas reconnu.
- Client B : « Qté Atelier » et « Qté Chantier » ne sont pas reconnues (pas de quantité). Les trois colonnes « PU … » se disputent `unit_price_ht`.
- La majoration MO est additive dans le projet A (0 = neutre) mais multiplicative dans l'appli : `import-flow.ts:454-457` donnerait `h_mo_majoration = 0`, ce qui annule la MO.

**Impact.** L'import du format historique du porteur produit, sans alerte, des lignes sans MO ou avec des PU erronés. L'utilisateur peut corriger le mapping ; la mémoire et les modèles de mapping n'ont pas été évalués.

**Recommandation.**
1. Tester d'abord le motif prix (« prix unitaire », « pu ») avant « unit ».
2. Ajouter des alias pour les en-têtes réels : `Uté`, `Tps pose unitaire`, `Coeff FO/MO`, `Qté Atelier/Chantier`.
3. Prendre le xlsx du projet A comme cas de test de bout en bout.

### D4-18 — Arrondis et cohérence PU × Q ; écarts entre les éditions du même chiffrage — **Moyen, Confirmé**

**Preuve**
- Offres : PT ≠ Q × PU affiché sur **420 lignes sur 785** (hydraulique, écart maximal 7,94 €) et **341 sur 656** (plomberie, 2,03 €). Exemple O4 : 13,53 € × 1 139 = 15 410,67 € contre 15 406,11 € facturés.
- Même affaire, deux outils : xlsx et logiciel source diffèrent de −89,49 € (hydraulique) et de +18,88 € (plomberie). Causes : PR FO tenu à plus de 2 décimales (95,625), arrondi par sous-article (O4 : −15,95 €).
- TVA par ligne dans l'appli v2 contre TVA sur le total chez le porteur : −11 et −10 centimes.
- Le moteur de l'appli (mapping A) reproduit le xlsx à 0,00 € près sur O1 à O7.

**Impact.** Un vérificateur qui recalcule Q × PU trouve d'autres montants. L'oracle doit fixer une tolérance.

**Recommandation.** Fixer contractuellement « PU arrondi au centime, puis PT = Q × PU » (ou l'inverse) et la règle de TVA. Adopter comme tolérance de l'oracle : **0 € face au xlsx** ; **≤ 0,1 % ou ≤ 16 € par ligne** face au logiciel source.

### D4-19 — DPGF du client B : grille à double quantité, options incluses dans le total — **Moyen, Confirmé**

**Preuve.** Voir § 3 : `P174 = SUM(P4:P173)` inclut les Options (lignes 167-169) et les réserves ; unité `"` ; `F138:F151` en `ml` ; titre LOT05 contre lot 4 ; noms `#REF!`. Dans l'appli, le split atelier/chantier ne porte que sur les heures et il n'existe pas de ligne option.

**Impact.** La reconstitution fidèle de la réponse est partielle, et les options risquent d'être additionnées.

**Recommandation.** À l'import, détecter les options et réserves, conserver les deux quantités (au moins en métadonnées) et produire un export au format du client.

### D4-20 — Secrets et données personnelles dans les matériaux versionnés — **Critique, Confirmé (présence) ; validité non testée**

**Preuve.**
- `docs/prd_file/Feuille de calcul sans titre.xlsx` (versionné, commit `433a9d4c`), cellules `A16:A22` : deux chaînes ayant l'apparence de mots de passe sous les libellés « Supabase » et « Logiciel », deux adresses e-mail, l'URL d'un déploiement applicatif. Les valeurs ne sont pas reproduites ici.
- `MM_appro.xlsm` (`HEX_appro`, `essai-1`, lignes 2-9) et les en-têtes des PDF contiennent des coordonnées d'entreprise et des noms de personnes.

**Impact.** Fuite d'identifiants dans l'historique git.

**Recommandation.** Rotation immédiate des identifiants, purge de l'historique, sortie des matériaux du dépôt ou anonymisation, et contrôle de détection de secrets sur `docs/`. Hors du périmètre D4 : à transmettre à l'axe sécurité.

### D4-21 — Calorifuge : ml ou m², avec ou sans MO selon la source — **Faible, Confirmé**

**Preuve.**
- Bible : ml, périmètre en « Commentaire », tôle en kg par `ROUNDUP`, MO « Cal » de 0,25 à 0,8 h sur la robinetterie.
- BDC : m².
- Projet A : m² en FO seule (sous-traitance) ou ml en ouvrage composé avec MO (O4).

**Impact.** Il faut convertir à la main pour passer d'une source à l'autre.

**Recommandation.** Fixer l'unité de chiffrage du calorifuge par famille et stocker la conversion (périmètre π(D+2e)).

### D4-22 — Kit de la bible : prototype unique et formules parent incomplètes — **Faible, Confirmé**

**Preuve.**
- `kit!L4 = SUMIFS(L:L;$C:$C;$D4)` additionne les PR FO des enfants **sans multiplier par `Qté`** (toutes à 1 aujourd'hui).
- `kit!O4` (h MO) = 0 : la MO du kit n'est pas calculée (h/" et pouces sont additionnés séparément en `S4` et `T4`).
- Un seul kit renseigné sur 612 lignes.
- Gabarit : `INOX304_15_K` « compris supportage », sans formule.

**Impact.** Il n'existe pas de modèle d'ouvrage composé abouti à migrer.

**Recommandation.** Spécifier avec le porteur le contenu type d'un ouvrage (quantités par unité, MO) avant de l'outiller dans les ouvrages de l'appli.

---

## 7. Non audité, limites

- **Macros VBA** (`vbaProject.bin` de la bible et de l'appro) : non lues et non exécutées. Elles peuvent appliquer des règles invisibles dans les formules, comme les majorations Cu et isolant ou la consolidation `All_data`.
- **Extraction des PDF** : par regroupement de texte, avec appariement séquentiel. Les colonnes « Net » et remise du déboursé ne sont pas restituées par l'extraction : la remise est **déduite** (Probable), pas lue.
- **Effet final de l'import** : la mémoire, les modèles de mapping et les corrections manuelles n'ont pas été évalués.
- **Règle `min_margin`** sous le mapping B : non rejouée.
- **Validité des secrets de D4-20** : non testée, volontairement.
