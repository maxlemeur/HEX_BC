# REF-016 - Rationaliser TakeoffMetricsDashboard

- Fichier: `src/components/takeoff/TakeoffMetricsDashboard.tsx`
- Priorite: P3
- Complexite: M
- Statut: A faire

## Probleme

Le fichier depasse 1000 lignes principalement parce qu'il contient beaucoup de sous-composants visuels locaux.

## Pourquoi il est gros

- Peu d'etat local et peu de complexite de controle.
- Beaucoup de petits composants presentation dans le meme fichier.

## Refacto cible

- Extraire les formatters.
- Extraire les tables et charts en fichiers freres.
- Optionnellement ajouter `useTakeoffMetrics`.

## Definition of done

- Le dashboard garde son orchestration SWR.
- Les sous-composants visuels vivent hors du fichier principal.
- Aucun changement fonctionnel ou visuel.
