# Supabase (base de données)

## 1) Créer le projet Supabase

- Créez un projet Supabase (cloud) ou utilisez Supabase local via le CLI.
- Activez l'authentification Email/Password dans **Authentication**.

## 2) Appliquer le schéma

- Ouvrez **SQL Editor** dans Supabase
- Exécutez `supabase/schema.sql`

## 3) Variables d'environnement Next.js

Copiez `.env.example` en `.env.local` et renseignez :

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

