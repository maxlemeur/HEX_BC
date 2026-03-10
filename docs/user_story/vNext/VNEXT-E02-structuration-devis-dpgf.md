# VNEXT-E02 — Structuration du devis depuis DPGF

> Priorite: P0 | Equipe recommandee: B | Statut: A faire

## Objectif

Consolider le pipeline canonique DPGF pour qu'il reste la source de verite de la structure devis,
et faire converger le DPGF PDF vers ce meme pipeline.

## Ce qui existe deja

- import `csv/xlsx`
- parser tabulaire
- mapping assiste
- normalisation des lignes
- creation affaire/V1 ou nouvelle version via RPC SQL

## User stories

### US-2.1 — Import tabulaire et mapping assiste

Portee:
- preview
- suggestions
- validation
- templates
- memoire
- stats d'import

Priorite: `P0`
Complexite: `M`

### US-2.2 — DPGF PDF vers pipeline canonique

Portee:
- detection des tableaux
- validation ciblee
- alimentation de `dpgf_rows_raw`
- convergence vers le mapping standard

Hors portee:
- OCR libre magique
- creation directe du devis sans validation

Priorite: `P0`
Complexite: `XL`

### US-2.3 — Creation d'affaire ou de nouvelle version

Portee:
- choix nouvelle affaire / nouvelle version
- materialisation structurelle
- counts et totaux

Priorite: `P0`
Complexite: `M`

### US-2.4 — Aides de structuration adjacentes

Portee:
- exposition `version-zero` et `generated-ouvrages`
- labels `adjacent`
- non-confusion avec le flux principal

Priorite: `P2`
Complexite: `M`

## Criteres d'acceptation transverses

- le tabulaire existant n'est pas degrade
- le PDF converge vers le pipeline canonique, sans nouvelle filiere
- la materialisation version/affaire reste traçable
- les aides adjacentes ne remplacent jamais le pipeline principal

## Fichiers / zones probables

- `src/lib/imports/parser.ts`
- `src/lib/imports/server.ts`
- `src/lib/mappings/server.ts`
- `src/lib/affaires/import-flow.ts`
- `src/lib/affaires/import-flow-server.ts`
- `src/app/dashboard/affaires/_actions/import-flow.ts`
- `src/app/dashboard/affaires/_actions/quick-create-affaire.ts`
- `supabase/migrations/20260307113000_ux2_009_create_estimate_version_from_import_lines_section_defaults_fix.sql`
- `supabase/migrations/20260305103000_ux2_011_quick_create_from_import.sql`

## Notes d'implementation

- US-6.1 doit etre traitee en piggyback car elle touche la meme zone de code
- toute entree PDF doit rejoindre `dpgf_rows_raw` puis le mapping standard
- Equipe B possede les contrats import/mapping/RPC

## Dependances

- imports
- mappings
- RPC SQL
- `version-zero`
- `generated-ouvrages`
