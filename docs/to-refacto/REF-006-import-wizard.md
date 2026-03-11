# REF-006 - Decouper ImportWizard

- Fichier: `src/components/imports/ImportWizard.tsx`
- Priorite: P1
- Complexite: L
- Statut: A faire

## Probleme

Le wizard ajoute une state machine locale importante au-dessus de `useImportFlow`, avec scan de fichier, validation, review PDF et historique.

## Pourquoi il est gros

- Plusieurs etapes UX differentes dans un seul fichier.
- Logique de scan et de staging imbriquee dans le rendu.

## Refacto cible

- Extraire `useImportWizardFileStage`.
- Sortir `scanFileHeaders` vers un utilitaire dedie.
- Extraire `ImportSuccessCta`, `ImportHistoryFilters` et `ImportHistoryTable`.

## Definition of done

- Les etapes de fichier et l'historique ne vivent plus dans le meme bloc.
- Le scan d'en-tete est testable hors composant.
- Le parcours utilisateur reste strictement identique.
