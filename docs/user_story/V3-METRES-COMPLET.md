# V3 — Track Takeoff / Metres — Documentation Complete

> Ce fichier consolide la totalite de la documentation V3 (metres, plans, takeoff IA) pour analyse externe.
> Fichiers sources : `docs/user_story/v3/` (6 fichiers, ~1660 lignes)

---

# PARTIE 1 — Vue d'ensemble V3

---

# User Stories v3 — TIMAX

## Contexte

La V3 comporte 2 tracks independants qui peuvent etre developpes en parallele :

| Track | Objectif | Epics | Stories |
|-------|----------|-------|---------|
| **Takeoff / Metre** | Integrer le module metre (IA Gemini) dans le flow affaire-centric | V3-E01 a E03 | 14 stories |
| **Approbation / Direction** | Workflow d'approbation, role director, portail client | V3-E04+ | A definir |

Les 2 tracks ne partagent **aucune table, route ou composant** — ils peuvent etre developpes
par des equipes differentes sans conflit.

### Prerequis V2

La V3 presuppose que les features V2 suivantes sont livrees :
- UX2-005 : Page liste affaires (`/dashboard/affaires`)
- UX2-006 : Hub affaire (`/dashboard/affaires/[projectId]`)
- UX2-009 : UnifiedImportFlow (flux import unifie)
- UX2-001 : Mode UI Simplifie/Expert (`useUiMode()`)

### Baseline technique V3

- Framework: `next@16.x` (App Router) + `react@19`
- Tests unitaires/integration: **Vitest**
- Tests e2e parcours critiques: **Playwright**

---

## Track 1 : Takeoff / Metre

### Probleme

Le module takeoff est **version-scoped** : `plan_sets` et `takeoff_jobs` sont rattaches a
`estimate_version_id`. Dans le workflow BTP reel :
- Les plans PDF appartiennent au **projet** (affaire), pas a une version
- Le chiffreur recoit les plans UNE FOIS et les reutilise sur V1, V2, V3
- Le metre est le chainon entre "ce que le client demande" (DPGF) et "ce que je mesure"

### Solution

Migrer `plan_sets` vers un scope projet, surfacer le takeoff dans le hub affaire, et creer
un pont DPGF ↔ Takeoff pour comparer quantites client vs quantites mesurees.

### Flow cible

```
1. Reception DPGF + plans du client
2. Import DPGF dans affaire (V2)
3. Upload plans PDF dans l'affaire (V3)          ← V3-006
4. Extraction IA des quantites (takeoff)          ← V3-007, V3-009
5. Comparaison DPGF vs Takeoff                    ← V3-010
6. Validation / ajustement dans l'editeur
7. Chiffrage (prix unitaires, marge)
8. Soumission pour envoi
```

---

## Index des epics — Track Takeoff

| Code | Nom | Priorite | Stories | Fichier |
|------|-----|----------|---------|---------|
| V3-E01 | Plans Project-Scoped | P0 | V3-001 a 004 | [V3-E01-plans-project-scope.md](./V3-E01-plans-project-scope.md) |
| V3-E02 | Hub Plans & Metres | P0-P1 | V3-005 a 008 | [V3-E02-hub-plans-metres.md](./V3-E02-hub-plans-metres.md) |
| V3-E03 | Workflow Metre Bridge | P1-P2 | V3-009 a 014 | [V3-E03-workflow-metre-bridge.md](./V3-E03-workflow-metre-bridge.md) |

**Total Track Takeoff : 14 stories** (6 P0, 6 P1, 2 P2) | [Plan d'implementation](./IMPLEMENTATION_PLAN.md)

---

## Index des epics — Track Approbation (placeholder)

| Code | Nom | Priorite | Stories | Fichier |
|------|-----|----------|---------|---------|
| V3-E04 | Role Director & Permissions | P0 | A definir | — |
| V3-E05 | Workflow Approbation | P0 | A definir | — |
| V3-E06 | Dashboard Direction | P1 | A definir | — |
| V3-E07 | Portail Client | P2 | A definir | — |

> Infrastructure deja construite : `estimate_rules`, `estimate_approvals`, `rules-engine.ts`,
> `gating.ts`, `/api/estimates/[versionId]/approve`. Stories a rediger.

---

## Etat d'avancement — Track Takeoff

| Story | Titre | Epic | Priorite | Effort | Couches | Etat |
|-------|-------|------|----------|--------|---------|------|
| V3-001 | Ajout project_id plan_sets | E01 | P0 | M | DB | A faire |
| V3-002 | RLS project-scope | E01 | P0 | M | DB | A faire |
| V3-003 | Data access project-scoped | E01 | P0 | M | Back | A faire |
| V3-004 | Backfill plan_sets | E01 | P0 | S | DB | A faire |
| V3-005 | Card Plans & Metres hub | E02 | P0 | M | Back Front | A faire |
| V3-006 | Page Plan Center affaire | E02 | P0 | L | Back Front | A faire |
| V3-007 | Page Takeoff Jobs affaire | E02 | P1 | L | Back Front | A faire |
| V3-008 | Sidebar nav affaire-centric | E02 | P1 | S | Front | A faire |
| V3-009 | Action rapide metre | E03 | P1 | S | Front | Clos |
| V3-010 | Comparaison DPGF vs Takeoff | E03 | P1 | L | Back Front | A faire |
| V3-011 | Carry-over versions | E03 | P1 | M | DB Back | A faire |
| V3-012 | UX Junior/Senior review | E03 | P1 | M | Front | A faire |
| V3-013 | Plans dans flow import | E03 | P2 | M | Front | A faire |
| V3-014 | Auto-trigger metre | E03 | P2 | M | Back Front | Clos |

---

## Totaux — Track Takeoff

- **Par effort :** 3 Small, 7 Medium, 4 Large
- **Par priorite :** 6 P0, 6 P1, 2 P2
- **Par couche :**
  - `[DB]` 5 stories — V3-001, 002, 004, 011 + index dans 001
  - `[Back]` 7 stories — V3-003, 005, 006, 007, 010, 011, 014
  - `[Front]` 10 stories — toutes sauf V3-001, 002, 003, 004

---

## Graphe de dependances

```
V3-001 (DB: project_id)
  ├── V3-004 (DB: backfill)
  └── V3-002 (DB: RLS)
        └── V3-003 (Back: data layer)
              ├── V3-005 (Hub: card plans)
              │     ├── V3-006 (Page: Plan Center)
              │     │     ├── V3-009 (Action: lancer metre)
              │     │     ├── V3-013 (Import: etape plans) [P2]
              │     │     │     └── V3-014 (Auto-trigger) [P2]
              │     │     └──────────────────────┐
              │     └── V3-007 (Page: Jobs)      │
              │           ├── V3-008 (Nav)       │
              │           ├── V3-010 (Compare DPGF)
              │           └── V3-012 (UX Junior/Senior)
              └── V3-011 (Carry-over versions)
```

**Chemin critique** : `V3-001 → V3-002 → V3-003 → V3-005 → V3-006`

---

## Coexistence des 2 tracks

| Aspect | Track Approbation | Track Takeoff |
|--------|-------------------|---------------|
| Tables DB | `estimate_approvals`, `profiles` (role director) | `plan_sets` (modif), `takeoff_version_links` (new) |
| Routes API | `/api/estimates/*/approve` | `/api/takeoff/*` |
| Hub affaire | Badge/section "Approbation" | Section "Plans & Metres" |
| Feature flags | `APPROVAL_WORKFLOW_ENABLED` | `TAKEOFF_MODULE_ENABLED` |
| Conflit | Aucun | Aucun |

---

## Strategie de migration plan_sets

1. **Phase 1** (V3-001) : Ajout `project_id` nullable → zero impact existant
2. **Phase 2** (V3-004) : Backfill depuis `estimate_versions.project_id` → NOT NULL
3. **Phase 3** (V3-003) : APIs dual-mode (acceptent `project_id` OU `estimate_version_id`)
4. **Phase 4** (V3-005/006) : Nouvelles pages utilisent `project_id` exclusivement
5. **V4 (futur)** : Drop `estimate_version_id` de `plan_sets`

Aucune suppression de donnees. Aucun changement de paths storage. Backward compat totale.

---

## Standards techniques

Les standards V2 s'appliquent (cf. [V2 README](../v2/README.md#standards-techniques-obligatoires-v2)),
avec les complements V3 suivants :

- Next.js (`next-best-practices`) :
  - Reads internes via Server Components / `*.server.ts`
  - Mutations UI via Server Actions (`"use server"`) avec auth + validation
  - `route.ts` reserve aux uploads binaires, webhooks, compat API externe
  - Routes dynamiques en `params: Promise<...>` + `await`
  - `loading.tsx` / `error.tsx` / `not-found.tsx` sur nouveaux segments metier
  - Next 16: nouveau code en `proxy.ts` / `proxyConfig` (legacy `middleware.ts` temporaire)
- Supabase/Postgres (`supabase-postgres-best-practices`) :
  - Index sur toutes les FK + index composites alignes aux filtres reels (`tenant_id` en prefixe)
  - RLS performante (`(select auth.uid())`, predicates indexables, `EXPLAIN` obligatoire sur P0/P1)
  - Migrations idempotentes (DO block + `pg_constraint`/`pg_attribute`), pas de SQL fragile
  - Ecritures bulk (batch insert / upsert) pour imports et creation jobs multiples
  - Transactions courtes pour limiter contention/locks
- React/Next perf (`vercel-react-best-practices`) :
  - `async-parallel`, `async-suspense-boundaries`
  - `bundle-dynamic-imports`, `bundle-conditional`
  - `server-auth-actions`, `server-cache-react`, `server-serialization`
  - `rerender-memo`, `rerender-derived-state-no-effect`, `rerender-functional-setstate`, `rerender-transitions`
  - `client-event-listeners`, `client-passive-event-listeners`, `client-localstorage-schema`

### Definition of done technique (minimum)

- Stories P0/P1: plan de requete valide (`EXPLAIN`) sur requetes critiques
- Stories UI P0/P1: au moins 1 verification perf explicite (waterfall, bundle ou rerender)
- Tests obligatoires avant merge :
  - `npm test` (Vitest)
  - `npm run e2e:rls` (RLS sensible)
  - `npm run e2e:pw:critical` (parcours UX critiques)


---

# PARTIE 2 — Analyse Personas

---

# Analyse Persona V3 — Takeoff / Metre

> 3 personas, 3 parcours, 14 stories analysees sous l'angle utilisateur.

---

## Persona 1 — Marie, Chiffreuse Junior

### Profil

| | |
|---|---|
| **Role** | Chiffreuse depuis 8 mois, sortie d'ecole |
| **Mode UI** | `simplified` (par defaut) |
| **Contexte** | PME batiment, 15 salaries. Marie traite 3-4 affaires par mois. |
| **Outil avant TIMAX** | Excel + plans papier + surligneur |
| **Rapport au digital** | A l'aise smartphone, moins avec les outils metier complexes |

### Objectifs

- Repondre aux appels d'offres sans oublier de postes
- Avoir confiance dans les quantites avant de soumettre
- Ne pas se tromper de fichier entre V1 et V2

### Frustrations actuelles (avant V3)

- Le module takeoff est cache dans `/dashboard/takeoff` — Marie ne sait pas qu'il existe
- La page review affiche une table dense avec 3 onglets, des filtres, des strategies de merge
  qu'elle ne comprend pas
- Pas de lien entre le DPGF qu'elle a importe et les quantites extraites par l'IA
- Elle uploade ses plans dans une version, puis quand elle cree V2, ses plans "disparaissent"

### Parcours V3 de Marie

```
                    ┌─────────────────────────────────────────────────────┐
                    │  1. Marie ouvre son affaire "Ecole Jean Jaures"    │
                    │     → Hub affaire avec PlansMetresCard visible     │
                    │     (V3-005 : card resume plans + dernier job)     │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  2. Import DPGF + Upload plans en meme temps       │
                    │     → Etape optionnelle "Ajouter vos plans" dans   │
                    │       le flux d'import (V3-013)                    │
                    │     → Drop 3 PDF, compteur "3 fichiers, 42 Mo"    │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  3. Prompt auto-trigger                            │
                    │     → "Lancer l'extraction automatique ?" → Oui   │
                    │     (V3-014 : Level A auto, fire-and-forget)       │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  4. Review simplifiee                              │
                    │     → Cartes une par une : description + quantite  │
                    │     → 2 boutons : Accepter / Rejeter              │
                    │     → Barre progression "12/18 items revus"       │
                    │     (V3-012 : vue junior, mode simplified)        │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  5. Application automatique                        │
                    │     → Strategie fixe "append" (pas de choix)      │
                    │     → TakeoffApplyWizard (meme wizard, simplifie) │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  6. Nouvelle version V2                            │
                    │     → "Reprendre les metres de V1 ?" → Oui       │
                    │     → Les plans sont deja la (project-scope)      │
                    │     (V3-001/004 : plans project-scoped)           │
                    │     (V3-011 : carry-over takeoff jobs)            │
                    └─────────────────────────────────────────────────────┘
```

### Stories V3 qui impactent Marie

| Story | Impact | Valeur percue |
|-------|--------|---------------|
| V3-005 | **Fort** — decouvre le takeoff depuis son hub quotidien | Visibilite (elle ne savait pas que ca existait) |
| V3-012 | **Critique** — la review simplifiee est son interface principale | Confiance (elle comprend ce qu'elle valide) |
| V3-013 | **Fort** — upload plans dans le flux naturel d'import | Fluidite (pas de detour vers une autre page) |
| V3-014 | **Moyen** — extraction auto apres upload | Gain de temps (mais elle ne sait pas ce qu'est "Level A") |
| V3-001/004 | **Indirect** — plans partages entre versions | Plus de "mes plans ont disparu" |
| V3-011 | **Moyen** — carry-over metres entre versions | Pas besoin de tout refaire sur V2 |
| V3-009 | **Faible** — action rapide depuis le hub | Elle preferera le flux import integre (V3-013) |
| V3-010 | **Nul** — comparaison DPGF vs Takeoff | Reserve au mode expert, pas visible pour elle |

### Risques / Points d'attention

- **Le prompt auto-trigger (V3-014) doit etre pedagogique** — Marie ne sait pas ce qu'est
  un "Level A". Le wording doit etre "Voulez-vous que l'IA analyse vos plans automatiquement ?"
  et non "Lancer extraction Level A ?"
- **La review simplifiee (V3-012) doit afficher le contexte** — une carte avec juste
  "Cloisons 48/72 — 125 m2" ne suffit pas ; il faut montrer la page du PDF source pour
  que Marie puisse verifier visuellement
- **Le carry-over (V3-011) doit etre propose, pas impose** — Marie ne comprend pas
  ce que signifie "reprendre les metres" si on ne lui explique pas

---

## Persona 2 — Laurent, Chiffreur Senior

### Profil

| | |
|---|---|
| **Role** | Chiffreur depuis 12 ans, responsable chiffrage |
| **Mode UI** | `expert` |
| **Contexte** | ETI batiment, 120 salaries. Laurent traite 8-10 affaires simultanement. |
| **Outil avant TIMAX** | Logiciel metier legacy (Batigest/Onaya) + Excel avance |
| **Rapport au digital** | Power user, raccourcis clavier, veut aller vite |

### Objectifs

- Gagner du temps sur le chiffrage en automatisant les metres
- Comparer ses metres IA avec les quantites du DPGF client pour detecter les oublis
- Maitriser la qualite : pouvoir modifier, exclure, re-mesurer ligne par ligne
- Reutiliser ses metres quand le client demande une V2 avec variantes

### Frustrations actuelles (avant V3)

- Le takeoff est accessible mais deconnecte de l'affaire — il faut naviguer vers
  `/dashboard/takeoff`, retrouver la bonne version, lancer un job
- Pas de comparaison DPGF ↔ Takeoff : Laurent doit ouvrir le DPGF dans un onglet,
  la review takeoff dans un autre, et comparer a l'oeil
- Les plans sont version-scoped : quand il cree V2, il doit re-uploader les memes PDF
- L'action "Lancer un metre" n'est pas accessible depuis le hub

### Parcours V3 de Laurent

```
                    ┌─────────────────────────────────────────────────────┐
                    │  1. Laurent ouvre l'affaire "Clinique Pasteur"     │
                    │     → Hub avec PlansMetresCard : "3 jeux, 12 PDF, │
                    │       dernier job: termine, 47 items"             │
                    │     (V3-005 : resume instantane)                  │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  2. Gestion fine des plans                         │
                    │     → Clic "Voir les plans" → Page Plan Center    │
                    │     → 3 plan sets : Archi, Structure, CVC         │
                    │     → Upload nouveau PDF dans set "Structure"     │
                    │     (V3-006 : page dediee, CRUD plan sets)        │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  3. Lancer un metre depuis le hub                  │
                    │     → Bouton "Lancer un metre" (QuickActionsCard) │
                    │     → TakeoffUploadForm pre-configure :           │
                    │       projectId auto, derniere version draft       │
                    │     → Choix Level B (tables structurees)          │
                    │     (V3-009 : action rapide)                      │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  4. Suivi des jobs                                 │
                    │     → Redirect vers page Takeoff Jobs affaire     │
                    │     → Filtre "V3 uniquement" : 2 jobs en cours    │
                    │     → Compteurs : 5 total, 3 termines, 2 en cours │
                    │     (V3-007 : page jobs cross-versions)           │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  5. Review complete (mode expert)                  │
                    │     → Table complete avec toutes les colonnes      │
                    │     → Inline edit : corriger une quantite          │
                    │     → Exclure avec raison : "doublon avec lot 3"  │
                    │     → Onglet "Comparaison DPGF" :                 │
                    │       cote-a-cote, delta %, codes couleur          │
                    │     (V3-012 : vue expert complete)                │
                    │     (V3-010 : comparaison DPGF vs Takeoff)        │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  6. Application avec strategie                     │
                    │     → Choix "merge" (fusionner avec existant)     │
                    │     → Override par item : "Cloisons" → forcer     │
                    │       la quantite DPGF au lieu du takeoff         │
                    │     → TakeoffApplyWizard complet                  │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  7. Nouvelle version V2 (variante sans lot CVC)   │
                    │     → "Reprendre metres de V1" → oui             │
                    │     → Plans deja partages (project-scope)         │
                    │     → Badge "(from V1)" sur les items repris      │
                    │     → Re-lance un metre Level B sur lot modifie   │
                    │     (V3-011 : carry-over + TakeoffSourceBadge)    │
                    └─────────────────────────────────────────────────────┘
```

### Stories V3 qui impactent Laurent

| Story | Impact | Valeur percue |
|-------|--------|---------------|
| V3-010 | **Critique** — comparaison DPGF vs Takeoff | Son besoin #1 : detecter oublis et ecarts |
| V3-006 | **Fort** — gestion plans dans l'affaire | Plus besoin de naviguer vers `/dashboard/takeoff` |
| V3-007 | **Fort** — suivi jobs cross-versions | Vue d'ensemble de tous ses metres par affaire |
| V3-009 | **Fort** — lancer metre en 1 clic | Gain de temps quotidien |
| V3-011 | **Fort** — carry-over metres entre versions | Ne pas refaire les metres quand le client revient |
| V3-001/004 | **Fort** — plans project-scoped | Plus de re-upload des memes PDF |
| V3-005 | **Moyen** — card resume dans le hub | Vue rapide, mais il ira vite vers la page complete |
| V3-012 | **Faible** — il est en mode expert, pas concerne par la vue simplifiee | Le toggle "Vue simplifiee" peut servir pour montrer a un client |
| V3-013 | **Faible** — upload dans import flow | Il prefere gerer ses plans sets manuellement (V3-006) |

### Risques / Points d'attention

- **La comparaison DPGF (V3-010) est le feature decisive** — si l'algorithme de matching
  est mediocre (descriptions DPGF != descriptions takeoff), Laurent perdra confiance et
  reviendra a sa methode manuelle. Le lien manuel (drag/select) est crucial.
- **Le carry-over (V3-011) doit preserver les exclusions et modifications** — si Laurent
  a exclu un item en V1 et le retrouve en V2 sans l'exclusion, c'est une regression
- **Le filtre par version (V3-007) doit etre rapide** — Laurent a potentiellement 20+ jobs
  sur une affaire complexe avec 5 versions
- **Le merge strategy dans l'apply wizard doit respecter les overrides** — s'il a force
  une quantite, une re-application ne doit pas l'ecraser

---

## Persona 3 — Nadia, Conductrice de travaux

### Profil

| | |
|---|---|
| **Role** | Conductrice de travaux, supervise 4 chiffreurs |
| **Mode UI** | `expert` (mais utilise peu les features avancees) |
| **Contexte** | ETI batiment, meme entreprise que Laurent. Responsable de la validation. |
| **Outil avant TIMAX** | Recoit les devis par email, annote en PDF, valide par telephone |
| **Rapport au digital** | Correcte, prefere les vues synthese aux interfaces denses |

### Objectifs

- Verifier que les quantites sont coherentes avant soumission
- Identifier les ecarts significatifs entre DPGF client et metres reels
- S'assurer que tous les lots ont ete metres (pas d'oubli)
- Avoir une vue d'ensemble sans entrer dans le detail de chaque ligne

### Frustrations actuelles (avant V3)

- Pas de vue "resume metre" — elle doit ouvrir chaque job takeoff individuellement
- Pas de comparaison DPGF ↔ Takeoff — elle demande a Laurent de lui faire un Excel
- Pas de visibilite sur l'etat d'avancement des metres depuis le hub affaire
- Elle ne sait pas quels plans ont ete uploades ni lesquels ont ete metres

### Parcours V3 de Nadia

```
                    ┌─────────────────────────────────────────────────────┐
                    │  1. Nadia ouvre l'affaire "Clinique Pasteur"       │
                    │     → PlansMetresCard : "3 jeux, dernier job      │
                    │       termine, 47 items extraits"                 │
                    │     → Elle sait immediatement ou en est le metre  │
                    │     (V3-005 : resume dans le hub)                 │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  2. Vue d'ensemble des jobs                        │
                    │     → Page Takeoff Jobs : tous les jobs du projet │
                    │     → Compteurs : 5 termines, 0 en cours,         │
                    │       1 echoue (lot CVC)                          │
                    │     → Filtre par version pour voir l'evolution    │
                    │     (V3-007 : suivi jobs)                         │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  3. Comparaison DPGF vs Takeoff (le coeur)        │
                    │     → Onglet "Comparaison DPGF" dans la review    │
                    │     → Resume : 38 matches, 5 ecarts >20%,        │
                    │       4 absents du takeoff                        │
                    │     → Scan rapide des lignes rouges :             │
                    │       "Faux plafond: DPGF 800m2, Takeoff 520m2"  │
                    │     → Note mentale : demander a Laurent de        │
                    │       verifier le lot faux plafond                │
                    │     (V3-010 : vue comparaison)                    │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  4. Verification plans                             │
                    │     → Page Plan Center : verifie que tous les     │
                    │       lots ont des plans uploades                 │
                    │     → Archi: 4 PDF ✓, Structure: 3 PDF ✓,        │
                    │       CVC: 0 PDF ✗ → "manque les plans CVC"      │
                    │     (V3-006 : page plans affaire)                 │
                    └────────────────────┬────────────────────────────────┘
                                         │
                    ┌────────────────────▼────────────────────────────────┐
                    │  5. Validation inter-versions                      │
                    │     → Ouvre V2 : voit badge "(from V1)" sur les   │
                    │       items repris → sait que c'est du carry-over │
                    │     → Verifie que les nouvelles quantites du lot  │
                    │       modifie sont bien issues d'un job V2        │
                    │     (V3-011 : tracabilite carry-over)             │
                    └─────────────────────────────────────────────────────┘
```

### Stories V3 qui impactent Nadia

| Story | Impact | Valeur percue |
|-------|--------|---------------|
| V3-005 | **Critique** — resume metre dans le hub | Sa vue principale, pas besoin d'aller plus loin 80% du temps |
| V3-010 | **Critique** — comparaison DPGF vs Takeoff | Son outil de validation principal |
| V3-007 | **Fort** — vue d'ensemble jobs | Savoir quels lots sont metres, echoues, en cours |
| V3-006 | **Moyen** — page plans | Verification completude des plans uploades |
| V3-011 | **Moyen** — carry-over tracabilite | Comprendre l'historique des metres entre versions |
| V3-001/004 | **Indirect** — plans project-scoped | Plus de confusion "ou sont les plans de V1 ?" |
| V3-009 | **Faible** — lancer un metre | Elle ne lance pas de metre elle-meme |
| V3-012 | **Nul** — vue junior/senior | Elle n'est pas dans le parcours review/apply |
| V3-013/014 | **Nul** — import/auto-trigger | Elle ne fait pas l'import DPGF |

### Risques / Points d'attention

- **La card PlansMetresCard (V3-005) est son point d'entree principal** — elle doit
  afficher assez d'info pour qu'elle n'ait pas besoin de naviguer plus loin :
  nombre de jeux, nombre de fichiers, statut dernier job, nombre d'items extraits
- **La comparaison DPGF (V3-010) doit permettre un scan rapide** — Nadia ne va pas
  examiner 200 lignes ; elle a besoin du resume en haut (matches, ecarts, absents)
  et ne regarde que les lignes rouges
- **L'export CSV (V3-010, optionnel P2) serait tres utile** pour envoyer le rapport
  de comparaison par email au maitre d'oeuvre
- **Nadia est le persona qui justifie le plus V3-010** — sans la comparaison, elle
  continue a demander des Excel a Laurent

---

## Matrice d'impact croisee

| Story | Marie (Junior) | Laurent (Senior) | Nadia (Conductrice) |
|-------|:--------------:|:-----------------:|:-------------------:|
| V3-001 | indirect | **fort** | indirect |
| V3-002 | — | — | — |
| V3-003 | — | — | — |
| V3-004 | indirect | **fort** | indirect |
| V3-005 | **fort** | moyen | **critique** |
| V3-006 | faible | **fort** | moyen |
| V3-007 | faible | **fort** | **fort** |
| V3-008 | moyen | moyen | moyen |
| V3-009 | faible | **fort** | — |
| V3-010 | — | **critique** | **critique** |
| V3-011 | moyen | **fort** | moyen |
| V3-012 | **critique** | faible | — |
| V3-013 | **fort** | faible | — |
| V3-014 | moyen | — | — |

### Stories a plus forte valeur multi-persona

1. **V3-005 (PlansMetresCard)** — impacte les 3 personas, point d'entree universel
2. **V3-010 (Comparaison DPGF)** — critique pour Laurent ET Nadia (validation + detection ecarts)
3. **V3-012 (UX Junior/Senior)** — critique pour Marie (seul moyen d'utiliser le takeoff)
4. **V3-007 (Page Jobs)** — fort pour Laurent + Nadia (suivi et vue d'ensemble)

### Stories a faible portee (mais necessaires)

- **V3-001/002/003/004** — infrastructure invisible mais fondation de tout le reste
- **V3-008 (sidebar)** — qualite de vie, pas de valeur metier directe
- **V3-014 (auto-trigger)** — P2, convenance pour Marie uniquement

---

## Recommandations UX par persona

### Pour Marie (Junior)

1. **Le wording doit etre metier, pas technique** — "Analyser vos plans" plutot que
   "Lancer extraction Level A". "Quantites detectees" plutot que "Items takeoff".
2. **La review simplifiee (V3-012) doit montrer le contexte PDF** — un thumbnail ou
   lien vers la page source du plan pour chaque item
3. **Les actions doivent etre binaires** — pas de choix entre append/replace/merge.
   Le systeme choisit pour elle.
4. **L'onboarding doit mentionner le takeoff** — quand Marie voit la PlansMetresCard
   pour la premiere fois, un tooltip "Nouveau : analysez vos plans avec l'IA"
   guiderait son adoption

### Pour Laurent (Senior)

1. **La comparaison DPGF (V3-010) doit etre accessible en 2 clics max** — depuis le hub,
   clic sur la card → dernier job → onglet comparaison
2. **Le matching algorithmique doit exposer son score** — Laurent veut comprendre
   POURQUOI le systeme a matche "Cloisons platre" avec "Doublage platre"
3. **Les overrides doivent persister** — si Laurent force une quantite, un carry-over
   ou une re-application ne doit pas l'ecraser silencieusement
4. **Le raccourci clavier devrait exister** — dans la command palette (UX2-018),
   "Lancer un metre" devrait etre une action accessible via Ctrl+K

### Pour Nadia (Conductrice)

1. **La PlansMetresCard (V3-005) doit etre auto-suffisante** — resume complet sans
   navigation supplementaire pour 80% de ses consultations
2. **Le resume comparaison doit etre exportable** — CSV ou PDF pour transmission
   au client/maitre d'oeuvre (renforcer la priorite du CSV export dans V3-010)
3. **Les ecarts significatifs doivent remonter dans le hub** — un badge "5 ecarts >20%"
   sur la PlansMetresCard eviterait a Nadia d'ouvrir la page comparaison
4. **Une vue "couverture metres" serait ideale** — quel pourcentage des postes DPGF
   ont ete metres ? (non prevu en V3, candidat V4)

---

## Heatmap priorite par persona

```
                    Marie         Laurent        Nadia
                   (Junior)      (Senior)    (Conductrice)
                 ─────────── ─────────────── ───────────────
  P0 DB/Back     ░░░░░░░░░░  ███████████░░  ░░░░░░░░░░░░░
  (V3-001→004)   invisible    fondation       invisible

  P0 Hub/Pages   ██████████  ██████████░░░  ████████████░░
  (V3-005→006)   decouverte   productivite   vue d'ensemble

  P1 Workflow    ████████░░  ████████████░  ████████████░░
  (V3-007→012)   review       comparaison    validation
                  simplifiee   DPGF           inter-versions

  P2 Import      ██████░░░░  ░░░░░░░░░░░░  ░░░░░░░░░░░░░
  (V3-013→014)   fluidite     pas concerne   pas concerne
```

> `█` = forte valeur pour le persona | `░` = faible ou nulle


---

# PARTIE 3 — Epic E01 : Plans Project Scope (fondation DB)

---

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


---

# PARTIE 4 — Epic E02 : Hub Plans & Metres (UI pages)

---

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


---

# PARTIE 5 — Epic E03 : Workflow Metre Bridge (integration chiffreur)

---

# V3-E03 — Workflow Integration : DPGF + Metre Bridge

> Track: Takeoff / Metre | Priorite: P1-P2 | Statut: A faire

## Objectif

Integrer le metre dans le flow naturel du chiffreur : Import DPGF → Upload plans → Extraction
IA → Comparaison quantites DPGF vs Takeoff → Validation dans l'editeur. Le metre devient le
chainon entre "ce que le client demande" (DPGF) et "ce que je mesure" (takeoff des plans).

## Ce qui existe deja

- **`src/components/takeoff/TakeoffUploadForm.tsx`** : Formulaire upload PDF + lancement job
  takeoff. Accepte `versionId` et `level` (A/B/C).
- **`src/components/takeoff/TakeoffApplyWizard.tsx`** : Wizard d'application des resultats
  takeoff (strategies append/replace/merge, mapping engine, overrides par item).
- **`src/components/takeoff/TakeoffReviewPage.tsx`** : Page review complete avec table des
  items extraits, actions accept/reject, apply wizard.
- **`src/components/takeoff/TakeoffReviewTable.tsx`** : Table detaillee des items extraits
  avec colonnes: description, unite, quantite, confiance, source PDF.
- **`src/components/takeoff/TakeoffSourceBadge.tsx`** : Badge indiquant l'origine takeoff
  d'un `estimate_item` (lien vers le job source).
- **`src/lib/takeoff/diff.ts`** : Utilitaire `buildTakeoffDiff()` comparant items takeoff
  vs items existants (match par description, unite, calcul delta).
- **`src/components/affaires/UnifiedImportFlow.tsx`** : Flow import unifie
  Upload → Mapping → Preview → Confirmation.
- **`src/components/affaires/AffaireHub.tsx`** : Hub affaire avec `QuickActionsCard`
  (fonction locale).

---

## V3-009 — Action rapide "Lancer un metre"

**Priorite:** P1 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux lancer un metre directement depuis le hub de mon affaire,
> sans devoir naviguer manuellement vers la page plans puis le formulaire d'upload.

### Criteres d'acceptation

- [ ] Nouveau bouton "Lancer un metre" dans `QuickActionsCard` du hub affaire
- [ ] Le bouton ouvre `TakeoffUploadForm` dans un dialog/drawer, pre-configure avec :
      - `projectId` de l'affaire courante
      - `versionId` de la derniere version draft du projet (auto-resolve)
      - `level` par defaut : A (Basic)
- [ ] Si aucune version draft n'existe, message "Creez d'abord une version brouillon"
      avec lien vers la creation
- [ ] Apres lancement reussi, redirection vers la page takeoff jobs de l'affaire
      (`/dashboard/affaires/[projectId]/takeoff`)
- [ ] Le bouton n'apparait que si `TAKEOFF_MODULE_ENABLED` est actif
- [ ] Le bouton n'apparait que si au moins un plan set existe pour le projet
- [ ] La creation du job passe par Server Action authentifiee/validee (`server-auth-actions`)
- [ ] `redirect()` est appele hors `try/catch` (ou via `unstable_rethrow`)
- [ ] Couverture Playwright : launch job depuis hub + redirection

### Notes techniques

- Fichiers a modifier :
  - `src/components/affaires/AffaireHub.tsx` — ajouter bouton dans `QuickActionsCard`
  - `src/components/takeoff/TakeoffUploadForm.tsx` — accepter `projectId` prop optionnel,
    auto-resolve `versionId` depuis derniere version draft
- Reutiliser :
  - `TakeoffUploadForm.tsx` — formulaire existant
  - `useFeatureFlag('TAKEOFF_MODULE_ENABLED')` pour le gate
- Dependances : V3-005, V3-006

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Faible | Elle preferera le flux import integre (V3-013) |
| Laurent (Senior) | **Fort** | Lancer un metre en 1 clic depuis le hub — gain de temps quotidien |
| Nadia (Conductrice) | Nul | Elle ne lance pas de metre elle-meme |

---

## V3-010 — Vue comparaison DPGF vs Takeoff

**Priorite:** P1 | **Effort:** L | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur senior, je veux comparer les quantites de mon DPGF avec celles
> extraites par le metre, afin d'identifier rapidement les ecarts et ajuster mon chiffrage.

### Criteres d'acceptation

- [ ] Nouveau composant `TakeoffDpgfCompareView` affichant cote-a-cote :
      - Colonne gauche : ligne DPGF (designation, unite, quantite client)
      - Colonne droite : item takeoff (designation, unite, quantite mesuree)
      - Colonne delta : ecart absolu et pourcentage, code couleur
- [ ] Codes couleur :
      - Vert : ecart < 5% → match
      - Orange : ecart 5-20% → a verifier
      - Rouge : ecart > 20% → ecart significatif
      - Gris : absent d'un cote (pas de correspondance)
- [ ] Matching automatique base sur `buildTakeoffDiff()` de `diff.ts`
      (description + unite similaire)
- [ ] Possibilite de lier manuellement une ligne DPGF a un item takeoff
      (drag-drop ou select dropdown)
- [ ] Resume en haut : nombre de matches, ecarts, absents DPGF, absents takeoff
- [ ] Accessible comme onglet dans la page review takeoff
      (`/dashboard/affaires/[projectId]/takeoff/[jobId]/review`)
- [ ] Fetcher serveur `fetchDpgfTakeoffComparison(jobId, versionId)` retournant
      les lignes matchees et non-matchees
- [ ] Export CSV de la comparaison (optionnel, P2)
- [ ] Chargements independants (lignes DPGF, items takeoff, metadata job) en `Promise.all`
      (`async-parallel`)
- [ ] Le tableau de comparaison est pagine (cursor) ou virtualise pour gros volumes
- [ ] Tests Vitest sur algorithme de matching + Playwright sur le flux review/compare

### Notes techniques

- Fichiers a creer :
  - `src/components/takeoff/TakeoffDpgfCompareView.tsx`
  - `src/lib/takeoff/dpgf-compare.ts` — logique de comparaison enrichie
    (wraps `buildTakeoffDiff` avec metadata DPGF)
- Fichiers a modifier :
  - `src/components/takeoff/TakeoffReviewPage.tsx` — ajouter onglet "Comparaison DPGF"
  - `src/lib/takeoff/diff.ts` — etendre pour retourner le score de matching
- Reutiliser :
  - `buildTakeoffDiff()` — algorithme de diff existant
  - `TakeoffReviewTable.tsx` — pattern de table existant
  - `STATUS_BADGE_STYLES` — codes couleur existants
- Dependances : V3-007

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Nul | Reserve au mode expert, pas visible pour elle |
| Laurent (Senior) | **Critique** | Son besoin #1 — detecter oublis et ecarts entre DPGF client et metres reels |
| Nadia (Conductrice) | **Critique** | Son outil de validation principal — scan rapide des lignes rouges (ecarts >20%) |

> Story a plus forte valeur multi-persona : decisive pour la validation du chiffrage.

---

## V3-011 — Carry-over takeoff entre versions

**Priorite:** P1 | **Effort:** M | **Couches:** `[DB]` `[Back]`

### User Story

> En tant que chiffreur, je veux que les resultats de metres d'une version precedente
> soient accessibles dans ma nouvelle version, afin de ne pas relancer des extractions
> deja faites quand je cree V2 ou V3 du devis.

### Criteres d'acceptation

- [ ] Nouvelle table `takeoff_version_links` :
      ```sql
      CREATE TABLE takeoff_version_links (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        takeoff_job_id uuid NOT NULL REFERENCES takeoff_jobs(id) ON DELETE CASCADE,
        source_version_id uuid NOT NULL REFERENCES estimate_versions(id),
        target_version_id uuid NOT NULL REFERENCES estimate_versions(id),
        linked_at timestamptz NOT NULL DEFAULT now(),
        linked_by uuid REFERENCES auth.users(id),
        UNIQUE(takeoff_job_id, target_version_id)
      );
      ```
- [ ] RLS sur `takeoff_version_links` : meme tenant uniquement
- [ ] Index : `(tenant_id, target_version_id)`, `(tenant_id, source_version_id)`,
      `(takeoff_job_id)` (toutes FKs indexees)
- [ ] Lors de la creation d'une nouvelle version, option "Reprendre les metres de V{N}"
      qui cree les liens automatiquement
- [ ] `TakeoffSourceBadge` enrichi pour afficher "(from V{N})" quand le job provient
      d'une version anterieure via lien
- [ ] Les plans etant deja project-scope (V3-001), seuls les jobs ont besoin de liens
- [ ] Fetcher `fetchLinkedTakeoffJobs(versionId)` retourne les jobs du projet
      accessibles pour cette version (directs + linked)
- [ ] Policies RLS utilisent des predicates indexables avec wrappers `(select ...)`
      pour les fonctions auth
- [ ] Migration idempotente (DO block + verification contraintes/indexes)
- [ ] Requetes de lecture liees validees via `EXPLAIN`

### Notes techniques

- Fichiers a creer :
  - `supabase/migrations/YYYYMMDD_v3_011_takeoff_version_links.sql`
  - `src/lib/takeoff/version-links.ts` — CRUD liens
- Fichiers a modifier :
  - `src/components/takeoff/TakeoffSourceBadge.tsx` — afficher provenance version
  - `src/lib/takeoff/plans.ts` — fetcher linked jobs
- Reutiliser :
  - Pattern RLS tenant-scoped existant
  - `TakeoffSourceBadge.tsx` — badge existant a enrichir
- Dependances : V3-001, V3-003

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Moyen | Ses metres V1 sont repris dans V2 sans effort — pas besoin de tout refaire |
| Laurent (Senior) | **Fort** | Reutilise ses metres entre versions, badge "(from V1)" pour tracabilite |
| Nadia (Conductrice) | Moyen | Comprend l'historique des metres — sait ce qui vient de V1 vs V2 |

---

## V3-012 — UX Junior/Senior pour review takeoff

**Priorite:** P1 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur junior, je veux une vue simplifiee de la review takeoff qui me
> guide dans l'acceptation des resultats, sans etre submerge par les options avancees.

### Criteres d'acceptation

- [ ] **Mode Simplifie** (junior) :
      - Vue carte par item (pas de table) avec : description, quantite, unite, confiance
      - Actions par item : Accepter / Rejeter (2 boutons clairs)
      - Action globale : "Tout accepter" en haut de page
      - Strategie d'application fixee a "append" (pas de choix merge/replace)
      - Barre de progression : "{N}/{Total} items revus"
      - Les vues expertes (tables, comparaisons, DPGF) ne sont pas accessibles via URL seule
- [ ] **Mode Expert** (senior) :
      - `TakeoffReviewPage` existant complet (table, filtres, tri, strategies, overrides)
      - Acces a la vue comparaison DPGF (V3-010)
      - Edition inline des quantites avant application
- [ ] Le mode est determine par `useUiMode()` :
      - `isSimplified` → vue junior
      - `isExpert` → vue senior
- [ ] Toggle local a la page pour passer d'un mode a l'autre
      (icone "Vue avancee" / "Vue simplifiee")
- [ ] Le toggle de review ne modifie pas durablement le profil utilisateur
- [ ] Les deux modes utilisent le meme `TakeoffApplyWizard` en fin de parcours
- [ ] Le wizard suit la vue effectivement affichee :
      - vue simplifiee → `append` impose
      - vue experte → strategies completes disponibles
- [ ] La vue expert lourde est chargee en `next/dynamic` quand necessaire
      (`bundle-dynamic-imports`)
- [ ] L'action bulk "Tout accepter" utilise `startTransition`
      pour maintenir la fluidite (`rerender-transitions`)
- [ ] Couverture Playwright : parcours junior et expert

### Notes techniques

- Fichiers a creer :
  - `src/components/takeoff/TakeoffReviewSimplified.tsx` — vue carte junior
- Fichiers a modifier :
  - `src/components/takeoff/TakeoffReviewPage.tsx` — aiguillage mode simplifie/expert
- Reutiliser :
  - `useUiMode()` — hook persona existant (UX2-001)
  - `TakeoffApplyWizard.tsx` — wizard application existant
  - `TakeoffReviewTable.tsx` — table review existante (mode expert)
- Dependances : V3-007

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | **Critique** | La review simplifiee est son interface principale — sans elle, le takeoff est inaccessible |
| Laurent (Senior) | Faible | Il reste en mode expert ; le toggle "Vue simplifiee" peut servir pour montrer a un client |
| Nadia (Conductrice) | Nul | Elle n'est pas dans le parcours review/apply |

> Story cle pour l'adoption junior — gate l'accessibilite du module takeoff entier.

---

## V3-013 — Upload plans dans flow import DPGF

**Priorite:** P2 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux pouvoir ajouter mes plans PDF directement pendant
> l'import de mon DPGF, pour eviter de retourner a une autre page apres l'import.

### Criteres d'acceptation

- [ ] Nouvelle etape optionnelle dans `UnifiedImportFlow` :
      apres "Confirmation" et avant la sortie du flow
- [ ] Etape "Plans (optionnel)" affichant :
      - `PlanFileUploadZone` pour drop/upload de PDF
      - Message "Vous pourrez aussi ajouter vos plans plus tard depuis le hub"
      - Bouton "Passer cette etape" bien visible
- [ ] Les fichiers uploades sont ajoutes au jeu de plans par defaut du projet
      :
      - reutiliser le jeu "Plans import" s'il existe deja
      - sinon creer "Plans import"
- [ ] L'etape n'apparait que si `TAKEOFF_MODULE_ENABLED` est actif
- [ ] L'etape apparait quand l'import cree une nouvelle version exploitable pour
      l'affaire courante
- [ ] Compteur de fichiers uploades avec taille totale
- [ ] Transition fluide vers la fin du flow puis retour au hub affaire
- [ ] L'etape optionnelle est chargee conditionnellement (`bundle-conditional`)
      pour ne pas alourdir le first render du flow import
- [ ] Si un upload est en cours, on ne peut pas quitter l'etape de facon ambigue

### Notes techniques

- Fichiers a creer :
  - `src/components/affaires/PlansStep.tsx` — etape dediee plans
- Fichiers a modifier :
  - `src/components/affaires/UnifiedImportFlow.tsx` — ajouter etape plans
- Reutiliser :
  - `PlanFileUploadZone.tsx` — zone upload existante
  - `fetchPlanSetsForProject()` / `createPlanSet()` pour resoudre le jeu par defaut
- Dependances : V3-005, V3-006

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | **Fort** | Upload plans dans le flux naturel d'import — pas de detour vers une autre page |
| Laurent (Senior) | Faible | Il prefere gerer ses plan sets manuellement dans le Plan Center (V3-006) |
| Nadia (Conductrice) | Nul | Elle ne fait pas l'import DPGF |

---

## V3-014 — Auto-trigger metre apres upload

**Priorite:** P2 | **Effort:** M | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur, je veux que le systeme me propose de lancer automatiquement
> une extraction apres l'upload de plans, pour gagner du temps sur les metres simples.

### Criteres d'acceptation

- [ ] Apres upload de fichiers PDF (dans Plan Center ou dans le flow import) :
      - Prompt dialog : "Lancer l'extraction automatique des quantites ?"
      - Options : "Oui, lancer" / "Non, plus tard"
      - Checkbox "Se souvenir de mon choix" (persiste en localStorage)
- [ ] Si accepte, creation automatique d'un job takeoff Level A (Basic) pour chaque
      fichier uploade
- [ ] Nouveau feature flag `TAKEOFF_AUTO_TRIGGER_ENABLED` (desactive par defaut)
      — gate le prompt auto-trigger
- [ ] Le flag `TAKEOFF_MODULE_ENABLED` doit aussi etre actif (double gate)
- [ ] Les jobs crees sont visibles dans la page takeoff jobs de l'affaire
- [ ] Notification toast "Extraction lancee pour {N} fichier(s)" avec lien vers la
      page takeoff jobs
- [ ] Si le preference "Se souvenir" est active, skip le dialog et lance directement
      (ou skip directement selon le dernier choix)
- [ ] Creation multi-jobs en batch insert (pas une requete par fichier)
- [ ] Preference locale stockee avec schema versionne (`client-localstorage-schema`)
- [ ] Callbacks de queue/toasts bases sur `setState` fonctionnel
      (`rerender-functional-setstate`)
- [ ] Couverture Vitest (creation batch) + Playwright (prompt + auto-trigger)

### Notes techniques

- Fichiers a modifier :
  - `src/components/takeoff/PlanFileUploadZone.tsx` — callback post-upload
    pour trigger le prompt
  - `src/app/api/takeoff/jobs/route.ts` — creation batch pour compat API/polling
  - `src/app/dashboard/affaires/[projectId]/takeoff/_actions/jobs.ts` — Server Action UI
- Fichiers a creer :
  - `src/components/takeoff/AutoTriggerPrompt.tsx` — dialog de confirmation
- Reutiliser :
  - `TakeoffUploadForm.tsx` — logique de creation de job existante
  - Pattern localStorage pour preferences (similaire a `useColumnVisibility`)
  - `useFeatureFlag()` pour double gate
- Dependances : V3-006, V3-013

### Impact persona

| Persona | Impact | Valeur |
|---------|--------|--------|
| Marie (Junior) | Moyen | Extraction auto apres upload — gain de temps, mais doit etre pedagogique ("Analyser vos plans" pas "Level A") |
| Laurent (Senior) | Nul | Il prefere controler le niveau et le moment du lancement |
| Nadia (Conductrice) | Nul | Pas dans son parcours |

> Story P2, convenance principalement junior. Le wording doit etre metier, pas technique.


---

# PARTIE 6 — Plan d'implementation (equipes, sprints, coordination)

---

# Plan d'implementation V3 — Track Takeoff / Metre

## Equipes


| Equipe             | Profil    | Focus principal                                           | Charge (pts) |
| ------------------ | --------- | --------------------------------------------------------- | ------------ |
| **FS** (Fullstack) | Fullstack | Fondation DB (E01), APIs, logique serveur lourde          | 14           |
| **FE** (Frontend)  | Frontend  | Pages UI, adaptation composants existants, workflow front | 14           |


> Points : S=1, M=2, L=3. Total : 28 points, 14 pts/equipe.

---

## Assignation par equipe

### FS — Fondation DB & Logique Serveur (7 stories, 14 pts)


| Story  | Titre                        | Epic                                     | Effort | Couches    | Description                                                                                                                                                               | Dependances    |
| ------ | ---------------------------- | ---------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| V3-001 | Ajout `project_id` plan_sets | [E01](./V3-E01-plans-project-scope.md)   | M (2)  | DB         | Migration `project_id uuid` nullable FK → `estimate_projects`, index `(tenant_id, project_id, created_at DESC)`. Idempotente.                                             | Aucune         |
| V3-002 | RLS project-scope            | [E01](./V3-E01-plans-project-scope.md)   | M (2)  | DB         | Fonction `can_access_takeoff_project()`, policies RLS `plan_sets`/`plan_files` OR logique (`project_id` OU `estimate_version_id`). Predicates indexables.                 | V3-001         |
| V3-003 | API routes project-scoped    | [E01](./V3-E01-plans-project-scope.md)   | M (2)  | Back       | Endpoints plan-sets dual-mode (`project_id` ou `estimate_version_id`). Fetcher `fetchPlanSetsForProject()`. Schema Zod dual. Backward compat.                             | V3-002         |
| V3-004 | Backfill plan_sets           | [E01](./V3-E01-plans-project-scope.md)   | S (1)  | DB         | Backfill `project_id` depuis join `estimate_versions`, `project_id` → NOT NULL, `estimate_version_id` → nullable. Requete validation incluse.                             | V3-001         |
| V3-005 | Card Plans & Metres hub      | [E02](./V3-E02-hub-plans-metres.md)      | M (2)  | Back Front | Fetcher `fetchAffaireHubPlansSummary()` (plan_sets + takeoff_jobs en `Promise.all`). Composant `PlansMetresCard`. Gate par `TAKEOFF_MODULE_ENABLED`. Empty state.         | V3-003         |
| V3-010 | Comparaison DPGF vs Takeoff  | [E03](./V3-E03-workflow-metre-bridge.md) | L (3)  | Back Front | Fetcher `fetchDpgfTakeoffComparison()`. `TakeoffDpgfCompareView` cote-a-cote (qty DPGF vs takeoff, delta, codes couleur). Etend `buildTakeoffDiff()`. Onglet dans review. | V3-007         |
| V3-011 | Carry-over versions          | [E03](./V3-E03-workflow-metre-bridge.md) | M (2)  | DB Back    | Migration `takeoff_version_links`. RLS tenant-scoped. Fetcher `fetchLinkedTakeoffJobs()`. `TakeoffSourceBadge` enrichi "(from V{N})".                                     | V3-001, V3-003 |


### FE — Pages UI & Workflow Front (7 stories, 14 pts)


| Story  | Titre                           | Epic                                     | Effort | Couches    | Description                                                                                                                                                              | Dependances    |
| ------ | ------------------------------- | ---------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| V3-006 | Page Plan Center affaire        | [E02](./V3-E02-hub-plans-metres.md)      | L (3)  | Back Front | Route `/dashboard/affaires/[projectId]/plans`. Adapte `PlanCenter.tsx` pour `projectId`. CRUD plan sets + upload. `loading.tsx` + `error.tsx`. Breadcrumb. Playwright.   | V3-003, V3-005 |
| V3-007 | Page Takeoff Jobs affaire       | [E02](./V3-E02-hub-plans-metres.md)      | L (3)  | Back Front | Route `/dashboard/affaires/[projectId]/takeoff`. Join takeoff_jobs cross-versions. Filtre par version. Compteurs statuts. Adapte `TakeoffJobList`. `loading.tsx`.        | V3-005         |
| V3-008 | Sidebar nav affaire-centric     | [E02](./V3-E02-hub-plans-metres.md)      | S (1)  | Front      | Lien "Metres plans" → `/dashboard/affaires/[projectId]/takeoff` (derniere affaire en localStorage). Bandeau deprecation `/dashboard/takeoff`.                            | V3-007         |
| V3-009 | Action rapide "Lancer un metre" | [E03](./V3-E03-workflow-metre-bridge.md) | S (1)  | Front      | Bouton dans `QuickActionsCard` → `TakeoffUploadForm` pre-configure (projectId, derniere version draft, Level A). Gate flag + plan set existant.                          | V3-005, V3-006 |
| V3-012 | UX Junior/Senior review         | [E03](./V3-E03-workflow-metre-bridge.md) | M (2)  | Front      | Vue simplifiee junior (cartes, accepter/rejeter, append seul, barre progression). Vue expert complete. `useUiMode()`. Toggle temporaire. `next/dynamic` pour vue expert. | V3-007         |
| V3-013 | Plans dans flow import          | [E03](./V3-E03-workflow-metre-bridge.md) | M (2)  | Front      | Etape optionnelle dans `UnifiedImportFlow` : `PlanFileUploadZone` entre Confirmation et Redirect. Gate flag. Chargement conditionnel.                                    | V3-005, V3-006 |
| V3-014 | Auto-trigger metre              | [E03](./V3-E03-workflow-metre-bridge.md) | M (2)  | Back Front | Prompt apres upload → jobs Level A batch. Double gate flags. Preference localStorage versionnee. Server Action batch.                                                    | V3-006, V3-013 |


---

## Graphe de dependances

```
V3-001 (FS)
  ├── V3-004 (FS)
  └── V3-002 (FS)
        └── V3-003 (FS)
              ├── V3-005 (FS)
              │     ├── V3-006 (FE)
              │     │     ├── V3-009 (FE)
              │     │     ├── V3-013 (FE) [P2]
              │     │     │     └── V3-014 (FE) [P2]
              │     │     └──────────────────────┐
              │     └── V3-007 (FE)              │
              │           ├── V3-008 (FE)        │
              │           ├── V3-010 (FS) ───────┘
              │           └── V3-012 (FE)
              └── V3-011 (FS)
```

> Les stories FS forment la colonne vertebrale (fondation + APIs + logique metier).
> Les stories FE se branchent une fois les APIs pretes (a partir de V3-005).

---

## Sprint Plan (sprints de 2 semaines)

### Sprint 1 — Fondation DB (E01)

> Objectif : migrer `plan_sets` vers project-scope. Zero impact UI.


| Equipe | Stories                              | Points | Description                                      |
| ------ | ------------------------------------ | ------ | ------------------------------------------------ |
| **FS** | V3-001 (M) → V3-004 (S) + V3-002 (M) | 5      | Migration colonne + backfill + RLS project-scope |
| **FE** | Buffer V2 / prep                     | 0      | Pas de deps V3 disponibles encore                |


**Livrable S1 :** `plan_sets.project_id` NOT NULL, RLS project-scope actives, donnees existantes backfillees.

> Note : V3-001 d'abord, puis V3-004 et V3-002 en parallele (les deux ne dependent que de V3-001).

---

### Sprint 2 — APIs + Hub Card

> Objectif : les APIs project-scoped sont pretes, le hub affaire affiche les plans.
> Prerequis : V3-001, V3-002, V3-004 livres en S1.


| Equipe | Stories                 | Points | Description                                                           |
| ------ | ----------------------- | ------ | --------------------------------------------------------------------- |
| **FS** | V3-003 (M) + V3-005 (M) | 4      | Routes dual-mode + card PlansMetres dans hub                          |
| **FE** | V3-006 (L)              | 3      | Page Plan Center (demarre une fois V3-005 livre, peut deborder en S3) |


**Livrable S2 :** APIs plan-sets acceptent `project_id`, card Plans & Metres visible dans le hub, page Plan Center en cours.

---

### Sprint 3 — Pages Affaire & Carry-over

> Objectif : les pages takeoff sont navigables, le carry-over versions fonctionne.
> Prerequis : V3-003, V3-005 livres en S2.


| Equipe | Stories                              | Points | Description                                   |
| ------ | ------------------------------------ | ------ | --------------------------------------------- |
| **FS** | V3-011 (M) + V3-010 (L, debut)       | 5      | Table version_links + debut comparaison DPGF  |
| **FE** | V3-007 (L) + V3-009 (S) + V3-008 (S) | 5      | Page Jobs + action rapide metre + sidebar nav |


**Livrable S3 :** Page Jobs operationnelle, lien sidebar, action rapide metre, carry-over versions, comparaison DPGF en cours.

> Note : V3-010 (FS) depend de V3-007 (FE). FS commence la logique back (`dpgf-compare.ts`, fetcher) pendant que FE livre V3-007, puis FS branche la vue une fois la page prete.

---

### Sprint 4 — Workflow Integration

> Objectif : integration complete du workflow metre dans le flow chiffreur.
> Prerequis : V3-007 et V3-006 livres.


| Equipe | Stories                            | Points | Description                                      |
| ------ | ---------------------------------- | ------ | ------------------------------------------------ |
| **FS** | V3-010 (fin si debord S3) + buffer | 0-3    | Finalisation compare view + corrections          |
| **FE** | V3-012 (M) + V3-013 (M)            | 4      | UX Junior/Senior review + plans dans flow import |


**Livrable S4 :** Comparaison DPGF vs Takeoff complete, review simplifiee junior, etape plans dans import.

---

### Sprint 5 — P2 + Polish final

> Objectif : features P2 restantes, stabilisation, tests E2E.


| Equipe | Stories             | Points | Description                                  |
| ------ | ------------------- | ------ | -------------------------------------------- |
| **FS** | Buffer bugs/perf    | 0      | Corrections + EXPLAIN sur requetes critiques |
| **FE** | V3-014 (M) + buffer | 2      | Auto-trigger metre + stabilisation + E2E     |


**Livrable S5 :** Auto-trigger, zero regression, couverture Playwright complete.

---

## Complexite par story


| Story  | Effort | Complexite technique                                                                    | Risques                                              |
| ------ | ------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| V3-001 | M      | Faible — ALTER TABLE + index composite                                                  | Verification idempotence (`pg_attribute`)            |
| V3-002 | M      | Moyenne — OR logique policies + nouvelle fonction SQL                                   | Predicates indexables, validation EXPLAIN            |
| V3-003 | M      | Moyenne — dual-mode API (project_id OU version_id) + backward compat                    | Schema Zod dual-mode, coherence client/server        |
| V3-004 | S      | Faible — UPDATE + ALTER NOT NULL + validation count                                     | Backfill sur table potentiellement vide              |
| V3-005 | M      | Faible — fetcher parallelise + card RSC                                                 | Promise.all plan_sets/takeoff_jobs                   |
| V3-006 | L      | **Elevee** — adaptation PlanCenter.tsx pour projectId, route dynamique + loading/error  | Regression composant existant version-scoped         |
| V3-007 | L      | **Elevee** — join takeoff_jobs cross-versions via estimate_versions, filtres, compteurs | Performance SQL sur gros volumes de jobs             |
| V3-008 | S      | Faible — modification `build-nav-groups.tsx` + bandeau deprecation                      | —                                                    |
| V3-009 | S      | Faible — bouton dans QuickActionsCard + dialog TakeoffUploadForm                        | Auto-resolve derniere version draft                  |
| V3-010 | L      | **Elevee** — algorithme matching DPGF-takeoff + vue cote-a-cote + lien manuel           | Calibrage seuils (5%/20%), UX matching interactif    |
| V3-011 | M      | Moyenne — migration + RLS + CRUD + enrichir TakeoffSourceBadge                          | RLS indexable sur nouvelle table, UNIQUE constraint  |
| V3-012 | M      | Moyenne — 2 vues conditionnelles + toggle + `next/dynamic`                              | Coherence apply wizard entre modes junior/senior     |
| V3-013 | M      | Faible — etape optionnelle dans stepper existant                                        | Integration dans `UnifiedImportFlow` sans regression |
| V3-014 | M      | Moyenne — batch creation + preference localStorage versionnee + double gate             | Gestion preference localStorage cross-sessions       |


---

## Chemin critique

Le chemin critique (plus longue chaine de dependances) est :

```
V3-001 → V3-002 → V3-003 → V3-005 → V3-006
  (S1)     (S1)     (S2)     (S2)    (S2-S3)
```

Cela signifie que **V3-001 est le goulot d'etranglement** : toute l'integration hub + pages en depend. Il doit etre livre en priorite absolue debut Sprint 1.

Second chemin critique (workflow) :

```
V3-005 → V3-007 → V3-010
  (S2)     (S3)    (S3-S4)
```

Troisieme chemin (P2) :

```
V3-006 → V3-013 → V3-014
 (S2-S3)   (S4)     (S5)
```

---

## Coordination inter-equipes


| Sprint  | Handoff FS → FE                                                         | Notes                                                   |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| S1 → S2 | V3-002 debloque V3-003 (meme equipe), mais FE attend V3-005 pour V3-006 | FE peut preparer les composants en local avec mock data |
| S2 → S3 | V3-005 debloque V3-006, V3-007, V3-009                                  | Moment cle : l'essentiel du travail FE demarre          |
| S3 → S4 | V3-007 (FE) debloque V3-010 (FS)                                        | Dependance croisee : FS attend FE                       |
| S4 → S5 | V3-013 (FE) debloque V3-014 (FE)                                        | Pas de handoff inter-equipe                             |


---

## Regles de gestion

1. **Pas de merge sur `main` sans tests** — chaque PR doit passer Vitest + Playwright critique
2. **Review cross-equipe** — les stories DB/Back (FS) et les pages UI (FE) sont relues mutuellement
3. **Demo fin de sprint** — chaque equipe demontre ses stories en 15 min
4. **Buffer S5** — 1 sprint de marge pour bugs, perf, tests E2E complets, stabilisation
5. **Definition of Done** — cf. [V3 README](./README.md) section "Standards techniques"
6. **Handoff S2** — la livraison de V3-005 par FS debloque la majorite du travail FE ; si en retard, tout le plan glisse
7. **Dependance croisee S3** — V3-010 (FS) depend de V3-007 (FE) ; FS commence la partie back (fetcher, `dpgf-compare.ts`) sans attendre la page
