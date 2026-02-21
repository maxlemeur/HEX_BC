# EST-E14 — Observabilite, tests, performance

> Milestone: M4 | Priorite: P1 | Statut: A faire

## Objectif

Garantir la fiabilite en production par une couverture de tests exhaustive (RLS, E2E, charge), une optimisation des performances de l'editeur pour les gros devis, et la mise en place d'un monitoring structure. Ce module couvre la dette technique et les fondations necessaires avant la mise en production.

## Ce qui existe deja

- Tests unitaires du moteur de calcul dans `src/lib/estimate-calculations.test.ts` (vitest)
- Tests serveur et client dans `src/lib/estimates/server.test.ts` et `src/lib/estimates/client.test.ts`
- 21 migrations appliquees couvrant : durcissement RLS, performance, procurement, reorder atomique, bulk update, piste d'audit, import DPGF, mapping, multi-tenant, catalogue
- Piste d'audit via le trigger `log_estimate_audit()` et la table `audit_logs`
- Gestion d'erreurs structuree via `ApiError` et `toErrorResponse()` (`src/lib/estimates/errors.ts`)
- Policies RLS sur toutes les tables estimate avec isolation tenant

---

## EST-261 — Tests RLS end-to-end

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que developpeur, je veux des tests automatises verifiant que les policies RLS bloquent correctement les acces inter-tenant, afin de garantir la securite des donnees.

### Criteres d'acceptation

- [ ] Suite de tests avec simulation de multiples utilisateurs appartenant a differents tenants
- [ ] Verification des policies SELECT / INSERT / UPDATE / DELETE sur toutes les tables estimate
- [ ] Test de l'isolation inter-tenant : un utilisateur du tenant A ne peut pas lire/modifier les donnees du tenant B
- [ ] Test de l'acces par role : admin vs chiffreur (engineer) vs viewer (client)
- [ ] Couverture des tables : `estimate_versions`, `estimate_items`, `estimate_categories`, `estimate_labor_roles`, `estimate_suggestion_rules`, `portal_tokens`, `audit_logs`
- [ ] Execution automatique en CI (GitHub Actions)
- [ ] Tests en echec = pipeline bloquee (aucun merge possible)

### Notes techniques

- Fichiers a creer :
  - `src/lib/estimates/__tests__/rls.test.ts` — Tests RLS via client Supabase avec differents JWT
  - Ou alternativement `supabase/tests/rls_test.sql` — Tests SQL directs via pgTAP
  - Configuration CI pour executer les tests RLS
- Reutiliser : `createSupabaseServerClient()` pour simuler differents contextes utilisateur, schema des policies RLS existantes dans les migrations
- Dependances : aucune

---

## EST-262 — Tests E2E parcours critique

**Priorite:** P0 | **Effort:** L

### User Story

> En tant que developpeur, je veux des tests E2E couvrant le parcours complet (creer, editer, envoyer, accepter), afin de detecter les regressions avant deploiement.

### Criteres d'acceptation

- [ ] Suite de tests Playwright couvrant les scenarios critiques
- [ ] Scenario 1 : creer un devis, ajouter des items, editer les valeurs, sauvegarder
- [ ] Scenario 2 : changer le statut (draft -> sent -> accepted)
- [ ] Scenario 3 : dupliquer un devis et verifier les donnees copiees
- [ ] Scenario 4 : imprimer / exporter un devis
- [ ] Scenario 5 : import DPGF et verification du mapping
- [ ] Captures d'ecran automatiques en cas d'echec
- [ ] Execution en CI avec rapport HTML
- [ ] Temps d'execution total < 5 minutes

### Notes techniques

- Fichiers a creer :
  - `e2e/estimates/full-lifecycle.spec.ts` — Parcours complet de creation a acceptation
  - `e2e/estimates/duplicate.spec.ts` — Duplication et verification
  - `e2e/estimates/import-dpgf.spec.ts` — Import et mapping
  - `playwright.config.ts` — Configuration Playwright (si inexistant)
  - Configuration CI pour pipeline E2E
- Reutiliser : Page d'edition existante (`src/app/dashboard/estimates/[versionId]/edit/page.tsx`), routes API existantes pour le seeding des donnees de test
- Dependances : aucune

---

## EST-263 — Metriques et monitoring

**Priorite:** P1 | **Effort:** M

### User Story

> En tant qu'admin, je veux un dashboard de metriques (temps de reponse API, erreurs, usage), afin de surveiller la sante de l'application.

### Criteres d'acceptation

- [ ] Logging structure en JSON sur tous les endpoints API
- [ ] Mesure du temps de reponse (duration) par requete
- [ ] Taux d'erreur par endpoint (4xx et 5xx)
- [ ] Metriques de connexion Supabase (pool usage)
- [ ] Dashboard de visualisation (Grafana ou page admin integree)
- [ ] Alerting sur anomalies : taux d'erreur > seuil, latence p95 > seuil
- [ ] Retention des metriques configurable (defaut : 30 jours)

### Notes techniques

- Fichiers a creer :
  - `src/lib/monitoring/logger.ts` — Logger structure JSON (compatible Vercel / stdout)
  - `src/lib/monitoring/metrics.ts` — Collection et agregation des metriques
  - `src/app/dashboard/admin/metrics/page.tsx` — Page admin de visualisation des metriques
- Fichiers a modifier :
  - Tous les route handlers dans `src/app/api/estimates/` — Ajouter le middleware de timing et logging
- Reutiliser : `toErrorResponse()` de `src/lib/estimates/errors.ts` pour les logs d'erreur structures, systeme de roles existant pour restreindre l'acces admin
- Dependances : aucune

---

## EST-264 — Optimisation performance editeur

**Priorite:** P0 | **Effort:** L | **Milestone:** M1

### User Story

> En tant que chiffreur, je veux que l'editeur reste fluide avec 3000+ lignes, afin de travailler sur de gros devis (echelle OPTIMA) sans ralentissement.

> **Note PRD:** Promu de M4 a M1 — les fichiers OPTIMA reels contiennent 2948 lignes (hydraulique), ce qui en fait un blocker immediat.

### Criteres d'acceptation

- [ ] Scrolling virtuel implemente sur la table de l'editeur (react-window ou @tanstack/virtual)
- [ ] Calculs lazy : seules les lignes visibles sont calculees en temps reel
- [ ] Memoisation des calculs via `useMemo` / `React.memo` sur les composants couteux
- [ ] Benchmark : rendu < 100ms pour 1000 lignes
- [ ] Benchmark : chargement initial < 500ms pour 3000 lignes
- [ ] Benchmark : scroll 60fps avec 3000 lignes et drapeaux qualite actifs
- [ ] Pas de regression fonctionnelle sur l'edition (ajout, suppression, reorder, bulk update)
- [ ] Profiling React DevTools documente (avant/apres)

### Notes techniques

- Fichiers a creer :
  - `src/hooks/useVirtualList.ts` — Hook personnalise pour le scrolling virtuel
  - Tests de benchmark (performance) integres
- Fichiers a modifier :
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — Integrer la virtualisation dans la table
  - Composant `EstimateEditorTable` (si extrait) — Refactoring pour supporter le rendu virtuel
- Reutiliser : `src/lib/estimate-calculations.ts` pour les calculs (a memoiser), `src/lib/estimate-quality.ts` pour les flags qualite (a lazy-evaluer)
- Dependances : aucune

---

## EST-265 — Tests de charge API

**Priorite:** P2 | **Effort:** M

### User Story

> En tant que developpeur, je veux des tests de charge sur les endpoints critiques, afin de connaitre les limites et garantir la stabilite sous charge.

### Criteres d'acceptation

- [ ] Scripts de test de charge avec k6 ou Artillery
- [ ] Scenario 1 : mises a jour bulk concurrentes (`PUT /api/estimates/[versionId]/items/bulk`)
- [ ] Scenario 2 : creation parallele de devis (`POST /api/estimates`)
- [ ] Scenario 3 : export de gros devis (3000+ lignes)
- [ ] Scenario 4 : export BDC 31 colonnes avec 3000 lignes (EST-202)
- [ ] SLA definis : p95 < 500ms pour les lectures, p95 < 2s pour les ecritures
- [ ] Rapport genere avec courbes de latence et taux d'erreur
- [ ] Execution periodique (hebdomadaire) en CI
- [ ] Identification des goulots d'etranglement (DB queries, connexion pool, calculs)

### Notes techniques

- Fichiers a creer :
  - `load-tests/estimates.js` — Script k6 principal avec les scenarios de charge
  - `load-tests/config.json` — Configuration des seuils et parametres
  - `load-tests/README.md` — Documentation d'execution
  - Configuration CI pour execution periodique
- Reutiliser : Routes API existantes comme cibles de test, `bulk_update_estimate_items()` et `duplicate_estimate_version()` comme operations critiques a tester
- Dependances : aucune
