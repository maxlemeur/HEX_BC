# PRD – Module “Métré Assisté” (Gemini 3) pour Takeoff → Chiffrage

**Produit**: Module `takeoff` connecté au module `estimates` (devis FO/MO)  
**Stack**: Next.js 16 (App Router) + Supabase (Postgres/RLS/Storage/Edge Functions) + Zod  
**Modèle IA** (cible): `gemini-3.1-pro-preview` (Gemini 3.1 Pro Preview)

---

## 1) Résumé

Nous ajoutons un module “Métré Assisté” pour **extraire et normaliser des données structurées** depuis:
- des exports existants (CSV/Excel),
- des extraits de texte,
- des tableaux/listes présents dans des plans PDF,
- et, à terme, une **pré-estimation assistée** sur un plan complet (PDF/image).

L’IA (Gemini 3) **ne modifie jamais directement** le contenu d’un devis. Elle alimente une **zone tampon (Takeoff)**, ensuite:
1) l’utilisateur **révise** (review)  
2) l’utilisateur **applique** (apply) vers une `EstimateVersion` **uniquement si `status=draft`**.

---

## 2) Contexte & problème

### Problème utilisateur
Les estimateurs perdent du temps à:
- reconstituer des quantités (BOM / nomenclatures / schedules) depuis des plans,
- harmoniser des exports hétérogènes (colonnes différentes, unités incohérentes),
- recoller manuellement les données dans le chiffrage.

### Opportunité
Gemini peut traiter des documents PDF via vision “native” et extraire des infos structurées (dont tableaux) pour alimenter un workflow downstream.  
Objectif: **réduire le temps de préparation des quantités**, augmenter la cohérence, et accélérer le passage au chiffrage.

---

## 3) Objectifs (et Non-objectifs)

### 3.1 Objectifs produit (Goals)
1) **Normaliser** toutes sources de quantités en un **JSON canonique** validé par Zod.  
2) **Extraire** des tables/listes depuis des PDF de plans (schedules, nomenclatures).  
3) Proposer (Niveau C) une **pré-estimation assistée** avec:
   - `evidence` (pourquoi/quoi),
   - `confidence` (0..1),
   - **review humaine obligatoire** avant application.
4) Intégration “safe” au module `estimates`: appliquer en **draft-only** avec recalcul version.

### 3.2 Non-objectifs (Non-goals) – v1
- ❌ Pas de “mesure géométrique” full automatique fiable (runs de gaines, surfaces de murs) à partir du plan sans règles métier/échelle robustes.
- ❌ Pas d’application automatique dans un devis “sent/accepted”.
- ❌ Pas de promesse “zéro erreur”: l’IA propose, l’humain valide.

---

## 4) Indicateurs de succès (KPIs)

1) **Temps médian** “source → quantités prêtes” (Takeoff ready)  
2) **Temps médian** “quantités prêtes → devis draft structuré”  
3) **Taux d’erreur détectée au review** (items modifiés/supprimés)  
4) **% d’items appliqués** vs items extraits  
5) **Adoption**: nombre de jobs créés / semaine, répartition A/B/C  
6) **Coût IA / job** (tokens, temps, taux d’échec)

---

## 5) Personas & User stories

### Personas
- **Estimateur**: veut aller vite, veut des quantités propres, déteste le copier/coller.
- **Chargé d’affaires**: veut sortir plus de devis, valoriser options, réduire cycles.
- **Admin**: gère mappings, bibliothèques (assemblies), gouvernance des plans.

### User stories (exemples)
- *En tant qu’estimateur, je charge un export Excel d’un takeoff et je veux obtenir un JSON canonique propre, puis générer des lignes de devis.*  
- *En tant qu’estimateur, je charge un PDF de plan contenant un tableau “equipment schedule” et je veux l’extraire en lignes/colonnes exploitables.*  
- *En tant qu’estimateur, je lance une pré-estimation sur un plan complet, je veux voir l’évidence et filtrer les items à faible confiance avant d’appliquer au devis.*

---

## 6) Scope fonctionnel par niveaux (A → B → C)

### Niveau A – “Import normaliseur universel”
**Entrées**: CSV, Excel, texte, exports variés.  
**Sortie**: JSON canonique + `takeoff_items` éditables.

Fonctions:
- Upload fichier
- Normalisation via Gemini → JSON canonique
- Validation Zod
- Review simple (table)
- Apply vers devis draft (bulk items + recalcul)

### Niveau B – “Extraction PDF schedules / tables”
**Entrées**: PDF(s) plans contenant tables/listes.  
**Sortie**: tables structurées + items normalisés (avec source_page).

Fonctions:
- Plan Center (upload PDF)
- Lancer job extraction tables/listes
- Review (vue table + groupements)
- Apply vers devis draft

### Niveau C – “Pré-estimation plan complet assistée”
**Entrées**: plan complet PDF/image.  
**Sortie**: propositions d’items avec `confidence` + `evidence` obligatoires.

Fonctions:
- Job C multi-pass (option)
- Review avancée: evidence + confidence + “verify”
- Apply draft-only (jamais auto)

---

## 7) UX: écrans & parcours (wireframe-level)

### 7.1 Écran: Plan Center (dans `EstimateProject`)
- Liste des PDFs (plan set / révision)
- Upload, tags (discipline, niveau, date, revision)
- Actions: “Créer job B”, “Créer job C”

### 7.2 Écran: Import Takeoff (Niveau A)
- Upload CSV/Excel
- Prévisualisation (30 premières lignes)
- Choix: “Auto-normaliser (Gemini)” ou mapping manuel
- Résultat: `takeoff_items` + warnings

### 7.3 Écran: Job Monitor
- Liste jobs (queued/running/review/failed/applied)
- Durée, niveau, config (thinking/resolution), erreurs
- Actions: retry/cancel/open

### 7.4 Écran: Takeoff Review
**Mode A/B**:
- table éditable: `designation`, `unit`, `quantity`, `size`, `tag`, `source_page`
- filtre anomalies (qty=0, unit vide, designation vide)
- bouton “Apply to draft”

**Mode C**:
- colonne `confidence`
- panneau `evidence` (explication + page/zone)
- filtre `confidence < seuil`
- checkbox “Verified” requis avant Apply sur items low-confidence

### 7.5 Apply Wizard (“Appliquer au devis”)
- Sélectionner `EstimateVersion` (ou “Dupliquer pour éditer” si non-draft)
- Choisir parent section (ou créer section “Métré (Gemini)”)
- Stratégie merge:
  - append (ajouter lignes)
  - merge (regrouper par clé)
  - replace section (remplacer contenu d’une section cible)
- Option: appliquer mapping rules/assemblies

---

## 8) Spécifications fonctionnelles détaillées (FR)

### FR-01 – Données canon (TakeoffExchange v1)
**Structure** (canon):
- `schemaVersion = "1.0"`
- `document`: nom fichier, révision, discipline (optional)
- `items[]`: éléments quantifiés
- `warnings[]`: avertissements (unités incertaines, info manquante)
- `sources[]` (option): mapping fichiers/pages

**Champs item minimaux**
- `designation: string`
- `unit: string`
- `quantity: number >= 0`
- optionnels: `size`, `dn`, `tag`, `source_page`, `source_file`

**Champs Niveau C obligatoires**
- `confidence: number [0..1]`
- `evidence: object` (au minimum `{ page, rationale }`)

### FR-02 – Validation stricte Zod
- Toute sortie IA est validée par Zod.
- Si invalid: job = `failed` (code `AI_SCHEMA`) + trace de la réponse brute.

### FR-03 – Extraction tables/listes PDF (B)
- Détecter et extraire:
  - “equipment schedules”
  - nomenclatures
  - listes d’équipements/terminaux
- Sortie B inclut un mode “table”:
  - `tables[]: { page, title?, headers[], rows[][] }`
  - puis transformation `tables → items`

### FR-04 – Pré-estimation plan complet (C)
- Le job C doit produire:
  - items + evidence + confidence
  - warnings explicites si échelle incertaine
- Review obligatoire:
  - pas d’auto-apply
  - apply interdit si items low-confidence non “verified”

### FR-05 – Application au devis (draft-only)
- Apply ne peut écrire dans `estimate_items` que si:
  - `EstimateVersion.status = draft`
  - user a accès (RLS)
- Si version non-draft:
  - UI propose “Dupliquer la version” puis apply sur la copie.

### FR-06 – Conversion takeoff → lignes devis (mappings)
- Mapping rules optionnelles mais recommandées:
  - match par keyword/regex
  - outputs: catégorie FO, K, rôle MO, facteurs (h/unité)
- Assemblies optionnelles:
  - kit FO + MO pour convertir un item en plusieurs lignes

### FR-07 – Traçabilité
- Chaque `EstimateItem` créé depuis takeoff doit inclure `meta.source`:
  - provider, jobId, plan reference (file/page)
- Historique minimal: qui a lancé le job, quand, config.

---

## 9) Modèle de données (DB) – proposition

> NB: nommage à ajuster à votre convention (snake_case).

### 9.1 Plans
- `estimate_plan_files`
  - `id, project_id, uploaded_by, filename, storage_path, mime_type, size_bytes, created_at`
- `estimate_plan_sets`
  - `id, project_id, name, revision, created_by, created_at`
- `estimate_plan_set_files`
  - `plan_set_id, plan_file_id, sort_index`

### 9.2 Takeoff jobs
- `takeoff_jobs`
  - `id, project_id, estimate_version_id?`
  - `source_type` = `import|pdf_schedule|full_plan`
  - `level` = `A|B|C`
  - `status` = `queued|running|review|applied|failed|canceled`
  - `model` (default `gemini-3.1-pro-preview`)
  - `thinking_level`, `media_resolution`
  - `schema_version`
  - `created_by, created_at, started_at, finished_at`
  - `error_code, error_message`

- `takeoff_results`
  - `job_id (PK/FK), extracted_json (jsonb), raw_text?, provider_meta (jsonb), created_at`

- `takeoff_items`
  - `id, job_id`
  - `designation, unit, quantity`
  - `size?, dn?, tag?`
  - `source_file?, source_page?`
  - `confidence?, evidence?`
  - `verified_at?, verified_by?`

### 9.3 Conversion (optionnel v1, recommandé v1.1)
- `takeoff_mapping_rules`
- `estimate_assemblies` / `estimate_assembly_items` (si pas déjà existant)

---

## 10) API (contrats) – Next.js Route Handlers

> Route Handlers = endpoints dans `app/api/**/route.ts`, basés sur Web Request/Response.  
> Ils sont disponibles uniquement dans le dossier `app`.  

### Takeoff
- `POST /api/takeoff/jobs`
- `GET /api/takeoff/jobs/:jobId`
- `POST /api/takeoff/jobs/:jobId/retry`
- `POST /api/takeoff/jobs/:jobId/cancel`
- `POST /api/takeoff/jobs/:jobId/apply`
  - body: `{ estimateVersionId, parentSectionId?, mergeStrategy, applyMapping?: boolean }`

### Plans
- `POST /api/estimates/:projectId/plans/upload`
- `POST /api/estimates/:projectId/plan-sets`
- `PATCH /api/estimates/:projectId/plan-sets/:id`

### Conversion (optionnel)
- CRUD mapping rules
- `POST /api/takeoff/jobs/:jobId/preview-conversion`

---

## 11) Architecture technique (recommandée)

### 11.1 Pattern recommandé: Supabase-first async (P2)
- **Création job** via Route Handler Next.js (validation Zod, insert `takeoff_jobs`)
- **Traitement job** via Supabase Edge Function `process_takeoff_job`
  - utiliser `EdgeRuntime.waitUntil(...)` pour tâches longues sans bloquer la requête
- **Résultat** en DB (`takeoff_results`, `takeoff_items`) puis statut `review`
- **Apply** via API `jobs/:id/apply` (bulk sur `estimate_items` + recalcul version)

### 11.2 Gemini – paramètres & appels
- Modèle: `gemini-3.1-pro-preview` (PDF input + structured outputs + thinking support)
- Structured output:
  - `responseMimeType = "application/json"`
  - `responseJsonSchema = <json schema depuis Zod>`
- Réglages:
  - Niveau A: `thinkingLevel=low`, `media_resolution=medium`
  - Niveau B: `thinkingLevel=low|medium`, `media_resolution=high`
  - Niveau C: `thinkingLevel=high`, `media_resolution=high`
- Entrée fichiers:
  - inline/base64 pour petits fichiers
  - URL signée ou Files API pour gros PDFs (selon taille/fréquence)

### 11.3 Supabase Storage (plans)
- Bucket privé `plans`
- RLS Storage sur `storage.objects` pour:
  - upload autorisé au bon tenant
  - download autorisé au bon tenant

### 11.4 RLS & performance
- RLS obligatoire sur toutes tables exposées.
- Indexer les colonnes utilisées dans les policies (ex: `project_id`, `created_by`, `estimate_version_id`).

---

## 12) Exigences non fonctionnelles (NFR)

### 12.1 Performance
- Niveau A: 1–2 minutes max (fichier modeste)
- Niveau B: cible < 5–10 minutes selon volume
- Niveau C: asynchrone, chunking; pas de blocage UI

### 12.2 Fiabilité
- Retry idempotent (ne pas créer doublons)
- Job cancelable
- Stocker réponse brute si Zod invalide (debug)

### 12.3 Sécurité & confidentialité
- Clé Gemini uniquement côté serveur/worker
- Pas de fuite de signed URLs en logs
- Isolation tenant via RLS

### 12.4 Observabilité
- Logs job: durée, taille doc, nb items, taux d’échec
- Coût IA estimé / job (si dispo)
- Traces d’erreur (AI_SCHEMA, AI_TIMEOUT, AI_QUOTA)

---

## 13) Critères d’acceptation (AC) – par niveau

### A (Import normalisation)
- Un CSV/Excel hétérogène peut être normalisé en JSON canonique validé par Zod.
- L’utilisateur peut corriger en table et appliquer au devis draft.
- “Apply” fait 1 bulk + 1 recalcul version.

### B (PDF tables)
- Extraction de tableaux/listes depuis PDF avec lignes/colonnes cohérentes.
- Chaque item a un `source_page`.
- Apply crée une section dédiée et des lignes propres.

### C (Plan complet)
- Chaque item a `evidence + confidence`.
- UI filtre low-confidence, impose review/verified avant apply.
- Jamais d’auto-apply.

---

## 14) Phasage / livraison (recommandation)

- **Phase 1 (MVP)**: Niveau A + Apply draft + provenance + job async minimal
- **Phase 2**: Niveau B + Plan Center + extraction schedules/tables
- **Phase 3**: Niveau C v0 (confidence/evidence + review) + chunking
- **Phase 4 (option)**: mapping rules/assemblies + révisions/delta

---

## 15) Risques & mitigations

1) **Sortie JSON non conforme**  
Mitigation: structured outputs + Zod strict + fail fast + stockage réponse brute.

2) **Plans PDF très denses / scannés**  
Mitigation: media_resolution=high, chunking, warnings; limiter scope C.

3) **Coût/latence**  
Mitigation: niveaux A/B par défaut; C option “Accurate”; quotas; caching/Files API.

4) **Perf RLS**  
Mitigation: indexes sur colonnes policy + requêtes filtrées (ne pas compter sur RLS comme filtre).

---

## 16) Références docs (pour l’équipe)
- Gemini Structured outputs (JSON Schema)  
- Gemini Document understanding (PDF, tables)  
- Gemini Media resolution (PDF token budgets)  
- Gemini Thinking levels (Gemini 3.1 Pro support low/medium/high)  
- Gemini File input methods (inline vs URL vs Files API)  
- Supabase Edge Functions background tasks (`EdgeRuntime.waitUntil`)  
- Supabase Storage access control (RLS sur `storage.objects`)  
- Supabase RLS performance best practices (index sur colonnes de policy)  
- Next.js Route Handlers (app/api/route.ts)
