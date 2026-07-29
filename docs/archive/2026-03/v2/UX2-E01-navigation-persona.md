# UX2-E01 — Navigation & Mode Persona

> Milestone: M1 | Priorite: P0 | Statut: A faire

## Objectif

Introduire un toggle Simplifie/Expert qui adapte toute l'interface au profil de l'utilisateur,
et restructurer la sidebar pour l'organiser par workflow metier (ce qu'on fait) plutot que par
module technique (imports, mappings, catalogue). Chaque persona voit une navigation adaptee a
ses actions quotidiennes.

## Ce qui existe deja

- **`src/components/DashboardShell.tsx`** : Sidebar complete avec `NAV_GROUPS` statique,
  collapse/expand, mobile hamburger, feature flag pour takeoff. 3 groupes fixes :
  Chiffrages, Commandes, Configurer.
- **`src/components/UserContext.tsx`** : `UserProvider` avec `tenantId` et `profile`
  (inclut `tenant_role` : `admin | engineer | viewer`)
- **`src/lib/auth/server.ts`** : `getUserContext()` retourne `profile.tenant_role`
- **`src/app/dashboard/layout.tsx`** : Layout qui instancie `UserProvider` + `DashboardShell`
- **`src/hooks/useFeatureFlag.ts`** : Hook existant pour conditionner des features
- **`src/app/dashboard/admin/page.tsx`** : Guard `profile.tenant_role !== 'admin'` → redirect

---

## UX2-001 — Preference mode interface (Simplifie/Expert)

**Priorite:** P0 | **Effort:** S | **Couches:** `[DB]` `[Back]` `[Front]`

### User Story

> En tant que chiffreur, je veux choisir entre un mode Simplifie (interface guidee, colonnes
> essentielles) et un mode Expert (controle total, colonnes avancees), afin que l'application
> s'adapte a mon niveau d'experience.

### Criteres d'acceptation

- [ ] Colonne `ui_mode text DEFAULT 'simplified'` ajoutee a la table `profiles`
      avec contrainte `CHECK (ui_mode IN ('simplified', 'expert'))`
- [ ] Hook `useUiMode()` retourne `{ mode, setMode, isExpert, isSimplified }`
- [ ] Le mode est persiste en `localStorage` pour une reponse instantanee au chargement,
      puis synchronise avec la base via Server Action (pas via route handler interne)
- [ ] Le mode controle : preset colonnes editeur, densite toolbar, visibilite options
      avancees, declenchement de l'onboarding
- [ ] Un toggle compact (icone Simplifie ○ / Expert ●) est accessible dans la sidebar
- [ ] Le changement de mode est instantane (pas de rechargement de page)
- [ ] Migration SQL idempotente (verification `pg_constraint`) pour la contrainte
      `ui_mode` et rollback propre en cas d'erreur
- [ ] La Server Action `updateProfileUiMode()` verifie authN/authZ + payload valide
      (`server-auth-actions`)

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/YYYYMMDD_ux2_001_ui_mode.sql`
  - `src/hooks/useUiMode.ts`
  - `src/app/dashboard/_actions/profile.ts` — `updateProfileUiMode()`
- Fichiers a modifier :
  - `src/components/UserContext.tsx` — ajouter `ui_mode` au type `UserProfile`
- Reutiliser :
  - `createSupabaseBrowserClient()` pour la persistence cote client
  - Pattern localStorage deja utilise par `useColumnVisibility`
  - `revalidatePath("/dashboard")` apres mutation
- Dependances : Aucune

---

## UX2-002 — Refactorer NAV_GROUPS en configuration dynamique par role

**Priorite:** P0 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur en mode Simplifie, je veux voir uniquement les liens pertinents pour
> mon travail quotidien (Mes affaires, Commandes), afin de ne pas etre surcharge par des
> options techniques ou d'administration.

### Criteres d'acceptation

- [ ] `NAV_GROUPS` n'est plus une constante statique dans `DashboardShell.tsx` ;
      il est calcule via `buildNavGroups(role, featureFlags, uiMode)`
- [ ] Role `engineer` + mode Simplifie : Mes affaires, Commandes
- [ ] Role `engineer` + mode Expert : Mes affaires, Commandes, Outils (Referentiel, Tarifs)
- [ ] Role `admin` : Mes affaires, Commandes, Outils, Administration
- [ ] Role `viewer` : Mes affaires (lecture seule), Commandes (lecture seule)
- [ ] Les entrees "Imports DPGF" et "Mappings" sont supprimees de la sidebar
      (absorbees dans le flux affaire — cf. UX2-E03)
- [ ] Le `TAKEOFF_NAV_ITEM` conditionnel reste inchange (ajoute si flag `TKF` actif)
- [ ] Tests unitaires Vitest couvrent les combinaisons role × mode × flags

### Notes techniques

- Fichiers a creer :
  - `src/lib/navigation/build-nav-groups.ts`
  - `src/lib/navigation/build-nav-groups.test.ts`
- Fichiers a modifier :
  - `src/components/DashboardShell.tsx` — remplacer la constante par l'appel a `buildNavGroups()`
- Reutiliser :
  - `useUserContext()` pour le role
  - `useFeatureFlag()` pour les flags conditionnels
  - `useUiMode()` pour le mode interface
- Dependances : UX2-001, **UX2-005** (la page `/dashboard/affaires` doit exister avant
  que la sidebar y pointe, sinon lien mort)

---

## UX2-003 — Restructurer la sidebar (workflow-first)

**Priorite:** P0 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux que la navigation soit organisee par ce que je fais
> (Mes affaires, Mes commandes, Outils) plutot que par concepts techniques (Chiffrages,
> Imports, Mappings), afin de trouver rapidement ma destination.

### Criteres d'acceptation

- [ ] Groupe "Chiffrages" renomme en "Mes affaires" avec icone dossier
- [ ] Les entrees "Imports DPGF" et "Mappings" disparaissent de la sidebar
- [ ] Groupe "Configurer" eclate en "Outils" (pour engineer expert) et
      "Administration" (pour admin)
- [ ] Le lien principal `/dashboard/estimates` pointe vers `/dashboard/affaires`
- [ ] Les anciens URLs `/dashboard/imports`, `/dashboard/mappings` restent fonctionnels
      via des redirects dans `next.config.ts`
- [ ] La sidebar en mode Simplifie montre max 2 groupes (Mes affaires, Commandes)
- [ ] L'icone et le libelle de chaque item sont mis a jour pour etre metier-friendly

### Notes techniques

- Fichiers a modifier :
  - `src/components/DashboardShell.tsx` — structure des groupes, labels, icones
  - `next.config.ts` — ajout de `redirects` pour backward compat
- Reutiliser :
  - Le pattern `isActive()` existant dans `DashboardShell` pour les conditions d'active state
- Dependances : UX2-002, **UX2-005** (ne PAS activer les redirects tant que
  `/dashboard/affaires` n'est pas operationnel)

---

## UX2-004 — Badge mode + role dans le footer sidebar

**Priorite:** P2 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant qu'utilisateur, je veux voir mon mode actif (Simplifie/Expert) et pouvoir le
> basculer rapidement depuis le pied de sidebar, afin de changer de mode sans quitter
> ma page courante.

### Criteres d'acceptation

- [ ] Le bloc utilisateur en bas de sidebar affiche : initiales, nom, badge du mode actif
- [ ] Le badge du mode est un switch compact cliquable (Simplifie ○ ↔ Expert ●)
- [ ] Le changement de mode est instantane et persiste (cf. UX2-001)
- [ ] Clic sur la zone nom/initiales ouvre toujours `/dashboard/profile`
- [ ] En sidebar collapsed, seul le switch est visible (pas le label texte)

### Notes techniques

- Fichiers a modifier :
  - `src/components/DashboardShell.tsx` — section footer user
- Reutiliser :
  - `useUiMode()` pour le toggle
- Dependances : UX2-001
