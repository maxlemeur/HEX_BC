# Offre à 0 € et « ML » = mètre linéaire (sous-lot 2.2)

Statut : **contrat écrit avant implémentation**, branche `lot2/2.2-offre-zero-ml` (base `28c7546b`).
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
  `m` / `ml` insensible à la casse, en TS et dans la préparation d'achat SQL.
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

## Exécution rouge

À compléter : journal des tests d'exigence rouges sur `28c7546b`.
