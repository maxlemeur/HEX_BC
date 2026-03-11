# VNEXT-E06 — Continuite, reprise et clarte des flux

> Priorite: P0-P1 | Equipe recommandee: B | Statut: A faire

## Objectif

Rendre le parcours robuste dans le temps:
- carry-over explicite
- reprise apres attente, erreur ou echec partiel
- hierarchie claire entre principal, adjacent et legacy

## Contrat source

Le detail de scenario et les criteres d'acceptation par story restent dans:
- `docs/user_story/vNext/TIMAX-vNext-backlog-structure.md`
- section `EPIC-6`

## Ce qui existe deja

- carry-over best effort
- version links takeoff
- statuts async intake/takeoff
- coexistence flux principal / adjacents / legacy

## User stories

### US-6.1 — Creation de version avec carry-over explicite

Priorite: `P0`
Complexite: `M`

### US-6.2 — Reprise apres attente, erreur ou echec partiel

Priorite: `P1`
Complexite: `L`

### US-6.3 — Hierarchie claire entre flux principal, adjacents et legacy

Priorite: `P1`
Complexite: `M`

## Criteres d'acceptation transverses

- le carry-over n'est plus un warning cache
- l'utilisateur comprend ce qui est repris, perdu, relancable ou acquis
- les boutons de reprise mènent a la bonne etape
- le legacy reste volontaire et balise

## Fichiers / zones probables

- `src/app/dashboard/affaires/_actions/import-flow.ts`
- `src/app/dashboard/affaires/_actions/quick-create-affaire.ts`
- `src/lib/takeoff/version-links.ts`
- `src/lib/affaires/server.ts`
- `src/components/affaires/AffaireHub.tsx`
- routes / surfaces legacy takeoff

## Notes d'implementation

- US-6.1 doit etre traite pendant VNEXT-E02
- US-6.2 et US-6.3 servent de durcissement final avant generalisation
- Equipe B possede les messages de verite sur les contrats techniques

## Dependances

- VNEXT-E02
- VNEXT-E03
- VNEXT-E04
