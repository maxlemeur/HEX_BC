# REF-010 - Decouper TakeoffApplyWizard

- Fichier: `src/components/takeoff/TakeoffApplyWizard.tsx`
- Priorite: P2
- Complexite: L
- Statut: A faire

## Probleme

Le modal porte quatre etapes, la preview async, la table d'overrides et le guard low-confidence dans un seul composant.

## Pourquoi il est gros

- Plusieurs ecrans distincts vivent dans le meme fichier.
- La table d'impact et d'override est dense et coupee du reste conceptuellement.

## Refacto cible

- Extraire les corps des etapes 1, 2 et 4.
- Extraire la table preview/override.
- Ajouter `useTakeoffApplyPreview`.

## Definition of done

- Le modal principal ne porte plus les gros tableaux inline.
- Les gardes de verification et le submit restent identiques.
- Les etapes sont separables sans perte de lisibilite.
