# REF-011 - Decouper EstimateStructureDraftDialog

- Fichier: `src/components/estimates/EstimateStructureDraftDialog.tsx`
- Priorite: P2
- Complexite: XL
- Statut: A faire

## Probleme

Le fichier melange logique pure de merge/arbre/normalisation et wizard UI de draft structurel.

## Pourquoi il est gros

- Une partie du volume vient d'algorithmes purs.
- L'autre partie vient de plusieurs ecrans riches de revue et d'override.

## Refacto cible

- Deplacer la logique pure vers `src/lib`.
- Extraire `SourcesStep`, `SelectionStep`, `OverridesStep`, `ApplyResultStep`.
- Extraire les cartes de noeud et d'override.

## Definition of done

- Les fonctions pures ne vivent plus dans le composant.
- Le wizard devient une composition d'etapes claires.
- Les decisions de merge restent strictement identiques.
