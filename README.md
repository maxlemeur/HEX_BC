# HEX_BC — Logiciel de chiffrage BTP

Application interne de chiffrage pour le bâtiment : de la réception des pièces d'une affaire
jusqu'au devis envoyé au client, puis aux bons de commande fournisseurs.

Chaîne fonctionnelle principale :

```
Affaire → dépôt des pièces (DPGF, plans, CCTP) → import DPGF / métré assisté par IA
        → devis chiffré (lots, ouvrages, lignes) → validation → PDF + envoi
        → portail client (acceptation / signature) → bons de commande
```

## Domaines

| Domaine | Route | Rôle |
|---|---|---|
| **Affaires** | `/dashboard/affaires` | Hub projet : dépôt de pièces, brief IA, registre d'hypothèses, pilotage |
| **Chiffrages** | `/dashboard/estimates` | Éditeur type tableur, versions, variantes, diff, PDF, envoi |
| **Métrés** | `/dashboard/takeoff` | Extraction de quantités depuis les plans (Gemini), niveaux A/B/C, preuves |
| **Référentiel / Tarifs** | `/dashboard/referentiel`, `/dashboard/tarifs` | Produits, fournisseurs, prix, indices, ouvrages réutilisables |
| **Validation** | `/dashboard/approvals`, `/dashboard/direction` | File d'approbation, revue multi-rôle, portefeuille de risque |
| **Commandes** | `/dashboard/orders` | Bons de commande fournisseurs et devis rattachés |
| **Portail client** | `/portal/[token]` | Consultation, acceptation ou refus d'un devis, signature |

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript strict** · **Tailwind CSS 4**
- **Supabase** — Postgres multi-tenant, RLS active sur toutes les tables, Auth, Storage, Edge Functions
- **Gemini** pour le métré assisté et la classification documentaire
- **Vitest** (projets `node` et `jsdom`) · **Playwright** · suites PowerShell héritées
- OpenAPI 3.1 généré depuis les schémas Zod, validé au build

## Prérequis

- Node.js 24 LTS (voir `.nvmrc`) / npm 11
- Un projet Supabase (cloud ou local via CLI)

## Mise en place

```bash
npm ci
cp .env.example .env.local
```

Renseignez `.env.local`. Les deux premières variables suffisent à démarrer l'application ; les
suivantes conditionnent l'IA, l'email et les workers :

| Variable | Requise pour |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Démarrage de base |
| `SUPABASE_SERVICE_ROLE_KEY` | Workers, tâches serveur privilégiées |
| `GEMINI_API_KEY` | Métré assisté, classification des pièces |
| `RESEND_API_KEY`, `EMAIL_FROM` | Envoi de devis par email |
| `NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL` | Liens du portail client |
| `TAKEOFF_WORKER_SECRET`, `TAKEOFF_WORKER_URL` | Traitement asynchrone des métrés |

La base s'initialise **par les migrations**, jamais par `schema.sql` — voir
[supabase/README.md](supabase/README.md).

```bash
npm run dev     # http://localhost:3000
```

## Commandes courantes

```bash
npm run dev          # serveur de développement
npm run build        # valide l'OpenAPI puis construit
npm run typecheck    # TypeScript strict, sans émission
npm run lint         # ESLint, zéro warning toléré
npm test             # suite Vitest complète
npm run e2e:pw:critical   # Playwright, parcours critiques
```

L'inventaire complet des scripts est dans `package.json`.

## Documentation

| Document | Contenu |
|---|---|
| [AGENTS.md](AGENTS.md) | **Contrat de travail** : périmètre, tests, invariants métier et sécurité. À lire en premier |
| [docs/README.md](docs/README.md) | Index de la documentation |
| [docs/metier/regles-de-calcul.md](docs/metier/regles-de-calcul.md) | Formules, arrondis, TVA, marge, remises |
| [docs/metier/glossaire.md](docs/metier/glossaire.md) | Vocabulaire du chiffrage BTP |
| [docs/metier/cycle-de-vie.md](docs/metier/cycle-de-vie.md) | Statuts, immutabilité, scellement, approbations |

## Comptes de test

Les identifiants ne sont **jamais** committés. Voir [docs/test-logins.md](docs/test-logins.md).
