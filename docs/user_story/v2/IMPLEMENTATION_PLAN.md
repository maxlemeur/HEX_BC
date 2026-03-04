# Plan d'implementation V2 — Refonte UX TIMAX

## Equipes

| Equipe | Profil | Focus principal | Charge (pts) |
|--------|--------|-----------------|-------------|
| **FS-A** (Fullstack A) | Fullstack | Hub Affaire + Flux Import | 16 |
| **FS-B** (Fullstack B) | Fullstack | Editeur + Analytics | 18 |
| **FE** (Frontend) | Frontend | Navigation + Polish + Composants UI | 18 |

> Points : S=1, M=2, L=3. Total : 52 points, ~17 pts/equipe.

---

## Assignation par equipe

### FS-A — Hub Affaire & Import (7 stories, 16 pts)

| Story | Titre | Epic | Effort | Couches | Description | Dependances |
|-------|-------|------|--------|---------|-------------|-------------|
| UX2-005 | Liste des affaires | [E02](./UX2-E02-hub-affaire.md) | L (3) | DB Back Front | Nouvelle page `/dashboard/affaires` avec cartes/tableau, 2 indicateurs de statut (version courante + derniere acceptee), pagination curseur, filtres texte/statut. Migration indexes `estimate_versions`. | Aucune |
| UX2-006 | Hub affaire | [E02](./UX2-E02-hub-affaire.md) | L (3) | Back Front | Page `/dashboard/affaires/[projectId]` avec 4 sections (resume financier, timeline versions, source DPGF, actions rapides). `Promise.all` + `Suspense` boundaries. `not-found.tsx`. | UX2-005 |
| UX2-007 | Lier DPGF a projet | [E02](./UX2-E02-hub-affaire.md) | M (2) | DB Back | Migration : ajout FK `project_id` sur `dpgf_imports`, index composite `(tenant_id, project_id, created_at desc)`, update RLS policies. Server Action pour l'association. | UX2-005 |
| UX2-008 | Breadcrumb editeur | [E02](./UX2-E02-hub-affaire.md) | S (1) | Front | Composant breadcrumb contextuel "Mes affaires > Projet > V{N} - Edition" dans l'editeur et les pages detail. Mobile : segment + fleche retour. | UX2-006 |
| UX2-009 | UnifiedImportFlow | [E03](./UX2-E03-import-unifie.md) | L (3) | Back Front | Composant multi-step inline (Upload → Mapping → Preview → Confirmation). Reutilise `useFileParser`, `ColumnMapper`, `DataPreview`. Batch insert + Server Action transaction courte. `next/dynamic` par etape. | UX2-007 |
| UX2-010 | Auto-mapping confiance | [E03](./UX2-E03-import-unifie.md) | M (2) | DB Back Front | Scoring confiance sur auto-mapping (vert >80%, orange 50-80%, rouge <50%). Migration contrainte unique `mapping_memory` pour UPSERT. `React.cache()` pour dedup. | UX2-009 |
| UX2-011 | Creation affaire + import | [E03](./UX2-E03-import-unifie.md) | M (2) | Back Front | Dialog "Nouvelle affaire" avec drop DPGF optionnel. Server Action creation projet + version + items en batch. `redirect()` hors try/catch. Mode Simplifie : champs minimaux. | UX2-005, UX2-009 |

### FS-B — Editeur & Analytics (9 stories, 18 pts)

| Story | Titre | Epic | Effort | Couches | Description | Dependances |
|-------|-------|------|--------|---------|-------------|-------------|
| UX2-001 | Preference mode interface | [E01](./UX2-E01-navigation-persona.md) | S (1) | DB Back Front | Migration `profiles.ui_mode`, hook `useUiMode()`, Server Action `updateProfileUiMode()`. Persistence localStorage + sync DB. Toggle dans sidebar. | Aucune |
| UX2-017 | Mode lecture viewer | [E04](./UX2-E04-editeur-simplifie.md) | S (1) | DB Front | Migration RLS `estimate_items` bloquant INSERT/UPDATE/DELETE pour `viewer`. Guard UI : masquer boutons edition, banniere "Mode consultation". | Aucune |
| UX2-013 | Settings summary bar | [E04](./UX2-E04-editeur-simplifie.md) | M (2) | Front | Barre fixe au-dessus du tableau : marge %, TVA %, remise, total HT/TTC. Chaque valeur cliquable → section drawer. Calculs memoises sans effets. Mode Simplifie : HT + marge seulement. | Aucune |
| UX2-022 | Acces rapide templates | [E05](./UX2-E05-outils-expert.md) | M (2) | Front | Boutons "+ Template" et "+ Assemblage" dans toolbar Row 2 (mode Expert). Picker inline avec recherche et preview. Insertion a la position curseur. Chargement conditionnel. | Aucune |
| UX2-015 | Toolbar compacte | [E04](./UX2-E04-editeur-simplifie.md) | M (2) | Front | Refactoring toolbar en 2 rows : Row 1 = actions principales, Row 2 = filtres/options. Sticky au scroll. Mode Simplifie : Row 2 allegee. Mobile : Row 2 en overflow. `startTransition` sur filtres. | UX2-013, UX2-014 |
| UX2-020 | Dashboard analytics | [E05](./UX2-E05-outils-expert.md) | L (3) | Back Front | Page `/dashboard/analytics` avec KPIs personnels (affaires actives, CA HT, taux acceptation, delai moyen). Graphique 6 mois. Top 10 affaires. Admin : stats tous chiffreurs. Requetes agregees + indexes. | UX2-005 |
| UX2-016 | Split fichier editeur | [E04](./UX2-E04-editeur-simplifie.md) | L (3) | Front | Decoupe `edit/page.tsx` (~7000 lignes) en 5 modules : Page, Toolbar, Drawer, Alerts, useEditorState. Frontieres RSC. Sous-arbres memoises. Zero regression. | UX2-015 |
| UX2-021 | Analyse marge affaire | [E05](./UX2-E05-outils-expert.md) | M (2) | Back Front | Widget dans hub affaire (mode Expert) : marge globale + repartition par section/lot. Evolution marge entre versions. Code couleur seuils. SQL agrege `GROUP BY`. | UX2-006 |
| UX2-025 | Responsive tablette | [E06](./UX2-E06-onboarding-polish.md) | M (2) | Front | Media queries 768-1024px. Scroll horizontal fluide + indicateur ombre. Drawer fullscreen. Toolbar overflow. Touch targets 44x44px. Listeners passifs. | UX2-015 |

### FE — Navigation & Polish (11 stories, 18 pts)

| Story | Titre | Epic | Effort | Couches | Description | Dependances |
|-------|-------|------|--------|---------|-------------|-------------|
| UX2-018 | Command Palette | [E05](./UX2-E05-outils-expert.md) | M (2) | Front | Palette Ctrl+K style VS Code. 3 groupes : affaires recentes, actions, navigation. Fuzzy search. Navigation clavier. `next/dynamic` au premier open. Listener global unique. | Aucune |
| UX2-026 | Toast queue | [E06](./UX2-E06-onboarding-polish.md) | S (1) | Front | Systeme toast global avec queue (max 3 visibles). 4 types (success/error/warning/info). Auto-dismiss 4s. API `toast.success()`. Provider client. `setState` fonctionnel. | Aucune |
| UX2-027 | Skeletons | [E06](./UX2-E06-onboarding-polish.md) | S (1) | Front | Composant `Skeleton` generique (text/circle/rect/card). Skeletons specifiques : liste affaires, hub, editeur. Routes `loading.tsx`. Remplace les spinners. `animate-pulse`. | Aucune |
| UX2-019 | Panel raccourcis | [E05](./UX2-E05-outils-expert.md) | S (1) | Front | Modal `?` listant tous les raccourcis par contexte (navigation, editeur, selection). Bouton `?` footer sidebar. Listeners centralises. | Aucune |
| UX2-002 | NAV_GROUPS dynamique | [E01](./UX2-E01-navigation-persona.md) | M (2) | Front | Extraction `buildNavGroups(role, flags, uiMode)`. Logique role × mode × flags. Suppression entrees Import/Mapping de la sidebar. Tests Vitest combinatoires. | UX2-001, UX2-005 |
| UX2-014 | Preset Essentiel defaut | [E04](./UX2-E04-editeur-simplifie.md) | S (1) | Front | Mode Simplifie → preset "essential" par defaut. Mode Expert → preset "standard" ou dernier utilise. Bouton "+N colonnes" toggle vers "full". Persistence localStorage. | UX2-001 |
| UX2-004 | Badge mode sidebar | [E01](./UX2-E01-navigation-persona.md) | S (1) | Front | Footer sidebar : initiales + nom + switch Simplifie/Expert compact. Changement instantane. En collapsed : switch seul visible. | UX2-001 |
| UX2-003 | Restructuration sidebar | [E01](./UX2-E01-navigation-persona.md) | M (2) | Front | Renommer groupes (Chiffrages → Mes affaires, Configurer → Outils/Admin). Supprimer Import/Mapping. Redirects `next.config.ts`. Mode Simplifie : 2 groupes max. | UX2-002, UX2-005 |
| UX2-023 | Empty states | [E06](./UX2-E06-onboarding-polish.md) | M (2) | Front | Composant `EmptyState` reutilisable. Etats vides : liste affaires, hub sans version, commandes. Animation fade-in. CTA contextuel. | UX2-005 |
| UX2-024 | Onboarding tour | [E06](./UX2-E06-onboarding-polish.md) | M (2) | Front | Overlay 4 etapes au premier login Simplifie (sidebar, creation, import, parametres). Highlight + tooltip. Persistence localStorage versionnee. Relancable depuis menu aide. | UX2-003 |
| UX2-012 | Deprecation standalone | [E03](./UX2-E03-import-unifie.md) | S (1) | Front | Bandeaux info sur `/dashboard/imports`, `/dashboard/mappings`, `/dashboard/catalogue` orientant vers le flux affaire. Fonctionnalites existantes preservees. Lien "Voir l'affaire" si `project_id`. | UX2-009, UX2-011 |

---

## Graphe de dependances

```
Aucune dep          UX2-005 (FS-A)     UX2-001 (FS-B)
                        │                    │
          ┌─────────────┼──────────┬─────────┼──────────┐
          │             │          │         │          │
     UX2-006 (FS-A)  UX2-007   UX2-002   UX2-014   UX2-004
          │          (FS-A)     (FE)      (FE)      (FE)
          │             │         │
     ┌────┼────┐    UX2-009      │
     │    │    │    (FS-A)    UX2-003 (FE)
  UX2-008 │  UX2-021  │         │
  (FS-A)  │  (FS-B)   ├────  UX2-024 (FE)
          │         UX2-010
        UX2-020     (FS-A)
        (FS-B)         │
                    UX2-011 (FS-A)
                       │
                    UX2-012 (FE)

UX2-013 (FS-B) ─── UX2-015 (FS-B) ─── UX2-016 (FS-B)
       └──────────── UX2-014 (FE) ──┘        │
                                          UX2-025 (FS-B)

Sans dependances : UX2-017(FS-B), UX2-018(FE), UX2-019(FE),
                   UX2-022(FS-B), UX2-023(FE→005), UX2-026(FE), UX2-027(FE)
```

---

## Sprint Plan (sprints de 2 semaines)

### Sprint 1 — Fondations (M1a)

> Objectif : poser les briques de base sans dependances.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS-A** | UX2-005 (L) | 3 | Page liste affaires + migration indexes |
| **FS-B** | UX2-001 (S) + UX2-017 (S) + UX2-013 (M) | 4 | Mode UI + RLS viewer + Summary bar editeur |
| **FE** | UX2-018 (M) + UX2-026 (S) + UX2-027 (S) | 4 | Command palette + Toast queue + Skeletons |

**Livrable S1 :** Page `/dashboard/affaires` operationnelle, `ui_mode` en base, RLS viewer ferme, outils transversaux (toast, skeletons, palette) prets.

---

### Sprint 2 — Hub Affaire + Navigation (M1b)

> Objectif : le hub affaire prend forme, la sidebar bascule sur le nouveau workflow.
> Prerequis : UX2-005 et UX2-001 livres en S1.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS-A** | UX2-006 (L) + UX2-007 (M) | 5 | Hub affaire + liaison DPGF-projet |
| **FS-B** | UX2-022 (M) + UX2-020 (L) | 5 | Pickers templates/assemblages + debut analytics |
| **FE** | UX2-002 (M) + UX2-014 (S) + UX2-004 (S) + UX2-019 (S) | 5 | NAV_GROUPS dynamique + preset essentiel + badge mode + raccourcis |

**Livrable S2 :** Hub affaire navigable, DPGF lie au projet, sidebar adaptee au mode, preset colonnes conditionnel.

---

### Sprint 3 — Import Unifie + Sidebar finale (M2a)

> Objectif : le flux import-to-estimate fonctionne, la sidebar est en version finale.
> Prerequis : UX2-007 et UX2-002 livres en S2.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS-A** | UX2-009 (L) + UX2-008 (S) | 4 | UnifiedImportFlow + breadcrumb editeur |
| **FS-B** | UX2-015 (M) + UX2-020 (L, fin) | 5 | Toolbar compacte + fin analytics (si deborde de S2) |
| **FE** | UX2-003 (M) + UX2-023 (M) | 4 | Restructuration sidebar + empty states |

**Livrable S3 :** Import DPGF en flux continu dans le hub, sidebar workflow-first, empty states, analytics chiffreur.

> Note : Si UX2-020 est termine en S2, FS-B commence UX2-016 en avance.

---

### Sprint 4 — Finitions M2 + Expert (M2b)

> Objectif : l'import est complet (auto-mapping, quick create), l'editeur est split et optimise.
> Prerequis : UX2-009 et UX2-015 livres en S3.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS-A** | UX2-010 (M) + UX2-011 (M) | 4 | Auto-mapping confiance + quick create affaire |
| **FS-B** | UX2-016 (L) + UX2-021 (M) | 5 | Split editeur monolithique + analyse marge |
| **FE** | UX2-024 (M) + UX2-025 (M) | 4 | Onboarding tour + responsive tablette |

**Livrable S4 :** Auto-mapping intelligent, creation affaire en 1 clic, editeur decoupe en modules, marge par lot, onboarding, tablette.

---

### Sprint 5 — Polish final (M3)

> Objectif : deprecation des anciennes pages, stabilisation, tests E2E.
> Prerequis : UX2-011 et UX2-009 livres en S4.

| Equipe | Stories | Points | Description |
|--------|---------|--------|-------------|
| **FS-A** | UX2-012 (S) + buffer bugs/perf | 1 | Deprecation pages standalone + corrections |
| **FS-B** | UX2-025 (M, si debord S4) + buffer bugs/perf | 0-2 | Responsive (si deborde) + corrections |
| **FE** | Buffer bugs/perf + tests E2E | 0 | Stabilisation + couverture Playwright |

**Livrable S5 :** Bandeaux deprecation, zero regression, couverture E2E complete.

---

## Complexite par story

| Story | Effort | Complexite technique | Risques |
|-------|--------|---------------------|---------|
| UX2-001 | S | Faible — migration simple + hook + Server Action | Sync localStorage/DB au refresh |
| UX2-002 | M | Moyenne — logique combinatoire role × mode × flags | Couverture exhaustive des combinaisons |
| UX2-003 | M | Faible — renommage + redirects | Backward compat des anciens URLs |
| UX2-004 | S | Faible — UI sidebar footer | — |
| UX2-005 | L | **Elevee** — nouvelle page RSC + migration indexes + pagination curseur + 2 status indicators | Performance pagination sur gros volumes |
| UX2-006 | L | **Elevee** — page dynamique + parallel fetching + Suspense boundaries + not-found | Waterfall si mal parallelise |
| UX2-007 | M | Moyenne — migration FK + RLS update | Backward compat imports existants sans `project_id` |
| UX2-008 | S | Faible — composant breadcrumb reutilisant HubBreadcrumb existant | — |
| UX2-009 | L | **Elevee** — composant multi-step + batch insert + Server Action + integration 4 composants existants | Complexite d'integration, gestion des erreurs par etape |
| UX2-010 | M | Moyenne — UPSERT + scoring algorithme + UI badges | Calibrage des seuils de confiance |
| UX2-011 | M | Moyenne — dialog + Server Action chaine (projet + version + items) | Transaction atomique + redirect hors try/catch |
| UX2-012 | S | Faible — bandeaux + lien conditionnel | — |
| UX2-013 | M | Moyenne — composant reactif connecte au contexte editeur | Re-renders a maitriser (calculs memoises) |
| UX2-014 | S | Faible — condition dans hook existant | — |
| UX2-015 | M | Moyenne — refactoring toolbar existante en 2 rows + overflow mobile | Regression visuelle toolbar |
| UX2-016 | L | **Elevee** — extraction de code dans un fichier 7000 lignes sans regression | Risque de regression eleve, necessite bonne couverture tests avant |
| UX2-017 | S | Faible — migration RLS + guard conditionnel UI | Verifier que les policies sont indexables |
| UX2-018 | M | Moyenne — fuzzy search + keyboard navigation + registre actions | Conflit raccourcis avec editeur |
| UX2-019 | S | Faible — modal statique | — |
| UX2-020 | L | **Elevee** — requetes agregees + graphiques + page RSC + indexes | Performance SQL sur volumes |
| UX2-021 | M | Moyenne — SQL agrege GROUP BY sections + graphique evolution versions | Coherence calculs marge avec `estimate-calculations.ts` |
| UX2-022 | M | Moyenne — picker inline + insertion a position curseur | Position curseur dans le spreadsheet |
| UX2-023 | M | Faible — composant generique + 3 variantes | — |
| UX2-024 | M | Moyenne — overlay positionne + highlight zones + gestion steps | Positionnement dynamique des tooltips |
| UX2-025 | M | Moyenne — media queries + touch targets + scroll indicators | Tests multi-device |
| UX2-026 | S | Faible — provider + queue + animations | — |
| UX2-027 | S | Faible — composants pulse + loading.tsx routes | — |

---

## Chemin critique

Le chemin critique (plus longue chaine de dependances) est :

```
UX2-005 → UX2-007 → UX2-009 → UX2-011 → UX2-012
  (S1)      (S2)      (S3)      (S4)      (S5)
```

Cela signifie que **UX2-005 est le goulot d'etranglement** : tout le flux Hub + Import en depend. Il doit etre livre en priorite absolue en Sprint 1.

Second chemin critique (editeur) :

```
UX2-013 + UX2-014 → UX2-015 → UX2-016
   (S1)     (S2)      (S3)      (S4)
```

---

## Regles de gestion

1. **Pas de merge sur `main` sans tests** — chaque PR doit passer Vitest + Playwright critique
2. **Review cross-equipe** — les stories DB/Back de FS-A/FS-B sont relues mutuellement
3. **Demo fin de sprint** — chaque equipe demontre ses stories en 15 min
4. **Buffer S5** — 1 sprint de marge pour bugs, perf, tests E2E complets, stabilisation
5. **Definition of Done** — cf. README.md section "Standards techniques obligatoires (V2)"
