# REF-014 - Extraire la logique de AffairePilotagePanel

- Fichier: `src/components/affaires/AffairePilotagePanel.tsx`
- Priorite: P2
- Complexite: M
- Statut: A faire

## Probleme

Le volume vient surtout de builders metier purs, plus que du rendu JSX.

## Pourquoi il est gros

- Consolidation de nombreuses regles metier dans le meme fichier.
- Les fonctions de construction d'etat pilotage dominent le volume.

## Refacto cible

- Deplacer `buildReadyToSendAction`, `buildReadyToOrderAction`, `buildFinishLineCards`, `buildPilotageSteps`, `buildPilotageExceptions` vers un module metier dedie.
- Garder le composant React focalise sur le rendu.

## Definition of done

- Les builders vivent hors du composant.
- Les tests couvrent les regles metier extraites.
- Le JSX principal devient sensiblement plus court sans changer l'UX.
