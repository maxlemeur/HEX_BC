# TKF-E01 — Fondations Takeoff & Schema Canonique

> Phase: 1 (MVP) | Priorite: P0 | Statut: Termine (fichier fini)

## Objectif

Poser le socle technique du module Takeoff : schema de base de donnees (tables, enums, RLS,
indexes), schema Zod canonique `TakeoffExchange`, wrapper SDK Gemini, prompts metier versiones,
feature flag par tenant, et module d'erreurs. Cette epic garantit que tous les developpements
Takeoff s'appuient sur des fondations solides et coherentes.

## Ce qui existe deja

- **Pattern Zod** : `src/lib/estimates/schemas.ts` — validation, discriminatedUnion, preprocess,
  superRefine. A reproduire pour `TakeoffExchange`.
- **Erreurs normalisees** : `src/lib/estimates/errors.ts` — `ApiError`, `ok()`, `badRequest()`,
  `unauthorized()`, `forbidden()`, `notFound()`, `conflict()`, `internalError()`,
  `mapSupabaseError()`, `toErrorResponse()`. Reutilisable directement.
- **Feature flags** : `src/lib/feature-flags.ts` — `getFeatureFlagValueForTenant()`.
  Pattern existant a reutiliser pour `TAKEOFF_MODULE_ENABLED`.
- **SDK Gemini** : `docs/old_gemini_chiffrage/` — reference SDK `@google/genai`,
  schemas JSON Gemini, prompts d'extraction, patterns d'appel structuree.
- **Supabase server** : `src/lib/supabase/server.ts` — `createSupabaseServerClient()`.
- **Migrations incrementales** : ~60 migrations dans `supabase/migrations/`.

---

## TKF-001 — Tables takeoff_jobs, takeoff_results, takeoff_items + enums + RLS + indexes

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que chiffreur, je veux que le systeme dispose d'un schema de base de donnees
> structure pour stocker les jobs takeoff, leurs resultats et items extraits, afin que
> toutes les donnees d'extraction soient persistees de maniere fiable et securisee.

### Criteres d'acceptation

- [ ] Migration SQL idempotente cree:
  - enums `takeoff_job_level` (`A`,`B`,`C`) et `takeoff_job_status` (`pending`,`processing`,`completed`,`failed`,`canceled`,`applied`)
  - table `takeoff_jobs` avec `tenant_id` obligatoire et FK vers `estimate_versions`
  - table `takeoff_results` avec `tenant_id` obligatoire et FK vers `takeoff_jobs`
  - table `takeoff_items` avec `tenant_id` obligatoire et FK vers `takeoff_jobs`/`takeoff_results`
- [ ] Contraintes de coherence en base:
  - `confidence` borne entre `0` et `1`
  - `quantity > 0`
  - `status` et `level` non null
  - `updated_at` maintenu automatiquement
- [ ] RLS activee sur les 3 tables avec policies `SELECT/INSERT/UPDATE/DELETE`
      scopees par `current_tenant_id()`
- [ ] Tests SQL RLS couvrent:
  - un membre du tenant A ne voit jamais les lignes du tenant B
  - `INSERT/UPDATE/DELETE` cross-tenant refuses
- [ ] Index minimaux:
  - `takeoff_jobs(tenant_id, status, created_at desc)`
  - `takeoff_jobs(tenant_id, estimate_version_id)`
  - `takeoff_results(tenant_id, job_id)`
  - `takeoff_items(tenant_id, job_id, is_excluded, is_verified)`
- [ ] Migration documentee dans `supabase/migrations/` avec script de verification
      (requete smoke test) pour Dev/QA

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/xxx_takeoff_schema.sql`
- Reutiliser :
  - Pattern RLS de `supabase/migrations/004_harden_estimate_devis_rls_s1.sql`
  - Fonctions DB `current_tenant_id()`, `is_tenant_member()`
- Dependances : aucune

---

## TKF-002 — Schema Zod TakeoffExchange v1 + types TS + helper zodToGeminiJsonSchema()

**Priorite:** P0 | **Effort:** M

### User Story

> En tant que developpeur, je veux un schema Zod canonique `TakeoffExchange` qui definit
> le format de sortie structure de Gemini, afin de valider automatiquement les reponses IA
> et garantir la coherence des donnees extraites.

### Criteres d'acceptation

- [ ] `TakeoffExchangeSchema` est strict (`.strict()`) et refuse tout champ inconnu
- [ ] Le schema couvre:
  - `items[]` avec champs obligatoires `designation`, `quantity`, `unit`
  - `warnings[]` normalises
  - `tables[]` (niveau B) structurees
  - `metadata` incluant `level`, `prompt_version`, `file_type`, `schema_version`
  - `confidence`/`evidence` encadres pour niveau C
- [ ] Validation conditionnelle par niveau (`A/B/C`) via `discriminatedUnion`
      ou `superRefine`:
  - niveau A: `tables` optionnel
  - niveau B: `tables` requis
  - niveau C: `confidence` global + `evidence` par item requis
- [ ] Types TS exportes: `TakeoffExchange`, `TakeoffItem`, `TakeoffTable`,
      `TakeoffWarning`, `TakeoffMetadata`
- [ ] `zodToGeminiJsonSchema()` fournit un JSON Schema compatible structured output
- [ ] Tests unitaires couvrent:
  - cas valides A/B/C
  - cas invalides (bornes confidence, quantity, unit vide)
  - rejection des champs inconnus

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/schemas.ts`
  - `src/lib/takeoff/types.ts`
- Reutiliser :
  - `src/lib/estimates/schemas.ts` — patterns Zod (preprocess, superRefine, discriminatedUnion)
  - `docs/old_gemini_chiffrage/` — schemas JSON Gemini existants comme reference
- Dependances : aucune

---

## TKF-003 — Wrapper SDK Gemini server-side (callGeminiStructured)

**Priorite:** P0 | **Effort:** M

### User Story

> En tant que developpeur, je veux un wrapper serveur encapsulant les appels au SDK Gemini
> avec gestion d'erreurs, retry, et parsing structure, afin de centraliser la logique
> d'interaction IA et garantir la securite de la cle API.

### Criteres d'acceptation

- [ ] `callGeminiStructured<T>()` accepte un contrat type:
  - `options`: `{ prompt, schema, files?, thinkingLevel?, timeoutMs?, maxRetries?, context? }`
  - retourne `{ data, tokenCount, costCents, durationMs, model, promptVersion }`
- [ ] Cle Gemini lue uniquement cote serveur (`GEMINI_API_KEY`) et jamais exposee
      en variable `NEXT_PUBLIC_*`
- [ ] Retry avec backoff exponentiel (3 max) sur erreurs retryables (`429`,`500`,`503`, timeout)
- [ ] Timeout par defaut `60s`, extensible a `120s+` pour niveau C
- [ ] Mapping erreur standardise vers `TakeoffError`:
  - `AI_RATE_LIMIT`, `AI_TIMEOUT`, `AI_SCHEMA`, `AI_SAFETY`, `AI_PROVIDER`
  - champ `retryable` obligatoire
- [ ] Logging structure par appel:
  - `job_id`, `tenant_id`, `level`, `duration_ms`, `token_count`, `cost_cents`, `status`
- [ ] Tests unitaires couvrent:
  - succes structure output
  - retry puis succes
  - echec final apres retries
  - timeout et erreurs schema

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/gemini-client.ts`
- Reutiliser :
  - `docs/old_gemini_chiffrage/lib/` — patterns SDK `@google/genai`
  - `src/lib/estimates/errors.ts` — `ApiError`, mapping erreurs
- Dependances : TKF-002 (schemas Zod pour typing generique)

---

## TKF-004 — Prompts metier versiones par niveau A/B/C

**Priorite:** P0 | **Effort:** M

### User Story

> En tant que chiffreur, je veux que les prompts envoyes a Gemini soient optimises par
> niveau d'extraction (A/B/C), afin d'obtenir des resultats precis et adaptes au type
> de document traite.

### Criteres d'acceptation

- [ ] Prompts separes et exportes pour niveaux A/B/C avec interface typee commune
- [ ] Chaque prompt inclut:
  - objectif metier
  - contraintes de format strict vers `TakeoffExchangeSchema`
  - regles de warnings/anomalies
- [ ] Versionning explicite (`prompt_version`) par niveau, stocke dans le job
- [ ] Matrice `level -> model -> thinkingLevel` centralisee et testee
- [ ] Tests de non-regression:
  - snapshot du prompt rendu
  - verification presence instructions obligatoires (`confidence/evidence` pour C)

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/prompts.ts`
- Reutiliser :
  - `docs/old_gemini_chiffrage/` — prompts existants comme base
- Dependances : TKF-002

---

## TKF-005 — Feature flag TAKEOFF_MODULE_ENABLED par tenant

**Priorite:** P0 | **Effort:** S

### User Story

> En tant qu'admin, je veux pouvoir activer ou desactiver le module Takeoff par tenant,
> afin de deployer progressivement la fonctionnalite sans impacter les tenants non concernes.

### Criteres d'acceptation

- [ ] Flag `TAKEOFF_MODULE_ENABLED` ajoute/initialise par tenant (default `false`)
- [ ] `assertTakeoffEnabled(tenantId)` applique sur toutes les routes `/api/takeoff/*`
- [ ] Route API retourne `403` normalise si flag desactive
- [ ] Hook UI `useTakeoffEnabled()` supporte `loading/error/ready`
- [ ] Navigation et CTA takeoff masques si flag off (pas seulement desactives)
- [ ] Tests integration multi-tenant:
  - tenant A flag on: acces OK
  - tenant B flag off: blocage API + UI

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/feature-flags.ts`
- Reutiliser :
  - `src/lib/feature-flags.ts` — `getFeatureFlagValueForTenant()`
  - Pattern existant des feature flags (EST-006)
- Dependances : aucune

---

## TKF-006 — Module errors.ts + types communs Takeoff

**Priorite:** P0 | **Effort:** S

### User Story

> En tant que developpeur, je veux un module d'erreurs dedie au takeoff avec des types
> communs, afin de garantir une gestion d'erreurs coherente et des messages explicites
> dans tout le module.

### Criteres d'acceptation

- [ ] `TakeoffError` etend `ApiError` avec:
  - `code` (enum stable), `jobId?`, `level?`, `retryable`, `details?`
- [ ] Catalogue d'erreurs complet:
  - module disabled, file validation, gemini provider/rate-limit/timeout/safety/schema,
    apply conflict, job not found, unauthorized tenant
- [ ] `toTakeoffErrorResponse()` retourne une forme JSON stable pour front/QA
- [ ] Types partages exportes:
  - `TakeoffLevel`, `TakeoffJobStatus`, `TakeoffJobCreateInput`, `TakeoffJobResponse`,
    `TakeoffApiError`
- [ ] Contrats erreurs references dans la spec OpenAPI (compatible validate-openapi)
- [ ] Tests verifies:
  - mapping exception -> code HTTP
  - absence de fuite de secrets provider dans les messages

### Notes techniques

- Fichiers a creer :
  - `src/lib/takeoff/errors.ts`
  - `src/lib/takeoff/types.ts` (si pas deja cree par TKF-002)
- Reutiliser :
  - `src/lib/estimates/errors.ts` — `ApiError`, `ok()`, `badRequest()`, `toErrorResponse()`
- Dependances : TKF-003
