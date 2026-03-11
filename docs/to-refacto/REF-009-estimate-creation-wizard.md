# REF-009 - Decouper EstimateCreationWizard

- Fichier: `src/components/estimates/EstimateCreationWizard.tsx`
- Priorite: P2
- Complexite: L
- Statut: A faire

## Probleme

Le wizard concentre persistance du brouillon, chargement de ressources, validation et plusieurs etapes riches de rendu.

## Pourquoi il est gros

- Le state management et les etapes UI sont colocalises.
- Deux chemins de creation differentes vivent dans le meme composant.

## Refacto cible

- Extraire `useEstimateCreationDraft`.
- Extraire `useEstimateCreationResources`.
- Extraire `ProjectStep`, `PricingStep`, `ImportStep`.
- Isoler la couche submit.

## Definition of done

- Les hooks de ressources et de draft sont testables hors rendu.
- Chaque etape est lisible sans parcourir le wizard complet.
- Les validations et chemins de creation restent inchanges.
