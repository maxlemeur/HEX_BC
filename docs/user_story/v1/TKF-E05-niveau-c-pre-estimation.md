# TKF-E05 — Niveau C : Pre-estimation Plan Complet

> Phase: 3 | Priorite: P1 | Statut: Termine (fichier fini)

## Objectif

Implementer le Niveau C du takeoff : analyse de plans architecturaux complets via Gemini
Vision avec ThinkingLevel.HIGH, generation d'items avec score de confidence et evidence
textuelle, chunking pour PDF volumineux, et interface de review avec validation obligatoire
des items low-confidence avant application.

## Ce qui existe deja

- **Pipeline Niveau A+B complet** : TKF-E01 + TKF-E02 + TKF-E04 — schema, SDK, traitement,
  review, apply, gestion plans.
- **Wrapper Gemini** : `src/lib/takeoff/gemini-client.ts` — `callGeminiStructured()` avec
  support `ThinkingLevel`.
- **Schema Zod** : `src/lib/takeoff/schemas.ts` — `TakeoffExchangeSchema` avec champs
  `confidence` et `evidence`.
- **Prompts** : `src/lib/takeoff/prompts.ts` — prompt Niveau C.
- **Gestion plans** : TKF-017/018 — tables et API plans.

---

## TKF-022 — Traitement job Niveau C (ThinkingLevel.HIGH, confidence/evidence)

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux lancer une pre-estimation automatique depuis un plan
> architectural complet, avec un score de confiance et des justifications pour chaque
> item, afin d'obtenir une premiere estimation rapide a valider manuellement.

### Criteres d'acceptation

- [ ] `processLevelC(jobId)` implemente pipeline complet:
  1. chargement PDF/plan set
  2. chunking si necessaire
  3. appel Gemini Vision `ThinkingLevel.HIGH`
  4. validation Zod stricte
  5. persistence resultats/items
  6. transition status job
- [ ] Timeout etendu (`>=120s`) et configurable par niveau
- [ ] Chaque item persiste obligatoirement:
  - `designation`, `quantity`, `unit`
  - `confidence` entre `0` et `1`
  - `evidence` non vide
  - `source_page`
- [ ] Score global job calcule et persiste
- [ ] Budget/observabilite:
  - token budget configurable
  - metriques detaillees (`input`,`reasoning`,`output`,`cost`,`duration`)
  - logs structures avec `job_id`, `tenant_id`, `level`
- [ ] Tests integration couvrent:
  - sortie valide
  - sortie schema invalide
  - timeout
  - cout excessif/budget depasse

### Notes techniques

- Fichiers a creer / modifier :
  - `src/lib/takeoff/processor.ts` — ajouter `processLevelC()`
- Reutiliser :
  - `src/lib/takeoff/gemini-client.ts` — `callGeminiStructured()` avec ThinkingLevel
  - `src/lib/takeoff/prompts.ts` — prompt Niveau C
  - `src/lib/takeoff/schemas.ts` — schema avec confidence/evidence
- Dependances : TKF-002, TKF-003, TKF-004, TKF-006, TKF-017, TKF-018, TKF-023

---

## TKF-023 — Chunking PDF multi-pages (seuil 15 pages, chunks de 10)

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que developpeur, je veux que les PDF volumineux soient decoupes en chunks avant
> envoi a Gemini, afin de respecter les limites de tokens et garantir une extraction fiable
> meme sur des plans de grande taille.

### Criteres d'acceptation

- [ ] Nombre de pages detecte automatiquement et persiste dans metadata fichier/job
- [ ] Parametres configurables:
  - `chunk_threshold_pages` (defaut 15)
  - `chunk_size_pages` (defaut 10)
  - `chunk_overlap_pages` (defaut 2)
- [ ] Chaque chunk produit:
  - bornes pages (`start`,`end`)
  - metriques (`tokens`,`duration`,`cost`)
  - statut succes/echec
- [ ] Fusion finale deterministe:
  - dedup sur cle stable (`designation`,`unit`,`source_page`)
  - conservation meilleure confidence
  - aggregation warnings/evidence
- [ ] Gestion explicite des chevauchements de chunks
- [ ] Si `page_count` depasse limite absolue (defaut 200), job `failed` avec erreur claire
- [ ] Tests unitaires couvrent split, overlap, fusion, dedup et limites

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/chunking.ts`
- Reutiliser :
  - `src/lib/takeoff/gemini-client.ts` — appels multiples
  - `src/lib/takeoff/processor.ts` — integration dans le pipeline
- Dependances : TKF-017, TKF-018

---

## TKF-024 — UI Review Niveau C (confidence bar, evidence panel, verified checkbox)

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux examiner les items pre-estimes depuis un plan avec
> une visualisation du niveau de confiance et des justifications de l'IA, afin de
> valider efficacement les donnees avant application au devis.

### Criteres d'acceptation

- [ ] Vue review C affiche:
  - score global job
  - score par item avec code couleur (`HIGH`,`MEDIUM`,`LOW`)
  - checkbox `is_verified`
- [ ] Panel evidence:
  - affiche `evidence` complete
  - `source_page`
  - lien document source (signed URL)
- [ ] Filtres + tri:
  - confiance
  - verifies/non verifies
  - page source
  - tri par confiance (`LOW` en premier par defaut)
- [ ] Compteurs en temps reel: par niveau de confiance + verifies
- [ ] Warning bloquant visible pour items `LOW` non verifies
- [ ] Accessibilite:
  - navigation clavier
  - annonces d'etat pour changements de filtre/selection
- [ ] Tests UI couvrent filtres, panel evidence, verification item et warning

### Notes techniques

- Fichiers a creer :
  - `src/components/takeoff/TakeoffReviewConfidence.tsx`
  - `src/components/takeoff/TakeoffEvidencePanel.tsx`
- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/takeoff/[jobId]/review/page.tsx` —
    ajout mode vue confidence
- Reutiliser :
  - `src/components/takeoff/TakeoffReviewTable.tsx` — base commune
- Dependances : TKF-012, TKF-022, TKF-023

---

## TKF-025 — Guard apply : verified obligatoire pour low-confidence

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux etre empeche d'appliquer des items low-confidence non
> verifies au devis, afin de garantir que l'IA ne pollue pas mon devis avec des donnees
> incertaines sans validation humaine.

### Criteres d'acceptation

- [ ] Guard serveur central (`src/lib/takeoff/guards.ts`) applique dans route apply:
  - pour niveau C, tout item inclus avec `confidence < threshold` doit etre `is_verified=true`
  - sinon retour `422` avec `item_ids` bloques
- [ ] Guard client apply wizard:
  - detection pre-submit des items bloques
  - message actionnable avec lien retour review
- [ ] `threshold` configurable par tenant (defaut `0.5`)
- [ ] Option override:
  - desactivee par defaut
  - reservee aux admins explicites
  - auditee (`takeoff.apply.override`)
- [ ] Items `MEDIUM` non bloques mais warning visible
- [ ] Tests integration couvrent guard serveur, guard client et mode admin override

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/guards.ts`
- Fichiers a modifier :
  - `src/app/api/takeoff/jobs/[jobId]/apply/route.ts` — ajout guard serveur
  - `src/components/takeoff/TakeoffApplyWizard.tsx` — ajout guard client
- Reutiliser :
  - `src/lib/estimates/server.ts` — pattern `assertDraftStatus()`
- Dependances : TKF-013, TKF-024
