# REF-001 - Decomposer EstimateEditorRow

- Fichier: `src/components/estimates/components/EstimateEditorRow.tsx`
- Priorite: P1
- Complexite: XL
- Statut: A faire

## Probleme

Le composant concentre la branche `section`, la branche `line`, le wiring spreadsheet, le drag and drop, la gestion des cellules MO et les suggestions catalogue async dans un seul composant memoise.

## Pourquoi il est gros

- Double rendu metier `section` et `line` dans le meme composant.
- Beaucoup de cellules inline et de logique de navigation spreadsheet.
- Mini workflow asynchrone de suggestions catalogue.

## Refacto cible

- Extraire `SectionRow`.
- Extraire les groupes de cellules `StandardMoCells` et `LaborSplitCells`.
- Extraire le popover de suggestions catalogue.
- Garder `EstimateEditorRow` comme orchestrateur mince.

## Definition of done

- Le fichier principal passe sous 900 lignes.
- Les branches `section` et `line` sont isolees.
- Les tests existants de navigation et edition restent verts.
- Le comportement memoise et le drag and drop ne regressent pas.
