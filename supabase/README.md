# Supabase (base de données)

## 1) Créer le projet Supabase

- Créez un projet Supabase (cloud) ou utilisez Supabase local via le CLI.
- Activez l'authentification Email/Password dans **Authentication**.

## 2) Initialiser le schéma

- Ouvrez **SQL Editor** dans Supabase
- Exécutez `supabase/schema.sql`

## 3) Runbook migrations via MCP

Ce runbook applique des migrations incrémentales (non destructives) sur le projet principal.

1. Vérifier l'état sécurité avant migration:
   - `mcp__supabase__get_advisors({ type: "security" })`
2. Préparer la migration à appliquer:
   - `name`: nom court en `snake_case` (ex: `004_harden_estimate_devis_rls_s1`)
   - `query`: contenu SQL exact du fichier `supabase/migrations/<file>.sql`
3. Appliquer dans l'ordre:
   - `mcp__supabase__apply_migration` avec `004_harden_estimate_devis_rls_s1`
   - `mcp__supabase__apply_migration` avec `005_set_search_path_estimate_functions_s1`
4. Vérifier l'état sécurité après migration:
   - `mcp__supabase__get_advisors({ type: "security" })`
5. Contrôler les policies/fonctions ciblées si nécessaire:
   - `pg_policies` pour `estimate_*` et `purchase_order_devis`
   - `pg_proc.proconfig` pour `set_updated_at`, `guard_estimate_versions_readonly`, `duplicate_estimate_version`

Notes:
- Les migrations SQL doivent être idempotentes (`if exists`, `create or replace`, `drop policy if exists`).
- Ne pas utiliser de SQL destructif en prod (pas de `drop table`).

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
