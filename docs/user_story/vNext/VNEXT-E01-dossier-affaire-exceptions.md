# VNEXT-E01 — Dossier affaire pilote et gestion par exceptions

> Priorite: P0 | Equipe recommandee: A | Statut: A faire

## Objectif

Faire de l'affaire le cockpit unique du chiffreur:
- depot du dossier
- brief et registre a confirmer
- timeline transverse
- file d'exceptions orientee action

## Contrat source

Le detail de scenario et les criteres d'acceptation par story restent dans:
- `docs/user_story/vNext/TIMAX-vNext-backlog-structure.md`
- section `EPIC-1`

## Ce qui existe deja

- hub affaire
- intake documentaire
- brief affaire
- registre
- signaux de marge / DPGF / plans

## User stories

### US-1.1 — Depot unique du dossier

Objectif utilisateur:
- deposer tout le dossier dans l'affaire
- voir immediatement comment chaque fichier sera exploite

Portee:
- depot multi-fichiers
- type detecte
- statut
- destination de traitement
- reclassification des cas ambigus

Priorite: `P0`
Complexite: `L`

### US-1.2 — Brief et registre a confirmer

Objectif utilisateur:
- confirmer ou corriger brief, hypotheses, vigilances et manques avant les automations aval

Portee:
- brief
- sources
- reclassification
- confirmation explicite

Priorite: `P0`
Complexite: `M`

### US-1.3 — Timeline globale et file d'exceptions

Objectif utilisateur:
- savoir ou reprendre le dossier et traiter d'abord les vrais blocages

Portee:
- timeline transverse
- exceptions intake / takeoff / pricing / finish line
- deep links vers le bon point de correction

Priorite: `P0`
Complexite: `L`

## Criteres d'acceptation transverses

- la vue par defaut montre le travail utile restant
- aucune revue exhaustive ligne par ligne n'est imposee par defaut
- chaque exception renvoie vers sa source ou sa surface de correction
- la confirmation humaine du brief reste explicite

## Fichiers / zones probables

- `src/app/dashboard/affaires/[projectId]/page.tsx`
- `src/components/affaires/AffaireHub.tsx`
- `src/components/affaires/IntakeWorkspace.tsx`
- `src/components/affaires/BriefDraftCard.tsx`
- `src/lib/affaires/server.ts`
- `src/lib/affaires/intake-server.ts`

## Notes d'implementation

- Equipe A possede la coque affaire et la navigation
- ne pas creer un second "centre d'operations" hors affaire
- toutes les automations doivent rester compréhensibles dans le contexte de l'affaire

## Dependances

- intake
- brief
- register
- import-flow
- takeoff
- pricing
- finish line
