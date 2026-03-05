# V3-E02 — Hub Affaire : Plans & Metres

> Track: Takeoff / Metre | Priorite: P0-P1 | Statut: A faire

## Objectif

Surfacer le module takeoff directement dans le hub affaire (`/dashboard/affaires/[projectId]`).
L'utilisateur gere ses plans et lance des metres depuis son affaire, sans passer par le hub
standalone `/dashboard/takeoff`. Le takeoff devient un citoyen de premier ordre du hub.

## Ce qui existe deja

- **`src/components/affaires/AffaireHub.tsx`** : Hub avec 4 sections (FinancialSummaryCard,
  VersionTimelineCard, DpgfSourceCard, QuickActionsCard). Layout 2 colonnes.
- **`src/lib/affaires/server.ts`** : Fetchers `fetchAffaireHubSummary`, `fetchAffaireHubTimeline`,
  `fetchAffaireHubDpgfSource`.
- **`src/components/takeoff/PlanCenter.tsx`** : Composant existant pour gerer les plan sets
  et fichiers PDF. Accepte `versionId` (a adapter pour `projectId`).
- **`src/components/takeoff/PlanSetFormModal.tsx`** : Modal de creation de plan set.
- **`src/components/takeoff/PlanFileUploadZone.tsx`** : Zone de drop/upload pour PDF.
- **`src/components/takeoff/TakeoffJobList.tsx`** : Liste des jobs takeoff filtree par version.
- **`src/app/dashboard/takeoff/page.tsx`** : Hub takeoff standalone listant toutes les versions.
- **`src/lib/navigation/build-nav-groups.tsx`** : Item nav "Metres plans" conditionnel sur
  `featureFlags.takeoffEnabled`, pointe vers `/dashboard/takeoff`.

---

## V3-005 — Card Plans & Metres dans le hub affaire

**Priorite:** P0 | **Effort:** M | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur, je veux voir un resume des plans et metres directement dans le hub
> de mon affaire, afin de savoir immediatement quels documents sont disponibles et l'etat
> des extractions sans changer de page.

### Criteres d'acceptation

- [ ] Nouveau fetcher serveur `fetchAffaireHubPlansSummary(projectId)` retournant :
      `{ planSetCount, planFileCount, totalSizeBytes, latestJob: { id, status, level,
      source_file_name, items_count, created_at } | null }`
- [ ] Nouveau composant `PlansMetresCard` affichant :
      - Nombre de jeux de plans et fichiers
      - Statut du dernier job (icone + texte : en cours, termine, echoue)
      - Nombre d'items extraits par le dernier job
      - Lien "Voir les plans" → `/dashboard/affaires/[projectId]/plans`
      - Bouton "Lancer un metre" → action (cf. V3-009)
- [ ] Quand aucun plan n'existe : empty state "Ajoutez vos plans" + bouton upload
- [ ] Le composant est gate par `TAKEOFF_MODULE_ENABLED` : si desactive, pas de rendu
- [ ] La card est ajoutee dans la colonne droite du hub, sous `DpgfSourceCard`
- [ ] Les lectures plan_sets/takeoff_jobs sont parallelisees via `Promise.all`
- [ ] Fetcher cache via `React.cache()` si reutilise dans plusieurs sections
- [ ] Le gate feature flag est resolu cote serveur (ou passe en prop serializable),
      pas via hook client dans un Server Component
- [ ] Couverture Playwright : hub affaire avec/sans plans, et avec flag active/desactive

### Notes techniques

- Fichiers a creer :
  - `src/components/affaires/PlansMetresCard.tsx`
- Fichiers a modifier :
  - `src/lib/affaires/server.ts` — ajouter `fetchAffaireHubPlansSummary()`
  - `src/components/affaires/AffaireHub.tsx` — ajouter la card
  - `src/app/dashboard/affaires/[projectId]/page.tsx` — fetch plans data
- Reutiliser :
  - `formatFileSize()` pour l'affichage taille
  - `STATUS_BADGE_STYLES` pour le badge statut job
  - Resolution server-side des feature flags existante
- Dependances : V3-003

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | **Fort** | Decouvre le takeoff depuis son hub quotidien — visibilite sur un module qu'elle ignorait |
| Laurent (Senior) | Moyen | Vue rapide, mais il ira vite vers la page complete (V3-006) |
| Nadia (Conductrice) | **Critique** | Son point d'entree principal — resume metre auto-suffisant pour 80% de ses consultations |

---

## V3-006 — Page Plan Center au niveau affaire

**Priorite:** P0 | **Effort:** L | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur senior, je veux acceder a une page dediee "Plans" au sein de mon
> affaire, pour gerer mes jeux de plans, uploader de nouveaux PDF et voir l'historique
> des fichiers.

### Criteres d'acceptation

- [ ] Nouvelle route `/dashboard/affaires/[projectId]/plans`
- [ ] Reutilise le composant `PlanCenter.tsx` adapte pour accepter `projectId` prop
      (en plus du `versionId` existant)
- [ ] Creation de plan set via `createPlanSet({ project_id: projectId, name, description })`
- [ ] Upload fichiers via `PlanFileUploadZone` (inchange)
- [ ] Liste des plan sets avec : nom, nombre de fichiers, date creation, taille totale
- [ ] Expansion d'un plan set : liste des fichiers avec nom, taille, pages, date upload
- [ ] Suppression de plan set (confirmation dialog)
- [ ] Breadcrumb : Mes affaires > [Nom affaire] > Plans
- [ ] `loading.tsx` et `error.tsx` pour la route
- [ ] `not-found.tsx` pour gerer affaire inexistante/non accessible
- [ ] Route dynamique : `params: Promise<{ projectId: string }>` + `await`
- [ ] Couverture Playwright : upload plan → verifier affichage → supprimer
- [ ] Les mutations UI (create/delete plan set) passent par Server Actions authentifiees
      et validees (`server-auth-actions`)

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/affaires/[projectId]/plans/page.tsx`
  - `src/app/dashboard/affaires/[projectId]/plans/loading.tsx`
  - `src/app/dashboard/affaires/[projectId]/plans/error.tsx`
  - `src/app/dashboard/affaires/[projectId]/plans/not-found.tsx`
- Fichiers a modifier :
  - `src/components/takeoff/PlanCenter.tsx` — accepter `projectId | versionId`
  - `src/components/takeoff/PlanSetFormModal.tsx` — accepter `projectId`
  - `src/app/dashboard/affaires/[projectId]/plans/_actions/plan-sets.ts`
- Reutiliser :
  - `PlanCenter.tsx` — composant principal existant
  - `PlanFileUploadZone.tsx` — zone upload PDF existante
  - `PlanSetFormModal.tsx` — modal creation existante
  - `HubBreadcrumb.tsx` — breadcrumb reutilisable
- Dependances : V3-003, V3-005

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Faible | Elle passera plutot par le flux import (V3-013) que par la page plans dediee |
| Laurent (Senior) | **Fort** | Sa page de gestion fine — CRUD plan sets, organisation par lots (Archi/Structure/CVC) |
| Nadia (Conductrice) | Moyen | Verification completude des plans uploades par lot |

---

## V3-007 — Page Takeoff Jobs au niveau affaire

**Priorite:** P1 | **Effort:** L | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur, je veux lancer et suivre les extractions de metres depuis le hub
> de mon affaire, sans devoir naviguer vers une version specifique.

### Criteres d'acceptation

- [ ] Nouvelle route `/dashboard/affaires/[projectId]/takeoff`
- [ ] Liste tous les `takeoff_jobs` dont `estimate_version_id` appartient au projet,
      via requete `takeoff_jobs JOIN estimate_versions ON project_id = ?`
- [ ] Filtre optionnel par version (dropdown "Toutes les versions" / V1 / V2 / V3)
- [ ] Compteurs en haut : total jobs, en cours, termines, echoues
- [ ] Bouton "Lancer un metre" qui ouvre `TakeoffUploadForm` cible sur la derniere
      version draft du projet
- [ ] Chaque carte job affiche : version (V{N}), niveau (A/B/C), statut, nombre items,
      fichier source, date
- [ ] Clic sur un job navigue vers la review existante
      `/dashboard/estimates/[versionId]/takeoff/[jobId]/review`
- [ ] `loading.tsx` pour la route
- [ ] `error.tsx` pour la route
- [ ] Route dynamique : `params: Promise<{ projectId: string }>` + `await`
- [ ] Requete jobs evite le N+1 (agregats/compteurs en SQL) et est validee via `EXPLAIN`
- [ ] Pagination en curseur pour la liste jobs si volumetrie > 100
- [ ] Couverture Playwright : filtre par version + navigation review

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/affaires/[projectId]/takeoff/page.tsx`
  - `src/app/dashboard/affaires/[projectId]/takeoff/loading.tsx`
  - `src/app/dashboard/affaires/[projectId]/takeoff/error.tsx`
- Fichiers a modifier :
  - `src/components/takeoff/TakeoffJobList.tsx` — accepter `projectId` filter
  - `src/lib/takeoff/jobs.server.ts` — fetchers project-scoped
  - `src/app/api/takeoff/jobs/route.ts` — conserve polling/backward compat
- Reutiliser :
  - `TakeoffJobList.tsx` — composant liste existant
  - `TakeoffUploadForm.tsx` — formulaire upload existant
  - `TakeoffJobMonitor.tsx` — suivi temps reel existant
- Dependances : V3-005, V3-003

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Faible | Elle n'utilise pas directement la page jobs |
| Laurent (Senior) | **Fort** | Vue d'ensemble de tous ses metres par affaire, filtre par version, compteurs statuts |
| Nadia (Conductrice) | **Fort** | Savoir quels lots sont metres, echoues, en cours — supervision sans entrer dans le detail |

---

## V3-008 — Sidebar nav : takeoff affaire-centric

**Priorite:** P1 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux que le lien "Metres plans" dans la sidebar me dirige
> vers le hub metre de mon affaire en cours, afin de garder un workflow centre sur l'affaire.

### Criteres d'acceptation

- [ ] Quand `TAKEOFF_MODULE_ENABLED` est actif, le lien "Metres plans" :
      - Si l'utilisateur a une affaire en contexte (derniere visitee, stockee localStorage),
        navigue vers `/dashboard/affaires/[projectId]/takeoff`
      - Sinon, navigue vers `/dashboard/affaires` (liste des affaires)
- [ ] La page standalone `/dashboard/takeoff` affiche un bandeau
      "Acces depuis le hub affaire recommande" avec lien vers `/dashboard/affaires`
- [ ] Les anciennes routes `/dashboard/estimates/[versionId]/takeoff/*` restent
      fonctionnelles (backward compat) avec un bandeau similaire
- [ ] Le lien nav est mis a jour dans `build-nav-groups.tsx`
- [ ] La cle localStorage "derniere affaire" est versionnee (`client-localstorage-schema`)
- [ ] Rendu sans hydration mismatch : fallback deterministic cote serveur,
      upgrade client apres mount

### Notes techniques

- Fichiers a modifier :
  - `src/lib/navigation/build-nav-groups.tsx` — logique du lien takeoff
  - `src/app/dashboard/takeoff/page.tsx` — bandeau deprecation
- Reutiliser :
  - Pattern localStorage pour "derniere affaire visitee"
    (similaire a `useColumnVisibility`)
  - Listener global unique pour navigation clavier (`client-event-listeners`) si ajoute
- Dependances : V3-007

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Moyen | Navigation simplifiee vers le metre depuis la sidebar |
| Laurent (Senior) | Moyen | Acces direct au metre de son affaire en cours, plus de detour par `/dashboard/takeoff` |
| Nadia (Conductrice) | Moyen | Qualite de vie — pas de valeur metier directe mais navigation coherente |
