# Rapport Takeoff v1

Date: 2026-03-07

## Objet

Ce rapport synthétise:
- la vision produit cible du module Takeoff pour un chiffreur BTP
- l'état réel de la codebase
- l'état des epics et tickets `v1`
- la stack technique mobilisée
- ce qui est déjà implémenté
- ce qui doit encore évoluer pour tenir la promesse métier `plan -> données de chiffrage exploitables`

Ce document est destiné à l'équipe en charge d'améliorer et de rédiger les prochaines user stories.

---

## Vision produit cible

La vision métier reste la suivante:

> En tant que chiffreur BTP, je veux déposer un plan, un PDF, un tableau de métrés ou un jeu de plans, afin que le système analyse automatiquement les documents, en extraie des données fiables, me propose un pré-chiffrage ou des données directement exploitables, et réduise au maximum le temps nécessaire pour produire mon devis.

Cette vision implique quatre capacités produit:
- importer des données déjà structurées et gagner du temps sur la saisie
- analyser des PDF/plans et récupérer des quantités, tableaux, postes ou indices utiles
- rendre les résultats révisables et traçables avant injection dans le devis
- convertir les résultats en données de chiffrage réellement exploitables: sections, lignes, catégories, prix, ouvrages, comparaison aux sources, contrôle qualité

---

## Verdict exécutif

Le module Takeoff est techniquement avancé.

Le parcours actuellement le plus abouti est:
- `fichier structuré CSV/XLS/XLSX -> analyse -> review -> apply au devis`

Le parcours encore incomplet côté produit est:
- `plan PDF / jeu de plans -> analyse IA -> pré-chiffrage exploitable`

En pratique:
- le niveau `A` est réellement livrable
- le niveau `B` est largement codé, mais encore partiellement exposé au lancement utilisateur
- le niveau `C` dispose de nombreuses briques techniques, mais n'est pas encore livré comme parcours complet pour le chiffreur

Conclusion simple:
- le socle n'est pas le problème
- le gap principal est l'ouverture produit et l'industrialisation du flux `plans -> chiffrage`

---

## Stack technique

### Frontend

- Next.js 16 App Router
- React 19
- TypeScript strict
- SWR pour le fetching/polling client
- composants UI maison dans `src/components/`
- Tailwind CSS v4
- `motion` pour certaines animations

### Backend applicatif

- Routes API Next.js dans `src/app/api/**`
- logique métier serveur dans `src/lib/**`
- validation Zod
- OpenAPI validé au build

### Base de données et services

- Supabase
- Postgres avec migrations SQL dans `supabase/migrations/`
- RLS tenant-aware
- Supabase Storage pour les fichiers takeoff et plans
- Supabase Edge Function `process_takeoff_job`

### Traitement documentaire

- `xlsx` et `exceljs` pour Excel
- `pdf-lib` pour PDF/chunking
- Gemini via wrapper serveur `src/lib/takeoff/gemini-client.ts`

### Qualité et tests

- Vitest avec projets `node` et `jsdom`
- Playwright pour les parcours critiques
- ESLint
- TypeScript `--noEmit`
- validation OpenAPI intégrée au build

---

## Architecture fonctionnelle actuelle

### Surfaces principales

- Hub affaire et pages affaires
- pages estimates/takeoff
- plan center / plan sets
- review takeoff
- apply wizard
- dashboard / activity center / métriques admin

### Modules clés

- `src/lib/takeoff/schemas.ts`
- `src/lib/takeoff/types.ts`
- `src/lib/takeoff/errors.ts`
- `src/lib/takeoff/feature-flags.ts`
- `src/lib/takeoff/gemini-client.ts`
- `src/lib/takeoff/prompts.ts`
- `src/lib/takeoff/processor.ts`
- `src/lib/takeoff/async-worker.ts`
- `src/lib/takeoff/server.ts`
- `src/lib/takeoff/plans.ts`
- `src/lib/takeoff/mapping-engine.ts`
- `src/lib/takeoff/diff.ts`
- `src/lib/takeoff/guards.ts`

### Composants majeurs

- `src/components/takeoff/TakeoffUploadForm.tsx`
- `src/components/takeoff/TakeoffJobMonitor.tsx`
- `src/components/takeoff/TakeoffReviewPage.tsx`
- `src/components/takeoff/TakeoffApplyWizard.tsx`
- `src/components/takeoff/PlanCenter.tsx`
- `src/components/takeoff/TakeoffTableView.tsx`
- `src/components/takeoff/TakeoffReviewExpert.tsx`
- `src/components/takeoff/TakeoffSourceBadge.tsx`
- `src/components/takeoff/MappingRulesManager.tsx`
- `src/components/takeoff/TakeoffDiffView.tsx`
- `src/components/takeoff/TakeoffMetricsDashboard.tsx`

---

## Etat des epics v1

### TKF-E01 — Fondations Takeoff & Schema Canonique

Vision user story:
- poser un socle robuste et cohérent pour tous les flux takeoff

Etat:
- implémenté

Déjà présent:
- schémas et types
- gestion d'erreurs dédiée
- feature flags takeoff
- vérifications tenant / accès
- prompts et wrapper Gemini
- socle DB et migrations takeoff

Conclusion:
- epic cohérente avec la codebase
- pas de chantier majeur prioritaire ici

### TKF-E02 — Niveau A : Import Normaliseur Universel

Vision user story:
- permettre à un chiffreur d'importer un fichier de métrés structuré pour éviter la ressaisie

Etat:
- implémenté pour le parcours `Niveau A`

Déjà présent:
- upload CSV/XLS/XLSX
- création de job
- traitement async
- review des items
- édition/exclusion
- apply au devis
- audit et provenance

Limite actuelle:
- cette epic ne couvre pas la promesse complète `plan PDF -> pré-chiffrage`
- elle couvre surtout `import structuré -> normalisation -> injection contrôlée`

Conclusion:
- fiable et cohérente si on la lit comme flux `import de métrés`

### TKF-E03 — Provenance & Tracabilité

Vision user story:
- garantir que les données issues de l'IA restent explicables, auditables et visibles dans le devis

Etat:
- quasi implémenté

Déjà présent:
- colonnes de provenance sur `estimate_items`
- badge source et popover / panneau d'évidence
- audit des actions takeoff
- liens vers source, page, niveau, job

Point d'attention:
- le badge IA n'est pas limité à `takeoff_gemini`
- la codebase supporte aussi `takeoff` et d'autres providers

Conclusion:
- epic saine et cohérente après correction sémantique

### TKF-E04 — Niveau B : Extraction PDF Schedules

Vision user story:
- permettre à un chiffreur d'analyser des plans/PDF et d'en extraire des tableaux exploitables

Etat:
- partiellement livré

Déjà présent:
- plan sets et plan files
- plan center
- création de jobs depuis un jeu de plans dans le hub affaire
- traitement niveau `B`
- review en vue tables

Ce qui manque:
- exposition claire et générique du niveau `B` au lancement utilisateur
- alignement entre UI de lancement et capacités backend
- parcours produit plus explicite pour les chiffreurs

Conclusion:
- très avancé techniquement
- encore incomplet comme fonctionnalité produit standard

### TKF-E05 — Niveau C : Pré-estimation Plan Complet

Vision user story:
- générer une première estimation depuis un plan complet, avec confiance et justification

Etat:
- partiellement livré

Déjà présent:
- traitement niveau `C`
- chunking PDF
- gestion confidence/evidence
- review experte
- garde d'apply sur items low confidence

Ce qui manque:
- point d'entrée utilisateur clair pour créer un job `C`
- exposition produit assumée de ce niveau
- validation métier sur la qualité réelle des résultats pour accélérer un chiffreur

Conclusion:
- moteur technique présent
- parcours produit non finalisé

### TKF-E06 — Job Async & Resilience

Vision user story:
- traiter les jobs en arrière-plan avec retry et observabilité

Etat:
- largement implémenté

Déjà présent:
- Edge Function `process_takeoff_job`
- worker async partagé
- retry/backoff
- cancel/retry/listing
- métriques takeoff
- pages et composants de suivi

Point d'attention:
- les références documentaires doivent suivre les noms de composants réellement présents

Conclusion:
- cohérent avec la vision produit
- socle async exploitable

### TKF-E07 — Mapping Rules & Revisions

Vision user story:
- enrichir les résultats takeoff et comparer plusieurs extractions

Etat:
- largement implémenté

Déjà présent:
- CRUD mapping rules
- manager admin
- preview conversion
- apply avec overrides
- moteur de mapping
- compare/diff entre jobs

Limite actuelle:
- cette epic est utile, mais elle ne suffit pas à elle seule à finaliser le parcours `plans -> chiffrage`

Conclusion:
- épic cohérente techniquement
- dépend de l'ouverture plus complète des niveaux `B/C` pour délivrer toute sa valeur métier

---

## Ce qui est déjà réellement implémenté

### 1. Socle takeoff complet

- modèle de données takeoff
- niveau `A/B/C` dans les types, schémas, prompts, processor et worker
- erreurs dédiées et normalisées
- feature flags
- contrôles tenant et accès draft

### 2. Flux Niveau A complet

- upload et validation de fichiers CSV/XLS/XLSX
- création de job takeoff
- traitement asynchrone
- suivi de statut
- review éditable
- apply au devis

### 3. Gestion des plans et sets

- création de plan sets
- upload de fichiers PDF
- stockage et métadonnées
- plan center
- lancement de takeoff depuis un jeu de plans dans le contexte affaire

### 4. Review avancée

- review simplifiée et experte
- filtres
- exclusion / modification
- vues evidence / confidence
- garde d'apply pour les cas sensibles

### 5. Apply et enrichissement

- apply wizard multi-étapes
- preview de conversion
- règles de mapping
- overrides
- provenance et badge source

### 6. Async, observabilité et administration

- trigger async
- retry / cancel
- centre d'activité takeoff
- métriques admin
- mapping rules admin

---

## Ce qui doit évoluer

### A. Ouvrir réellement les niveaux B et C

Constat:
- le code prend en charge `B/C`
- le flux utilisateur principal reste centré sur `A`

Evolution attendue:
- permettre de choisir explicitement le type d'analyse
- autoriser la création de jobs `B/C` depuis des entrées produit claires
- aligner UI, API publique et parcours affaire/estimate

### B. Clarifier les parcours produit

Aujourd'hui, trois intentions métier coexistent:
- importer un fichier de métrés déjà structuré
- analyser un PDF/tableau issu d'un plan
- générer une pré-estimation depuis un plan complet

Evolution attendue:
- séparer les parcours dans l'UX
- nommer clairement les promesses et limites de chaque niveau
- éviter le mélange entre `import de métrés` et `analyse de plans`

### C. Transformer le takeoff en données de chiffrage plus directement exploitables

Le vrai besoin n'est pas seulement l'extraction.
Le vrai besoin est la réduction de temps de chiffrage.

Evolution attendue:
- meilleure structuration par sections / lots
- meilleure catégorisation
- pré-remplissage plus riche des prix/unités/catégories
- insertion plus intelligente dans le devis
- meilleur usage des ouvrages

### D. Valider la qualité métier du niveau C

Le niveau C doit prouver qu'il:
- réduit réellement la charge de review
- produit des items utiles
- ne génère pas trop de bruit

Evolution attendue:
- campagne d'évaluation sur vrais plans
- mesures de précision/exploitabilité
- boucles de feedback avec chiffreurs

### E. Mieux exposer la valeur dans le cockpit affaire

Le takeoff doit devenir un accélérateur du chiffrage, pas un module isolé.

Evolution attendue:
- raccorder davantage takeoff au cockpit affaire
- mettre en avant recommandations, risques, écarts DPGF, suggestions de prix
- rendre visibles les gains concrets pour le chiffreur

---

## Gaps principaux entre vision produit et code actuel

### Gap 1

Vision:
- déposer un plan et lancer une analyse adaptée

Etat actuel:
- l'interface principale laisse encore penser que seul `Rapide/A` est réellement disponible

### Gap 2

Vision:
- obtenir un pré-chiffrage exploitable rapidement

Etat actuel:
- on obtient surtout des items reviewables et transformables
- la conversion en chiffrage directement prêt reste encore partielle

### Gap 3

Vision:
- parcours simple et évident pour le chiffreur

Etat actuel:
- plusieurs briques existent, mais le parcours global est encore fragmenté

---

## Recommandations pour les prochaines user stories

### Lot 1 — Exposition produit B/C

Objectif:
- rendre les niveaux `B/C` lançables de façon claire et supportée

Stories candidates:
- choix explicite du type d'analyse au lancement
- création de job `B` depuis plan set ou PDF ciblé
- création de job `C` depuis plan set / plan complet
- alignement UI/API/worker sur les niveaux réellement supportés

### Lot 2 — Parcours plans vers chiffrage

Objectif:
- faire du takeoff un vrai accélérateur de devis

Stories candidates:
- transformation automatique par lots / sections
- enrichissement plus fort via mapping rules
- ouvrages automatiques pilotés par règles métier
- pré-affectation catégories, unités et destinations de section

### Lot 3 — Qualité métier et confiance

Objectif:
- prouver la valeur du niveau `C`

Stories candidates:
- scoring d'exploitabilité
- feedback chiffreur sur les items générés
- instrumentation de la charge de review
- métriques de qualité par type de document / niveau / lot

### Lot 4 — Intégration cockpit affaire

Objectif:
- intégrer le takeoff dans la boucle de pilotage complète

Stories candidates:
- recommandations contextualisées dans le cockpit
- liens forts entre plans, takeoff, DPGF, risques et devis
- plan d'action métier basé sur anomalies et écarts détectés

---

## Position proposée pour l'équipe user stories

Les nouvelles stories ne devraient pas repartir de zéro.

La bonne stratégie est:
- capitaliser sur le socle existant
- documenter précisément les parcours déjà livrés
- traiter les `B/C` comme des stories d'ouverture produit et d'industrialisation
- recentrer les futures stories sur la valeur chiffrage, pas seulement sur l'extraction

Formulation cible à garder en tête:

> Le but n'est pas seulement de faire un moteur d'analyse documentaire.
> Le but est de faire gagner un maximum de temps au chiffreur pour produire un devis fiable.

---

## Annexes

### Dossier stories v1

- `docs/user_story/v1/README.md`
- `docs/user_story/v1/TKF-E01-fondations-schema.md`
- `docs/user_story/v1/TKF-E02-niveau-a-import.md`
- `docs/user_story/v1/TKF-E03-provenance-tracabilite.md`
- `docs/user_story/v1/TKF-E04-niveau-b-pdf-tables.md`
- `docs/user_story/v1/TKF-E05-niveau-c-pre-estimation.md`
- `docs/user_story/v1/TKF-E06-job-async-resilience.md`
- `docs/user_story/v1/TKF-E07-mapping-rules-revisions.md`

### Commandes de référence

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run e2e:pw:critical`
- `npm run build`

