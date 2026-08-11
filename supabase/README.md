# Supabase (base de données)

## 1) Créer le projet Supabase

- Créez un projet Supabase (cloud) ou utilisez Supabase local via le CLI.
- Activez l'authentification Email/Password dans **Authentication**.

## 2) Initialiser le schéma

> ⚠️ **N'exécutez jamais `supabase/schema.sql` sur une base contenant des données.**
> Ce fichier commence par une quarantaine de `drop table if exists … cascade` visant
> `estimate_items`, `estimate_versions`, `tenants`, `purchase_orders`, `audit_logs`… Il **détruit**
> la base. C'est de plus un **snapshot partiel et périmé** : il déclare 40 tables là où les
> migrations en créent environ 99.
>
> **La source de vérité du schéma, c'est `supabase/migrations/`** (195 fichiers, de
> `001_add_job_title_to_profiles.sql` à
> `20260811212848_enforce_active_tenant_boundaries.sql`).

Sur une base **neuve**, appliquez les migrations dans l'ordre :

```bash
supabase link --project-ref <ref>
supabase db push
```

La preuve locale canonique est une commande unique :

```bash
npm run db:ci:local
```

Elle utilise la CLI Supabase `2.109.1` épinglée dans le projet, crée une pile à
ports uniques, rejoue les migrations sans seed, compare l'inventaire appliqué,
exécute pgTAP puis la matrice RLS avec trois utilisateurs Auth locaux. Dans son
bloc de cleanup, elle arrête la pile sans backup et supprime son workdir isolé ;
un échec de ce cleanup fait échouer la commande. Elle refuse les variables et
commandes qui pourraient cibler un projet distant.

Les quatre versions date-only historiques (`20260222`, `20260304`, `20260305`,
`20260306`) sont exécutées par la CLI mais restent volontairement sans version
appliquée dans sa sortie. Leurs effets SQL sont couverts directement par pgTAP ;
ne les renommez et ne les rejouez jamais sous un nouvel identifiant sans preuve
catalogue préalable.

## 3) Ajouter une migration

1. Inspecter le schéma courant, l'historique, les RLS et l'autorisation serveur affectée.
2. Créer un fichier **horodaté en UTC** : `supabase/migrations/<YYYYMMDDHHMMSS>_<snake_case>.sql`.
   Ne jamais réécrire une migration déjà appliquée.
3. Ajouter son hash immuable avec `npm run supabase:manifest:add`.
4. Écrire du SQL **idempotent** (`if exists`, `create or replace`, `drop policy if exists`) et
   **non destructif** (pas de `drop table` en production).
5. Ajouter une régression structurelle ou comportementale ciblée.
6. Lancer `npm run supabase:migrations:git-guard`, puis `npm run db:ci:local`.
7. N'appliquer sur un projet partagé ou distant **que sur autorisation explicite de l'utilisateur**.

### Runbook d'application via MCP

Quand l'application distante est autorisée :

1. `mcp__supabase__get_advisors({ type: "security" })` — état avant migration.
2. `mcp__supabase__apply_migration` avec le nom du fichier et son contenu SQL exact, **dans l'ordre
   chronologique des migrations non encore appliquées**.
3. `mcp__supabase__get_advisors({ type: "security" })` — état après migration.
4. Contrôler les objets ciblés si nécessaire : `pg_policies` pour les tables concernées,
   `pg_proc.proconfig` pour le `search_path` des fonctions.

## 4) Variables d'environnement Next.js

Copiez `.env.example` en `.env.local` et renseignez :

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 5) Sauvegarde automatique (GitHub Actions)

Le workflow [`supabase-backup.yml`](../.github/workflows/supabase-backup.yml) exécute :

- un dump planifié chaque jour (`02:25 UTC`)
- un dump manuel via `workflow_dispatch`
- 3 fichiers SQL (`roles.sql`, `schema.sql`, `data.sql`) compressés dans un artefact `.tar.gz`

Secrets requis dans GitHub :

- `SUPABASE_DB_URL` : URL Postgres **percent-encoded** (si le mot de passe contient des caractères spéciaux).

Restauration (exemple local) :

```bash
tar -xzf supabase-backup-<timestamp>.tar.gz
psql "$SUPABASE_DB_URL" -f backups/<timestamp>/roles.sql
psql "$SUPABASE_DB_URL" -f backups/<timestamp>/schema.sql
psql "$SUPABASE_DB_URL" -f backups/<timestamp>/data.sql
```

Notes :

- Le dump SQL couvre les schémas `public`, `auth`, `storage`.
- Les binaires de Storage (fichiers objets) ne sont pas dans le dump SQL ; seul le metadata SQL est dumpé.
