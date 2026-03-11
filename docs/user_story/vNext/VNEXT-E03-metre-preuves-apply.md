# VNEXT-E03 — Metre IA, preuves et apply controle

> Priorite: P0 | Equipe recommandee: A | Statut: A faire

## Objectif

Faire du takeoff un flux affaire-first:
- plans confirmes exploitables sans reupload
- revue orientee preuves et exceptions
- apply controle avec impact lisible

## Contrat source

Le detail de scenario et les criteres d'acceptation par story restent dans:
- `docs/user_story/vNext/TIMAX-vNext-backlog-structure.md`
- section `EPIC-3`

## Ce qui existe deja

- sync plans depuis l'intake
- `plan_sets`
- create job from plan set
- prompts/niveaux A-B-C
- review page
- apply wizard
- RPC `apply_takeoff_job`

## User stories

### US-3.1 — Plans synchronises et takeoff lancable depuis l'affaire

Priorite: `P0`
Complexite: `M`

### US-3.2 — Revue takeoff pilotee par preuves

Priorite: `P0`
Complexite: `L`

### US-3.3 — Apply controle avec provenance

Priorite: `P0`
Complexite: `M`

## Criteres d'acceptation transverses

- seuls les plans confirms et synchronises sont metrables
- l'utilisateur choisit version cible et niveau
- la revue montre d'abord warnings, faible confiance et manque de preuves
- l'apply affiche l'impact avant confirmation
- aucune fixation automatique des prix dans cette etape

## Fichiers / zones probables

- `src/lib/affaires/intake-plan-sync.ts`
- `src/lib/takeoff/plans.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/takeoff/processor.ts`
- `src/lib/takeoff/prompts.ts`
- `src/lib/takeoff/schemas.ts`
- `src/components/takeoff/TakeoffReviewPage.tsx`
- `src/components/takeoff/TakeoffApplyWizard.tsx`
- `supabase/functions/process_takeoff_job/index.ts`
- `supabase/migrations/20260225133000_tkf013_takeoff_apply_rpc.sql`

## Notes d'implementation

- Equipe A possede les surfaces affaire-first et la narration produit
- Equipe B doit geler les contrats takeoff si un changement moteur est necessaire
- ne pas renvoyer l'utilisateur dans le legacy estimate-first par defaut

## Dependances

- VNEXT-E01
- takeoff existant
- plan sync
