# REF-005 - Decouper EstimateApprovalActions

- Fichier: `src/components/estimates/EstimateApprovalActions.tsx`
- Priorite: P1
- Complexite: L
- Statut: A faire

## Probleme

Le composant centralise etat de workflow, synchro URL, handlers metier, panneaux de soumission, commentaires et historique de revue.

## Pourquoi il est gros

- Plusieurs panneaux metier riches dans un seul composant.
- Logique d'etat et rendu historique fortement couples.

## Refacto cible

- Extraire `ChangesSummarySection`.
- Extraire la checklist correction.
- Extraire le panneau de soumission.
- Extraire l'historique de revue.
- Isoler la logique d'orchestration dans un hook.

## Definition of done

- Chaque panneau principal est dans un fichier dedie.
- La synchro URL et les decisions restent intactes.
- Le fichier principal devient majoritairement orchestration.
