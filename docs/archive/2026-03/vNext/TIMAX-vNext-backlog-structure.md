# TIMAX vNext — Backlog produit structuré

> Source unique utilisée : documents de contexte fournis (`context-proof-pack.md`, `PROMESSE-PRODUIT-VNEXT-ANALYSE-PLAN.md`, contexte précédent).
>
> Règles appliquées :
> - aucune capability non présente dans le contexte n’est présentée comme existante ;
> - distinction stricte entre **flux principal**, **branches adjacentes** et **legacy** ;
> - quand un point relève d’une proposition de vNext, il est marqué **[inference]** ;
> - aucune capability `Partiel` n’est élevée à `Prouvé`.

---

## 1. Cadre de vérité

### 1.1 Flux principal à préserver

Le flux principal prouvé par le contexte est :

`affaire -> intake documentaire -> brief -> import DPGF tabulaire -> mapping -> création de version -> sync plans -> takeoff IA -> review/apply -> suggestions de prix`

### 1.2 Branches adjacentes

- `version-zero` : génération d’une structure V0 depuis le brief
- `generated-ouvrages` : suggestions d’ouvrages depuis des extraits documentaires

### 1.3 Legacy

- `takeoff estimate-first` : ancien flux encore présent mais non canonique

### 1.4 Personas de référence [inference]

- **Chiffreur / chargé d’études BTP** : doit aller vite, sans perdre la maîtrise des quantités, des prix et de la structure du devis
- **Responsable validation / direction d’études** : veut des sorties traçables, relisibles, défendables vis-à-vis du client et des achats

---

## 2. Vision vNext [inference]

La prochaine version doit transformer TIMAX d’un ensemble de briques déjà puissantes en **un parcours affaire unique, piloté par exceptions**, dans lequel le chiffreur peut déposer son dossier, comprendre immédiatement ce que TIMAX sait exploiter, sécuriser le brief, structurer le devis, compléter les quantités depuis les plans, comparer les prix fournisseurs et terminer sur une finish line lisible côté devis et côté commandes.

La promesse crédible de cette vNext est :

- une **entrée unique** centrée affaire ;
- un **parcours lisible** avec états d’avancement, reprises et blocages ;
- une **gestion par exceptions** plutôt qu’une revue exhaustive ligne par ligne ;
- une **traçabilité visible** des quantités, des prix, des hypothèses et des sources ;
- une **accélération forte** du travail du chiffreur, sans raconter une automatisation “magique”.

La vNext ne doit pas vendre comme déjà acquis :

- DPGF PDF full-auto sans validation ;
- arbitrage fournisseur global sans humain ;
- stock temps réel ;
- commandes fournisseurs finales générées automatiquement sans revue ;
- promesse “bouclé avant midi” sans workflow de contrôle.

---

## 3. Principes UX et métier [inference]

### 3.1 Principes UX

1. **Une seule affaire, un seul fil rouge**
   - l’utilisateur ne doit pas reconstruire mentalement le parcours entre intake, devis, plans, pricing et sortie.

2. **Gestion par exceptions**
   - par défaut, l’interface montre d’abord :
     - les documents ambigus,
     - les mappings incomplets,
     - les items takeoff fragiles,
     - les prix manquants / ambigus / stale,
     - les prérequis de sortie non remplis.

3. **Progression explicite**
   - chaque étape du flux principal doit afficher un état :
     - non démarré,
     - en cours,
     - en attente de validation,
     - bloqué,
     - terminé.

4. **Corrections dans le contexte**
   - l’utilisateur doit corriger là où l’erreur apparaît, sans changer de logique produit.

5. **Asynchrone lisible**
   - ce qui tourne en tâche de fond doit être visible, repris simplement, et ne pas casser le reste du parcours.

6. **Progressive disclosure**
   - l’interface par défaut reste simple ; les détails de preuve et de diagnostic se déplient au besoin.

### 3.2 Principes métier de chiffrage

1. **Préserver la structure du devis**
   - la nomenclature et l’arborescence sont des actifs métier, pas des détails d’UI.

2. **Séparer structure, quantités et prix**
   - ne pas mélanger le DPGF, le takeoff et le pricing dans une seule logique opaque.

3. **Rendre visibles hypothèses, manques et vigilances**
   - ce qui manque ou est supposé doit rester défendable.

4. **Permettre la reprise en main manuelle**
   - toute automatisation doit pouvoir être corrigée sans casser le flux.

5. **Privilégier couverture et fiabilité avant full-auto**
   - mieux vaut accélérer fortement avec contrôle que promettre un résultat fragile.

### 3.3 Principes de confiance et de traçabilité

1. **Toute quantité IA doit être relisible**
   - page source, evidence, confidence quand disponibles.

2. **Tout prix suggéré doit être explicable**
   - source, fraîcheur, logique de sélection.

3. **Chaque transformation majeure doit laisser une provenance**
   - import source, mapping, takeoff job, stratégie d’apply, choix fournisseur, sortie produite.

4. **Confiance ≠ validation**
   - la confiance machine aide au tri, elle ne remplace pas la décision humaine.

---

## 4. Liste des epics

## EPIC-1 — Dossier affaire piloté et gestion par exceptions

- **Objectif utilisateur** : disposer d’un poste de pilotage unique du dossier de chiffrage.
- **Problème résolu** : la valeur existe déjà mais reste éclatée entre intake, import DPGF, plans/takeoff, pricing et sorties.
- **Valeur métier** : réduction de charge cognitive, meilleure reprise, moins d’oublis.
- **Ce qui existe déjà** :
  - hub affaire
  - intake documentaire
  - brief / registre
  - surfaces dédiées côté affaire
- **Ce qui est partiel** :
  - timeline transverse
  - vue unifiée des blocages
  - parcours vraiment unique
- **Ce qu’il faut construire** [inference] :
  - dépôt unique visible
  - timeline globale
  - file d’exceptions
  - reprise de session
- **Dépendances** :
  - `AffaireHub`
  - `IntakeWorkspace`
  - brief/register
  - import-flow
  - takeoff
  - pricing
  - exports
- **Priorité** : `P0`

## EPIC-2 — Structuration du devis depuis DPGF

- **Objectif utilisateur** : obtenir une base de devis fiable et rapide à valider.
- **Problème résolu** : le tabulaire est solide, le DPGF PDF ne converge pas encore vers le pipeline canonique.
- **Valeur métier** : moins de ressaisie, meilleure stabilité de structure, meilleure continuité métier.
- **Ce qui existe déjà** :
  - import `json/csv/xlsx`
  - mapping avec preview / suggestions / validation / templates
  - normalisation de lignes
  - création d’affaire / version via RPC SQL
- **Ce qui est partiel** :
  - DPGF PDF seulement détecté en périphérie
- **Ce qu’il faut construire** [inference] :
  - convergence DPGF PDF -> `dpgf_rows_raw` -> mapping canonique
  - validation ciblée des ambiguïtés PDF
  - exposition claire des aides adjacentes
- **Dépendances** :
  - parser/imports
  - mappings
  - `create_affaire_from_import_lines`
  - `create_estimate_version_from_import_lines`
  - `version-zero`
  - `generated-ouvrages`
- **Priorité** : `P0`

## EPIC-3 — Mètre IA sur plans avec preuves et injection contrôlée

- **Objectif utilisateur** : enrichir le devis avec des quantités justifiées depuis les plans.
- **Problème résolu** : le takeoff est fort, mais doit être vécu comme un flux piloté et relisible.
- **Valeur métier** : gain de temps sur le métré, meilleure confiance dans les quantités.
- **Ce qui existe déjà** :
  - plan sync depuis l’intake
  - `plan_sets`
  - takeoff `plan-set centric`
  - niveaux A/B/C
  - review/apply
  - stratégies `append/replace/merge`
- **Ce qui est partiel** :
  - robustesse manuscrite non prouvée
  - preuves/confiance surtout fortes au niveau C
- **Ce qu’il faut construire** [inference] :
  - monitoring affaire-first du takeoff
  - revue d’abord par alertes
  - meilleure reprise en cas d’échec partiel
- **Dépendances** :
  - intake plan sync
  - `createTakeoffJobFromPlanSet`
  - `TakeoffReviewPage`
  - `TakeoffApplyWizard`
  - `apply_takeoff_job`
- **Priorité** : `P0`

## EPIC-4 — Pricing fournisseur intégré et couverture de prix

- **Objectif utilisateur** : exploiter les tarifs négociés dans le même parcours affaire et traiter seulement les exceptions prix.
- **Problème résolu** : les briques pricing existent, mais restent trop séparées et coûteuses à exploiter à grande échelle.
- **Valeur métier** : meilleure marge, gain de temps, meilleure confiance prix.
- **Ce qui existe déjà** :
  - suggestions de prix multi-sources
  - import fournisseur via pricebook CSV
  - comparaison fournisseur par ligne
- **Ce qui est partiel** :
  - intégration dans le parcours affaire
  - expérience Excel fournisseur
  - couverture prix synthétique
  - présélection à l’échelle du devis
- **Ce qu’il faut construire** [inference] :
  - entrée affaire pour le pricebook
  - couverture `couverte / ambiguë / sans prix / stale`
  - présélection assistive bulk
  - revue d’écarts
- **Dépendances** :
  - `PriceBookCsvImport`
  - `suggestEstimateCataloguePrices`
  - `getEstimateSupplierComparisons`
  - sélection fournisseur dans l’éditeur
- **Priorité** : `P0`

## EPIC-5 — Finish line devis + commandes

- **Objectif utilisateur** : terminer le dossier avec un devis envoyable et des commandes préparables.
- **Problème résolu** : les briques de sortie existent, mais pas comme finish line unique lisible.
- **Valeur métier** : réduction du dernier kilomètre, meilleure opérabilité.
- **Ce qui existe déjà** :
  - export PDF
  - envoi email du devis
  - export BDC
  - module `purchase_orders`
- **Ce qui est partiel** :
  - chaîne explicite `devis final -> commandes prêtes à finaliser`
- **Ce qu’il faut construire** [inference] :
  - états `ready to send` / `ready to order`
  - wizard de regroupement par fournisseur
  - brouillons de commandes à partir des choix fournisseur
- **Dépendances** :
  - PDF generator
  - send-estimate
  - export `bdc`
  - APIs et écrans `purchase_orders`
- **Priorité** : `P1`

## EPIC-6 — Continuité du chiffrage et reprise fiable

- **Objectif utilisateur** : ne pas perdre le fil ni les preuves entre imports, versions, jobs asynchrones et transitions de flux.
- **Problème résolu** : carry-over takeoff best-effort, coexistence `project_id` / `estimate_version_id`, legacy encore présent.
- **Valeur métier** : confiance, continuité, réduction du risque opérationnel.
- **Ce qui existe déjà** :
  - création d’affaire / nouvelle version depuis import
  - warning sur carry-over
  - modèle plans en transition
  - legacy takeoff identifié
- **Ce qui est partiel** :
  - visibilité utilisateur de ces limites
  - reprise fluide après erreur / attente
- **Ce qu’il faut construire** [inference] :
  - carry-over explicite
  - reprise guidée
  - hiérarchie claire entre flux principal, adjacents et legacy
- **Dépendances** :
  - import-flow server actions
  - `takeoff_version_links`
  - `plans.ts`
  - surfaces legacy
- **Priorité** : `P0`

---

## 5. User stories par epic

## EPIC-1 — Dossier affaire piloté et gestion par exceptions

### EPIC-1 / US-1.1 — Dépôt unique du dossier
- **Formulation** : En tant que chiffreur, je veux déposer l’ensemble du dossier dans l’affaire afin que TIMAX m’indique immédiatement comment chaque fichier va être exploité.
- **Scénario utilisateur** :
  1. je glisse plusieurs fichiers dans l’affaire ;
  2. TIMAX affiche pour chacun un type détecté, un statut et une destination de traitement ;
  3. je corrige les cas ambigus avant de continuer.
- **Portée** :
  - dépôt multi-fichiers
  - routage proposé
  - statuts par fichier
  - visibilité des fichiers non classés
- **Hors portée** :
  - exploitation full-auto du DPGF PDF
  - exploitation full-auto des grilles Excel
- **Dépendances** :
  - intake
  - import DPGF
  - sync plans
  - pricebook
- **Priorité** : `P0`
- **Complexité estimative** : `L`

### EPIC-1 / US-1.2 — Brief et registre à confirmer
- **Formulation** : En tant que chargé d’études, je veux confirmer ou corriger le brief et le registre avant les automatisations aval afin de sécuriser les hypothèses.
- **Scénario utilisateur** :
  1. après classification, je relis le brief ;
  2. je vérifie les hypothèses, vigilances, manques et sources ;
  3. je reclassifie si besoin ;
  4. je confirme.
- **Portée** :
  - brief
  - sources
  - hypothèses
  - vigilances
  - manques
  - confirmation
  - reclassification
- **Hors portée** :
  - confirmation automatique sans contrôle humain
- **Dépendances** :
  - intake
  - brief
  - register
- **Priorité** : `P0`
- **Complexité estimative** : `M`

### EPIC-1 / US-1.3 — Timeline globale et file d’exceptions
- **Formulation** : En tant que chiffreur, je veux une timeline unique et une file d’exceptions afin de reprendre le dossier là où il bloque réellement.
- **Scénario utilisateur** :
  1. j’ouvre l’affaire ;
  2. je vois ce qui est terminé, en cours, bloqué ou en attente ;
  3. je clique sur une exception ;
  4. j’arrive directement au bon point de correction.
- **Portée** :
  - timeline transverse
  - regroupement des ambiguïtés, échecs, stale, non couverts, validations attendues
- **Hors portée** :
  - revue exhaustive ligne par ligne par défaut
- **Dépendances** :
  - hub affaire
  - intake
  - takeoff
  - pricing
  - finish line
- **Priorité** : `P0`
- **Complexité estimative** : `L`

## EPIC-2 — Structuration du devis depuis DPGF

### EPIC-2 / US-2.1 — Import tabulaire et mapping assisté
- **Formulation** : En tant que chiffreur, je veux importer un DPGF tabulaire et corriger seulement le mapping nécessaire afin d’obtenir une base de devis exploitable rapidement.
- **Scénario utilisateur** :
  1. je charge un CSV/XLSX ;
  2. TIMAX propose le mapping ;
  3. je corrige les champs ambigus ;
  4. je valide.
- **Portée** :
  - preview
  - suggestions
  - validation
  - templates
  - mémoire
  - statistiques d’import
- **Hors portée** :
  - DPGF PDF
- **Dépendances** :
  - parser/imports
  - mappings
- **Priorité** : `P0`
- **Complexité estimative** : `M`

### EPIC-2 / US-2.2 — DPGF PDF vers pipeline canonique
- **Formulation** : En tant que chiffreur, je veux qu’un DPGF PDF tabulaire converge vers le même pipeline que le tabulaire afin de ne pas recréer un flux à part.
- **Scénario utilisateur** :
  1. je dépose un PDF ;
  2. TIMAX détecte les tableaux ;
  3. je valide les ambiguïtés ;
  4. j’arrive dans le mapping standard.
- **Portée** :
  - détection des tableaux
  - validation ciblée
  - alimentation de `dpgf_rows_raw`
  - réutilisation du mapping existant
- **Hors portée** :
  - OCR libre hors logique tabulaire
  - conversion magique sans validation
- **Dépendances** :
  - import canonique
  - classifier `tabular_pdf`
  - mapping
- **Priorité** : `P0`
- **Complexité estimative** : `XL`

### EPIC-2 / US-2.3 — Création d’affaire ou de nouvelle version
- **Formulation** : En tant que chargé d’études, je veux matérialiser le résultat de l’import en affaire + V1 ou en nouvelle version afin de préserver la structure du devis sans ressaisie.
- **Scénario utilisateur** :
  1. après mapping validé, je choisis “nouvelle affaire” ou “nouvelle version” ;
  2. TIMAX crée la structure ;
  3. je récupère la version prête à enrichir.
- **Portée** :
  - choix du mode
  - version/section title
  - totaux
  - inserted count
- **Hors portée** :
  - carry-over takeoff implicite garanti
- **Dépendances** :
  - RPC SQL
  - import-flow server
- **Priorité** : `P0`
- **Complexité estimative** : `M`

### EPIC-2 / US-2.4 — Aides de structuration adjacentes
- **Formulation** : En tant que chiffreur, je veux pouvoir appeler `version-zero` ou `generated-ouvrages` comme appoint quand mon DPGF est incomplet afin d’accélérer la préparation du devis.
- **Scénario utilisateur** :
  1. je constate des lots ou lignes manquants ;
  2. j’utilise une aide adjacente ;
  3. TIMAX me propose une structure ou des ouvrages ;
  4. je décide si je les matérialise.
- **Portée** :
  - exposition depuis l’affaire
  - labels `adjacent`
  - non-confusion avec le flux principal
- **Hors portée** :
  - pricing final via V0
  - remplacement du flux DPGF/takeoff
- **Dépendances** :
  - `version-zero`
  - `generated-ouvrages`
- **Priorité** : `P2`
- **Complexité estimative** : `M`

## EPIC-3 — Mètre IA sur plans avec preuves

### EPIC-3 / US-3.1 — Plans synchronisés et takeoff lançable depuis l’affaire
- **Formulation** : En tant que chiffreur, je veux que les plans confirmés dans l’intake deviennent directement exploitables pour le takeoff afin de ne pas recharger mes fichiers.
- **Scénario utilisateur** :
  1. je confirme le brief ;
  2. les plans sont synchronisés ;
  3. je choisis une version et un niveau A/B/C ;
  4. je lance le job.
- **Portée** :
  - sync plans
  - sélection du `plan_set`
  - choix du niveau
  - lancement
- **Hors portée** :
  - chemin legacy estimate-first comme parcours principal
- **Dépendances** :
  - intake plan sync
  - takeoff server
- **Priorité** : `P0`
- **Complexité estimative** : `M`

### EPIC-3 / US-3.2 — Revue takeoff pilotée par preuves
- **Formulation** : En tant que chargé d’études, je veux revoir d’abord les items fragiles, non reliés ou peu prouvés afin de valider vite ce qui mérite une attention humaine.
- **Scénario utilisateur** :
  1. j’ouvre la revue takeoff ;
  2. TIMAX me montre warnings, faible confiance, manque d’evidence/page, décisions en attente ;
  3. je relie, j’exclus ou je valide.
- **Portée** :
  - review decisions
  - liens manuels DPGF/takeoff
  - tri par exception
- **Hors portée** :
  - édition libre non documentée des items takeoff
- **Dépendances** :
  - review page
  - manual links
  - review decisions
- **Priorité** : `P0`
- **Complexité estimative** : `L`

### EPIC-3 / US-3.3 — Apply contrôlé avec provenance
- **Formulation** : En tant que chiffreur, je veux appliquer les quantités avec une stratégie explicite afin d’enrichir mon devis sans casser l’existant.
- **Scénario utilisateur** :
  1. je choisis `append`, `replace` ou `merge` ;
  2. TIMAX me montre l’impact ;
  3. je confirme.
- **Portée** :
  - apply wizard
  - preview d’impact
  - counts créés/mis à jour/ignorés
  - provenance takeoff
- **Hors portée** :
  - fixation automatique des prix lors de l’apply
- **Dépendances** :
  - `apply_takeoff_job`
  - version draft
  - job completed
- **Priorité** : `P0`
- **Complexité estimative** : `M`

## EPIC-4 — Pricing fournisseur intégré et couverture de prix

### EPIC-4 / US-4.1 — Import fournisseur CSV dans le parcours affaire
- **Formulation** : En tant que chiffreur, je veux importer une grille fournisseur CSV dans l’affaire afin que mes tarifs négociés alimentent le pricing du devis.
- **Scénario utilisateur** :
  1. depuis l’affaire, je charge un CSV fournisseur ;
  2. je passe les étapes d’association/résolution ;
  3. les prix deviennent exploitables dans le devis.
- **Portée** :
  - déclenchement depuis l’affaire
  - étapes `Charger / Detection / Associer / Resoudre / Importer`
- **Hors portée** :
  - import Excel bout en bout dans cette première itération
- **Dépendances** :
  - pricebook CSV import
  - catalogue/server
- **Priorité** : `P0`
- **Complexité estimative** : `L`

### EPIC-4 / US-4.2 — Extension aux grilles fournisseurs Excel
- **Formulation** : En tant que chargé d’études, je veux traiter des grilles fournisseurs Excel dans le même parcours afin de coller davantage à mon entrée métier réelle.
- **Scénario utilisateur** :
  1. je dépose une grille Excel fournisseur ;
  2. TIMAX la fait converger vers la même logique de mapping/résolution que le CSV.
- **Portée** :
  - ingestion Excel dans le parcours affaire
- **Hors portée** :
  - drop-all full-auto de plusieurs grilles sans résolution
- **Dépendances** :
  - US-4.1
  - pricebook pipeline
- **Priorité** : `P1`
- **Complexité estimative** : `XL`

### EPIC-4 / US-4.3 — Couverture pricing et comparaison exploitable
- **Formulation** : En tant que chiffreur, je veux voir les lignes couvertes, ambiguës, sans prix ou stale afin de travailler le pricing par exception.
- **Scénario utilisateur** :
  1. j’ouvre la vue pricing ;
  2. TIMAX regroupe les lignes selon leur qualité de couverture ;
  3. j’affiche les alternatives fournisseur et je tranche les cas utiles.
- **Portée** :
  - `best_price`
  - `most_recent`
  - `preferred_supplier`
  - stale
  - couverture
- **Hors portée** :
  - stock temps réel
- **Dépendances** :
  - supplier comparisons
  - price suggestions
- **Priorité** : `P0`
- **Complexité estimative** : `L`

### EPIC-4 / US-4.4 — Présélection assistive à l’échelle du devis
- **Formulation** : En tant que chargé d’études, je veux qu’une présélection assistive me propose les meilleurs choix ligne par ligne afin que je ne traite plus que les écarts.
- **Scénario utilisateur** :
  1. je lance une présélection ;
  2. TIMAX pré-remplit les cas simples ;
  3. il isole les lignes ambiguës, stale ou non couvertes ;
  4. je valide ou corrige.
- **Portée** :
  - bulk assistive
  - justification
  - file d’écarts
- **Hors portée** :
  - arbitrage full-auto irréversible
  - stock-aware pricing
- **Dépendances** :
  - US-4.1
  - US-4.3
- **Priorité** : `P1`
- **Complexité estimative** : `L`

## EPIC-5 — Finish line devis + commandes

### EPIC-5 / US-5.1 — Statuts ready to send / ready to order
- **Formulation** : En tant que chiffreur, je veux savoir si le dossier est prêt à envoyer côté devis et prêt à finaliser côté commandes afin de sécuriser ma sortie.
- **Scénario utilisateur** :
  1. j’ouvre l’affaire ;
  2. je vois deux statuts distincts ;
  3. TIMAX m’indique les prérequis manquants.
- **Portée** :
  - readiness states
  - raisons bloquantes
- **Hors portée** :
  - envoi ou commande automatiques sans confirmation
- **Dépendances** :
  - exports
  - email
  - orders
  - pricing coverage
- **Priorité** : `P1`
- **Complexité estimative** : `M`

### EPIC-5 / US-5.2 — Sortie devis depuis la finish line
- **Formulation** : En tant que chargé d’études, je veux générer/envoyer le devis et exporter le BDC depuis le même point afin de terminer le dossier sans dispersion.
- **Scénario utilisateur** :
  1. depuis la finish line, je génère le PDF ;
  2. j’envoie l’email ;
  3. ou j’exporte le BDC.
- **Portée** :
  - PDF
  - email
  - BDC depuis l’affaire
- **Hors portée** :
  - règles métiers avancées de validation commerciale non documentées
- **Dépendances** :
  - PDF route
  - send-estimate
  - export route
- **Priorité** : `P1`
- **Complexité estimative** : `M`

### EPIC-5 / US-5.3 — Brouillons de commandes par fournisseur
- **Formulation** : En tant que chiffreur, je veux générer des brouillons de commandes regroupés par fournisseur afin de préparer l’achat sans ressaisie.
- **Scénario utilisateur** :
  1. j’ouvre la finish line commandes ;
  2. TIMAX me propose des regroupements par fournisseur ;
  3. je crée les drafts utiles.
- **Portée** :
  - groupement par fournisseur
  - création de drafts
  - rattachement aux lignes source
- **Hors portée** :
  - génération finale automatique de toutes les commandes sans revue
- **Dépendances** :
  - purchase orders
  - sélections fournisseur sur lignes
  - BDC/export
- **Priorité** : `P1`
- **Complexité estimative** : `L`

## EPIC-6 — Continuité du chiffrage et reprise fiable

### EPIC-6 / US-6.1 — Création de version avec carry-over explicite
- **Formulation** : En tant que chargé d’études, je veux savoir exactement ce qui est repris ou non quand je crée une nouvelle version afin d’éviter les pertes invisibles.
- **Scénario utilisateur** :
  1. après un import, TIMAX me montre l’état du carry-over takeoff ;
  2. je comprends ce qui suit, ce qui doit être relancé et ce qui reste acquis ;
  3. je confirme.
- **Portée** :
  - visibilité du carry-over
  - next steps explicites
- **Hors portée** :
  - garantie implicite de carry-over complet
- **Dépendances** :
  - create version from import
  - takeoff links
- **Priorité** : `P0`
- **Complexité estimative** : `M`

### EPIC-6 / US-6.2 — Reprise après attente, erreur ou échec partiel
- **Formulation** : En tant que chiffreur, je veux reprendre un dossier après un job asynchrone, un échec partiel ou une interruption afin de ne pas repartir de zéro.
- **Scénario utilisateur** :
  1. je reviens dans l’affaire ;
  2. TIMAX me montre ce qui attend, ce qui a échoué et ce qui est déjà acquis ;
  3. je relance ou corrige seulement ce qui est nécessaire.
- **Portée** :
  - reprise pour intake
  - reprise pour takeoff
  - reprise pour pricing
  - reprise pour finish line
- **Hors portée** :
  - moteur générique de retry sur tous les sous-systèmes sans distinction
- **Dépendances** :
  - statuts intake
  - async takeoff
  - outputs
- **Priorité** : `P1`
- **Complexité estimative** : `L`

### EPIC-6 / US-6.3 — Hiérarchie claire entre flux principal, adjacents et legacy
- **Formulation** : En tant que chiffreur, je veux que TIMAX me guide d’abord sur le bon parcours afin d’éviter les confusions entre flux principal, aides adjacentes et legacy.
- **Scénario utilisateur** :
  1. je suis dans l’affaire ;
  2. je vois clairement ce qui est principal, adjacent ou legacy ;
  3. je n’entre dans le legacy que volontairement.
- **Portée** :
  - libellés
  - garde-fous
  - fallback explicite
- **Hors portée** :
  - suppression immédiate du legacy
- **Dépendances** :
  - affair hub
  - V0/generated
  - legacy takeoff
- **Priorité** : `P1`
- **Complexité estimative** : `M`

---

## 6. Critères d’acceptation

## EPIC-1 / US-1.1
- **Critères fonctionnels**
  - l’upload mixte crée un groupe de dépôt ;
  - chaque fichier reçoit un statut, un type métier proposé et une destination visible.
- **Critères UX**
  - une seule zone de dépôt dans l’affaire ;
  - l’utilisateur comprend immédiatement “quoi faire ensuite”.
- **Critères de robustesse**
  - un échec partiel n’empêche pas les autres fichiers de continuer.
- **Critères de traçabilité / preuve**
  - chaque fichier garde son upload d’origine et son type détecté.
- **Critères de contrôle humain**
  - la reclassification reste possible avant confirmation.

## EPIC-1 / US-1.2
- **Critères fonctionnels**
  - le brief expose `summary`, `scope`, `lots`, `receivedPieces`, `assumptions`, `vigilancePoints`, `missingElements`, `sources`.
- **Critères UX**
  - confirmation et correction se font dans le même contexte.
- **Critères de robustesse**
  - les documents ambigus restent visibles.
- **Critères de traçabilité / preuve**
  - les sources du brief restent consultables.
- **Critères de contrôle humain**
  - la confirmation du brief est explicite.

## EPIC-1 / US-1.3
- **Critères fonctionnels**
  - la timeline affiche les étapes du flux principal ;
  - la file d’exceptions regroupe ambiguïtés, blocages et validations en attente.
- **Critères UX**
  - la vue par défaut montre le travail utile restant.
- **Critères de robustesse**
  - la timeline se reconstruit depuis l’état serveur.
- **Critères de traçabilité / preuve**
  - chaque exception renvoie vers sa source.
- **Critères de contrôle humain**
  - l’utilisateur choisit l’ordre de traitement.

## EPIC-2 / US-2.1
- **Critères fonctionnels**
  - l’import tabulaire propose preview, suggestions, validation, templates et mémoire ;
  - la création de devis reste bloquée tant que le mapping minimal n’est pas valide.
- **Critères UX**
  - seules les colonnes non résolues demandent une action.
- **Critères de robustesse**
  - les lignes invalides sont isolées sans faire échouer tout l’import.
- **Critères de traçabilité / preuve**
  - import, mapping et lignes mappées restent liés.
- **Critères de contrôle humain**
  - validation finale du mapping requise.

## EPIC-2 / US-2.2
- **Critères fonctionnels**
  - un DPGF PDF tabulaire passe par une étape de validation des tableaux détectés avant de rejoindre le mapping canonique.
- **Critères UX**
  - l’utilisateur retrouve ensuite la même expérience que sur le tabulaire.
- **Critères de robustesse**
  - en cas de faible qualité d’extraction, le système n’auto-matérialise pas le devis.
- **Critères de traçabilité / preuve**
  - [inference] les lignes extraites conservent une provenance minimale de page/table.
- **Critères de contrôle humain**
  - l’utilisateur approuve les tableaux retenus et le mapping.

## EPIC-2 / US-2.3
- **Critères fonctionnels**
  - le système permet clairement “nouvelle affaire” ou “nouvelle version” ;
  - il retourne counts et totaux.
- **Critères UX**
  - le choix de matérialisation est compréhensible et réversible avant validation.
- **Critères de robustesse**
  - la création n’écrase pas une version existante.
- **Critères de traçabilité / preuve**
  - le lien import -> version/affaire est conservé.
- **Critères de contrôle humain**
  - confirmation explicite avant appel RPC.

## EPIC-2 / US-2.4
- **Critères fonctionnels**
  - `version-zero` et `generated-ouvrages` sont accessibles comme aides de structuration.
- **Critères UX**
  - ces aides sont clairement taggées `adjacent`.
- **Critères de robustesse**
  - elles ne remplacent pas automatiquement le flux DPGF/takeoff.
- **Critères de traçabilité / preuve**
  - la source “brief” ou “fragment documentaire” est visible.
- **Critères de contrôle humain**
  - matérialisation explicite uniquement.

## EPIC-3 / US-3.1
- **Critères fonctionnels**
  - seuls les documents `plans` confirmés sont synchronisés vers les `plan_sets` ;
  - le takeoff se lance depuis l’affaire avec choix du niveau.
- **Critères UX**
  - l’utilisateur comprend ce qui est éligible ou non au métré.
- **Critères de robustesse**
  - le plan sync n’exige pas de reupload si le fichier vient déjà de l’intake.
- **Critères de traçabilité / preuve**
  - la provenance `affaire-intake` reste visible.
- **Critères de contrôle humain**
  - choix de la version cible et du niveau de takeoff.

## EPIC-3 / US-3.2
- **Critères fonctionnels**
  - la revue met en avant warnings, faible confiance, manque d’evidence/page, items non reliés.
- **Critères UX**
  - tri par exception avant le reste.
- **Critères de robustesse**
  - les décisions de review persistent.
- **Critères de traçabilité / preuve**
  - `confidence`, `source_page`, `evidence`, `source_file` sont consultables quand disponibles.
- **Critères de contrôle humain**
  - exclusion, validation et lien manuel restent explicites.

## EPIC-3 / US-3.3
- **Critères fonctionnels**
  - l’apply supporte `append`, `replace`, `merge` avec preview d’impact.
- **Critères UX**
  - l’impact sur le devis est lisible avant confirmation.
- **Critères de robustesse**
  - impossible d’appliquer un job non terminé ou une version non draft.
- **Critères de traçabilité / preuve**
  - created/updated/ignored counts et source takeoff visibles.
- **Critères de contrôle humain**
  - confirmation finale obligatoire.

## EPIC-4 / US-4.1
- **Critères fonctionnels**
  - l’affaire permet de démarrer un import pricebook CSV complet.
- **Critères UX**
  - les étapes `Charger / Detection / Associer / Resoudre / Importer` sont visibles dans le parcours affaire.
- **Critères de robustesse**
  - les inconnus sont mis en résolution, pas importés silencieusement.
- **Critères de traçabilité / preuve**
  - le batch importé reste relié à son fichier source.
- **Critères de contrôle humain**
  - résolution des inconnus avant import final.

## EPIC-4 / US-4.2
- **Critères fonctionnels**
  - les grilles Excel convergent vers la même logique que le CSV.
- **Critères UX**
  - pas de second parcours caché pour Excel.
- **Critères de robustesse**
  - un Excel non lisible reste en exception, sans polluer le pricebook.
- **Critères de traçabilité / preuve**
  - [inference] lien fichier source -> import pricebook visible.
- **Critères de contrôle humain**
  - validation mapping/résolution requise.

## EPIC-4 / US-4.3
- **Critères fonctionnels**
  - chaque ligne peut montrer couverture, alternatives fournisseur, fraîcheur et sélection courante.
- **Critères UX**
  - vue par défaut sur les lignes à risque.
- **Critères de robustesse**
  - les cas ambigus ne sont pas auto-substitués.
- **Critères de traçabilité / preuve**
  - justification, source kind et stale flag visibles.
- **Critères de contrôle humain**
  - sélection manuelle par ligne possible.

## EPIC-4 / US-4.4
- **Critères fonctionnels**
  - la présélection bulk isole les divergences, stale, ambiguïtés et trous de couverture.
- **Critères UX**
  - un écran unique remplace la revue exhaustive ligne par ligne.
- **Critères de robustesse**
  - aucun bulk apply irréversible sans confirmation.
- **Critères de traçabilité / preuve**
  - chaque proposition bulk reste explicable et réversible.
- **Critères de contrôle humain**
  - validation globale puis arbitrage des exceptions.

## EPIC-5 / US-5.1
- **Critères fonctionnels**
  - `ready to send` et `ready to order` apparaissent avec leurs prérequis.
- **Critères UX**
  - la finish line est visible dans l’affaire.
- **Critères de robustesse**
  - les statuts sont recalculés, pas saisis à la main.
- **Critères de traçabilité / preuve**
  - chaque statut liste ses blocages.
- **Critères de contrôle humain**
  - l’utilisateur décide quand franchir la finish line.

## EPIC-5 / US-5.2
- **Critères fonctionnels**
  - PDF, envoi email et export BDC sont lançables depuis la finish line.
- **Critères UX**
  - une seule zone de sortie.
- **Critères de robustesse**
  - les erreurs d’envoi/export n’invalident pas le devis.
- **Critères de traçabilité / preuve**
  - la version envoyée/exportée est explicite.
- **Critères de contrôle humain**
  - confirmation avant envoi.

## EPIC-5 / US-5.3
- **Critères fonctionnels**
  - le wizard de commandes groupe les lignes par fournisseur et crée des drafts.
- **Critères UX**
  - il montre aussi ce qui n’est pas commandable.
- **Critères de robustesse**
  - aucune commande n’est créée pour une ligne sans fournisseur résolu.
- **Critères de traçabilité / preuve**
  - chaque draft commande reste liée aux lignes source.
- **Critères de contrôle humain**
  - revue et création explicites.

## EPIC-6 / US-6.1
- **Critères fonctionnels**
  - la création de version affiche un état de carry-over et les post-actions éventuelles.
- **Critères UX**
  - le risque n’est pas relégué à un warning technique.
- **Critères de robustesse**
  - la version reste créable même si le carry-over n’est pas complet.
- **Critères de traçabilité / preuve**
  - [inference] l’état de carry-over est mémorisé.
- **Critères de contrôle humain**
  - l’utilisateur confirme malgré ou après le gap.

## EPIC-6 / US-6.2
- **Critères fonctionnels**
  - l’affaire permet de reprendre un dossier après attente, échec partiel ou interruption.
- **Critères UX**
  - le bouton de reprise mène à la bonne étape.
- **Critères de robustesse**
  - les sous-résultats déjà acquis sont conservés.
- **Critères de traçabilité / preuve**
  - les statuts précédents restent visibles.
- **Critères de contrôle humain**
  - relance/reprise explicites.

## EPIC-6 / US-6.3
- **Critères fonctionnels**
  - le flux principal, les adjacents et le legacy sont identifiés comme tels.
- **Critères UX**
  - l’utilisateur n’est pas envoyé par défaut dans le legacy.
- **Critères de robustesse**
  - le fallback legacy reste volontaire et tracé.
- **Critères de traçabilité / preuve**
  - la provenance du chemin utilisé est visible.
- **Critères de contrôle humain**
  - bascule explicite si fallback.

---

## 7. Découpage de release [inference]

## Release 1
- **Promesse utilisateur**
  - “Je pilote mon dossier dans une seule affaire, je structure mon devis depuis un DPGF tabulaire, je lance le métré, je traite les exceptions et je peux sortir le devis.”
- **Scope**
  - US-1.1
  - US-1.2
  - US-1.3
  - US-2.1
  - US-2.3
  - US-3.1
  - US-3.2
  - US-3.3
  - US-4.3
  - US-5.1
  - US-5.2
  - US-6.1
- **Ce qui est volontairement reporté**
  - DPGF PDF
  - import fournisseur CSV dans l’affaire
  - grilles fournisseurs Excel
  - bulk pricing assistif
  - brouillons de commandes

## Release 2
- **Promesse utilisateur**
  - “Je peux partir d’un DPGF PDF tabulaire et intégrer mes premiers tarifs fournisseurs dans le même parcours affaire.”
- **Scope**
  - US-2.2
  - US-4.1
  - US-4.3 (renforcement)
  - US-4.4
  - US-6.2
- **Ce qui est volontairement reporté**
  - grilles fournisseurs Excel
  - brouillons de commandes
  - exposition renforcée des aides adjacentes

## Release 3
- **Promesse utilisateur**
  - “Je termine dans TIMAX avec une finish line lisible côté devis et côté commandes, et une meilleure continuité entre versions.”
- **Scope**
  - US-4.2
  - US-5.3
  - US-6.3
  - US-2.4
- **Ce qui est volontairement reporté**
  - arbitrage fournisseur full-auto
  - stock-aware pricing
  - promesse “avant midi” sans revue humaine

---

## 8. Backlog final priorisé

### P0
- EPIC-1 / US-1.1 — Dépôt unique du dossier
- EPIC-1 / US-1.2 — Brief et registre à confirmer
- EPIC-1 / US-1.3 — Timeline globale et file d’exceptions
- EPIC-2 / US-2.1 — Import tabulaire et mapping assisté
- EPIC-2 / US-2.2 — DPGF PDF vers pipeline canonique
- EPIC-2 / US-2.3 — Création d’affaire ou de nouvelle version
- EPIC-3 / US-3.1 — Plans synchronisés et takeoff lançable
- EPIC-3 / US-3.2 — Revue takeoff pilotée par preuves
- EPIC-3 / US-3.3 — Apply contrôlé avec provenance
- EPIC-4 / US-4.1 — Import fournisseur CSV dans le parcours affaire
- EPIC-4 / US-4.3 — Couverture pricing et comparaison exploitable
- EPIC-6 / US-6.1 — Création de version avec carry-over explicite

### P1
- EPIC-4 / US-4.2 — Extension aux grilles fournisseurs Excel
- EPIC-4 / US-4.4 — Présélection assistive à l’échelle du devis
- EPIC-5 / US-5.1 — Statuts ready to send / ready to order
- EPIC-5 / US-5.2 — Sortie devis depuis la finish line
- EPIC-5 / US-5.3 — Brouillons de commandes par fournisseur
- EPIC-6 / US-6.2 — Reprise après attente, erreur ou échec partiel
- EPIC-6 / US-6.3 — Hiérarchie claire entre flux principal, adjacents et legacy

### P2
- EPIC-2 / US-2.4 — Aides de structuration adjacentes

---

## 9. Revue finale de qualité backlog [inference]

### 9.1 Vérification MECE
- **EPIC-1** : pilotage du dossier et exceptions
- **EPIC-2** : structure du devis
- **EPIC-3** : quantités / métré
- **EPIC-4** : prix fournisseur
- **EPIC-5** : sorties opérationnelles
- **EPIC-6** : continuité / reprise / isolation des flux

Le découpage est le plus **MECE** possible compte tenu du périmètre :
- pas d’epic “UX” générique ;
- pas d’epic “IA” générique ;
- pas de doublon entre structure, quantités, prix et finish line ;
- les branches adjacentes ne sont pas mélangées au flux principal ;
- le legacy n’est pas présenté comme une source de valeur au même niveau.

### 9.2 Anti-oubli “high stakes”
- ne pas présenter le DPGF PDF comme résolu avant sa convergence vers le pipeline canonique ;
- ne pas confondre pricebook CSV existant et promesse Excel “drop-all” ;
- ne pas confondre comparaison fournisseur par ligne et arbitrage global automatique ;
- ne pas fusionner structure, quantités et prix dans une logique opaque ;
- ne pas oublier que les preuves takeoff sont plus fortes au niveau C qu’au global ;
- ne pas lancer la finish line commandes sans lien explicite avec les choix fournisseur ;
- ne pas laisser le carry-over rester un warning caché ;
- ne pas brouiller la hiérarchie entre flux principal, adjacents et legacy.

