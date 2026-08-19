# Audit de dette technique — 2026-08-19

> État du dépôt à `main @ 7ecbfc4`, après la clôture des lots 0–7 du
> [`codebase-improvement-ledger.md`](codebase-improvement-ledger.md). Ce document en est la suite :
> même formule de score, mêmes règles de clôture. Il complète, sans le remplacer,
> [`AUDIT-DOCUMENTATION-2026-07-29.md`](AUDIT-DOCUMENTATION-2026-07-29.md).
>
> Périmètre : `src`, `supabase`, `e2e`, `.github`, `docs`. Aucun fichier du dépôt n'a été modifié
> par l'audit, hormis l'ajout de ce document.

## Chiffres clés

| Indicateur | Valeur |
|---|---|
| Quality Gate sur `main` | **rouge depuis le 9 août** — 19 échecs sur les 40 derniers runs |
| E2E Playwright Critical | **0 succès sur 20 runs** (`E2E_ALLOWED_SUPABASE_HOST` absent de `e2e-staging`) |
| Protection de branche `main` | aucune (404), rulesets vides, dépôt public, pushes directs |
| PR bloquées depuis le 13 août | 8 (release 0.4.0 + 7 Dependabot) |
| Postes de dette | 26, dont 9 à score ≥ 35 ; 4 à effort ≤ 1 j et score ≥ 40 |
| Effort phases 0 → 2 | ≈ 20 j·h, réalisable à ~20 % de capacité sur deux mois |
| Lots déjà payés (ne pas ré-auditer) | 7 : deps, migrations reproductibles, frontière tenant, effets externes, hotspots, moteur v2 |

## 1. Synthèse

Le chantier d'août a réglé l'essentiel de la dette *structurante* : dépendances à jour et auditées,
migrations reproductibles avec manifeste, frontière auth/tenant unifiée, moteur de calcul v2 gouverné,
secrets propres, documentation réduite de 287 à 29 fichiers. La dette qui reste est d'une autre nature.

**Les garde-fous existent mais ne gardent rien.** Le Quality Gate est rouge sur `main` depuis le
9 août (8 violations de budget d'architecture introduites par les commits des 13 et 18 août), la suite
Playwright « critique » n'a *jamais* réussi en CI (secret manquant dans l'environnement `e2e-staging`),
la matrice RLS échoue sur l'ordre des migrations, et `main` n'a ni protection de branche ni ruleset.
Conséquence visible : 8 PR bloquées depuis le 13 août, dont la release 0.4.0.

Trois autres constats structurent le reste du registre :

- **Un filet opérationnel à moitié tendu.** L'outbox email a une machine d'états complète mais aucun
  draineur ; le cron de reprise exige Vercel Pro sans repli ; il n'existe aucun suivi d'erreurs — un job
  de métré qui meurt n'alerte personne.
- **Une couche de types qui ment.** `src/types/database.ts` est écrit à la main : au moins 23 RPC
  appelées ne sont pas typées, le schéma takeoff entier est absent, d'où 1 047 `as never` dans
  `src/lib`. Une faute de frappe sur un nom de colonne compile.
- **Deux architectures qui coexistent.** Estimates/takeoff/affaires passent par `/api` + Zod + serveur ;
  purchase-orders/suppliers/products écrivent dans Supabase depuis le navigateur et 7 routes recodent
  l'auth sans résoudre le tenant.

Enfin, `CLAUDE.md` — injecté dans chaque session d'agent — affirme encore que « la v1 est ce qui
s'exécute en production » et que l'éditeur épingle `EDITOR_CALC_ENGINE_VERSION = 1`. La constante
n'existe plus ; `NEW_ESTIMATE_CALC_ENGINE_VERSION = 2` gouverne toute nouvelle création.

## 2. Priorisation

Score = (Impact + Risque) × (6 − Effort), chacun sur 1–5.
Effort : 1 ≈ ½ à 1 j · 2 ≈ 1–2 j · 3 ≈ 3–5 j · 4 ≈ 1–2 semaines · 5 > 2 semaines.

| # | Poste | Catégorie | I | R | E | Score | Effort | Phase |
|--:|---|---|:-:|:-:|:-:|--:|---|:-:|
| 1 | Remettre `main` au vert et rendre les gates bloquants | Infra/process | 5 | 5 | 1 | **50** | 1 j | P0 |
| 2 | Tester les mutations de frontière non couvertes (`memberships`, `estimate-approval.ts`, cancel takeoff) | Tests | 5 | 5 | 2 | **40** | 1,5 j | P1 |
| 3 | Supprimer l'auth artisanale des routes purchase-orders/audit (7 fichiers) | Code/sécu | 4 | 4 | 1 | **40** | ½ j | P0 |
| 4 | Corriger `CLAUDE.md` (moteur v1 « en production ») et les compteurs périmés | Docs | 4 | 4 | 1 | **40** | ½ j | P0 |
| 5 | Générer `database.ts` et détecter la dérive (≥ 23 RPC non typées, 1 047 `as never`) | Base/types | 5 | 4 | 2 | **36** | 2 j | P1 |
| 6 | Unifier les 5 copies de `toErrorResponse` (K-01 appliqué à 3/5) | Code/sécu | 3 | 4 | 1 | **35** | ½ j | P1 |
| 7 | Désarmer `supabase/schema.sql` (35 `drop table … cascade`) | Base | 2 | 5 | 1 | **35** | ½ j | P0 |
| 8 | Rapatrier les constantes métier dupliquées (TVA ×7, 12 formateurs monétaires) | Code | 3 | 4 | 1 | **35** | ½ j | P1 |
| 9 | Cron de reprise sans repli (Vercel Pro), backup sans alerte | Infra | 3 | 4 | 1 | **35** | 1 j | P0 |
| 10 | Couvrir les modules critiques sans aucun test (`evidence`, `estimate-seal`, `pdf-publication`…) | Tests | 4 | 4 | 2 | **32** | 2 j | P2 |
| 11 | Extraire les seams propres de `estimates/server.ts` (8 815 l., 36/174 commits) | Archi | 5 | 3 | 2 | **32** | 2 j | P2 |
| 12 | Exécuter toute la suite Playwright (13/20 specs jamais en CI), et sur les PR | Tests | 4 | 4 | 2 | **32** | 1,5 j | P2 |
| 13 | Drainer et réconcilier l'outbox email | Infra | 5 | 5 | 3 | **30** | 3–4 j | P2 |
| 14 | Installer un suivi d'erreurs et une sonde de santé | Infra | 5 | 5 | 3 | **30** | 4–5 j | P2 |
| 15 | Éclater les 43 snapshots golden du calcul | Tests | 3 | 4 | 2 | **28** | 1 j | P2 |
| 16 | Documenter les 22 variables d'environnement manquantes | Infra | 2 | 3 | 1 | **25** | ½ j | P1 |
| 17 | Régler l'horodatage des migrations au push | Base | 2 | 3 | 1 | **25** | ½ j | P1 |
| 18 | Ramener les écritures navigateur derrière l'API (suppliers, products, orders) | Archi | 4 | 4 | 3 | **24** | 5 j | P3 |
| 19 | Sortir `xlsx` des bundles client, budgets perf par page | Perf | 3 | 3 | 2 | **24** | 1,5 j | P2 |
| 20 | Couvrir les ~30 routes restantes sans test | Tests | 4 | 3 | 3 | **21** | 4 j | P3 |
| 21 | Sortir les deux contrôleurs feuilles du hook éditeur, renommer l'accesseur | Archi | 3 | 1 | 1 | **20** | ½ j | P1 |
| 22 | Déplacer les schémas Zod de `takeoff/server.ts`, seam mapping-rules | Archi | 3 | 2 | 2 | **20** | 1,5 j | P3 |
| 23 | Étendre pgTAP au-delà de ~29 % des fonctions | Tests/base | 4 | 5 | 4 | **18** | 8 j | P3 |
| 24 | Porter ou retirer les 29 suites PowerShell | Tests | 4 | 4 | 4 | **16** | 8 j | P3 |
| 25 | Dériver DTO client et réponses OpenAPI d'une seule source | Archi | 3 | 2 | 4 | **10** | 2 sem. | P3 |
| 26 | Décomposer le hub d'injection du hook éditeur | Archi | 5 | 4 | 5 | **9** | > 3 sem. | P3 |

## 3. Infrastructure, CI et exploitation

### 1 · Les gates sont rouges et non bloquants — I 5 · R 5 · E 1 → 50 — P0

- **Quality Gate** : dernier succès le 9 août (`docs: streamline repository guidelines`). Depuis,
  19 échecs sur 40 runs. Cause actuelle, reproduite localement avec la règle de comptage exacte de
  `src/test/architecture-budgets.ts` : 8 violations de `config/architecture-budgets.json` —
  `EstimateEditorTable.tsx` 2 338 > 2 299, `useEstimateEditorState.impl.tsx` 2 810 > 2 743,
  `affaires/server.ts` 2 301 > 2 274, `openapi/registry.ts` 4 963 > 4 928, `takeoff/types.ts`
  1 125 > 1 077, et trois modules non budgétés au-dessus de 1 000 : `useEstimateEditorSyncController.ts`
  1 010, `takeoff/client.ts` 1 026, `takeoff/stats.ts` 1 101.
- **E2E Playwright Critical** : 0 succès sur les 20 derniers runs (16 annulés, 4 échecs). Échec en
  36 s sur `Missing required environment variables: E2E_ALLOWED_SUPABASE_HOST` — l'environnement
  GitHub `e2e-staging` n'a jamais été complété.
- **E2E RLS Matrix** : le garde append-only refuse `20260812155612`, `20260812174449`, `20260812223050`
  (commit `f4f6a70`, 18 août) car la base contenait déjà `20260813030000` (commit `1c86bbe`, 13 août).
  Le garde se ré-alignera au prochain push, mais `db:ci:local` n'a pas validé l'état fusionné.
- **Aucune protection** : `GET /branches/main/protection` → 404, rulesets vides, dépôt public,
  pushes directs sur `main`. Le registre du lot 4 signalait déjà « statut required non vérifié ».
- **Effet** : 8 PR ouvertes depuis le 13 août qu'aucun run vert ne peut débloquer. Note mineure :
  dans `quality-gate.yml`, `if: ${{ !cancelled() }}` fait tourner lint + Vitest + build même après un
  échec de typecheck (≈ 5 min perdues par run rouge).

**Correctif.** (a) Ramener chacun des 8 modules sous son plafond (≈ 250 lignes à extraire, cf. postes
21–22) ou relever explicitement la baseline dans un commit dédié *et relu* — pas de relèvement
silencieux ; (b) renseigner `E2E_ALLOWED_SUPABASE_HOST` dans `e2e-staging` ; (c) ruleset sur `main` :
PR obligatoire, checks requis Quality Gate + RLS Matrix, pas de force-push ; (d) règle « re-horodater
les migrations locales avant push » (poste 17). Le point (c) est une configuration GitHub, hors dépôt.

### 9 · Reprise durable sans repli, sauvegarde sans alerte — I 3 · R 4 · E 1 → 35 — P0

- `vercel.json` planifie `/api/internal/workflows/recover` toutes les 5 min. Sur un plan Hobby, Vercel
  n'autorise que des crons quotidiens : toute la couche de reprise (baux takeoff/intake, cleanup Storage)
  serait inerte. Le plan n'est pas vérifiable depuis le dépôt.
- `supabase-backup.yml` (cron 02:25) dépose un dump en artefact GitHub 30 jours, sans notification
  d'échec ni copie hors plateforme.
- `recoverDurableWorkflows` renvoie ses échecs dans le corps HTTP que personne ne lit ; un item
  empoisonné est repris toutes les 5 min sans plafond. `maxIntakePerRun` = 2 → 24 intakes/heure sous
  backlog, sans signal de profondeur de file.

**Correctif.** Vérifier le plan Vercel ; ajouter un `schedule` GitHub Actions de repli qui appelle la
même route avec `CRON_SECRET` (pattern déjà présent dans `supabase-backup.yml`) ; job de notification
d'échec au backup ; plafonner les reprises par item (compteur + statut `dead`).

### 13 · L'outbox email n'a pas de draineur — I 5 · R 5 · E 3 → 30 — P2

- La migration `20260811231759_transactional_estimate_email_outbox.sql` définit les transitions
  `queued → processing → sent | failed | unknown` et `unknown → sent | failed`, plus un index partiel
  `(status, next_attempt_at, created_at) where status in ('queued','processing')` — construit pour un
  consommateur qui n'existe pas.
- Le seul appelant de `estimate-email-outbox.ts` est `send-estimate.ts`, dans le chemin de requête.
  `durable-recovery.ts` draine le cleanup Storage procurement, pas l'email. Aucun composant n'affiche un
  dispatch `unknown`.
- Conséquence : un crash entre `processing` et la réponse Resend, ou une réponse ambiguë, laisse un
  devis « envoyé » côté métier sans email parti et sans personne pour le savoir. Le registre du lot 5 le
  nommait comme limite ; c'est le principal risque client visible.

**Correctif.** Drain de l'outbox dans `recoverDurableWorkflows` (claim par bail, replay avec la même
`Idempotency-Key`, `failed` après N tentatives) ; exposer les dispatchs `unknown`/`failed` dans la fiche
devis avec action « renvoyer / marquer envoyé ».

### 14 · Aucune observabilité de production — I 5 · R 5 · E 3 → 30 — P2

- Zéro occurrence de Sentry, OpenTelemetry, Datadog, pino ou winston dans `src`, `scripts`, `.github`,
  `package.json`. 87 `console.error` non-test (12 dans `affaires/intake-server.ts`, 9 dans
  `takeoff/processor.ts`) partent dans les logs éphémères Vercel.
- `takeoff/async-worker.ts:1034` : « reached terminal failure » → log, `clearRetrySchedule`, retour.
  Pas d'alerte, pas de table de rebut.
- Pas de `src/app/global-error.tsx` ; 7 `error.tsx` de route qui ne rapportent nulle part. Pas de sonde
  de santé anonyme : `/api/takeoff/health` exige une session et un tenant actif. Corrélation
  `x-correlation-id` uniquement sur le chemin takeoff.
- Seul canal de télémétrie : `WebVitalsReporter`, optionnel, échantillonné à 10 %, sans erreurs.

**Correctif.** Un SDK d'erreurs (Sentry ou OTel → collecteur) dans `instrumentation.ts`,
`global-error.tsx` et le worker takeoff ; un `/api/health` anonyme (DB ping + version) ; alerte sur
`failed_terminal`. Le `logger?: Pick<typeof console,…>` déjà injecté dans le worker est le point d'entrée.

### 12 · Playwright : 7 specs sur 20, jamais avant merge — I 4 · R 4 · E 2 → 32 — P2

- `e2e-playwright-critical.yml` ne s'exécute que sur `push main` (projet `chromium-critical`, 7 specs).
  Les 13 autres — `takeoff-dpgf-review`, `takeoff-epics-matrix`, `team-b-user-stories`,
  `affaire-recovery-flow`, `cockpit-command-bar`… — ne tournent dans aucun workflow.
- `team-a-hub-dev-scenarios.spec.ts` exige `E2E_ALLOW_DEV_HUB_SCENARIOS=1`, jamais positionné, et figure
  dans `testIgnore` : inatteignable en CI.
- `failOnFlakyTests` + `retries: 1` + 7 attentes de 60 s dans `team-b-user-stories.spec.ts`
  (l. 610–773) sous un budget de 90 s par test : le premier flake fera un `main` rouge de plus.

**Correctif.** Un job PR sur les 7 critiques (staging ou stack éphémère), un job nightly sur les 20 ;
supprimer le `testIgnore` ou le spec ; ramener les budgets par attente sous 30 s.

### 16 · `.env.example` incomplet, flags takeoff hors du système central — I 2 · R 3 · E 1 → 25 — P1

- 13 variables documentées, 37 lues dans `src`. Manquent notamment `ENABLE_OPENAPI_DOCS`,
  `ESTIMATE_BATCH_MAX_OPERATIONS`, les six `NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_*`, les cinq
  `NEXT_PUBLIC_ESTIMATE_OUTLIER_*`, `TAKEOFF_AI_ESCALATION_*`, `TAKEOFF_GEMINI_*`, `TAKEOFF_MODULE_*`.
- Les flags produit sont centralisés (`src/lib/feature-flags.ts`, table `feature_flags`, admin UI), mais
  `src/lib/takeoff/feature-flags.ts:141` superpose ~20 clés `process.env` avec un ordre de résolution
  propre ; `DashboardShell.tsx:134` porte une clé en littéral.

**Correctif.** Compléter `.env.example` par sections (runtime / CI / E2E) ; test comparant les
`process.env.X` de `src` à `.env.example` ; documenter ou replier les flags env takeoff dans le système DB.

### 19 · `xlsx` atteignable côté client, un seul budget perf — I 3 · R 3 · E 2 → 24 — P2

- `src/lib/catalogue/product-price-template.ts:1` importe `xlsx` au niveau module et est importé
  statiquement par trois fichiers `"use client"` (`products/page.tsx`, `ProductPriceTemplateImport.tsx`,
  `PricesManager.tsx`) ; le jumeau `-server.ts` existe, la scission n'a pas été terminée.
  `src/lib/export.ts:1` idem depuis `orders/page.tsx` — alors que
  `useEstimateEditorExportController.ts:255` fait correctement `await import("@/lib/export")`.
- `config/performance-budgets.json` ne budgète que l'éditeur de devis ; orders, products, affaires hub,
  takeoff review n'ont aucun plafond.
- Sain : aucune lib lourde importée directement dans un fichier client ; `next/dynamic` bien utilisé
  (21 sites) ; PDF.js reste serveur.

**Correctif.** Terminer la scission client/serveur du template prix ; import dynamique de `@/lib/export`
dans orders ; ajouter 3–4 budgets de manifeste client.

## 4. Base de données et types

### 5 · `src/types/database.ts` est écrit à la main et ment — I 5 · R 4 · E 2 → 36 — P1

- 3 902 lignes, 18 commits depuis juin, pas d'en-tête « generated », aucun script `supabase gen types`
  dans `package.json`, `scripts/`, `.github/`. Le fichier est explicitement exclu du budget d'architecture.
- RPC appelées via `.rpc("…")` et absentes de `Database["public"]["Functions"]` :
  `transition_estimate_version_status`, `decide_estimate_approval`, `recover_stale_takeoff_jobs`,
  `list_due_durable_workflows`, `claim_portal_estimate_decision`, `acquire_takeoff_batch_reconcile_lease`,
  `claim_affaire_intake_upload`, `list_approval_queue`, `apply_takeoff_job_guarded_atomic`,
  `set_active_tenant_membership_default`… (≥ 23). Chacune est un `any` au site d'appel — le commentaire
  `estimates/server.ts:6280` « RPC added in migration, types not yet regenerated » l'admet.
- Les tables takeoff (`takeoff_jobs`, `takeoff_items`, `plan_files`, `plan_sets`,
  `takeoff_price_suggestions`…) n'y figurent pas : d'où 1 047 `as never` dans `src/lib`, 354 dans
  `takeoff/server.ts` seul. Exemple `takeoff/server.ts:1289` :
  `.from("plan_files" as never).eq("tenant_id" as never, …)` — noms de colonnes et valeurs castés.

**Correctif.** `supabase gen types typescript --local` dans `db:ci:local`, écriture de
`src/types/database.ts`, test qui échoue si le fichier généré diffère du commit ; supprimer les
`as never` module par module (takeoff d'abord).

### 7 · `supabase/schema.sql` reste une arme chargée — I 2 · R 5 · E 1 → 35 — P0

- 10 757 lignes, dernier commit 10 juillet, en-tête `-- Supabase schema for "Bons de commande
  fournisseur - Hydro Express"` (nom pré-pivot), puis 35 `drop table if exists … cascade` dont
  `tenant_memberships`, `feature_flags`, `margin_tiers`, `supplier_pricebook`.
- `supabase/README.md` et `CLAUDE.md` avertissent, mais le fichier reste dans le chemin canonique.

**Correctif.** Le supprimer (l'historique Git le conserve) ou le remplacer par un
`supabase db dump --schema public` sans `drop`, généré par `db:ci:local` et vérifié en CI.

### 17 · Trois conventions de nommage, horodatages hors ordre — I 2 · R 3 · E 1 → 25 — P1

- 210 fichiers : bloc ordinal `001_`–`030_`, quatre date-only (`20260222_est144_audit_index.sql`,
  `20260304_…`, `20260305_…`, `20260306_…`), puis UTC 14 chiffres.
- Le cas du 18 août : trois migrations horodatées 12 août commitées après une du 13 → sur une base
  distante déjà à jour du 13, elles s'appliquent *après* ; sur un reset frais, *avant*. Domaines
  distincts cette fois, donc sans effet ; la prochaine fois peut ne pas l'être.

**Correctif.** Script `supabase:migrations:restamp` qui ré-horodate les migrations absentes de
`origin/main` juste avant le push ; garde exécuté aussi dans Quality Gate.

### 23 · pgTAP couvre au plus ~29 % des fonctions SQL — I 4 · R 5 · E 4 → 18 — P3

- 233 `create or replace function` distinctes ; 8 fichiers pgTAP sous `supabase/tests/database/` ;
  68 noms de fonctions apparaissent dans pgTAP ou `rls.e2e.test.ts` (borne haute). Un seul fichier,
  `security-invariants.test.sql`, garde la surface SECURITY DEFINER.
- Côté application, 69 fichiers de test sur 551 mockent le client Supabase ; un seul
  (`rls.e2e.test.ts`) exerce un vrai query builder, hors `test:ci:node`.

**Correctif.** Toute nouvelle RPC arrive avec son pgTAP ; un pgTAP dédié par famille SECURITY DEFINER
existante (approbations, portail, takeoff apply, memberships) ; étendre `rls.e2e` aux 5–6 chemins
d'écriture les plus sensibles.

## 5. Tests

### 2 · Mutations de frontière sans aucun test — I 5 · R 5 · E 2 → 40 — P1

- 38 des 125 `route.ts` n'ont ni `route.test.ts` ni importeur de test ; 31 mutent des données. Deux
  traversent la frontière tenant/service-role déclarée critique au lot 4 :
  `src/app/api/memberships/route.ts` (GET, POST) et `memberships/[membershipId]/route.ts` (PATCH,
  DELETE), qui appellent `lib/memberships/server.ts` l. 179 et 283 (service-role).
- `src/app/dashboard/_actions/estimate-approval.ts` : 4 actions serveur mutant les approbations,
  exercées uniquement via `vi.mock` dans `EstimateApprovalActions.test.tsx:25` — l'implémentation
  réelle ne tourne jamais. Même situation pour `direction.ts`, `cockpit.ts`, `approval-queue.ts`,
  `manager-queue.ts`, `project.ts`, `profile.ts`, `dense-table-expand.ts` et deux actions inline dans
  `admin/*/page.tsx` (10 fichiers, ~15 actions).
- `takeoff/jobs/[jobId]/cancel/route.ts` (POST, service-role, worker) et
  `docs/swagger-ui/[asset]/route.ts` (service de fichiers `node:fs`) sans test dédié.

**Correctif.** Tests de route pour memberships (4 handlers) sur le modèle des 87 existants ; tests des
4 actions d'approbation avec le rules-engine réel ; test du cancel takeoff et de la traversée swagger.

### 10 · Modules critiques sans un seul test — I 4 · R 4 · E 2 → 32 — P2

Aucun fichier `*.test.ts` n'importe : `src/lib/takeoff/evidence.ts` (804 l. non vides),
`src/lib/estimates/estimate-structure-draft.ts` (477), `src/lib/estimates/estimate-seal.ts` (279,
scellement d'intégrité), `src/lib/takeoff/provider-batch.ts` (271),
`src/lib/estimates/pdf-publication.ts` (242, publication client-visible). Les autres gros modules sont
couverts par des fichiers de test scindés — c'est bien cette liste-ci qui compte.

**Correctif.** Un test comportemental par module, seal et pdf-publication en premier.

### 15 · 43 snapshots golden dans un seul fichier — I 3 · R 4 · E 2 → 28 — P2

46 assertions snapshot dans tout le dépôt, dont 43 dans `src/lib/estimate-calculations.golden.test.ts`.
Un changement moteur produit un diff géant unique, facile à accepter en bloc.

**Correctif.** Un fichier de fixtures golden par régime (v1, v2, sous-traitant, tranches de marge,
arrondi commercial) avec attentes explicites en centimes plutôt que `toMatchInlineSnapshot`.

### 20 · Les ~30 routes restantes sans test — I 4 · R 3 · E 3 → 21 — P3

Après le poste 2 : items (GET/POST/PATCH/DELETE), reorder, duplicate, categories, variants,
labor-roles ×2, sections duplicate, suggestion-rules ×3, version-zero-drafts ×3 (dont `materialize`),
templates ×5, margin-tiers ×2, prices ×2, catalogue, indices, mappings, audit, changelog,
draft-versions, approval, takeoff job GET.

**Correctif.** Au fil des features : route touchée = route testée. Une règle CI « route.ts sans
route.test.ts = avertissement » rend la liste visible.

### 24 · 29 suites PowerShell, seule couverture de quatre domaines, mortes en CI — I 4 · R 4 · E 4 → 16 — P3

- `e2e/hex/*.ps1` couvre seul : settings (`ti-146`, `ti-153`, `ti-142`), security (`ti-141-db-rls`),
  assemblies (`ti-182`), output (`ti-151-print`, `ti-152-export`) et les micro-interactions éditeur
  (`est-101…106`).
- `e2e/run-ps1.mjs` exige `pwsh` et `agent-browser` ; aucun workflow ne les mentionne.

**Correctif.** Décider par suite : porter vers Playwright (éditeur, output, settings) ou retirer
(doublons de `import-dpgf`, `full-lifecycle`, `duplicate`). En attendant, marquer ces domaines
« non couverts en CI » dans `e2e/README.md`.

## 6. Code et architecture

### 3 · Auth artisanale dans 7 routes — I 4 · R 4 · E 1 → 40 — P0

- `src/app/api/purchase-orders/route.ts`, `[id]/route.ts`, `[id]/zip`, `[id]/devis`,
  `[id]/devis/reorder`, `[id]/devis/[devisId]` (deux fois) et `src/app/api/audit/route.ts` font
  `supabase.auth.getUser()` puis 401 manuel, sans résoudre `tenantId` ni passer par
  `getAuthenticatedTenantContext` — RLS est le seul rempart, contrairement aux 118 autres routes.
- La régression d'architecture du lot 3 ne détecte pas l'auth artisanale.

**Correctif.** Frontière canonique ; étendre la régression : « `auth.getUser(` interdit sous
`src/app/api/**` ».

### 6 · Cinq copies de `toErrorResponse`, un correctif sur trois — I 3 · R 4 · E 1 → 35 — P1

- `estimates/errors.ts:239`, `imports/server.ts:219`, `mappings/server.ts:262`,
  `memberships/errors.ts:168`, `catalogue/server.ts:310` — plus 5 `mapSupabaseError`, 7 classes
  `*ApiError`, 4 jeux de `badRequest/notFound/conflict/forbidden`.
- Trois copies portent `// K-01: Log internal details server-side only, never expose to client` ;
  `estimates` et `memberships` renvoient encore `details: apiError.details` au client. À vérifier cas par
  cas (validation Zod : légitime ; erreur interne : fuite).

**Correctif.** Un module `src/lib/http/errors.ts` (classe unique, mapping unique, politique unique sur
`details`) et cinq réexports.

### 8 · Constantes métier définies plusieurs fois — I 3 · R 4 · E 1 → 35 — P1

- TVA par défaut 2000 bp : `estimates/server.ts:658`, `affaires/import-flow-server.ts:27`, et en
  littéral dans `canonical-v2-creation.ts:169`, `structure-drafts.ts:1622`,
  `version-zero-drafts.ts:1791`, `catalogue/server.ts:2116`, `catalogue/schemas.ts:261`.
- Seuil de marge 1000 bp en dur deux fois (`takeoff/server.ts:4334, 4339`). Timeout 60 000 ms redéfini
  dans `gemini-client.ts:8`, `processor.ts:92`, `takeoff/client.ts:130`. Portes go/no-go du pilote dans
  `takeoff/stats.ts:43`.
- 12 formateurs monétaires locaux réimplémentent `formatEUR` — quatre `formatCurrency(cents)` dans
  `components/estimates`, deux `formatAmount` identiques dans `affaires`. Bucket `"devis"` en littéral
  dans 3 routes ; `PLAN_FILES_BUCKET` et `ESTIMATE_DOCUMENTS_BUCKET` déclarés deux fois chacun.

**Correctif.** `src/lib/estimates/constants.ts` (TVA, seuils) et `src/lib/storage/buckets.ts` ;
remplacer les formateurs par `@/lib/money`.

### 11 · `estimates/server.ts` : le point chaud qui coûte chaque semaine — I 5 · R 3 · E 2 → 32 — P2

- 8 815 lignes non vides (budget 9 096), 82 exports, 119 fonctions ; touché dans **36 des 174 commits**
  depuis juin — trois fois plus que `takeoff/server.ts` (8 091 lignes, 9 commits).
- Neuf responsabilités : wrapper auth, comparaison fournisseurs (l. 717–1900), sceau, listing
  versions/imports (4305–4915), templates (4993–5368), assemblies (5368–5922), cycle de vie des versions
  (6341–8080), référentiel CRUD (8170–8716), items (8716–fin, dont `updateEstimateItem` 460 l.).
- Deux seams au test de suppression positif : le référentiel CRUD (l. 8170–8458) et templates +
  assemblies (4993–6341).

**Correctif.** Strangler par cluster, comme au lot 6 : `estimates/reference-data-server.ts` puis
`templates-server.ts` / `assemblies-server.ts`, façade `server.ts` conservée. Règle : une feature qui
touche un cluster l'extrait d'abord.

### 18 · Écritures Supabase depuis le navigateur — I 4 · R 4 · E 3 → 24 — P3

- `src/app/dashboard/suppliers/page.tsx:185–186` et `products/page.tsx:371–372` :
  `supabase.from(...).update(payload)` / `.insert(payload)` depuis un composant client, sans Zod, alors
  que `/api/catalogue` existe. `orders/page.tsx:315–422` : six requêtes jointes en JavaScript.
  `usePriceLookups.ts:120` pagine en `.range()` côté navigateur alors que les RPC
  `catalogue_products_page`/`supplier_prices_page` existent.
- 13 composants et 8 pages utilisent `createSupabaseBrowserClient` ; login/signup sont légitimes.

**Correctif.** Un domaine à la fois (suppliers, products, orders) : route API + Zod + hook SWR.

### 21 · Deux contrôleurs feuilles à sortir du hook éditeur — I 3 · R 1 · E 1 → 20 — P1

- `useEstimateEditorHistoryController` (2 arguments) et `useEstimateEditorActivityController`
  (2 arguments) sont déjà des feuilles ; les sortir ramène aussi `impl.tsx` sous son budget (poste 1).
- Le nom `useEstimateEditorState` désigne deux choses : le hook de 2 810 lignes et un accesseur de
  contexte (`EstimateEditorContext.tsx:63`).

**Correctif.** Extraire les deux feuilles ; renommer l'accesseur `useEstimateEditorContext`.

### 22 · `takeoff/server.ts` : schémas Zod déplacés, seam mapping-rules — I 3 · R 2 · E 2 → 20 — P3

Les schémas et parseurs des l. 910–3009 (~2 100 lignes) appartiennent à `takeoff/schemas.ts`. Les
mapping-rules (l. 8601–8762, 4 exports, 2 consommateurs) ne dépendent que des helpers HTTP. Priorité
basse : 9 commits depuis juin.

### 25 · DTO client et réponses OpenAPI sans source unique — I 3 · R 2 · E 4 → 10 — P3

- `estimates/client.ts` : client HTTP `requestJson`, mais l. 1–3554 = 105 déclarations de types
  restituant à la main les retours serveur ; 23 paires de fonctions homonymes client/serveur, 15 côté
  takeoff.
- `openapi/registry.ts` (4 963 lignes) déclare 206 `z.object(` inline. Primitives Zod triplées ;
  `estimateStatusSchema` deux fois.

**Correctif.** Schémas de réponse Zod exportés par domaine, consommés par le registre *et* par
`client.ts`. Commencer par les 3 types dont le nom collisionne déjà.

### 26 · Le hub d'injection du hook éditeur — I 5 · R 4 · E 5 → 9 — P3

- `useEstimateEditorState.impl.tsx` : 2 810 lignes, 26 commits depuis juin, 156 `const`/`let` et
  29 `useCallback` dans un seul corps, 18 contrôleurs (Sync 1 111 l./19 args, Suggestions 1 293/16,
  Status 880/21…). Hub d'injection manuel : l'ordre des appels est porteur de sens implicite.
- `editorTableProps` (l. 2429) : 67 clés, 78 dépendances. Le lot 6 l'a exclu du strangler à raison.

**Correctif.** Ne pas attaquer de front : poste 21, puis `useEstimateEditorCalculation` (198 l.,
10 entrées pures), puis contextes par zone (table, toolbar, dialogs).

## 7. Documentation et dépendances

### 4 · `CLAUDE.md` est faux sur l'invariant le plus sensible — I 4 · R 4 · E 1 → 40 — P0

- Lignes 98–99 : « La v1 est ce qui s'exécute en production ; l'éditeur épingle encore
  `EDITOR_CALC_ENGINE_VERSION = 1` ». La constante n'existe plus ;
  `src/lib/estimates/calc-engine-version.ts:17` déclare `NEW_ESTIMATE_CALC_ENGINE_VERSION = 2` ;
  `docs/metier/ecarts-standards-btp.md:364` documente le retrait de l'épingle.
- Compteurs figés en une semaine : « 202 migrations, dernière `20260812012308_…` » → 208, dernière
  `20260813201300_atomic_takeoff_apply_mapping.sql` ; « 122 route handlers » → 125 ; « ~19 contrôleurs »
  → 37 hooks `useEstimateEditor*`. `supabase/README.md` répète les mêmes chiffres.

**Correctif.** Réécrire le paragraphe moteur (v2 pour toute création, v1 conservé pour l'historique,
`resolveCalcEngineVersion` fait foi) ; supprimer les compteurs volatils ou les générer.

**Payé côté documentation** : 287 `.md` en juillet → 29 ; `docs/metier/` et `docs/domaines/` à jour
du 12–13 août ; README correct ; identifiants exposés retirés (rotation : action utilisateur).

### Dépendances : dette faible

Deux majeures en attente (`motion` 12 → 13, `postal-mime` 2 → 3) et des patchs (`next` 16.3.1,
`react` 19.2.8). Audit prod à zéro, politique d'exceptions vide, actions pinnées par SHA, `xlsx` via
tarball SheetJS avec intégrité. Seule dette, de process : les 7 PR Dependabot ne passent pas tant que le
gate est rouge (poste 1).

## 8. Plan de remédiation par phases

Chaque phase tient dans ~20 % de la capacité d'une personne et suit la règle du registre : lot atomique,
validé à hauteur de son risque, commit dédié. Les postes P3 se déclenchent quand une feature touche le
module (« qui touche extrait »).

| Phase | Quand | Postes | Sortie attendue |
|---|---|---|---|
| **P0 — remettre le filet** | cette semaine · ≈ 3 j | #1 vert + protection ; #4 CLAUDE.md ; #7 schema.sql ; #3 auth ; #9 cron/backup | 8 PR débloquées, release 0.4.0 publiable, chaque push réellement gardé |
| **P1 — coudre les trous** | sprint suivant · ≈ 5 j | #2 tests frontière ; #5 database.ts ; #6 erreurs HTTP ; #8 constantes ; #16 env ; #17 restamp ; #21 feuilles | frontière tenant testée, types fiables, plus de « sécurité à moitié corrigée » |
| **P2 — voir et se relever** | mois suivant · ≈ 12 j | #14 observabilité ; #13 outbox ; #12 Playwright ; #10 tests lib ; #15 golden ; #19 bundles ; #11 seams | un incident vu avant le client ; email perdu rattrapé ; hotspot n°1 −1 500 lignes |
| **P3 — au fil des features** | trimestre | #18 ; #20 ; #22 ; #23 ; #24 ; #25 ; #26 | règles : qui touche extrait ; nouvelle RPC = pgTAP + type ; nouvelle route = test ; pas de relèvement de budget sans commit dédié |

**Deux prérequis hors dépôt** : la ruleset GitHub sur `main` (1c) et le secret
`E2E_ALLOWED_SUPABASE_HOST` dans l'environnement `e2e-staging` (1b). Sans eux, la phase 0 rend la CI
verte mais toujours contournable.

## 9. Ce qui est sain — ne pas ré-auditer

- Hygiène : 0 `TODO/FIXME`, 0 `@ts-ignore`, 14 `eslint-disable` (6 `exhaustive-deps`), 5 `any` non-test.
- Secrets : aucun jeton dans `src`, `e2e`, `docs`, `scripts`, `supabase` ; `.gitignore` couvre `.env*`,
  rapports, `outputs/`, `design-qa.md`.
- Dépendances : audit prod à zéro, actions pinnées, Dependabot actif.
- Base : 404 index, 147 composites `(tenant_id, …)` ; backfills idempotents ; six buckets tous couverts
  par des policies `storage.objects`.
- Frontière tenant/service-role unifiée (lot 3) ; migrations reproductibles avec manifeste (lot 2).
- Flags produit centralisés ; `next/dynamic` bien employé ; PDF.js jamais bundlé côté client.
- Tests : 551 fichiers, aucun sans `expect`, aucun `.only`/`.skip` inconditionnel dans `src`.
- Docs : `docs/metier/` et `docs/domaines/` à jour du 12–13 août ; le registre des lots 0–7 est la
  trace fiable des décisions.

## 10. Méthode et limites

Analyse statique du dépôt à `7ecbfc4` (clean), sans `node_modules` installé : les suites n'ont pas été
exécutées localement ; les résultats CI viennent de `gh run list` / `gh run view` ; les violations de
budget ont été recomptées avec la règle exacte de `src/test/architecture-budgets.ts`. Trois relevés en
parallèle (code/archi, tests, infra/base) ont été recoupés ; chaque affirmation à fort impact (états CI,
RPC non typées, `as never`, imports `xlsx`, auth artisanale, écritures navigateur, copies de
`toErrorResponse`, absence de draineur, cron) a été revérifiée directement.

Bornes : le taux pgTAP (~29 %) est une borne haute par sous-chaîne ; les listes de routes/actions sans
test reposent sur l'absence d'import dans `*.test.ts(x)` ; le plan Vercel et la configuration GitHub
(`e2e-staging`) ne sont pas lisibles depuis le dépôt ; le caractère « fuite » des `details` renvoyés
par estimates/memberships est à confirmer cas par cas. Le churn (36/174 commits) couvre juin–août 2026.

Grille : Impact = frein pour l'équipe ; Risque = coût si rien n'est fait ; Effort = 1 (≤ 1 j) à
5 (> 2 semaines). Priorité = (Impact + Risque) × (6 − Effort), la même formule que le registre d'août.

## 11. Revue des remédiations (19 août 2026, après-midi)

Un jeu de remédiations couvrant les 26 postes a été appliqué dans l'arbre de travail
(96 fichiers modifiés, ~70 nouveaux, non commités). Relecture en trois passes parallèles
(auth/API, outbox/ops, refactors/types), chaque constat revérifié avant correction. Gates
après corrections : typecheck, lint (`--max-warnings=0`), `check:architecture` (900 modules,
0 cycle), `validate-openapi` (130 routes / 176 opérations) et Vitest complet (4 034 tests) verts.

### Corrigé pendant la revue

| Gravité | Constat | Correction |
|---|---|---|
| Bloquant | `src/lib/http/errors.ts` : `null` jugé non sûr → tout `details` contenant un `null` expurgé (`{ lock: null }`, statut PDF) ; l'éditeur perdait l'info de verrou, le polling PDF cassait (test `outliers` rouge) | `null` traité comme primitif JSON ; regex SQLSTATE sensible à la casse ; régressions ajoutées |
| Bloquant | Drain outbox : acteur système `"durable-recovery"` casté en uuid par les RPC → toute réclamation échouait ; mise au rebut sans bail → levait toujours | Replay sous `dispatch.created_by` (contrat `assert_estimate_email_dispatch_actor`), rebut claim-puis-fail sous bail, lignes encore louées exclues du listing ; tests |
| Majeur | Route `email-dispatch/reconcile` sans contrôle version/tenant/admin ; « Marquer envoyé » fabriquait un identifiant fournisseur ; bouton proposé pour `failed` (RPC refuse) ; requête page montrait un ancien échec malgré un envoi réussi | Contrôles 403/404, `providerId` obligatoire pour `sent` (saisie UI), bouton limité à `unknown`, requête sur le dernier dispatch `initial` |
| Majeur | Purchase-orders : contrôle de rôle déplacé du tenant de la commande vers le tenant actif de l'appelant (faux refus / faux accord selon l'appartenance par défaut) | `canWritePurchaseOrders(..., order.tenant_id)` + commande hors tenant actif → 404 ; tests de non-concordance |
| Majeur | `/api/products`, `/api/suppliers` : aucun contrôle de rôle, `update/delete` RLS-filtrés → `200` sans effet ; messages Postgres bruts renvoyés | Frontière tenant + admin requis pour les écritures, `.select("id")` + 404 si zéro ligne, `mapSupabaseError` ; tests 403/404/fuite |
| Majeur | `GET /api/orders?view=items` sans `order_id` renvoyait tous les items du tenant | `order_id` requis pour `items` ; test 400 |
| Majeur | `estimates/server.ts` : 13 helpers auth/verrou dupliqués à l'identique dans `server-context.ts` (extraction copiée, non déplacée) ; 10 helpers templates/assemblies morts ; idem `takeoff/server.ts` (mapping rules, `parseWithSchema`, `toValidationIssues`) | Suppression des copies, imports/ré-exports depuis les modules canoniques ; test de régression d'intégrité repointé sur `server-context.ts` |
| Majeur | Bannière d'erreur undo/redo collante (état privé de la page jamais effacé ; un « Envoyer » réussi laissait une erreur rouge) | Erreur externe repliée dans `actionError` de l'éditeur (clé de séquence), donc effacée par l'action suivante |
| Majeur | `takeoff/schemas.ts` : enums inlinés (lien compile-time perdu avec `TAKEOFF_JOB_STATUSES`) et cycle latent `schemas → dpgf-compare → types → schemas` | Modules feuilles `takeoff/enums.ts` et `takeoff/limits.ts`, ré-exports de compatibilité |
| Majeur | `e2e-playwright-critical.yml` ouvert aux `pull_request` (identifiants `e2e-staging` lisibles depuis une branche non relue), garde-fou inversé | Déclencheur `push main` rétabli, garde-fou restauré ; le nightly reste |
| Majeur | `installProcessErrorHooks` : `uncaughtException` avalé (serveur maintenu dans un état indéfini), pas d'idempotence HMR | Rapport borné 2 s puis `exit(1)` ; installation idempotente par cible ; tests |
| Majeur | `/api/health` : `up` sur clé rejetée / erreur de permission ; un aller-retour DB par requête | Sonde `GET /rest/v1/` : tout non-2xx/timeout → `down` ; cache 5 s ; `no-store` ; tests |
| Majeur | Garde `xlsx-client-import` non transitif (vacant pour `export.ts`) | Parcours en largeur avec arrêt aux frontières `"use server"` ; vérifié par sonde |
| Majeur | `database.ts` : `takeoff_run_metrics` sans 11 colonnes, `plan_sets.project_id` nullable à tort, deux RPC aux arguments requis marqués optionnels | Types corrigés d'après les migrations |
| Mineur | `quality-gate.yml` : `github.event.before` à zéro après force-push ; workflow de repli sans groupe de concurrence ; script `restamp` non atomique et muet sur les migrations déjà appliquées ; 8ᵉ `DEFAULT_TAX_RATE_BP` ; mock de test masquant un lien cassé ; ré-export `PLAN_FILES_BUCKET` pour tenir un budget à la ligne près ; hook conditionnel et imports morts (lint rouge) | Corrigés |
| Test | `memberships/[membershipId]` couvert uniquement en chemin nominal | 7 cas de refus ajoutés (403, 404, dernier admin, auto-suppression) |

### Vérification en exécution réelle (app lancée sur la prod)

`npm run dev` contre le projet unique de production a révélé trois défauts que les
tests unitaires ne pouvaient pas voir, tous introduits ou laissés par la vague de
remédiation :

| Défaut | Détail | Correction |
|---|---|---|
| Bundle Edge cassé | `process.exit` dans `error-reporter.ts` rendait `instrumentation.ts` invalide pour l'Edge Runtime (« Ecmascript file had an error » à chaque requête) | Accès via `globalThis.process?.exit?.()` ; `register()` filtre sur `NEXT_RUNTIME === "nodejs"` |
| Sonde `/api/health` toujours `down` | `GET /rest/v1/` n'accepte que la clé `service_role` : avec la clé anon la sonde renvoyait 401 → `down` en permanence, alors que les tests (fetch mocké en 200) passaient | Sonde sur une vraie table ; `up` si succès **ou** SQLSTATE Postgres renvoyé (42501 prouve l'aller-retour jusqu'à PostgreSQL), `down` sur clé rejetée, timeout, réseau ou `PGRST001` |
| Deux gardes au bord du délai | `env-inventory` (3,2 s) et `xlsx-client-import` (4,9 s) parcourent tout l'arbre et dépassaient les 5 s par défaut sous contention — rouges dans `check:quality` alors qu'ils passaient isolément | `setParentNodes: false` (4,9 → 2,8 s ; 3,2 → 2,0 s) et budget explicite de 30 s |

Leçon : un test vert contre un `fetch` mocké ne dit rien du contrat réel du
fournisseur. Les sondes d'infrastructure doivent être exercées au moins une fois
contre le vrai service.

### Le cron `vercel.json` bloquait tous les déploiements (découvert le 19/08)

Le check « Vercel » rouge sur toutes les PR n'était pas un build en échec : Vercel
**refusait de créer le déploiement**. `vercel.json` déclarait un cron `*/5 * * * *`
alors que l'équipe propriétaire est au plan **Hobby**, limité à une exécution
quotidienne ; le lien du check pointait vers la page de tarification des crons.

Conséquence : le dernier déploiement de production date du **09/08/2026 20:53**.
Tout ce qui a été fusionné depuis — métré, gouvernance du moteur v2, travaux
devis du 18/08, l'intégralité de la remédiation de dette et les montées de
dépendances du 19/08 — n'était jamais parti en production. Dix jours de dérive
entre `main` et la production, invisibles parce que le check n'était pas requis.

Correctif : le cron est retiré de `vercel.json`. La reprise durable est planifiée
par `.github/workflows/recover-durable-fallback.yml` (toutes les 5 minutes), qui
devient l'unique planificateur. Ce workflow échoue tant que `CRON_SECRET` et
`HEX_APP_URL` (ou la variable `APP_URL`) ne sont pas configurés dans le dépôt :
la couche de reprise reste donc inerte jusque-là.

### Reste ouvert après la revue

- **Outbox, lignes empoisonnées** : un dispatch dont `created_by` n'est plus admin/ingénieur, ou dont le tenant est suspendu, ne peut être ni rejoué ni clos (seule la transition `preparing → failed` accepte l'absence de bail). Il faut une migration (branche acteur-système dans `assert_estimate_email_dispatch_actor`, ou RPC de report avec backoff). D'ici là ces lignes sont listées mais comptées en erreur à chaque run.
- **`src/types/database.ts` reste écrit à la main** : pas de `supabase gen types`, ~34 tables absentes ; `database-types-inventory` compare des noms, pas des formes. À régénérer réellement depuis `db:ci:local`.
- **Playwright critique** : toujours sans `SUPABASE_SERVICE_ROLE_KEY` → les scénarios devis échouent (décision : secret staging posé par un admin, ou scénarios déplacés vers la pile éphémère).
- **Doublons préexistants** de `getVersionAccessOrThrow` / `assertDraftLockOwnedByCurrentUser` dans `version-zero-drafts.ts`, `structure-drafts.ts`, `generated-ouvrages.ts`, route `outliers` : antérieurs aux remédiations, à rabattre sur `server-context.ts`.
- `pgtap-rpc-baseline.json` exempte 168/233 fonctions (cliquet) ; `quality-gate.yml` garde `if: !cancelled()`.
- Rien n'est commité : l'ensemble (remédiations + corrections) doit partir en branche + PR, `main` étant désormais protégé.

## 12. Simplification de la CI (19 août 2026, soir)

L'audit et sa remédiation ont ajouté seize garde-fous « méta » — des tests qui
vérifient la CI et la configuration, pas le produit — dont huit le 19 août.
Mesure faite le soir même : sur les huit derniers échecs de CI, **deux seulement**
signalaient un vrai défaut ; les autres venaient des garde-fous eux-mêmes.

### Retiré

Six gardes supprimés, avec leur outillage (12 fichiers, 1 script npm) :

| Garde | Pourquoi il ne gagnait pas sa place |
|---|---|
| `database-types-inventory` | comparait des noms, pas des formes : laissait passer toutes les vraies dérives de `database.ts` |
| `env-inventory` | scan complet de l'arbre pour vérifier `.env.example` ; utile une fois, pas à chaque commit |
| `pgtap-rpc-coverage` | baseline exemptant 168 fonctions sur 233 : documentait surtout ce qu'il ne gardait pas |
| `routes-without-tests` | avertissement pur, sans effet sur la décision de fusion |
| `quality-gate-migrations` | assertions sur un workflow, déjà couvertes par `ci-guardrails` |
| `recover-fallback-workflow` | idem |

### Conservé

Les dix restants protègent quelque chose d'irréversible ou de vérifiable :
frontière d'authentification des routes, budgets d'architecture, propriétés de
sécurité des workflows, audit de dépendances, historique de migrations
append-only, environnement E2E, budgets de performance, fuite de `xlsx` dans le
bundle client, et les tests unitaires des scripts de garde eux-mêmes.

### Assoupli

- Budgets d'architecture : taille au gel +10 %, arrondie à la centaine. Marge
  minimale 107 lignes au lieu de 1. C'était la cause des quatre derniers échecs
  avant le 19/08 et de `main` rouge du 09 au 18.
- Quality Gate découpé en jobs parallèles (statique / tests / build). Retour
  ~3 min au lieu de 6,2 ; le nom du job en échec indique déjà le périmètre.
- Build hors des PR (rien ne déploie depuis une branche) ; matrice RLS
  déclenchée seulement quand `supabase/**` bouge, plus une passe nocturne.
  Machine par PR : ~9,5 min → ~5,6 min.

Règle retenue pour la suite : traiter le nombre de garde-fous comme un budget.
Un nouveau garde remplace un ancien plutôt que de s'y ajouter.
