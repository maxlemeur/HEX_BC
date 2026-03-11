# REF-013 - Decouper PriceBookCsvImport

- Fichier: `src/components/catalogue/PriceBookCsvImport.tsx`
- Priorite: P2
- Complexite: L
- Statut: A faire

## Probleme

Le composant implemente un mini pipeline ETL UI complet: parse, validation, resolution, creation des inconnus et import final.

## Pourquoi il est gros

- Workflow riche mais garde dans un seul composant.
- Plusieurs panneaux d'etape et tableaux de restitution inline.

## Refacto cible

- Extraire `usePriceBookCsvWorkflow`.
- Extraire `PriceBookUploadStep`.
- Extraire `UnknownResolutionPanel`.
- Extraire les tableaux preview et rejected rows.

## Definition of done

- Le workflow est testable sans parser le JSX complet.
- Les etapes sont separees en composants dedies.
- Le comportement d'import reste identique.
