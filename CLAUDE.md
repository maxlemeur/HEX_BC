# CLAUDE.md

Guidance pour Claude Code (claude.ai/code) sur ce dépôt.

## Source de vérité

**[AGENTS.md](AGENTS.md) est le contrat opérationnel de ce dépôt.** Lis-le avant toute modification :
périmètre, ordre de validation, invariants métier et sécurité, conventions, règles de publication.
Ce fichier-ci n'en est qu'un rappel d'orientation ; en cas de divergence, `AGENTS.md` l'emporte.

Pour l'état réel du système, la vérité est le **code**, les **migrations** et `package.json` — jamais
un document. La documentation `docs/` a été auditée le 2026-07-29 : tout ce qui précède cette date,
hors `docs/metier/` et `AGENTS.md`, doit être considéré comme un instantané historique.
Voir [docs/AUDIT-DOCUMENTATION-2026-07-29.md](docs/AUDIT-DOCUMENTATION-2026-07-29.md).

## Le produit

Logiciel de **chiffrage BTP** français, multi-tenant. Pas un gestionnaire de commandes.

```
Affaire → pièces (DPGF, plans, CCTP) → import DPGF / métré IA → devis → validation
        → PDF + envoi → portail client → bons de commande
```

Domaines dans `src/app/dashboard/` : `affaires`, `estimates`, `takeoff`, `referentiel`, `tarifs`,
`approvals`, `direction`, `orders`, `analytics`, `admin`. Portail client public sous `src/app/portal/`.

## Commandes

```bash
npm run dev          # développement
npm run build        # valide l'OpenAPI PUIS construit — les deux doivent passer
npm run typecheck    # TypeScript strict
npm run lint         # ESLint, --max-warnings=0
npm test             # Vitest (projets node + jsdom)
npm run check:quality # garde-fous CI sans secret, hors build
npm run check:release # check:quality + build Webpack et smoke next start
npm run e2e:pw:critical
```

Validation minimale attendue : test focalisé → `typecheck` → `lint`. Voir `AGENTS.md` § Test Strategy
pour l'ordre complet.

## Architecture

- `src/app/` — App Router : pages, layouts, server actions, `api/**` (122 route handlers)
- `src/components/` — UI partagée et par domaine
- `src/hooks/` — hooks React, dont ~19 contrôleurs de l'éditeur de devis
- `src/lib/` — logique métier. Principaux : `estimates/`, `takeoff/`, `affaires/`, `catalogue/`,
  `imports/`, `mappings/`, `approvals/`, `direction/`, `cockpit/`
- `src/lib/openapi/` — génération OpenAPI depuis les schémas Zod ; `openapi.json` est versionné
- `supabase/migrations/` — **195 migrations, source de vérité du schéma**
- `supabase/functions/` — Edge Functions Deno

**Authentification** : `src/proxy.ts` rafraîchit la session Supabase (cookies et redirections de session,
sans règle d'autorisation métier). L'autorisation passe par `getUserContext()` / `requireUser()`
(`src/lib/auth/server.ts`), consommé par les layouts et les server actions.

**Clients Supabase** : `createSupabaseServerClient()` (async, Server Components),
`createSupabaseBrowserClient()` (Client Components, avec `useMemo`), `service-role.ts` — **jamais**
côté navigateur.

## Base de données

~99 tables `public`, **RLS active sur toutes**, isolation par `tenant_id`. Domaines : `estimate_*`
(versions, items, catégories, approbations, drafts IA), `affaire_*` (intake, brief, registre),
`takeoff_*` + `plan_*`, `dpgf_*`, catalogue (`products`, `suppliers`, `supplier_pricebook`),
`purchase_order*`, `tenants` / `tenant_memberships`.

⚠️ `supabase/schema.sql` est un **snapshot partiel et périmé** (40 tables) qui commence par ~40
`drop table … cascade`. Ne jamais l'exécuter sur une base peuplée.

**Enums clés** :

| Enum | Valeurs |
|---|---|
| `estimate_status` | `draft`, `sent`, `accepted`, `archived` — sert au devis **et** à l'affaire |
| `estimate_version_approval_status` | `not_required`, `required`, `in_review`, `approved`, `changes_requested` |
| `estimate_item_type` | `section`, `line` |
| `tenant_role` | `admin`, `engineer`, `viewer`, `director` |
| `purchase_order_status` | `draft`, `sent`, `confirmed`, `received`, `canceled` |

Transitions de devis, contraintes par trigger : `draft → sent`, `sent → accepted|archived`,
`accepted → archived`. **Aucun retour en arrière.**

## Règles métier

Les montants sont des **entiers de centimes** (`*_cents`), les taux des **points de base**
(`*_bp`, 2000 = 20 %). `formatEUR()` pour l'affichage, `parseEuroToCents()` pour la saisie
(`src/lib/money.ts`).

⚠️ Deux méthodes d'arrondi coexistent, et cette hétérogénéité est **connue et non résolue** :
`bankersRound` (PU, coefficient global, remises cascade, allocation) et `Math.round` (coût de ligne,
vente de ligne, **TVA**). Ne pas « harmoniser » sans lire `docs/metier/regles-de-calcul.md`.

⚠️ Deux moteurs de calcul coexistent, gouvernés par `estimate_versions.calc_engine_version`.
**La v1 est ce qui s'exécute en production** ; la v2 (réconciliée) est écrite et testée mais
l'éditeur épingle encore `EDITOR_CALC_ENGINE_VERSION = 1`. Toute modification de
`src/lib/estimate-calculations.ts` change des montants contractuels sur des devis envoyés et
scellés — lire `docs/metier/regles-de-calcul.md` avant d'y toucher.

Détail complet : [docs/metier/regles-de-calcul.md](docs/metier/regles-de-calcul.md) et
[docs/metier/cycle-de-vie.md](docs/metier/cycle-de-vie.md).

## Conventions

TypeScript strict, indentation 2 espaces, points-virgules, guillemets doubles. Alias `@/` pour
`src/`. PascalCase pour les composants, `useX` pour les hooks, dossiers de route en minuscules.
Tests colocalisés (`module.test.ts`, `Component.test.tsx`).

Commits : Conventional Commits, avec le numéro de ticket quand il existe —
`fix(EST-243): remove unused portal test imports`.
