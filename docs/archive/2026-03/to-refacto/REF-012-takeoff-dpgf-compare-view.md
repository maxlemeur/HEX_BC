# REF-012 - Decouper TakeoffDpgfCompareView

- Fichier: `src/components/takeoff/TakeoffDpgfCompareView.tsx`
- Priorite: P2
- Complexite: L
- Statut: A faire

## Probleme

Le composant porte a la fois l'etat de revue, les panneaux risque, la liste maitre, l'aside detail et les modals metier.

## Pourquoi il est gros

- Surface metier coherent mais trop concentree.
- Le fichier contient plusieurs zones UI quasi autonomes.

## Refacto cible

- Extraire `RiskRadarSummary`.
- Extraire `DpgfRowList`.
- Extraire `SelectedRowReviewAside`.
- Extraire `ManualLinkModal` et `RiskStatusModal`.

## Definition of done

- Les modals et l'aside detail ne vivent plus dans le meme fichier.
- Le composant principal garde l'etat partage.
- Les actions de revue et de lien manuel restent identiques.
