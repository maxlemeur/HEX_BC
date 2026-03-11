# VNEXT-E04 — Pricing fournisseur integre

> Priorite: P0-P1 | Equipe recommandee: B | Statut: A faire

## Objectif

Rendre le pricing fournisseur exploitable depuis l'affaire en logique de couverture et d'exceptions,
sans promettre un arbitrage full-auto.

## Contrat source

Le detail de scenario et les criteres d'acceptation par story restent dans:
- `docs/user_story/vNext/TIMAX-vNext-backlog-structure.md`
- section `EPIC-4`

## Ce qui existe deja

- import pricebook CSV
- suggestions de prix multi-sources
- comparison fournisseur par ligne
- selections fournisseur sur lignes

## User stories

### US-4.1 — Import fournisseur CSV dans le parcours affaire

Priorite: `P0`
Complexite: `L`

### US-4.2 — Extension aux grilles fournisseurs Excel

Priorite: `P1`
Complexite: `XL`

### US-4.3 — Couverture pricing et comparaison exploitable

Priorite: `P0`
Complexite: `L`

### US-4.4 — Preselection assistive a l'echelle du devis

Priorite: `P1`
Complexite: `L`

## Criteres d'acceptation transverses

- le pricebook est injectable depuis l'affaire, pas seulement depuis un ecran a cote
- les lignes sont traitees par couverture: couvertes, ambiguës, sans prix, stale
- les alternatives `best_price`, `most_recent`, `preferred_supplier` restent visibles
- aucun arbitrage irreversible sans confirmation humaine
- aucun support stock temps reel n'est sous-entendu

## Fichiers / zones probables

- `src/components/catalogue/PriceBookCsvImport.tsx`
- `src/lib/catalogue/csv-import.ts`
- `src/lib/catalogue/server.ts`
- `src/lib/takeoff/price-suggestions.ts`
- `src/lib/estimates/server.ts`
- `src/app/api/estimates/[versionId]/supplier-comparisons/route.ts`
- `src/components/estimates/SupplierComparisonPanel.tsx`
- `src/components/estimates/hooks/useEstimateSupplierComparison.ts`

## Notes d'implementation

- Equipe B possede les contrats pricing
- Equipe A integre seulement les points d'entree affaire une fois les contrats stables
- l'objectif est une experience par exceptions, pas une revue exhaustive

## Dependances

- VNEXT-E01
- catalogue / pricebook
- supplier comparison
- price suggestions
