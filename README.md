# Générateur de commandes (Next.js 16 + Supabase)

Application interne pour :

- gérer des **clients** et **produits**
- créer des **commandes** (lignes, TVA, totaux)
- générer une version **imprimable / PDF** (via impression navigateur)

## Prérequis

- Node.js / npm
- Un projet Supabase (cloud) ou Supabase local

## Mise en place Supabase

1. Créez un projet Supabase et activez Email/Password (Authentication).
2. Dans **SQL Editor**, exécutez `supabase/schema.sql`.

Plus d'infos : `supabase/README.md`.

## Variables d'environnement

Copiez `.env.example` en `.env.local` et renseignez :

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Démarrer en local

```bash
npm install
npm run dev
```

Puis ouvrez http://localhost:3000
# HEX_BC

## Test user (E2E)

Email: e2e.hex@example.com
Password: E2eTest-2026!

