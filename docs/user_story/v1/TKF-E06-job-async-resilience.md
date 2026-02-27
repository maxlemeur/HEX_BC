# TKF-E06 — Job Async & Resilience

> Phase: 2 | Priorite: P1 | Statut: Termine (fichier fini)

## Objectif

Deporter le traitement des jobs takeoff vers une Supabase Edge Function asynchrone avec
retry automatique, implementer un dashboard de suivi des jobs par projet, et mettre en place
l'observabilite (metriques de cout, duree, taux d'echec).

## Ce qui existe deja

- **Pipeline takeoff** : TKF-E01 + TKF-E02 — traitement synchrone fonctionnel
  (`processLevelA`, `processLevelB`).
- **Schema DB** : tables `takeoff_jobs`, `takeoff_results` avec colonnes metriques
  (`token_count`, `cost_cents`, `duration_ms`).
- **Supabase server** : `src/lib/supabase/server.ts` — `createSupabaseServerClient()`.
- **Erreurs normalisees** : `src/lib/takeoff/errors.ts` — gestion d'erreurs avec `retryable`.

---

## TKF-026 — Supabase Edge Function process_takeoff_job + retry auto

**Priorite:** P1 | **Effort:** L

### User Story

> En tant que chiffreur, je veux que le traitement des jobs takeoff soit execute en arriere-plan
> sans bloquer l'interface, avec des retries automatiques en cas d'echec transitoire, afin de
> garantir la fiabilite meme pour les extractions longues (Niveau B/C).

### Criteres d'acceptation

- [ ] Edge Function `process_takeoff_job` creee et deployable dans `supabase/functions/`
- [ ] Declenchement asynchrone depuis creation job (appel direct ou webhook documente)
- [ ] Pipeline robuste:
  1. lecture job + lock logique
  2. transition `pending -> processing`
  3. dispatch `processLevelA|B|C`
  4. transition finale `completed|failed|canceled`
- [ ] Retry automatique:
  - max 3 tentatives
  - backoff `5s/15s/45s`
  - uniquement erreurs `retryable` (`429`,`500`,`503`, timeout)
  - `retry_count` incremente atomiquement
- [ ] Idempotence:
  - job terminal (`completed|canceled|applied`) jamais re-traite
  - double trigger concurrent ne cree pas de traitement parallele
- [ ] Variables d'env requises valideses au startup (`GEMINI_API_KEY`, etc.)
- [ ] Logging structure + correlation id:
  - `job_id`, `tenant_id`, `level`, `attempt`, `duration_ms`, `status`
- [ ] Tests integration couvrent succes, retry, echec final, idempotence

### Notes techniques

- Fichiers a creer :
  - `supabase/functions/process_takeoff_job/index.ts`
- Reutiliser :
  - `src/lib/takeoff/processor.ts` — logique de traitement existante
    (a adapter pour l'environnement Edge Function Deno)
  - `src/lib/takeoff/errors.ts` — `retryable` flag
  - `src/lib/takeoff/gemini-client.ts` — wrapper SDK
- Dependances : TKF-003, TKF-007, TKF-008

---

## TKF-027 — Job listing & dashboard jobs par projet

**Priorite:** P1 | **Effort:** M

### User Story

> En tant que chiffreur, je veux voir la liste de tous les jobs takeoff d'un projet avec
> leur statut, afin de suivre l'historique des extractions et acceder rapidement aux
> resultats.

### Criteres d'acceptation

- [ ] Page listing jobs affiche:
  - tableau trie date desc
  - colonnes source/level/status/date/duree/items/cout
  - lien detail/review
- [ ] Filtres fonctionnels:
  - statut
  - niveau
  - periode (optionnelle)
- [ ] Actions rapides:
  - nouveau job
  - retry job failed
  - cancel job actif
- [ ] Compteurs: total, en cours, completes, failed, canceled
- [ ] Pagination serveur si `>20` (page + pageSize)
- [ ] Verification tenant scope sur toutes les requetes
- [ ] Tests UI/API couvrent filtres, pagination, actions rapides, erreur 403/404

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/estimates/[versionId]/takeoff/page.tsx`
  - `src/components/takeoff/TakeoffJobList.tsx`
- Reutiliser :
  - `src/lib/takeoff/client.ts` — `listJobs()`
  - Patterns UI existants (listes, filtres, badges)
- Dependances : TKF-009, TKF-026

---

## TKF-028 — Observabilite : metriques jobs (cout, duree, taux d'echec)

**Priorite:** P1 | **Effort:** M

### User Story

> En tant qu'admin, je veux consulter des metriques agreees sur les jobs takeoff
> (cout Gemini, duree moyenne, taux d'echec), afin de suivre la consommation IA
> et identifier les problemes de fiabilite.

### Criteres d'acceptation

- [ ] `GET /api/takeoff/stats` retourne agregats:
  - jobs par statut
  - cout total (`cost_cents`)
  - duree moyenne par niveau
  - taux echec par niveau
  - moyenne items/job
  - serie temporelle (jour/semaine)
- [ ] Route scopee tenant et securisee (pas de fuite cross-tenant)
- [ ] Parametres filtres supportes:
  - `period` (`7d`,`30d`,`90d`)
  - `level` optionnel
- [ ] `TakeoffStatsPanel` affiche KPI + etat vide/erreur
- [ ] Donnees stats documentees OpenAPI
- [ ] Tests couvrent calculs, filtres, et precision des aggregations

### Notes techniques

- Fichiers a creer :
  - `src/app/api/takeoff/stats/route.ts`
  - `src/lib/takeoff/stats.ts` — fonctions d'agregation
  - `src/components/takeoff/TakeoffStatsPanel.tsx`
- Reutiliser :
  - `src/lib/supabase/server.ts` — `createSupabaseServerClient()`
  - `src/lib/estimates/errors.ts` — gestion erreurs
- Dependances : TKF-026
