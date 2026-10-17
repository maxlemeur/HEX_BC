# Unité d'achat et conditionnement (sous-lot 2.9)

Statut : **contrat écrit avant implémentation**, branche `lot2/2.9-unite-achat` (base `main` `b91f938f`).
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

### Isolation (justifiée)

- **Vitest T-UNIT3** `supplier-offer-purchase-unit.test.ts` : arithmétique de conversion (division et
  arrondi demi-supérieur au centime, arrondi entier, quantité non représentable, prix négocié) ; ces cas
  limites se paient cher en E2E et ont un jumeau SQL qui doit donner les mêmes nombres.
- **Vitest** `supplier-offer-eligibility.test.ts` : normaliseur partagé (« m.l. », « Pce », « forfait ») et
  offre convertie éligible pour une ligne dans son unité du devis.
- **Vitest** `csv-import.test.ts` : le profil `mm_bdc` lit `Unite`.
- **pgTAP** `supabase/tests/database/supplier-offer-purchase-unit.test.sql` : contrainte des trois colonnes,
  brouillon de commande converti (quantité, prix, unités, totaux), prix négocié, minimum sur la quantité
  d'achat, quantité non représentable refusée, normaliseur partagé dans la préparation.

Rejouer aussi : montée de version (M7 neutre sur les offres existantes), corpus figé et empreintes.

## Exécution rouge

À compléter.
