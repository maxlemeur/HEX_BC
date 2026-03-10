# VNEXT-E05 — Finish line devis + commandes

> Priorite: P1 | Equipe recommandee: A | Statut: A faire

## Objectif

Offrir une sortie unique depuis l'affaire:
- statuts `ready to send` / `ready to order`
- devis PDF / email / BDC
- brouillons de commandes par fournisseur

## Ce qui existe deja

- PDF devis
- envoi email
- export BDC
- module `purchase_orders`

## User stories

### US-5.1 — Statuts ready to send / ready to order

Priorite: `P1`
Complexite: `M`

### US-5.2 — Sortie devis depuis la finish line

Priorite: `P1`
Complexite: `M`

### US-5.3 — Brouillons de commandes par fournisseur

Priorite: `P1`
Complexite: `L`

## Criteres d'acceptation transverses

- deux statuts distincts et lisibles
- les blocages sont expliques
- PDF / email / BDC sont utilisables depuis un meme point
- les drafts commandes ne sont crees que pour les lignes fournisseur resolues
- aucune commande finale n'est generee silencieusement

## Fichiers / zones probables

- `src/app/api/estimates/[versionId]/pdf/route.ts`
- `src/lib/estimates/pdf-generator.tsx`
- `src/lib/email/send-estimate.ts`
- `src/app/api/estimates/[versionId]/export/route.ts`
- `src/app/api/purchase-orders/route.ts`
- `src/app/dashboard/orders/**`
- nouvelles surfaces affaire finish line [inference]

## Notes d'implementation

- Equipe A possede la finish line affaire
- les commandes restent des brouillons confirmes humainement
- cette vague consomme les sorties pricing deja stabilisees

## Dependances

- VNEXT-E04
- exports
- email
- orders
