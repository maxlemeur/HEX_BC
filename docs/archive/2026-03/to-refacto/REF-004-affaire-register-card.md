# REF-004 - Decouper AffaireRegisterCard

- Fichier: `src/components/affaires/AffaireRegisterCard.tsx`
- Priorite: P1
- Complexite: L
- Statut: A faire

## Probleme

Le composant melange etat local, filtres URL, mutations, formulaire manuel, liste, historique, pagination et modal de transition.

## Pourquoi il est gros

- Trop de sections UI autonomes dans le meme fichier.
- Le controleur et la presentation ne sont pas clairement separes.

## Refacto cible

- Extraire `RegisterEntryForm`.
- Extraire la liste principale et l'historique.
- Extraire la pagination.
- Extraire le dialog de transition.

## Definition of done

- Le composant parent garde les callbacks et l'orchestration.
- Les sections presentation sont dans des fichiers dedies.
- Les transitions de statut et filtres URL restent couvertes.
