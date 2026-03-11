Tu n'as PAS acces a la codebase.
Tu dois travailler uniquement a partir du contexte ci-dessous.

Objectif:
produire le backlog produit de la prochaine version de TIMAX, centre sur la promesse:
- import intelligent du dossier affaire
- structuration du devis
- metre IA
- pricing fournisseur
- finish line devis + commandes

Contraintes absolues:
- n'invente aucune capability non presente dans le contexte
- distingue toujours:
  - ce qui existe deja
  - ce qui est partiel
  - ce qu'il faut construire
- les epics et user stories doivent etre coherents avec la realite actuelle du produit
- quand tu fais une inference, marque-la `[inference]`

Exigence supplementaire: travail important sur l'experience utilisateur, l'interactivité, les outils les plus récents coté application web.
- ne produis pas seulement une liste fonctionnelle; pense le parcours utilisateur de bout en bout
- tiens compte des etats d'avancement, de l'attente, des blocages, des validations humaines, des erreurs, des corrections et de la reprise
- propose une UX qui reduit la charge cognitive pour un chiffreur
- privilegie une logique "gestion par exceptions" plutot qu'une UX qui demande de tout revoir ligne par ligne
- explicite les moments ou l'utilisateur doit comprendre, arbitrer, valider ou corriger

Exigence supplementaire: realite du metier de chiffrage
- raisonne comme si l'utilisateur etait un chiffreur ou charge d'etudes BTP qui travaille sous contrainte de delai, de fiabilite et de marge
- prends en compte les besoins metier reels:
  - traçabilite des quantites et des prix
  - confiance dans les extractions IA
  - comparaison fournisseur exploitable
  - gestion des hypotheses, manques et points de vigilance
  - preservation de la nomenclature et de la structure du devis
  - capacite a reprendre la main manuellement sans casser le flux
- evite les stories "IA magique"
- toute automation doit rester credible pour un contexte de chiffrage reel

Je veux exactement cette sortie :

## A. Vision vNext
Resume en 1 page maximum de ce que doit accomplir la prochaine version.

## B. Principes UX et metier
Definis les principes directeurs de la vNext:
- principes UX
- principes metier de chiffrage
- principes de confiance et de tracabilite

## C. Liste des epics
Pour chaque epic :
- titre
- objectif utilisateur
- probleme resolu
- valeur metier
- dependances
- priorite `P0 / P1 / P2`

## D. User stories par epic
Pour chaque story :
- identifiant `EPIC-X / US-X.Y`
- formulation `En tant que ... je veux ... afin de ...`
- scenario utilisateur
- portee
- hors portee
- dependances
- priorite
- complexite estimative `S / M / L / XL`
## E. Criteres d'acceptation
Pour chaque story :
- criteres fonctionnels
- criteres UX
- criteres de robustesse
- criteres de tracabilite / preuve si applicable
- criteres de controle humain si applicable

## F. Decoupage de release
Propose :
- `Release 1`
- `Release 2`
- `Release 3`

## G Produire un backlog final afin de réduire au maximum les oublis sur un sujet “high stakes”

## F enfaite refaire une derniere revue des users story je veux transformer une idée produit en backlog structuré avec des epics clairs, actionnables et priorisés avec persona, que chaque epic doit être orienté valeur utilisateur et résultat métier.
Vérifie que les epics sont MECE autant que possible: non redondants, complémentaires, couvrant le scope utile.

Règles de qualité:
- Ne fais pas d’epics vagues comme “Gestion” ou “Amélioration UX” sans précision.
- Chaque epic doit représenter un vrai bloc de valeur livrable.
- Évite les doublons entre epics.
- Sépare bien front, back-office, onboarding, paiement, analytics, permissions, notifications, IA, sécurité, seulement si cela a du sens métier.
- Si une idée est trop large, découpe-la en plusieurs epics plus précis.
- Si une idée est trop petite, fusionne-la dans un epic cohérent.
- N’invente pas de besoin non justifié sans l’indiquer comme hypothèse.

Pour chaque release:
- promesse utilisateur
- scope
- ce qui est volontairement reporte

## G. Risques produit et techniques
Liste les principaux risques si on essaie de tenir la promesse trop vite.

## H. Questions ouvertes
Liste les decisions produit/metier a arbitrer avant implementation.

