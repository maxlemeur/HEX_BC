Tu n'as PAS acces a la codebase.
Tu dois raisonner uniquement a partir du contexte fourni ci-dessous.

Le contexte fourni contient:
- une synthese produit/technique
- des extraits de code cibles
- des contrats SQL
- des niveaux de preuve (`Prouve`, `Partiel`, `Inference`)

Regles absolues:
- n'invente aucun composant, table, route, capability ou UX non present dans le contexte
- distingue toujours `flux principal`, `branches adjacentes`, `legacy`
- quand une promesse marketing depasse la preuve, dis-le explicitement
- n'eleve pas une capability de `Partiel` a `Prouve`
- marque toute deduction avec `[inference]`

Objectif:
produire un cadrage vNext centre promesse produit + experience utilisateur pour TIMAX.

Promesse cible a analyser:

"Lundi matin, le chaos habituel.
8h00. Votre client vous envoie un DPGF de 3 000 lignes en PDF, quatre grilles tarifaires fournisseurs en Excel et un plan annote a la main. Classiquement, il faut trois jours pour tout ressaisir, croiser et chiffrer."

"L'import intelligent.
Glissez-deposez vos fichiers dans TIMAX. L'algorithme parse le DPGF, identifie chaque ligne article, nettoie les designations et structure le tout en matrice exploitable. Les assemblages techniques metier sont reconnus automatiquement, sans ressaisie. Ensuite les plans sont analyses par l'IA: metrage, tableaux, PDF complexes, confiance, preuves, pages source."

"Ensuite cote devis, l'IA aide a structurer et preparer le contenu: arborescence, V0, lignes/lots, ouvrages suggeres, explications."

"Le chiffrage au meilleur prix.
TIMAX se connecte a vos tarifs negocies et compare chaque reference entre vos fournisseurs. Le moteur arbitre ligne par ligne."

"Le chiffrage boucle avant midi.
Le devis PDF part au client, les bons de commande fournisseurs sont prets."

Je veux exactement cette sortie:

## A. Verite produit actuelle
Classe les capabilities en:
- `solides`
- `partielles`
- `adjacentes`
- `manquantes`

## B. Mapping promesse -> realite
Pour chaque bloc de promesse, indique:
- capability attendue
- statut `prouve / partiel / inference / absent`
- preuve precise issue du contexte
- commentaire honnete

## C. Ce que TIMAX peut promettre aujourd'hui
Redige la version commerciale credibilisee a partir de la realite du produit.

## D. Gaps critiques pour tenir la promesse cible
Liste les trous majeurs qui empechent aujourd'hui de tenir la promesse "avant midi".

## E. Principes UX vNext
Propose une experience cible centree affaire:
- parcours unique
- etats de progression
- points de validation humaine
- traitement des exceptions
- finish line visible

## F. Plan d'implementation vNext
Structure en:
- `Phase 1: unification UX et orchestration`
- `Phase 2: DPGF PDF et intake unifie`
- `Phase 3: pricing fournisseur integre`
- `Phase 4: finish line devis + commandes`

Pour chaque phase:
- objectif utilisateur
- briques existantes a reutiliser
- briques a renforcer
- briques a construire
- risques

## G. Registre de preuves
Tableau final:
- capability
- statut
- niveau de preuve
- source du contexte

Voici le contexte source:

[COLLER ICI LE CONTENU DE context-proof-pack.md]

Si tu as encore de la place en contexte, ajoute aussi ce document de synthese:

[OPTIONNEL: COLLER ICI LE CONTENU DE context-full.md]
