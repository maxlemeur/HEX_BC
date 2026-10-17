# Unité d'achat et conditionnement (sous-lot 2.9)

Statut : **implémenté et relu**, branche `lot2/2.9-unite-achat` (écrit sur `main` `b91f938f`, rebasé sur
`9c426368` avant publication).
Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), D9,
§6.1 M7, §14 « 2.9 », décision P-18 ; constats C-09, D4-16, Q05 ; point 30 de
[estimate-engine-v3-2.4.md](estimate-engine-v3-2.4.md). Règle d'entrée valable pour tous les moteurs : aucune
ligne d'un devis existant n'est modifiée ; une offre sans conversion se comporte comme avant.

## Règles retenues (décisions du porteur du 17/10/2026)

- **Conversion portée par l'offre (M7).** `supplier_pricebook.estimate_unit_code` (unité du devis, code du
  référentiel `measurement_units`), `estimate_units_per_purchase_unit numeric(14,6) > 0` (quantité de
  l'unité du devis par unité d'achat, par exemple 3 ml par barre) et `purchase_rounding ∈ {none, ceil}`.
  Les trois sont nuls ensemble (offre sans conversion) ou renseignés ensemble. `unit` reste l'unité d'achat
  (« barre ») et `unit_price_cents` le prix par unité d'achat.
- **Prix converti (PR du devis).** Une offre convertie se présente au devis dans son unité du devis, au prix
  `arrondi demi-supérieur(prix d'achat / facteur)` au centime : barre de 3 m à 262,45 € → 87,48 €/ml. C'est
  ce prix que reçoivent la ligne (comparaison, présélection, popover, fiche article) et le meilleur prix.
- **Quantité commandée.** `quantité du devis / facteur`, arrondie à l'entier supérieur si `ceil` : 282 ml →
  94 barres ; 10 ml → 4 barres. Sans arrondi, une quantité d'achat qui n'est pas un multiple de 0,001 est
  refusée. Le minimum de commande de l'offre s'applique à la quantité d'achat.
- **Prix par unité d'achat sur la commande** (décision du porteur) : le prix de l'offre (262,45 €) tant que le
  PR de la ligne vaut le prix converti de l'offre (87,48 €) ; sinon, PR négocié × facteur, arrondi
  demi-supérieur au centime. La ligne de commande porte la quantité et le prix dans l'unité d'achat
  (`unit` = `price_unit` = « barre »).
- **Saisie** (décision du porteur) : trois champs dans la fiche d'offre du catalogue (modification d'une offre,
  route `update-offer`, comme le marquage du 2.2) ; l'import `mm_bdc` lit la colonne `Unite` dans l'unité de
  l'offre au lieu d'écrire `null` (devenue « u » en base).
- **Normaliseur partagé, tous moteurs** (décision du porteur, D9, point 30 du 2.4) : l'éligibilité des offres
  (`supplier-offer-eligibility.ts`) et la préparation d'achat SQL (`private.purchase_unit_token`) comparent
  les unités par le référentiel (`normalizeMeasurementUnit`, `private.normalize_unit`) ; une unité hors
  référentiel (« barre ») se compare par son jeton. « m.l. », « mètre linéaire » = `ml` ; « Pce » = `u` ;
  « forfait » = `fft`.

## Défaillances observables (état de `b91f938f`)

| # | Défaillance | Où |
|---|---|---|
| A1 | Une offre « barre » est refusée (« Unité différente du devis ») pour une ligne en ml : aucune conversion n'existe | `supplier-offer-eligibility.ts`, préparation SQL |
| A2 | Appliquée malgré tout, elle écrirait 262,45 € comme PR par ml | suggestions, comparaison, popover, fiche article |
| A3 | La commande d'une ligne de 282 ml porterait 282 unités au prix du ml, pas 94 barres | `purchase-order-drafts.ts`, `create_estimate_purchase_order_drafts`, déclencheur des lignes de commande |
| A4 | Le minimum de commande se compare à la quantité du devis au lieu de la quantité d'achat | idem |
| A5 | « m.l. », « Pce », « forfait » ne sont pas reconnus comme `ml`, `u`, `fft` aux achats | normaliseurs du 2.2 |
| A6 | L'import `mm_bdc` perd l'unité (`unit: null`, « u » en base) | `csv-import.ts` |
| A7 | Rien ne permet de déclarer une barre de 3 m | fiche d'offre |

## Preuves

### E2E (TesterArmy, phase `offers` de `calc-v3`)

Parcours `e2e/army/local/supplier-offer-purchase-unit.e2e.ts`, sur la fixture de la phase (propriétaire dédié) :

- **PU01** fiche d'offre : déclarer sur l'offre « barre » d'un article de fonte : 3 ml par barre, arrondi
  entier ; relu par l'API (`/api/prices`).
- **PU02** ligne de 282 ml : le popover applique l'article au PR converti 87,48 €/ml, unité « ml » conservée,
  relu en base ; préparation d'achat : 94 barres à 262,45 €, total 24 670,30 € HT, relu dans le brouillon.
- **PU03** ligne de 10 ml liée à une barre de 3 m à 27,00 € : 4 barres, 108,00 € HT ; une ligne au PR
  négocié (80,00 €/ml) commande au prix 240,00 € par barre.
- **PU04** (relecture) meilleur prix du catalogue par unité du devis (87,48 €) ; fiche article sur une ligne
  écrite en barres : elle garde « barre » et 262,45 € ; panneau de comparaison d'une ligne en ml : « / ml »,
  jamais « / barre » ; préparation d'achat de l'affaire : « 10 barre » ; une ligne en barres se commande
  94 barres à 262,45 €, 24 670,30 € HT.

### Isolation (justifiée)

- **Vitest T-UNIT3** `supplier-offer-purchase-unit.test.ts` : arithmétique de conversion (division et
  arrondi demi-supérieur au centime, arrondi entier, quantité non représentable, prix négocié) ; ces cas
  limites se paient cher en E2E et ont un jumeau SQL qui doit donner les mêmes nombres.
- **Vitest** `supplier-offer-eligibility.test.ts` : normaliseur partagé (« m.l. », « Pce », « forfait ») et
  offre convertie éligible pour une ligne dans son unité du devis.
- **Vitest** `csv-import.test.ts` : le profil `mm_bdc` lit `Unite`.
- **Vitest** (relecture) `SupplierOfferFormModal.conversion.test.tsx` : « Aucune conversion » vide les deux
  autres champs et envoie la conversion nulle (PU01 ne déclare qu'une conversion) ; `schemas.test.ts` : le
  facteur suit `numeric(14,6)` (six décimales au plus, jusqu'à 99 999 999,999999), une septième décimale est
  refusée au lieu d'être arrondie par la base.
- **Vitest** (second tour) `purchase-order-drafts.test.ts` : un aperçu dont la quantité, l'unité ou le prix
  commandés diffèrent de la revue signée est refusé (course entre deux lectures, sans crochet de temporisation) ;
  `editor-export.test.ts` et `SupplierPreselectionDialog.test.tsx` : prix par barre d'une ligne en barres
  (aucun parcours E2E n'exporte ni ne présélectionne une offre convertie sur une ligne en barres).
- **pgTAP** (relecture) : ligne L7 en barres commandée sans conversion ; L8, prix négocié par barre hors
  limites refusé ; valeurs commandées de la revue ; prix converti borné ; page catalogue lisible ; meilleur prix
  par unité du devis.
- **pgTAP** `supabase/tests/database/supplier-offer-purchase-unit.test.sql` : contrainte des trois colonnes,
  brouillon de commande converti (quantité, prix, unités, totaux), prix négocié, minimum sur la quantité
  d'achat, quantité non représentable refusée, normaliseur partagé dans la préparation.

Rejouer aussi : montée de version (M7 neutre sur les offres existantes), corpus figé et empreintes.

## Exécution rouge (17/10/2026, macOS, base `b91f938f`, tests `af2f171e`, devenu `32ea117a` au rebase)

Journaux : `.e2e/lot2-2.9/red/` (copie de travail, non versionnée).

- **Vitest** : 13 rouges sur 51. T-UNIT3 (module de conversion en bouchon sans conversion) ; « m.l. »,
  « mètre linéaire », « Pce », « pièce », « forfait », « Ft » refusés ; offre « barre » refusée pour une ligne
  en ml ; minimum compté en ml ; unité BDC perdue. Les gardes (offre sans conversion, unités hors
  référentiel comparées par leur graphie) étaient vertes. Le test BDC refusait d'abord ses lignes pour des
  références inconnues des données de test : corrigé avant la mise en œuvre, il est rouge pour la seule
  raison attendue (unités `null` sans la correction, vertes avec).
- **pgTAP** `supplier-offer-purchase-unit.test.sql` : 9 rouges sur 9 (colonnes absentes, commandes non
  converties). Le premier passage vert a révélé un défaut de la contrainte : `estimate_units_per_purchase_unit
  > 0` vaut `NULL` quand la colonne est nulle, et un CHECK `NULL` passe ; corrigé par des `IS NOT NULL`
  explicites avant tout commit de la migration.
- **TesterArmy** phase `offers` (fichier pgTAP rouge tenu hors du worktree de test) : PU01 rouge (pas de
  champ « Unité du devis »), PU02 rouge (le popover refuse l'offre « barre » pour une ligne en ml), PU03 rouge
  (l'API refuse les champs de conversion) ; OZ01 à OZ03 du 2.2 restent verts.

## Implémentation

| Élément | Correction |
|---|---|
| M7 `20261017172127_supplier_offer_purchase_unit.sql` | trois colonnes et contrainte ; `private.purchase_quantity`, `private.purchase_unit_price_cents`, `private.purchase_conversion_factor` ; `private.purchase_unit_token` par le référentiel ; `create_estimate_purchase_order_drafts`, `estimate_purchase_review_lines`, `normalize_purchase_order_item`, `update_supplier_offer` et `catalogue_products_page` redéfinies, seules les lignes visées changent |
| `supplier-offer-purchase-unit.ts` | jumeau TS, arithmétique entière exacte (facteur en millionièmes, quantités en millièmes) |
| Éligibilité | référentiel partagé ; unité du devis de l'offre ; minimum sur la quantité d'achat ; quantité non convertible refusée |
| Serveur des devis | une offre convertie se présente dans son unité du devis au prix converti, et en barres au prix de la barre (indice matière compris) pour une ligne écrite en barres, sur tous les chemins (suggestions, meilleur prix, présélection, popover, fiche article, métré, export BDC) |
| Comparaison | les analyseurs client transmettent la conversion et le prix d'achat ; prix et unité affichés et appliqués selon l'unité de la ligne |
| Préparation d'achat | la quantité, l'unité et le prix commandés (« 94 barre », 262,45 €), et « soit 282 ml au devis » |
| Aperçu de commande | quantité, unité et prix commandés (`ordered_*`) et totaux calculés comme le SQL |
| Catalogue | trois champs dans la fiche d'offre, « Aucune conversion » les vide tous ; facteur à six décimales au plus ; « 3 ml par barre » dans la liste ; meilleur prix par unité du devis ; erreurs nommées pour la contrainte et l'unité inconnue ; l'import `mm_bdc` garde `Unite` |
| Préparation d'achat (second tour) | la revue SQL porte les valeurs commandées de son instantané, comparées par l'API ; prix converti borné par contrainte ; prix par barre hors limites refusé |
| Exports et présélection | export éditeur, export BDC et dialogue de présélection au prix de l'unité de la ligne |
| Montée de version | les trois colonnes déclarées neutres (`null`) |

## Relecture (17/10/2026)

Relecture indépendante du diff vert : 7 constats, tous corrigés. Règle retenue : **une offre convertie sert
ses deux unités**. Une ligne en ml, ou sans unité, passe par la conversion ; une ligne écrite dans l'unité
d'achat (« barre ») garde le prix de la barre, indice matière compris, et se commande sans conversion
(`conversionForLineUnit` et `alternativePriceForLineUnit`, jumeau SQL `private.purchase_conversion_factor`).
Une offre sans conversion se comporte comme avant sur tous les chemins.

| # | Constat | Correction |
|---|---|---|
| R1 | La fiche article associait une ligne « barre » en ml au prix converti : coût divisé par 3 | prix et unité selon l'unité de la ligne : fiche, popover, présélection, comparaison, métré, export BDC |
| R2 | Une conversion déclarée rendait une ligne en barres inéligible et non commandable | éligibilité TS, préparation SQL et déclencheur des lignes de commande acceptent l'unité d'achat sans conversion |
| R3 | La préparation d'achat affichait la quantité et le prix du devis | quantité, unité et prix commandés affichés |
| R4 | Une quantité non représentable n'était refusée qu'en présence d'un minimum | refus hors de la branche du minimum |
| R5 | Le panneau de comparaison affichait « 87,48 € / barre » | « / ml » ; « / barre » au prix de la barre pour une ligne en barres |
| R6 | Le meilleur prix du catalogue comparait des prix par unité d'achat | `catalogue_products_page` compare et affiche par unité du devis |
| R7 | Pas de limite à six décimales ; « Aucune conversion » seule était refusée | schéma aligné sur `numeric(14,6)` ; ce choix vide les trois champs |

Rouge avant correction, sur les commits de tests `18752b97` et `6fb84079` (devenus `e51994cb` et `2ef30493`
au rebase) :

- **Vitest** : 6 rouges (3 par commit) : offre convertie pour une ligne en barres, quantité non
  représentable sans minimum, unité affichée ; vidage du formulaire et précision du facteur.
- **pgTAP** `supplier-offer-purchase-unit.test.sql` : 3 assertions rouges sur 10 (statut et ligne de commande
  de L7, écrite en barres ; meilleur prix du catalogue 26 245 au lieu de 900) ;
  `.e2e/lot2-2.9/red/pgtap-review.log`.
- **TesterArmy** phase `offers` : PU04 rouge à sa première assertion (meilleur prix 26 245 au lieu de 8 748) ;
  PU01 à PU03 et OZ01 à OZ03 verts ; `.e2e/lot2-2.9/red/offers-review*.log`.

### Second tour (relecture des corrections)

Relecture indépendante en lecture seule du diff corrigé : les 7 constats sont corrigés sur tous les chemins
parcourus, avec parité TS/SQL de la décision de conversion, des quantités, des prix et des totaux. Elle relève
trois défauts, corrigés ici :

| # | Constat | Correction |
|---|---|---|
| S1 | L'aperçu d'achat calcule les valeurs commandées sur une lecture de l'offre antérieure à l'empreinte : une offre modifiée entre les deux lectures (facteur 3 → 2) commanderait 141 barres en en montrant 94 | la revue SQL renvoie la quantité, l'unité et le prix commandés de l'instantané signé ; l'API refuse un aperçu qui en diffère (`ORDER_DRAFT_PREPARATION_STALE`) |
| S2 | Un facteur minuscule (0,000001) fait déborder l'entier du prix converti : la page catalogue échoue pour tout le tenant | contrainte `supplier_pricebook_converted_price_check` (prix converti ≤ 2 147 483 647 centimes) ; un prix négocié par barre hors limites donne `ORDER_DRAFT_INPUT_INVALID` au lieu de l'erreur brute 22003 |
| S3 | L'export éditeur et la présélection (offre actuelle, exceptions) affichent encore 87,48 € pour une ligne en barres | prix selon l'unité de la ligne (`item_unit` ajouté aux propositions et exceptions) ; l'unité de la métadonnée du métré suit le prix |

Hors périmètre, notés : `product_reference_price_proposal` compare encore les unités par graphie
(`lower(btrim())`), si bien qu'une offre « barre » convertie n'entre pas dans le prix de référence d'un article en
ml (antérieur au 2.9, suite à donner) ; la quantité transférée de l'affaire s'affiche sans unité ; un appel
direct de la RPC `update_supplier_offer` arrondit une septième décimale (l'API la refuse).

Rouge avant correction (`ee5bf69e`) : Vitest 5 (aperçu : quantité, unité et prix commandés ; export ;
présélection), pgTAP 4 sur 13 (L8 hors limites, valeurs commandées de la revue, contrainte, page catalogue) ;
`.e2e/lot2-2.9/red/pgtap-review-2.log`. Le test du dialogue cherchait d'abord le montant avec son espace
insécable, que Testing Library ne normalise que côté DOM : corrigé, il est rouge sur l'ancien dialogue (aucun
262,45 €) et vert sur le nouveau.

Qualification E2E de la relecture : PU04 a d'abord révélé une collision de verrou (PU02 tient encore le brouillon
« pu » ; PU04 a désormais son devis, comme les parcours du 2.2) ; OZ02 a révélé une régression d'affichage de la
fiche article (« Inclus / ml » au lieu de « Inclus ») : l'unité ne s'affiche plus qu'à côté d'un montant.

## Preuves (17/10/2026, macOS, Node 24.19.0, pile native possédée, source `dcbcf912`)

Branche rebasée sur `main` `9c426368`. Évidences sous `.e2e/` (copie de travail, non versionnée) ; campagnes
TesterArmy lancées depuis une copie propre sans `.env*`, sources inchangées pendant chaque campagne.

| Preuve | Résultat |
|---|---|
| `npm run verify:pr` | réussi : Node 2 794 réussis, 3 ignorés ; jsdom 823 réussis ; couverture critique 12 ; audit, signatures, budgets d'architecture, OpenAPI, typecheck et lint passés |
| `npm run db:ci:local` | 18 fichiers pgTAP, 1 727 assertions PASS, matrice RLS passée |
| `db:upgrade-check -- lot2-2-9` | M1, M2, M3 et M7 appliquées sur la base peuplée : 0 différence ; contrôle négatif détecté (`.e2e/engine-v3/upgrade-check/2026-10-17T18-46-50-734Z-lot2-2-9`) |
| Empreintes documentaires | 14 familles identiques |
| Corpus figé | identique à l'octet (600 cas) |
| `e2e:army:calc-v3` complet | 41/41 : journeys 11, components 5, numeric 4, resume 5, access 2, offers 8 (OZ01 à OZ03, PU01 à PU04, setup), emission 6 ; `.e2e/army/ci/2026-10-17T18-34-22-284Z-calc-v3` |
| OpenAPI | `openapi.json` documente les trois champs de conversion sur `update-offer` (facteur strictement inférieur à 10⁸), les champs d'unité d'achat des suggestions et comparaisons, `item_unit` de la présélection et les valeurs commandées de la préparation d'achat |

Une première campagne complète sur la même source a échoué hors du code : pendant le run, un processus
extérieur a supprimé le cache Playwright (« Executable doesn't exist ») puis les `node_modules` des deux copies.
Après `npm ci`, la campagne relancée seule est passée (41/41).

## Limites et intégration

- **Lignes v3 (2.5, M4)** : l'unité d'une ligne v3 est dans `estimate_items.unit_code`. Le 2.9 lit `description`
  (lignes v1/v2) sur les chemins d'achat. Si le 2.5 fusionne avant, le 2.9 fera lire `coalesce(unit_code,
  description)` aux chemins d'achat, par une fusion de `main` dans la branche.
- Une unité d'offre héritée terminée par une tabulation ou une espace insécable se compare différemment entre
  `trim()` (TS) et `btrim()` (SQL) ; l'aperçu d'achat est alors refusé comme périmé. Les chemins d'écriture
  actuels suppriment ces espaces ; la comparaison de l'unité de ligne existante a la même limite.
- `product_reference_price_proposal` compare toujours les unités par graphie (hors périmètre, antérieur).
- M7 doit être appliquée avant tout déploiement de ce code (colonnes lues par l'API et le catalogue).
