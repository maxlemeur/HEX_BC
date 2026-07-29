# User Stories v2 — Refonte UX TIMAX

## Contexte

L'application TIMAX (Hydro Express) dispose d'un feature-set riche (editeur spreadsheet,
import DPGF, catalogue, versioning, export) mais l'UX est fragmentee : navigation par concepts
techniques (imports, mappings, catalogue, estimates) plutot que par workflow metier.

La V2 est une **refonte UX pure** pour 3 personas :

| Persona | Profil | Besoin principal |
|---------|--------|-----------------|
| **Chiffreur Junior** | Nouveau chiffreur, peu d'experience logiciel | Interface guidee, colonnes essentielles, wizards pas-a-pas, aide contextuelle |
| **Chiffreur Senior** | Chiffreur experimente, veut de l'efficacite | Tous les raccourcis, colonnes avancees, bulk ops, templates, presets custom |
| **Admin** | Configure le systeme | Feature flags, rules, memberships — deja bien servi par la V1 |

### Principes UX

- **80/20** : 80% de l'ecran = actions quotidiennes, 20% max = options avancees
- **Progressive disclosure** : mode Simplifie par defaut, mode Expert on-demand
- **Affaire-centric** : tout gravite autour du projet/deal, pas de pages isolees
- **Workflow-first** : navigation organisee par ce qu'on FAIT, pas par module technique

### Implementation technique du mode Persona

Le Junior/Senior n'est **pas un role DB** — c'est une **preference d'interface** :
- Colonne `ui_mode` sur `profiles` (`'simplified'` | `'expert'`)
- Hook `useUiMode()` retourne `{ mode, setMode, isExpert, isSimplified }`
- Controle : preset colonnes, densite toolbar, visibilite options avancees, onboarding

---

## Standards techniques obligatoires (V2)

### Baseline projet figee

- Framework: `next@16.x` (App Router) + `react@19`
- Tests unitaires/integration: **Vitest**
- Tests e2e parcours critiques: **Playwright**

### Next.js (`next-best-practices`)

- Reads internes en Server Components ou utilitaires `server.ts` (pas de `route.ts` interne
  uniquement pour consommer depuis l'UI web)
- Mutations UI via Server Actions (`create/update/delete`) avec `revalidatePath`/`revalidateTag`
- Toute nouvelle route App Router metier ajoute au minimum `loading.tsx`;
  ajouter `error.tsx` et `not-found.tsx` pour les segments critiques
- Sur routes dynamiques, `params`/`searchParams` sont types en `Promise<...>` puis `await`
- Composants utilisant `useSearchParams()` (et `usePathname()` en route dynamique)
  encapsules dans `Suspense`
- Frontieres RSC respectees : pas de Client Component `async`,
  props server -> client serializables uniquement
- Convention Next 16: nouveau code d'interception en `proxy.ts` / `proxyConfig`;
  `middleware.ts` legacy maintenu temporairement si deja present

### Supabase/Postgres (`supabase-postgres-best-practices`)

- Toute nouvelle FK est indexee; privilegier les indexes composites alignes aux filtres reels
  (souvent avec `tenant_id` en premier)
- Pagination des listes profondes en curseur (`(updated_at, id)` ou `(created_at, id)`),
  pas en `OFFSET`
- Migrations idempotentes pour contraintes via `DO $$ ... pg_constraint ... $$`
  (pas de `ADD CONSTRAINT IF NOT EXISTS`)
- RLS obligatoire et performante : predicates indexables, fonctions auth enveloppees en
  `(select ...)`, policies verifiees avec `EXPLAIN` sur requetes critiques
- Ecritures massives (imports/mappings/items) en batch insert et `UPSERT` (`ON CONFLICT`)
  plutot que boucle ligne par ligne
- Transactions courtes : parsing/calcul hors transaction, transaction reservee
  aux ecritures atomiques finales

### React/Next perf (`vercel-react-best-practices`)

Shortlist obligatoire V2 (a appliquer uniquement sur les surfaces critiques):

- `async-parallel` : fetch independants en `Promise.all`
- `async-suspense-boundaries` : streaming via `Suspense` sur blocs lents
- `bundle-dynamic-imports` : `next/dynamic` pour composants lourds non critiques
  au premier paint
- `bundle-conditional` : chargement conditionnel des modules/features experts
- `server-auth-actions` : authN/authZ + validation d'entree dans chaque Server Action
- `server-cache-react` : `React.cache()` pour dedup des queries server repetitives
- `server-serialization` : minimiser les donnees server -> client
- `rerender-memo` : extraire les sous-arbres couteux en composants memoises
- `rerender-derived-state-no-effect` : eviter les effets pour etat derive simple
- `rerender-functional-setstate` : callbacks stables sur updates dependantes
- `rerender-transitions` : `startTransition` pour updates non urgentes
- `client-event-listeners` + `client-passive-event-listeners` :
  listeners globaux dedup + passifs pour scroll/touch

### Definition of done technique (minimum)

- Requetes critiques des stories P0/P1 validees avec `EXPLAIN` (pas de Seq Scan non justifie)
- Index/policies/migrations traces dans les notes techniques de la story concernee
- Stories UI P0/P1: au moins 1 verification perf explicite
  (waterfall, bundle, re-render ou listener global) documentee en PR

### Matrice de tests V2 (obligatoire)

- Unit/integration (logique pure, hooks, utilitaires): `npm test` (Vitest)
- RLS regression (policies sensibles): `npm run e2e:rls`
- E2E UX critique (navigation, affaire, import, editeur): `npm run e2e:pw:critical`
- E2E complet avant release milestone: `npm run e2e:pw`

---

## Index des epics

| Code | Nom | Milestone | Priorite | Stories | Fichier |
|------|-----|-----------|----------|---------|---------|
| UX2-E01 | Navigation & Mode Persona | M1 | P0 | UX2-001 a 004 | [UX2-E01-navigation-persona.md](./UX2-E01-navigation-persona.md) |
| UX2-E02 | Hub Affaire (Projet Dashboard) | M1 | P0 | UX2-005 a 008 | [UX2-E02-hub-affaire.md](./UX2-E02-hub-affaire.md) |
| UX2-E03 | Flux Import-to-Estimate Unifie | M2 | P0 | UX2-009 a 012 | [UX2-E03-import-unifie.md](./UX2-E03-import-unifie.md) |
| UX2-E04 | Editeur Simplifie (80/20 Layout) | M2 | P1 | UX2-013 a 017 | [UX2-E04-editeur-simplifie.md](./UX2-E04-editeur-simplifie.md) |
| UX2-E05 | Outils Expert & Productivite Senior | M3 | P1 | UX2-018 a 022 | [UX2-E05-outils-expert.md](./UX2-E05-outils-expert.md) |
| UX2-E06 | Onboarding, Polish & Responsive | M3 | P2 | UX2-023 a 027 | [UX2-E06-onboarding-polish.md](./UX2-E06-onboarding-polish.md) |

**Total : 27 stories** | [Plan d'implementation](./IMPLEMENTATION_PLAN.md)

---

## Milestones

| Milestone | Objectif | Epics | Stories |
|-----------|----------|-------|---------|
| **M1** | Navigation restructuree + Hub Affaire | E01, E02 | 8 stories |
| **M2** | Import unifie + Editeur simplifie | E03, E04 | 9 stories |
| **M3** | Outils Expert + Polish | E05, E06 | 10 stories |

### Ordre d'implementation M1

> **Contrainte critique :** E01 (sidebar) depend de E02 (page affaires).
> La sidebar ne peut pointer vers `/dashboard/affaires` que si la page existe.
>
> Sequence obligatoire :
> 1. **UX2-005** (page liste affaires) — cree la destination
> 2. **UX2-001** (mode UI) — fondation pour le reste
> 3. **UX2-002** (nav dynamique) — references `/dashboard/affaires`
> 4. **UX2-003** (redirect sidebar) — bascule la navigation
> 5. UX2-006, UX2-007, UX2-008 en parallele apres UX2-005

---

## Glossaire des roles

| Role | Code interne | Persona V2 | Description |
|------|-------------|------------|-------------|
| Chiffreur Junior | `engineer` + `ui_mode='simplified'` | Junior | Cree et edite les devis avec interface guidee |
| Chiffreur Senior | `engineer` + `ui_mode='expert'` | Senior | Cree et edite les devis avec controle total |
| Admin | `admin` | Admin | Gere les tenants, feature flags, rules, memberships |
| Lecteur | `viewer` | — | Consulte les devis en lecture seule |

---

## Etat d'avancement

| Story | Titre | Epic | Milestone | Priorite | Effort | Couches | Etat |
|-------|-------|------|-----------|----------|--------|---------|------|
| UX2-001 | Preference mode interface | E01 | M1 | P0 | S | DB Back Front | A faire |
| UX2-002 | NAV_GROUPS dynamique | E01 | M1 | P0 | M | Front | A faire |
| UX2-003 | Restructuration sidebar | E01 | M1 | P0 | M | Front | A faire |
| UX2-004 | Badge mode sidebar | E01 | M1 | P2 | S | Front | A faire |
| UX2-005 | Liste des affaires | E02 | M1 | P0 | L | DB Back Front | A faire |
| UX2-006 | Hub affaire | E02 | M1 | P0 | L | Back Front | A faire |
| UX2-007 | Lier DPGF a projet | E02 | M1 | P1 | M | DB Back | A faire |
| UX2-008 | Breadcrumb editeur | E02 | M1 | P1 | S | Front | A faire |
| UX2-009 | UnifiedImportFlow | E03 | M2 | P0 | L | Back Front | A faire |
| UX2-010 | Auto-mapping confiance | E03 | M2 | P1 | M | DB Back Front | A faire |
| UX2-011 | Creation affaire + import | E03 | M2 | P0 | M | Back Front | A faire |
| UX2-012 | Deprecation standalone | E03 | M2 | P2 | S | Front | A faire |
| UX2-013 | Settings summary bar | E04 | M2 | P1 | M | Front | A faire |
| UX2-014 | Preset Essentiel defaut | E04 | M2 | P1 | S | Front | A faire |
| UX2-015 | Toolbar compacte | E04 | M2 | P1 | M | Front | A faire |
| UX2-016 | Split fichier editeur | E04 | M2 | P2 | L | Front | A faire |
| UX2-017 | Mode lecture viewer | E04 | M2 | P1 | S | DB Front | A faire |
| UX2-018 | Command Palette | E05 | M3 | P1 | M | Front | A faire |
| UX2-019 | Panel raccourcis | E05 | M3 | P2 | S | Front | A faire |
| UX2-020 | Dashboard analytics | E05 | M3 | P1 | L | Back Front | A faire |
| UX2-021 | Analyse marge affaire | E05 | M3 | P2 | M | Back Front | A faire |
| UX2-022 | Acces rapide templates | E05 | M3 | P1 | M | Front | A faire |
| UX2-023 | Empty states | E06 | M3 | P2 | M | Front | A faire |
| UX2-024 | Onboarding tour | E06 | M3 | P2 | M | Front | A faire |
| UX2-025 | Responsive tablette | E06 | M3 | P2 | M | Front | A faire |
| UX2-026 | Toast queue | E06 | M3 | P2 | S | Front | A faire |
| UX2-027 | Skeletons | E06 | M3 | P2 | S | Front | A faire |

---

## Totaux

- **Par effort :** 9 Small, 11 Medium, 7 Large
- **Par priorite :** 5 P0, 10 P1, 12 P2
- **Par persona :** Junior (4), Senior (5), Tous (16), Dev (1), Admin (1)
- **Par couche :**
  - `[DB]` 6 stories — UX2-001, 005, 007, 010, 017 + index migration 005
  - `[Back]` 9 stories — UX2-001, 005, 006, 007, 009, 010, 011, 020, 021
  - `[Front]` 25 stories — toutes sauf UX2-007 (DB+Back pur)

---

## Notes architecturales

### Statut global affaire (UX2-005, UX2-006)
Le "statut global" d'une affaire affiche **2 infos distinctes** :
- **Statut courant** = statut de la version avec le plus grand `version_number`
  (= le travail en cours, ex: "V3 Brouillon")
- **Derniere acceptee** = badge separe si une version `status = 'accepted'` existe
  (= le dernier resultat valide, ex: "V2 Acceptee")

Cela couvre le cas V3 draft + V2 accepted sans ambiguite.

### Liaison catalogue (E03)
La liaison catalogue (lier une ligne DPGF a un produit/fournisseur du pricebook)
n'est **pas une etape d'import** — c'est une action qui se fait **dans l'editeur**,
ligne par ligne, via `selected_supplier_price_id` sur `estimate_items`.
Le `BulkSuggestDialog` existant et les suggestions auto couvrent deja ce besoin.
Le `UnifiedImportFlow` (UX2-009) ne couvre donc que Upload → Mapping → Preview →
Confirmation. La liaison catalogue vit dans l'editeur, pas dans le flux d'import.

### Mode lecture viewer (UX2-017)
Le guard UI est un "anti-erreur" utile, mais la permission reelle doit etre en base.
La V2 inclut donc un durcissement RLS de `estimate_items` pour bloquer
INSERT/UPDATE/DELETE au role `viewer` (autoriser `admin`/`engineer` uniquement),
en conservant les verifications de tenant.

---

## Hors scope V2 (prevu V3)

→ **Voir [User Stories V3](../v3/README.md)** pour les epics et stories detaillees.

### Track Takeoff / Metre (14 stories)
- Migration `plan_sets` vers scope projet (DB)
- Integration takeoff dans le hub affaire (Plans & Metres)
- Workflow metre : comparaison DPGF vs Takeoff, carry-over versions, UX junior/senior

### Track Approbation / Direction (a definir)
- Workflow d'approbation Direction (statut `pending_approval`)
- Role `director` dans `tenant_role`
- Dashboard Direction avec KPIs equipe
- File d'approbation
- Portail client
