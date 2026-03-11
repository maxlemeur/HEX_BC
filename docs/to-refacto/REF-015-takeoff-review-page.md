# REF-015 - Alleger TakeoffReviewPage

- Fichier: `src/components/takeoff/TakeoffReviewPage.tsx`
- Priorite: P3
- Complexite: M
- Statut: A faire

## Probleme

La page est volumineuse surtout comme orchestrateur: navigation URL, chargements, autosave et ouverture du wizard apply.

## Pourquoi il est gros

- Beaucoup de logique de page concentree au meme endroit.
- Les vues lourdes sont deja deleguees, donc le probleme est moindre.

## Refacto cible

- Extraire `useTakeoffReviewRoutingState`.
- Extraire `useTakeoffReviewData`.
- Extraire `useTakeoffReviewAutosave`.
- Laisser le rendu principal relativement stable.

## Definition of done

- Les pipelines de chargement et d'autosave vivent dans des hooks.
- La page reste le point d'assemblage.
- Aucun changement UX visible.
