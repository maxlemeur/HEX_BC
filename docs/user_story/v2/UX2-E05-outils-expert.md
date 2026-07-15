# UX2-E05 — Outils Expert & Productivite Senior

> Milestone: M3 | Priorite: P1 | Statut: A faire

## Objectif

Enrichir l'experience pour le chiffreur senior : acces rapide aux templates/ouvrages
depuis l'editeur, raccourcis clavier documentes, command palette pour la recherche rapide,
analytics personnels et analyse de marge par affaire. Ces fonctionnalites sont visibles
principalement en mode Expert et constituent le differentiel de productivite pour les
utilisateurs avances.

## Ce qui existe deja

- **`src/app/dashboard/estimates/[versionId]/edit/page.tsx`** : Raccourcis clavier
  implementes (Ctrl+S, Ctrl+Z/Y, Tab, Enter, Suppr, arrows), inline editing, DnD,
  multi-select, bulk operations
- **`src/hooks/useSpreadsheetNavigation.ts`** : Navigation clavier dans le spreadsheet
- **`src/app/dashboard/estimates/assemblies/page.tsx`** : Page gestion des ouvrages
  avec CRUD complet
- **`src/app/dashboard/estimates/templates/page.tsx`** : Page gestion des templates
  de chiffrage
- **`src/components/estimates/EstimateDashboard.tsx`** : Dashboard KPI global avec
  `TrendChart` SVG (graphique 6 mois), KPIs (total devis, taux acceptation, CA par statut)
- **`src/app/api/estimates/stats/route.ts`** : API route stats globales
- **`src/lib/estimate-calculations.ts`** : `computeEstimateLineValues()`,
  `computeEstimateTotals()` pour les calculs de marge
- **`src/components/ui/Modal.tsx`** : Composant modal reutilisable

---

## UX2-018 — Command Palette (recherche rapide actions)

**Priorite:** P1 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur senior, je veux ouvrir une palette de recherche rapide avec
> Ctrl+K pour trouver une affaire, executer une action ou naviguer vers une page,
> afin de ne jamais quitter le clavier.

### Criteres d'acceptation

- [ ] `Ctrl+K` (ou `Cmd+K` sur Mac) ouvre une palette de recherche centree
      (style VS Code / Linear)
- [ ] La palette propose 3 groupes de resultats :
  - **Affaires recentes** : les 5 dernieres affaires consultees
  - **Actions** : Nouvelle affaire, Exporter, Parametres, etc.
  - **Navigation** : Mes affaires, Commandes, Referentiel, etc.
- [ ] La recherche filtre en temps reel les resultats par fuzzy matching
- [ ] Entree valide le premier resultat, fleches haut/bas naviguent, Echap ferme
- [ ] En mode Simplifie : la palette est masquee par defaut mais le raccourci
      Ctrl+K fonctionne quand meme (decouverte progressive)
- [ ] En mode Expert : un bouton "Rechercher" est visible dans la toolbar/sidebar
- [ ] Les resultats sont navigables au clavier uniquement (pas besoin de souris)
- [ ] Le bundle de la palette est charge a la demande (premier open / focus)
      via `next/dynamic` (`bundle-dynamic-imports`)

### Notes techniques

- Fichiers a creer :
  - `src/components/ui/CommandPalette.tsx`
  - `src/hooks/useCommandPalette.ts` — logique de recherche, raccourci clavier,
    registre d'actions
- Fichiers a modifier :
  - `src/app/dashboard/layout.tsx` — monter le composant au niveau layout
- Reutiliser :
  - `src/components/ui/Modal.tsx` — base du overlay
  - `useUserContext()` pour les affaires recentes
  - Listener clavier global unique pour eviter les doublons (`client-event-listeners`)
- Dependances : Aucune

---

## UX2-019 — Panel raccourcis clavier

**Priorite:** P2 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux voir un panneau des raccourcis clavier disponibles via
> la touche `?` ou un bouton aide, afin de decouvrir les raccourcis qui accelerent
> mon travail dans l'editeur.

### Criteres d'acceptation

- [ ] Touche `?` ouvre un modal listant tous les raccourcis disponibles
- [ ] Les raccourcis sont groupes par contexte :
  - **Navigation** : Ctrl+K (recherche), Echap (fermer)
  - **Editeur** : Ctrl+S (sauver), Ctrl+Z/Y (undo/redo), Tab (cellule suivante),
    Entree (editer), Suppr (vider), Ctrl+D (dupliquer), Ctrl+Shift+S (ajouter section)
  - **Selection** : Ctrl+A (tout), Shift+clic (etendue), Ctrl+clic (toggle)
- [ ] Le modal est ferme par Echap ou clic en dehors
- [ ] Bouton `?` dans le footer de la sidebar pour y acceder sans clavier
- [ ] Les raccourcis affiches sont contextualises : si on est dans l'editeur,
      les raccourcis editeur sont mis en avant
- [ ] Gestion des listeners clavier centralisee (pas de listeners concurrents layout/editor)
      pour limiter les rerenders et effets de bord (`client-event-listeners`)

### Notes techniques

- Fichiers a creer :
  - `src/components/ui/KeyboardShortcutsModal.tsx`
- Fichiers a modifier :
  - `src/app/dashboard/layout.tsx` — listener touche `?`
  - `src/components/DashboardShell.tsx` — bouton `?` dans footer
- Reutiliser :
  - `src/components/ui/Modal.tsx` existant
- Dependances : Aucune

---

## UX2-020 — Dashboard analytics chiffreur

**Priorite:** P1 | **Effort:** L | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur senior, je veux voir un tableau de bord de mes performances
> personnelles (nombre d'affaires, CA, taux d'acceptation, tendance), afin de suivre
> mon activite et identifier les axes d'amelioration.

### Criteres d'acceptation

- [ ] Nouvelle page `/dashboard/analytics` accessible en mode Expert
      (dans le groupe "Outils" de la sidebar)
- [ ] KPIs personnels (filtres par `user_id` du chiffreur connecte) :
  - Nombre d'affaires actives (non archivees)
  - CA total HT (somme des versions acceptees)
  - Taux d'acceptation (acceptees / (envoyees + acceptees))
  - Delai moyen creation → acceptation
- [ ] Graphique tendance 6 mois : nombre d'affaires creees vs acceptees par mois
- [ ] Tableau "Top affaires" : les 10 affaires les plus recentes avec montant et statut
- [ ] Si role `admin` : option de voir les stats de tous les chiffreurs
      (select utilisateur en haut)
- [ ] Auto-refresh toutes les 60 secondes via `router.refresh()` (ou mecanisme equivalent)
      sans imposer une API interne dediee
- [ ] KPIs/graphes calcules en requetes agregees (pas de N+1)
- [ ] Plan de requete valide (`EXPLAIN`) et indexes composites ajoutes si necessaire
      sur les filtres `tenant_id`, `status`, `created_at`, `user_id`
- [ ] Fetchers server partages (contexte user/tenant, fenetre temporelle) dedupliques
      via `React.cache()` (`server-cache-react`)
- [ ] Les composants chart lourds sont charges dynamiquement si necessaire
      (`bundle-dynamic-imports`)
- [ ] Couverture Vitest sur calculs KPI + Playwright sur navigation/filtrage dashboard

### Notes techniques

- Fichiers a creer :
  - `src/app/dashboard/analytics/page.tsx`
  - `src/components/analytics/ChiffreurDashboard.tsx`
  - `src/lib/analytics/server.ts`
  - `src/app/dashboard/analytics/loading.tsx`
  - `src/app/dashboard/analytics/error.tsx`
- Reutiliser :
  - Composant `TrendChart` SVG de `src/components/estimates/EstimateDashboard.tsx`
  - `formatEUR()`, `STATUS_BADGE_STYLES`
  - Patterns de calcul serveur deja utilises dans `EstimateDashboard`
- Dependances : UX2-005

---

## UX2-021 — Widget analyse de marge par affaire

**Priorite:** P2 | **Effort:** M | **Couches:** `[Back]` `[Front]`

### User Story

> En tant que chiffreur senior, je veux voir l'analyse de marge detaillee par affaire
> (marge globale, par section/lot, evolution entre versions), afin d'identifier les
> postes sous-marginalises et optimiser ma rentabilite.

### Criteres d'acceptation

- [ ] Section "Analyse marge" dans le hub affaire (UX2-006), visible uniquement
      en mode Expert
- [ ] Affiche : marge globale en % et en EUR, coefficient applique
- [ ] Repartition de la marge par section/lot de premier niveau
      (liste des sections avec leur marge individuelle)
- [ ] Si plusieurs versions existent : graphique d'evolution de la marge V1 → V2 → V3
- [ ] Code couleur : vert si marge > 25%, orange si 15-25%, rouge si < 15%
      (seuils configurables dans le futur)
- [ ] Clic sur une section → filtre l'editeur sur cette section (navigation)
- [ ] Calcul SQL agrege par section (`group by`) pour eviter les boucles N+1 cote application

### Notes techniques

- Fichiers a creer :
  - `src/components/affaires/MarginAnalysis.tsx`
- Reutiliser :
  - `computeEstimateTotals()` de `src/lib/estimate-calculations.ts`
  - `formatCurrency()` / `formatEUR()` de `src/lib/money.ts`
  - Donnees de `estimate_items` groupees par section (`parent_id IS NULL`)
- Dependances : UX2-006

---

## UX2-022 — Acces rapide templates & ouvrages dans l'editeur

**Priorite:** P1 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur senior, je veux inserer un template ou un ouvrage directement
> depuis l'editeur via un bouton dans la toolbar, afin de ne pas quitter l'editeur pour
> aller chercher un modele sur une autre page.

### Criteres d'acceptation

- [ ] En mode Expert, la toolbar Row 2 affiche un bouton "+ Template" et
      un bouton "+ Ouvrage"
- [ ] Clic sur "+ Template" ouvre un picker inline (dropdown ou petit modal) avec :
  - Recherche par nom
  - Liste des 10 derniers templates utilises
  - Preview rapide (nombre de sections/lignes)
- [ ] Selection d'un template insere les items a la position courante du curseur
      (ou a la fin si pas de selection)
- [ ] Meme comportement pour "+ Ouvrage" avec la liste des ouvrages
- [ ] Les pages `/dashboard/estimates/templates` et `/dashboard/estimates/assemblies`
      restent accessibles pour la gestion complete
- [ ] En mode Simplifie, ces boutons ne sont pas visibles (mais la fonctionnalite
      est accessible via la Command Palette Ctrl+K)
- [ ] Les pickers Template/Ouvrage sont charges conditionnellement a l'ouverture
      (`bundle-conditional`)

### Notes techniques

- Fichiers a creer :
  - `src/components/estimates/editor/QuickTemplatePicker.tsx`
  - `src/components/estimates/editor/QuickAssemblyPicker.tsx`
- Reutiliser :
  - Les fetchers existants pour templates (`/api/estimates/templates`)
    et ouvrages (`/api/estimates/assemblies`)
  - La logique d'insertion existante dans le `ImportFromEstimateDialog`
  - `useUiMode()` pour la visibilite conditionnelle
- Dependances : Aucune
