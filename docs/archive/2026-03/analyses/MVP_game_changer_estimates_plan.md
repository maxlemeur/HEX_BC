# Plan MVP “Game Changer” (4–6 sprints) – Module Chiffrage / Devis `estimates`

Stack: **Next.js 16 (App Router)** + **Supabase (Postgres/RLS/Storage/Auth)** + **Zod**  
Date: 2026-02-21  
Invariants (non négociables):
- Toute mutation “contenu” **uniquement** si `EstimateVersion.status = draft` (UI + API + RLS + trigger).
- Versions non-draft: **lecture seule fonctionnelle** (UI + DB + RLS).
- Champs calculés (`pu_ht_cents`, `line_total_*`, `total_*`) toujours cohérents avec la formule (recalc/bulk).
- Remise: actuellement stockée en `discount_bp` (proportionnelle), UI en EUR.

---

## 1) Les 10 features “game changer” (rappel)
1. **Templates + Assemblies** (blocs réutilisables FO/MO)
2. **Price Book vivant** (catalogue FO + taux MO + import/MAJ + historique)
3. **Quantification assistée** (takeoff léger depuis PDF + mini-calculateurs)
4. **Guided Selling** (questionnaire → structure de devis)
5. **Éditeur “tableur turbo”** (clavier-first + bulk + copier/coller Excel)
6. **Suggestions intelligentes qui apprennent** (depuis devis acceptés)
7. **Rules engine** (garde-fous marge/remise + approbations)
8. **Diff entre versions** (+ impact financier + changelog client)
9. **Send/Portal/Accept** (PDF canonique + lien client + acceptation/signature)
10. **Immutabilité “tamper-evident”** (events append-only + audit log + hash PDF)

Pourquoi ces features sont “standard gagnant” dans les outils d’estimation/CPQ/proposals:
- Templates + assemblies sont explicitement présentés comme accélérateurs d’estimation (ex: “assemblies” dans des solutions d’estimation).  
  Réfs: Houzz Pro (assemblies + templates), InEight Estimate (cost item assemblies).  
- Guided selling et CPQ: accélèrent le cycle et fiabilisent le chiffrage par guidage + pricing en temps réel.  
  Réf: Cincom (guided selling).  
- Proposal lifecycle: créer, envoyer, **tracker** et **signer** dans un seul flux est une proposition de valeur récurrente.  
  Réf: Proposify (create/track/sign).  
- Pratiques DB: RLS + indexes sur colonnes de policies (perf) et audit logging (traçabilité).  
  Réfs: Supabase (RLS perf best practices), Redgate (audit logging).  
- eIDAS: 3 niveaux de signature (SES/AES/QES) et QES = effet équivalent manuscrit dans l’UE.  
  Réf: Commission européenne (eSignature / eIDAS).

---

## 2) Priorisation ultra concrète (Impact vs Effort vs Risque)

### 2.1 Méthode de scoring
Échelle **1 (faible) → 5 (fort)**.

**Impacts**
- **Vitesse chiffrage**: baisse du temps de saisie/structuration
- **Qualité & marge**: baisse erreurs, cohérence prix, protection marge
- **Cycle business**: envoi/acceptation plus rapide, révisions plus fluides

**Coûts**
- **Effort**: complexité dev (DB + API + UI)
- **Risque**: risques produit (adoption), risques data/perf/sécurité

**Score pondéré (indicatif)**
`score = 3*vitesse + 2*qualité + 2*cycle - 2*effort - risque`

> Ce score sert à **ordonner** et à décider du **cut MVP**.  
> Il ne remplace pas la réalité terrain (nombre de devis/mois, taille moyenne, variabilité des projets).

### 2.2 Matrice de priorisation (10 features)
| # | Feature | Vitesse | Qualité | Cycle | Effort | Risque | Score | Reco MVP | Pourquoi maintenant |
|---:|---|---:|---:|---:|---:|---:|---:|---|---|
| 1 | Templates + Assemblies | 5 | 4 | 3 | 3 | 2 | 21 | ✅ Oui | Tue la page blanche, standardise, réutilise 80% du récurrent |
| 5 | Tableur turbo | 5 | 3 | 3 | 3 | 2 | 19 | ✅ Oui | Gain immédiat minute/ligne, UX “pro” |
| 4 | Guided selling | 4 | 4 | 4 | 4 | 3 | 17 | 🟨 Plus tard (après templates) | Très puissant si scopes variés; nécessite un modèle métier clair |
| 6 | Suggestions qui apprennent | 4 | 4 | 3 | 3 | 3 | 17 | 🟨 MVP v1 (scoring) | On passe de “je remplis” à “je valide” |
| 2 | Price Book vivant | 4 | 4 | 3 | 4 | 3 | 15 | ✅ Oui (v1) | Réduit le temps “chercher prix”; limite les prix obsolètes |
| 8 | Diff + impact | 2 | 4 | 4 | 3 | 2 | 14 | 🟨 Sprint 5+ | Devient crucial dès que V2/V3 deviennent fréquentes |
| 7 | Rules engine + approbations | 2 | 5 | 4 | 4 | 4 | 12 | 🟨 Après MVP | Protège la marge; peut être trop “process” trop tôt |
| 3 | Takeoff léger | 4 | 4 | 3 | 5 | 4 | 12 | ❌ Hors MVP | Très game changer, mais lourd: plan/PDF, UX, perf |
| 9 | Send/Portal/Accept | 2 | 3 | 5 | 4 | 4 | 10 | ✅ MVP “lite” | Ferme la boucle “devis → client”; à minimiser au départ |
| 10 | Tamper-evident (events/audit/hash) | 1 | 5 | 3 | 4 | 3 | 8 | 🟨 Sprint 6 | A+ pour conformité; pas le 1er accélérateur de chiffrage |

---

## 3) MVP “Game Changer” recommandé (4 sprints)

### Objectif MVP
**Réduire drastiquement le temps de production d’un devis** tout en augmentant la cohérence et en diminuant les erreurs, sans complexifier le cycle de vente.

### MVP Scope (le cut)
✅ Inclus MVP (4 sprints)
- **Tableur turbo** (clavier-first + bulk + copier/coller + virtualisation)
- **Templates + assemblies (v1)** (insertion de blocs réutilisables)
- **Price book (v1)** (catalogue FO + import simple + “prix stale”)
- **Suggestions v2 (scoring)** (top 3 + apply à lignes similaires)
- **Send “lite”**: PDF canonique + stockage + status `sent` (portail client en v1 optionnel)

❌ Hors MVP (mais planifié)
- Takeoff PDF (mesures sur plans)
- Rules engine + approbations
- Guided selling complet
- Audit log “enterprise” (on fait une base en Sprint 6)

---

## 4) Plan Sprint-by-Sprint (4–6 sprints)

> Chaque sprint doit livrer une **valeur visible**.  
> On garde la règle d’or: “si ce n’est pas `draft`, c’est immuable”.

---

# Sprint 1 – Turbo Editor Foundations (vitesse brute)
**Outcome utilisateur**: éditer 50–300 lignes sans fatigue, au clavier, avec recalcul fiable.

### Scope produit
- Table “items” **clavier-first** (Tab/Enter/Flèches)
- Multi-sélection + **bulk edit** (K, rôle MO, catégorie, TVA)
- Virtualisation (500+ lignes)
- Qualité: flags + filtre + compteur (bloquants vs warnings)
- API bulk optimisée (recalc 1 fois)

### Deliverables tech (Next.js/Supabase)
- DB
  - Fonction `estimate_recalc_version(version_id)` stable + tests
  - Trigger recalc en draft (ou recalc en fin de transaction bulk)
  - Index `(version_id, parent_id, order_index)` pour l’éditeur
- API (Route Handlers Next.js, `app/api/**/route.ts`)
  - `POST /items/bulk` transaction + recalc unique
  - Mapping erreurs DB → `{code:"READ_ONLY"}`  
  Note Route Handlers: uniquement dans `app/`, via Web Request/Response APIs.  
- UI
  - Table virtuelle + editing cells
  - Bannière read-only si `status != draft`

### Acceptance Criteria
- 300 lignes: scroll fluide, aucune latence “visible” au focus.
- Bulk edit sur 100 lignes: 1 requête API, recalcul cohérent.
- Tentative de mutation non-draft: UI bloque + API renvoie `READ_ONLY`.

### Risks & mitigations
- **Perf RLS**: indexer les colonnes utilisées dans les policies (ex: `version_id`, `tenant_id`, etc.).  
  Supabase recommande explicitement d’indexer les colonnes utilisées dans les RLS pour booster la perf.  

---

# Sprint 2 – Templates + Assemblies (anti page blanche)
**Outcome utilisateur**: créer un devis structuré en quelques clics.

### Scope produit
- Création “depuis template”
- Bibliothèque d’**assemblies** (bloc section + lignes)
- Insertion d’un assembly à l’endroit courant (parent_id)
- Copy/paste Excel robuste (multi colonnes)
- Suggestions v2: scoring top 3 (keyword + heuristiques)

### Deliverables tech
- DB
  - Tables `estimate_templates`, `estimate_template_items`
  - Tables `estimate_assemblies`, `estimate_assembly_items`
- API
  - `GET /templates`, `POST /templates`
  - `POST /assemblies/:id/insert?versionId=...`
- UI
  - Picker “Templates” à la création
  - Drawer “Assemblies” dans l’éditeur

### Acceptance Criteria
- Créer un devis “type” en < 2 minutes (sans ressaisie répétitive).
- Insertion d’un assembly: structure correcte + recalcul immédiat.
- Dismiss/apply des suggestions persisté (par designation).

---

# Sprint 3 – Price Book v1 (prix à portée de main)
**Outcome utilisateur**: ne plus “chercher les prix”; réduire les erreurs de prix.

### Scope produit
- Catalogue FO (articles) avec:
  - libellé, unité, prix HT cents, catégorie, date MAJ
- Recherche + insertion rapide dans une ligne (auto-fill prix/unité/cat)
- Import simple CSV (admin)
- Indicateur “prix stale” (ex: > 90 jours sans MAJ)
- Historique minimal (timestamp + user)

### Deliverables tech
- DB
  - Table `price_book_items`
  - Index texte (trigram/FTS selon choix)
- API
  - `GET /price-book?query=...`
  - `POST /price-book/import`
- UI
  - Autocomplete “Article” dans ligne FO
  - Badge “stale” et filtre

### Acceptance Criteria
- Ajout de 30 lignes FO depuis le catalogue en < 5 minutes.
- Import CSV: prévisualisation + validation Zod.
- Si prix change: recalcul des lignes draft liées (option si tu relies par `price_book_item_id`).

---

# Sprint 4 – Send “lite” (PDF canonique + statut `sent`)
**Outcome utilisateur**: un bouton “Envoyer” qui produit un PDF propre, figé, retrouvable.

### Scope produit
- Génération PDF server-side (rendu “devis”)
- Stockage dans Supabase Storage (bucket privé)
- Passage `draft → sent`
- Téléchargement PDF depuis la version `sent`
- (Option si temps) lien partage read-only simple (token)

### Deliverables tech
- Storage
  - Bucket privé `estimates`
  - Policies d’accès via RLS (Storage Access Control Supabase)
- API
  - `POST /:versionId/send` = génère PDF + upload + status
  - `GET /:versionId/pdf` = stream du PDF (auth)
- UI
  - Bouton “Envoyer” conditionnel + checklist (bloquants)
  - Affichage “PDF généré le…”

### Acceptance Criteria
- Après `sent`, toute édition est impossible (UI + API + DB + RLS).
- PDF téléchargé est identique à l’aperçu (même totaux/structure).
- Storage access: seul le bon user/tenant peut télécharger.

---

# Sprint 5 – Version Diff + Changelog (révisions sans douleur) [Option]
**Outcome utilisateur**: comprendre et expliquer “ce qui a changé” en 30 secondes.

### Scope produit
- Diff V(n) vs V(n-1)
- Impact financier par section (+/- € HT)
- Export “changelog client” (PDF/CSV)

### Deliverables
- API `GET /diff?from=...&to=...`
- UI “Comparer versions”
- Rendu export

### Acceptance Criteria
- Toute modif de ligne apparaît (ajout/suppression/édition) avec impact €.
- Le diff est stable (mêmes IDs, mapping robuste).

---

# Sprint 6 – Tamper-evident + guardrails marge/remise (confiance & contrôle) [Option]
**Outcome utilisateur**: confiance, conformité, protection de marge.

### Scope produit
- Events append-only: `sent`, `accepted`, `archived` (+ métadonnées)
- Audit log des edits en `draft` (qui/quand/quoi)  
- Hash PDF (sha256) sur `sent` (preuve d’intégrité)
- Guardrails:
  - marge mini par catégorie/client
  - remise max
  - “approbation requise” (workflow simple)

### Deliverables
- DB tables: `estimate_version_events`, `estimate_audit_log`
- Trigger audit sur `estimate_items` (draft only)
- UI: timeline events + badge “approved”
- API: `POST /approve` (si applicable)

### Acceptance Criteria
- Un devis `sent` a: event + PDF + hash.
- Les modifications `draft` sont auditables.
- Règles marge/remise appliquées (au minimum: warnings + blocage configurable).

---

## 5) Variante “MVP en 4 sprints” vs “MVP en 6 sprints”
### MVP 4 sprints (recommandé si besoin d’impact rapide)
- Sprint 1: tableur turbo + bulk + qualité
- Sprint 2: templates + assemblies + suggestions v2
- Sprint 3: price book v1
- Sprint 4: send lite (PDF + storage + sent)

### MVP 6 sprints (si tu veux un produit “de bout en bout” plus fort)
- Ajoute Sprint 5 (diff) + Sprint 6 (events/audit/guardrails)

---

## 6) KPIs à suivre (sinon on pilote à l’oreille)
- **Temps médian**: création → devis “prêt à envoyer”
- **Temps médian**: création → `sent`
- **% devis envoyés avec anomalies** (doit tendre vers 0)
- **Nb lignes / minute** dans l’éditeur (proxy de friction)
- **% lignes venant d’assemblies/templates** (objectif: 50–80% sur répétitif)
- **Écart prix**: prix stale utilisés / total

---

## 7) Notes d’implémentation (spécifiques à la stack)

### Next.js 16 (App Router)
- Utiliser **Route Handlers** pour les endpoints (`app/api/**/route.ts`) et streaming exports.  
- Route files supportent `GET/POST/PATCH/DELETE` via Web Request/Response APIs.

### Supabase RLS
- RLS obligatoire pour tables exposées; utiliser `USING` + `WITH CHECK`.
- **Performance**: indexer colonnes utilisées dans les policies (ex: `user_id`, `tenant_id`, `version_id`) pour éviter des ralentissements massifs sur gros volumes.

### Supabase Storage
- Bucket privé + policies RLS pour téléchargement du PDF (accès par tenant/version).

### Zod
- Valider toutes entrées API (create, patch, bulk ops, import CSV) avec schémas partagés.
- Mapper erreurs Zod → `VALIDATION_FAILED` + détails.

---

## 8) Références (liens)
- Next.js: Route Handlers (App Router)  
  https://nextjs.org/docs/app/getting-started/route-handlers  
  https://nextjs.org/docs/app/api-reference/file-conventions/route
- Supabase: RLS performance best practices (index sur colonnes de policy)  
  https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- Supabase: Storage access control (RLS sur storage)  
  https://supabase.com/docs/guides/storage/security/access-control
- Guided selling (CPQ)  
  https://www.cincom.com/blog/cpq/guided-selling-the-secret-to-shorter-sales-cycles-and-higher-win-rates/
- Proposal lifecycle (create/track/sign)  
  https://www.proposify.com/
- Assemblies/templates (estimating)  
  https://pro.houzz.com/for-pros/feature-estimates  
  https://ineight.com/products/ineight-estimate/
- Price books / données de coûts (exemples)  
  https://www.rsmeans.com/products/books
- Takeoff PDF (mesures sur PDF)  
  https://www.bluebeam.com/workflows/takeoffs-and-estimation/
- Audit logging (principes)  
  https://www.red-gate.com/blog/database-design-for-audit-logging/
- eIDAS eSignature (3 niveaux + contexte UE)  
  https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/467109069/What%2Bis%2BeSignature  
  https://ec.europa.eu/digital-building-blocks/sites/spaces/DIGITAL/pages/880312429/eSignature%2BFAQ

