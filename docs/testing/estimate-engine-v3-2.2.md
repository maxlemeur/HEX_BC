# Offre à 0 € et « ML » = mètre linéaire (sous-lot 2.2)

Statut : **implémenté, relu et prouvé**, branche `lot2/2.2-offre-zero-ml`, recalée sur `main` `3d8d2f8a`
(PR #24). Contrat et tests d'exigence écrits rouges d'abord (`4824b335`), puis l'implémentation et la
migration M2 (`8ecd693a`, `20261017093407_supplier_offer_zero_price_policy.sql`), puis les corrections de
la relecture (`9ac86341` rouge, `e48814fa` et `c7e6571b`).
Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md), D9 (unités),
D10 (A7), §5.3 T-Z, §14 « 2.2 », décisions P-08 et P-17 (validées le 16/10/2026). Règle d'entrée valable
pour tous les moteurs : aucune ligne de devis déjà liée n'est modifiée.

## Règles retenues

- **A7.** Une offre fournisseur n'est utilisable pour son prix que si `unit_price_cents > 0` ou si elle est
  marquée `zero_price_kind ∈ {included, free}` (« Inclus », « Gratuit »). Le marquage n'est admis qu'à
  0 €. Prédicat unique : `private.supplier_offer_price_eligible` (SQL) et `isSupplierOfferPriceEligible`
  (`src/lib/estimates/supplier-offer-price.ts`).
- **P-08.** `m` = `ml` ; « ML », « mL », « Ml » sont le mètre linéaire, pas le millilitre, qui n'est pas au
  référentiel. Le normaliseur complet (NFKD, alias) arrive en 2.4 ; 2.2 rend seulement l'égalité
  `m` / `ml` insensible à la casse, en TS (`supplierOfferIneligibility`) et dans la préparation d'achat SQL
  (`private.purchase_unit_token`).
- **P-17.** Le marquage relève de qui administre le catalogue : les rôles qui écrivent déjà les offres
  (`admin`, `engineer`, RLS inchangée). Aucune nouvelle couche de droits.
- Le prix de référence exclut déjà les offres à 0 € (`zero_price` dans
  `product_reference_price_proposal`) et continue d'exclure les offres marquées : un prix gratuit n'est
  pas un prix d'achat.

## Défaillances observables (état de `28c7546b`)

| # | Chemin | Défaillance | Où |
|---|---|---|---|
| Z1 | Éligibilité | `supplierOfferIneligibility` accepte une offre à 0 € non marquée | `supplier-offer-eligibility.ts` |
| Z2 | Meilleur prix | Le tri croissant fait gagner l'offre à 0 € (`best_price`, `best_supplier_price_id`) | `estimates/server.ts`, `buildSuggestedCatalogueAlternatives` |
| Z3 | Présélection | Une seule alternative à 0 € est proposée puis écrite : ligne à 0 € | `findEstimateSupplierPreselectionProposalAlternative` |
| Z4 | Popover de suggestion | La suggestion de tête à 0 € s'applique (Entrée) ; aucun libellé ; le correctif écrit la désignation de l'article dans la colonne unité | `useCatalogueSuggestions.ts`, `CatalogueSuggestionsPopover.tsx` |
| Z5 | Fiche article (éditeur) | L'association liste et applique l'offre à 0 € | `EstimateArticleSheet.tsx`, `EstimateEditorTable.tsx` (`handleAssociateArticle`) |
| Z6 | Catalogue SQL et achat | `catalogue_products_page` / `catalogue_products_summary` retiennent l'offre à 0 € comme meilleur prix ; `create_estimate_purchase_order_drafts` accepte une ligne liée à une offre à 0 € non marquée | migrations `20260906145000`, `20260712201900`, `20261011091744` |
| U1 | Unités | « ML » contre « ml » : « Unité différente du devis » en TS et `ORDER_DRAFT_PREPARATION_STALE` en SQL (« ML » lu comme millilitre) | `supplier-offer-eligibility.ts:4-10`, `20261011091744…sql:607-608` |
| M1 | Marquage | Impossible de déclarer une offre gratuite voulue : rien ne la distingue d'une offre à prix manquant | `supplier_pricebook` |
| M2 | Intégrité | Un marquage « Inclus » sur une offre à prix > 0 serait incohérent | à garantir par CHECK |

Après correction, les 6 chemins refusent l'offre à 0 € non marquée ; une offre marquée « Inclus » ou
« Gratuit » est éligible et libellée comme telle là où son prix s'affiche.

## Preuves

### E2E (TesterArmy, phase `offers` de la campagne `calc-v3`)

La suite critique ne crée jamais de fiche catalogue (elle peut viser un hôte autorisé non jetable) : le
parcours tourne dans une nouvelle phase `offers` de `npm run e2e:army:calc-v3`, sur la pile possédée, avec
une fixture semée par le propriétaire natif. Parcours `e2e/army/local/supplier-offer-zero-price.e2e.ts` :

- **OZ01** article avec une offre à 0 € non marquée et une à 12,40 € (unité « ml ») ; ligne en « ML » :
  - comparaison fournisseurs : meilleur prix 12,40 € ; l'offre à 0 € est inéligible ;
  - présélection : 12,40 € proposé et appliqué, relu en base (`unit_price_ht_cents` 1 240,
    `selected_supplier_price_id`) ;
  - popover de suggestion sur une autre ligne en « ML » : 12,40 € appliqué, unité « ML » conservée
    (relue en base) ;
  - fiche article de l'éditeur : l'offre à 0 € n'est pas applicable ; 12,40 € l'est.
- **OZ02** offre à 0 € marquée « Inclus » par la fiche d'offre du catalogue : applicable et libellée
  « Inclus » dans la fiche article ; elle reste hors du prix de référence.
- **OZ03** brouillon de commande d'une ligne en « ML » liée à l'offre en « ml » : accepté, quantité et prix
  relus dans le brouillon ; une ligne liée à l'offre à 0 € non marquée est refusée à la préparation.

### Isolation (justifiée)

- **pgTAP `supabase/tests/database/supplier-offer-eligibility.test.sql`** : les prédicats SQL de
  `catalogue_products_page`, `catalogue_products_summary` et `create_estimate_purchase_order_drafts`
  ne sont pas tous observables par un parcours (résumé du catalogue, comptages, refus transactionnel
  `40001`) ; la contrainte `zero_price_kind` est une intégrité de données. Assertions : offre à 0 € non
  marquée jamais retenue comme prix minimal, marquée retenue ; nombre d'offres inchangé ; préparation
  refusée pour une offre à 0 € non marquée, acceptée « ML » contre « ml » ; `zero_price_kind` refusé si le
  prix > 0 ; prix de référence inchangé.
- **Vitest** `supplier-offer-eligibility.test.ts` : T-Z et T-UNIT2 (« ML », « mL », « m » contre « ml »),
  transposition en exigences de `rules.audit.test.ts:98` et `:101`. Le prédicat est partagé par six
  chemins ; un cas limite (prix nul avec marquage, unité vide) y est moins coûteux qu'en E2E.

Rejouer aussi : corpus figé et empreintes documentaires (aucun montant v1/v2 ne doit bouger).

## Écarts à la conception

- **Prédicat dans `public`.** La conception le place dans `private`. Les fonctions du catalogue
  (`catalogue_products_page`, `catalogue_products_summary`) s'exécutent en `SECURITY INVOKER` et le rôle
  `authenticated` n'a aucun droit sur le schéma `private` : `public.supplier_offer_price_eligible` est
  une fonction pure, sans lecture de données, exécutable par `authenticated` seulement.
- **Marquage à la modification seulement.** Le formulaire d'offre propose « Offre à 0 € : Inclus /
  Gratuit » quand le prix saisi vaut 0 € sur une offre existante (`update-offer`, RPC
  `update_supplier_offer`). Une offre se crée donc d'abord, puis se marque : la création
  (`create_supplier_catalog_price`, import en masse) n'accepte pas le marquage.
- **Empreinte de relecture d'achat inchangée.** `private.estimate_purchase_review_lines` n'inclut pas
  `zero_price_kind` ; la création du brouillon refait le contrôle d'éligibilité au moment de l'écriture.

## Exécution rouge (17/10/2026, macOS, base `28c7546b` avant recalage, tests d'exigence aujourd'hui `4824b335`)

Journaux : `.e2e/lot2-2.2/red/` (copie de travail, non versionnée).

- **Vitest** `supplier-offer-eligibility.test.ts` : 6 rouges sur 15. L'offre à 0 € non marquée est
  acceptée ; « ML », « mL », « Ml » contre « ml » et « m » contre « ML » sont refusés.
- **pgTAP** `supplier-offer-eligibility.test.sql` : 8 rouges sur 12. Marquage et intégrité (colonne
  absente) ; page catalogue `ZP22-1` meilleur prix 0 au lieu de 1 240 ; résumé `(4,3,1)` au lieu de
  `(4,2,2)` ; « ML » contre « ml » refusé (`40001`) ; ligne liée à l'offre à 0 € non marquée acceptée. Les
  gardes (prix de référence, ligne « m » sur offre marquée) étaient vertes.
- **TesterArmy** phase `offers` (fichier pgTAP rouge tenu hors du worktree de test pour atteindre les
  parcours) : OZ01 rouge au meilleur prix (l'offre à 0 € gagne), OZ02 rouge à la présélection (l'offre à
  0 € non marquée est proposée), OZ03 rouge à la préparation (la ligne liée à 0 € n'est pas bloquée).

## Implémentation, chemin par chemin

| Chemin | Correction |
|---|---|
| Éligibilité | `supplierOfferIneligibility` : contrôle du prix après archivage (`isSupplierOfferPriceEligible`), refus fermé si le prix est inconnu (« Prix de l'offre à vérifier »), unités P-08 |
| Lectures d'offres | `zero_price_kind` lu avec chaque offre ; `readSupplierOfferConditions` ajoute prix brut et marquage aux alternatives comparées |
| Meilleur prix, suggestions, métré | `suggestEstimateCataloguePrices` écarte les offres inéligibles avant tout classement ; le métré passe par la même fonction |
| Présélection et comparaison | les pairs inéligibles sont écartés ; l'offre déjà retenue d'une ligne reste affichée, la ligne n'est pas réécrite |
| Popover de suggestion | l'unité de la ligne est conservée ; vide, elle prend l'unité de l'article, jamais sa désignation |
| Fiche article | elle applique la tête des suggestions (éligible) ; comportement d'unité inchangé (unité de l'article, parcours critique `estimate-integrity`) |
| Catalogue et achat (SQL) | M2 : `catalogue_products_page`, `catalogue_products_summary`, `create_estimate_purchase_order_drafts`, `update_supplier_offer` ; préparation TS (`purchase-order-drafts.ts`) alignée |
| Libellés | « Inclus » / « Gratuit » dans la liste des prix, la fiche article, le popover, la comparaison et la présélection |

Les tests existants qui construisaient des offres sans prix leur en donnent un ; les deux tests du popover
attendent l'unité de l'article, et non plus la désignation, dans une ligne sans unité.

## Preuves (17/10/2026, macOS, Node 24.19.0, pile native possédée)

| Preuve | Résultat |
|---|---|
| `npm test` | 3 342 tests : 3 339 réussis, 3 ignorés (les mêmes qu'avant), 0 échec, à `c7e6571b` |
| `npm run db:ci:local` | 14 fichiers pgTAP, 1 265 assertions PASS (1 253 + 12), matrice RLS passée |
| `db:upgrade-check -- lot2-2-2` | M2 appliquée sur la base peuplée : 0 différence, colonne `zero_price_kind` neutre (`null`) partout ; contrôle négatif détecté |
| Empreintes documentaires | 14 familles identiques |
| Corpus figé | identique à l'octet (600 cas) |
| `e2e:army:calc-v3 --phase offers` | 4/4 (setup, OZ01, OZ02, OZ03), copie propre |
| `e2e:army:calc-v3` complet | 37/37 à `c7e6571b` (journeys 11, components 5, numeric 4, resume 5, access 2, offers 4, emission 6), copie propre, sources inchangées ; déjà 37/37 avant le recalage et avant la relecture |
| `e2e:army:local` | 68/68 (19 fichiers) avant le recalage ; rejouée par la CI de la PR sur l'état final |
| `npm run typecheck`, ESLint, OpenAPI | OK ; `openapi.json` ne gagne que `zero_price_kind` sur `update-offer` |

## Relecture (17/10/2026)

Un relecteur indépendant a confirmé la migration M2 : chaque fonction est identique à sa source hors des
lignes visées, aucune migration ultérieure ne la redéfinit, droits et `search_path` sont conservés. Il a
relevé quatre défauts, tous rendus observables en E2E rouge (`.e2e/lot2-2.2/red-review/`), puis corrigés :

| # | Gravité | Défaut | Rouge | Correction |
|---|---|---|---|---|
| R1 | élevée | Les deux analyseurs client des comparaisons (`EstimateEditorTable.tsx`, `useEstimateEditorSupplierController.ts`) jetaient `unit_price_cents` et `zero_price_kind` : l'éligibilité fermée refusait toutes les offres du panneau « Comparer fournisseurs » (« Prix de l'offre à vérifier ») et les libellés ne s'affichaient pas | OZ01, panneau sur la ligne liée : « Retenir cette offre » désactivé partout | les deux analyseurs transmettent prix brut et marquage |
| R2 | moyenne | Une ligne déjà liée à une offre à 0 € non marquée la voyait classée « meilleur prix » | OZ01 : `best_supplier_price_id` = l'offre à 0 € | l'offre retenue inéligible reste le choix courant, mais n'entre plus dans le classement |
| R3 | moyenne | Le popover appliquait une offre dans une autre unité (ligne en m2, offre en ml) ; l'unité d'une alternative choisie n'était pas reprise | OZ01, ligne m2 (écrit avant la correction) | refus avec motif « Unité différente du devis » ; règle P-08 partagée (`areSupplierUnitsCompatible`) ; unité de l'offre choisie pour une ligne sans unité |
| R4 | faible | Un marquage envoyé seul sur une offre à prix positif échouait en erreur générique | OZ02 : message générique | erreur de contrainte nommée, même message que le schéma |

Les tests verts antérieurs ne voyaient pas R1 : les tests unitaires construisent des alternatives avec un
prix, et OZ01 passait par l'API. Le panneau est désormais traversé par le parcours.

## Constats hors périmètre

- **Totaux de version périmés après une présélection fournisseurs.** Appliquer la présélection écrit les
  lignes (prix, offre, totaux de ligne corrects) mais laisse les totaux stockés de la version inchangés
  jusqu'à la sauvegarde suivante du devis ; entre-temps l'éditeur affiche « Totaux à synchroniser ». Dans
  OZ01 : version à `[0, 0, 0]` juste après la présélection (`oz01-preselection-persisted`), puis
  `[7 440, 1 488, 8 928]` après les sauvegardes suivantes, somme exacte des lignes. Défaut antérieur au 2.2
  (`useEstimateEditorSupplierController.ts` ne reprend que le jeton de version) ; un devis envoyé ou
  exporté dans cet intervalle pourrait porter un total faux (non observé).
- La suite critique ne crée jamais de fiche catalogue : les parcours du 2.2 tournent dans la phase
  `offers`, que la CI ne rejoue pas.

## Limites

- Normaliseur d'unités complet (« m.l. », « mètre linéaire », NFKD) : sous-lot 2.4.
- Marquage à la création d'une offre : non pris en charge (voir « Écarts »).
- Le motif exact `zero_price` du prix de référence n'est prouvé que par pgTAP : la fixture E2E ne peut pas
  poser de mode de transport (réservé à un administrateur), qui précède ce motif dans l'ordre d'exclusion.
