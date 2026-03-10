# EST-E22 - Draft Assisté & Ouvrages Générés

Milestone: M7  
Priorité: P0  
Statut: En cours (parcours EST-381, EST-382 et EST-383 livres, correctifs QA encore ouverts)

## Objectif

Supprimer la page blanche du chiffreur en permettant au produit de proposer une structure de devis, des lots, des ouvrages et un premier brouillon à partir du dossier et du texte métier.

## Dépendances

- EST-E21 - Intake IA & Brief Affaire
- EST-E16 / EST-E17 pour les briques de prix et de quantités

## Etat produit au 2026-03-10

- `EST-381` est livre sur le parcours principal de génération et de revue d'ouvrages.
- `EST-382` est livre sur le parcours principal `Structure IA`; le tuning de pertinence en contexte pauvre reste suivi dans [EST-431](./tickets/bug/EST-431.md).
- `EST-383` est livre sur le parcours principal de sous-detail compose; le correctif d'alignement metier post-QA reste suivi dans [EST-430](./tickets/bug/EST-430.md).
- `EST-384` reste a venir.

---

## EST-381 - Génération d'ouvrages depuis description libre ou CCTP

**Priorité:** P0  
**Effort:** L  
**Couches:** `[AI] [Back] [Front]`

### User Story

> En tant que chiffreur, je veux générer un ouvrage à partir d'une description libre, d'un extrait de CCTP ou d'une note interne, afin de créer rapidement des lignes cohérentes sans repartir de zéro.

### Critères d'acceptation

- [ ] L'utilisateur peut coller un texte libre ou sélectionner un extrait source
- [ ] Le système propose pour chaque ouvrage :
  - lot
  - désignation
  - unité
  - quantité si déductible
  - niveau de confiance
  - sources utilisées
- [ ] Le système ne crée rien silencieusement dans le devis
- [ ] L'utilisateur peut :
  - accepter tel quel
  - éditer avant insertion
  - rejeter
- [ ] Chaque proposition retenue garde une provenance source
- [ ] Le système distingue :
  - ouvrage certain
  - ouvrage plausible
  - question à poser

### Pourquoi cette story

- **Marie** n'est plus seule face à la page vide.
- **Laurent** gagne du temps sur les lots répétitifs.
- **Nadia** profite ensuite d'une meilleure lisibilité des hypothèses de départ.

---

## EST-382 - Génération automatique de structure de lots / chapitres

**Priorité:** P0  
**Effort:** L  
**Couches:** `[AI] [Back] [Front]`
**Etat produit au 2026-03-10:** Livre sur le parcours principal. Correctif de tuning documentaire/metier suivi dans [EST-431](./tickets/bug/EST-431.md).

### User Story

> En tant que chiffreur, je veux que le système propose une structure de devis cohérente à partir du dossier, afin de démarrer mon chiffrage avec une ossature claire.

### Critères d'acceptation

- [ ] Le système peut générer une structure de type :
  - lots
  - chapitres
  - sous-chapitres
- [ ] La structure proposée peut s'appuyer sur :
  - DPGF
  - CCTP
  - historiques d'affaires proches
  - bibliothèques existantes
- [ ] Une preview est affichée avant insertion
- [ ] L'utilisateur choisit :
  - créer une V0 vide structurée
  - fusionner dans une structure existante
  - générer seulement certains lots
- [ ] Les éléments générés reçoivent une provenance
- [ ] Les doublons détectés sont signalés avant application

### Pourquoi cette story

- **Marie** démarre plus proprement.
- **Laurent** ne perd pas son temps sur l'ossature.
- **Nadia** lit un devis mieux structuré dès le début.

---

## EST-383 - Suggestions de sous-détail et ouvrages composés

**Priorité:** P1  
**Effort:** L  
**Couches:** `[AI] [Back] [Front]`
**Etat produit au 2026-03-10:** Livre sur le parcours principal. Correctif d'alignement metier post-QA suivi dans [EST-430](./tickets/bug/EST-430.md).

### User Story

> En tant que chiffreur, je veux que le système me suggère un sous-détail de prix cohérent pour un ouvrage, afin d'accélérer la création d'ouvrages composés tout en gardant une logique BTP exploitable.

### Critères d'acceptation

- [ ] À partir d'un ouvrage, le système peut proposer :
  - matériaux
  - main d'oeuvre
  - matériel
  - sous-traitance
  - pertes
  - rendements
- [ ] La suggestion s'appuie sur :
  - bibliothèques internes
  - pricebooks
  - ouvrages historiques
  - référentiels si disponibles
- [ ] Chaque composant suggéré affiche sa source probable
- [ ] L'utilisateur peut modifier, supprimer ou compléter chaque composant
- [ ] La proposition calcule un coût et un prix cible indicatif
- [ ] Aucun ouvrage composé n'est publié sans validation humaine

### Pourquoi cette story

- **Marie** est aidée sans être abandonnée à des chiffres opaques.
- **Laurent** peut aller très vite sur des familles connues.
- **Nadia** bénéficie de prix plus justifiables lors de la revue.

---

## EST-384 - Brouillon complet "dossier -> V0"

**Priorité:** P1  
**Effort:** XL  
**Couches:** `[AI] [Back] [Front] [DB]`

### User Story

> En tant que chiffreur, je veux générer un premier brouillon complet de version à partir du dossier et du brief validé, afin de me concentrer sur la revue plutôt que sur la saisie de départ.

### Critères d'acceptation

- [ ] Le système peut produire une V0 contenant :
  - structure
  - premières lignes
  - suggestions d'ouvrages
  - hypothèses ouvertes
- [ ] Le brouillon est explicitement marqué `IA - à revoir`
- [ ] Chaque ligne insérée possède :
  - provenance
  - niveau de confiance
  - éventuelles hypothèses
- [ ] Le produit indique clairement ce qui a été généré et ce qui est manquant
- [ ] Une vue `Review V0` existe avant tout envoi interne
- [ ] L'utilisateur peut générer seulement certains lots si le reste est trop incertain

### Pourquoi cette story

- **Marie** gagne un vrai démarrage assisté.
- **Laurent** transforme son temps en arbitrage expert.
- **Nadia** entre plus vite dans une logique de revue par exception.
