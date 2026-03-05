# V3-E01 — Plans Project-Scoped (fondation DB)

> Track: Takeoff / Metre | Priorite: P0 | Statut: A faire

## Objectif

Migrer la table `plan_sets` d'un scope version (`estimate_version_id`) vers un scope projet
(`project_id`). Les plans PDF appartiennent a l'affaire, pas a une version specifique.
Cette epic est purement backend/DB — aucun impact UI direct.

## Ce qui existe deja

- **`supabase/migrations/20260224203000_tkf017_takeoff_plans.sql`** : Table `plan_sets` avec
  `estimate_version_id uuid NOT NULL` FK vers `estimate_versions(id)`, cascade delete.
  Index `(tenant_id, estimate_version_id, created_at desc)`.
- **`supabase/migrations/20260224203000_tkf017_takeoff_plans.sql`** : Table `plan_files` avec
  `plan_set_id uuid NOT NULL` FK vers `plan_sets(id)`. Types PDF uniquement.
  Storage bucket `plan-files` avec path `{tenant_id}/{plan_set_id}/{file_id}/{filename}`.
- **RLS `plan_sets`** : Utilise `can_access_takeoff_estimate_version(estimate_version_id, tenant_id)`
  pour verifier l'acces.
- **RLS `plan_files`** : Joint a travers `plan_sets` pour verifier l'acces version.
- **`src/app/api/takeoff/plan-sets/route.ts`** : GET (list par `estimate_version_id`),
  POST (create avec `estimate_version_id` obligatoire).
- **`src/lib/takeoff/plans.ts`** : Fonctions serveur `fetchPlanSets(versionId)`,
  `createPlanSet(input)`, `deletePlanSet(id)`.
- **`src/lib/takeoff/types.ts`** : `PlanSetListItem` avec `estimate_version_id`.
- **`src/lib/takeoff/client.ts`** : Client-side fetch `fetchPlanSets(versionId)`.

---

## V3-001 — Ajout colonne `project_id` sur `plan_sets`

**Priorite:** P0 | **Effort:** M | **Couches:** `[DB]`

### User Story

> En tant que chiffreur, je veux que mes plans soient rattaches a l'affaire et non a une
> seule version, afin de pouvoir les reutiliser quand je cree une nouvelle version du devis.

### Criteres d'acceptation

- [ ] Nouvelle colonne `project_id uuid REFERENCES estimate_projects(id) ON DELETE CASCADE`
      ajoutee a `plan_sets` (nullable dans un premier temps)
- [ ] Nouvel index `plan_sets_tenant_project_idx` sur `(tenant_id, project_id, created_at DESC)`
- [ ] Index partiel `plan_sets_tenant_project_not_null_idx` sur
      `(tenant_id, project_id, created_at DESC) WHERE project_id IS NOT NULL`
- [ ] L'index historique `(tenant_id, estimate_version_id, created_at desc)` reste en place
      pendant la phase de coexistence dual-scope
- [ ] Trigger `assign_plan_sets_tenant_id()` mis a jour pour deriver le `tenant_id`
      depuis `project_id` si `estimate_version_id` est NULL
- [ ] Migration idempotente (verification `pg_attribute` avant ALTER)
- [ ] Les requetes existantes utilisant `estimate_version_id` ne sont pas impactees
- [ ] Aucun downtime : la colonne est nullable, le code existant ne la reference pas

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Indirect | Plus de "mes plans ont disparu" quand elle cree V2 |
| Laurent (Senior) | **Fort** | Reutilise ses plans entre versions sans re-upload |
| Nadia (Conductrice) | Indirect | Pas de confusion "ou sont les plans de V1 ?" |

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/YYYYMMDD_v3_001_plan_sets_project_scope.sql`
- Dependances : Aucune

---

## V3-002 — Mise a jour RLS & storage pour scope projet

**Priorite:** P0 | **Effort:** M | **Couches:** `[DB]`

### User Story

> En tant qu'administrateur, je veux que les politiques de securite des plans s'appliquent
> au niveau projet, afin que tous les membres autorises du tenant puissent y acceder
> independamment de la version.

### Criteres d'acceptation

- [ ] Nouvelle fonction `can_access_takeoff_project(p_project_id uuid, p_tenant_id uuid)`
      verifiant que le projet appartient au tenant
- [ ] Policies RLS `plan_sets` mises a jour pour accepter SOIT `project_id` SOIT
      `estimate_version_id` (OR logique, backward compat)
- [ ] Policies RLS `plan_files` mises a jour transitivement (join `plan_sets`)
- [ ] Storage bucket `plan-files` : les policies restent inchangees
      (le path utilise `plan_set_id`, pas `version_id` directement)
- [ ] Les predicates de policy restent indexables
      (`(select ...)` wrapper sur `auth.uid()`)
- [ ] Validation avec `EXPLAIN` sur les requetes de lecture plan_sets filtrees par
      `project_id` ET `estimate_version_id` (mode legacy)
- [ ] Tests RLS : un utilisateur du meme tenant peut lire les plans de n'importe quelle
      version du meme projet
- [ ] Validation RLS automatisee via `npm run e2e:rls` sur le chemin takeoff/plans

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Nul | Infrastructure invisible |
| Laurent (Senior) | Nul | Infrastructure invisible |
| Nadia (Conductrice) | Nul | Infrastructure invisible |

> Story purement technique — securise l'acces project-scope sans impact UX direct.

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/YYYYMMDD_v3_002_plan_sets_project_rls.sql`
- Dependances : V3-001

---

## V3-003 — Data access project-scoped pour plan-sets

**Priorite:** P0 | **Effort:** M | **Couches:** `[Back]`

### User Story

> En tant que developpeur, je veux que la couche d'acces aux plans accepte un `project_id`
> en parametre, afin de creer et lister des jeux de plans au niveau affaire sans waterfall
> ni aller-retour HTTP interne inutile.

### Criteres d'acceptation

- [ ] Fetcher serveur `fetchPlanSetsForProject(projectId)` utilise directement par les pages
      App Router (Server Component), sans requete HTTP interne
- [ ] Server Action `createPlanSetAction` accepte `project_id` comme alternative a
      `estimate_version_id` et valide auth + payload (`server-auth-actions`)
- [ ] `GET /api/takeoff/plan-sets?project_id=X` conserve le support pour compat clients
      existants et usages non-UI
- [ ] `GET /api/takeoff/plan-sets?estimate_version_id=X` retourne les sets du projet de
      la version (backward compat, resolu via join)
- [ ] Les routes de fichiers (`POST /api/takeoff/plan-sets/[setId]/files`) sont inchangees
      (le plan_set est deja scope)
- [ ] Nouveau type `CreatePlanSetInput` : `{ project_id?: string, estimate_version_id?: string,
      name: string, description?: string }` — au moins un des deux identifiants requis
- [ ] Nouveau fetcher serveur `fetchPlanSetsForProject(projectId)` dans `plans.ts`
- [ ] Client library `fetchPlanSetsForProject(projectId)` dans `client.ts`
- [ ] `PlanSetListItem` dans `types.ts` gagne `project_id: string`
- [ ] Validation Zod mise a jour pour accepter les deux schemas
- [ ] `React.cache()` applique au fetcher serveur reutilise dans une meme requete
      (`server-cache-react`)
- [ ] Tests Vitest couvrent action + route en modes project et version

### Notes techniques

- Fichiers a modifier :
  - `src/app/dashboard/affaires/[projectId]/plans/_actions/plan-sets.ts` — Server Action create/delete
  - `src/app/api/takeoff/plan-sets/route.ts` — dual-mode query/body
  - `src/lib/takeoff/plans.ts` — `fetchPlanSetsForProject()`
  - `src/lib/takeoff/client.ts` — `fetchPlanSetsForProject()`
  - `src/lib/takeoff/types.ts` — `project_id` sur `PlanSetListItem`
  - `src/lib/takeoff/schemas.ts` — schema creation dual-mode
- Dependances : V3-001, V3-002

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Nul | Infrastructure invisible |
| Laurent (Senior) | Nul | Infrastructure invisible |
| Nadia (Conductrice) | Nul | Infrastructure invisible |

> Story technique — expose les APIs dual-mode consommees par les stories UI (V3-005+).

---

## V3-004 — Backfill des plan_sets existants avec `project_id`

**Priorite:** P0 | **Effort:** S | **Couches:** `[DB]`

### User Story

> En tant qu'administrateur, je veux que les jeux de plans existants soient automatiquement
> rattaches a leur projet, afin qu'il n'y ait pas de regression pour les donnees historiques.

### Criteres d'acceptation

- [ ] Migration data :
      ```sql
      UPDATE plan_sets ps
      SET project_id = ev.project_id
      FROM estimate_versions ev
      WHERE ev.id = ps.estimate_version_id
        AND ps.project_id IS NULL;
      ```
- [ ] Apres backfill, `project_id` passe en `NOT NULL`
- [ ] `estimate_version_id` passe en nullable (pas DROP, backward compat)
- [ ] CHECK constraint : `project_id IS NOT NULL` (simple, pas de double condition)
- [ ] Requete de validation incluse dans la migration :
      `SELECT count(*) FROM plan_sets WHERE project_id IS NULL` doit retourner 0
- [ ] Migration idempotente (safe re-run)
- [ ] Ajout/maj des contraintes via DO blocks (`pg_constraint`) pour rester idempotent
- [ ] Backfill execute en transaction courte (batch si volumetrie elevee) pour eviter
      les verrous longs (`lock-short-transactions`)

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/YYYYMMDD_v3_004_plan_sets_backfill_project_id.sql`
- Dependances : V3-001
- **Ordre** : cette migration doit s'executer APRES V3-001 (colonne existe)
  et AVANT que le code V3-003 ne requiere `project_id` NOT NULL

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Indirect | Ses plans existants migrent sans action de sa part |
| Laurent (Senior) | **Fort** | Garantit la continuite des donnees historiques |
| Nadia (Conductrice) | Indirect | Pas de regression sur les affaires en cours |

> Backfill transparent — les utilisateurs ne voient rien mais beneficient du scope projet.
