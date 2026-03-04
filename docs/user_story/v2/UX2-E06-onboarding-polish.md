# UX2-E06 — Onboarding, Polish & Responsive

> Milestone: M3 | Priorite: P2 | Statut: A faire

## Objectif

Ameliorer l'experience de premier lancement (onboarding guide pour le chiffreur junior),
les etats vides encourageants, la responsivite sur tablette, et les micro-interactions
(toasts, skeletons). Cette epic apporte le polish final qui transforme une application
fonctionnelle en une application agreable a utiliser au quotidien.

## Ce qui existe deja

- **`src/app/globals.css`** : Styles globaux avec variables CSS, animations
  (`animate-fade-in`, `animate-slide-in-right`), classes responsive, media queries
- **`src/components/DashboardShell.tsx`** : Hamburger mobile, overlay, sidebar responsive
- **`src/components/ui/Toast.tsx`** : Composant toast basique existant
  (pas encore utilise systematiquement dans les flux)
- **`src/app/dashboard/estimates/[versionId]/edit/page.tsx`** : Raccourcis clavier
  implementes dans l'editeur
- **`src/hooks/useSpreadsheetNavigation.ts`** : Navigation clavier spreadsheet
- **`src/components/ui/Modal.tsx`** : Modal generique reutilisable

---

## UX2-023 — Etats vides (Empty States) pour toutes les pages liste

**Priorite:** P2 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que nouveau chiffreur, je veux voir un message encourageant et un call-to-action
> clair quand il n'y a encore aucune affaire ou commande, afin de savoir par ou commencer
> et ne pas me sentir perdu devant un ecran vide.

### Criteres d'acceptation

- [ ] Composant reutilisable `EmptyState` avec props :
      `icon`, `title`, `description`, `actionLabel`, `actionHref`, `onAction`
- [ ] Page liste affaires vide : icone dossier + "Creez votre premiere affaire" +
      description courte + bouton "Nouvelle affaire"
- [ ] Hub affaire sans version : icone feuille + "Aucune version encore" +
      "Commencez le chiffrage ou importez un DPGF" + bouton "Demarrer"
- [ ] Page commandes vide : icone commande + "Aucune commande" +
      "Les commandes sont generees depuis un chiffrage accepte" +
      lien "Voir mes affaires"
- [ ] Chaque empty state utilise une animation `fade-in` subtile
- [ ] Le composant s'adapte aux modes Simplifie/Expert (pas de difference visuelle,
      mais le CTA peut varier)

### Notes techniques

- Fichiers a creer :
  - `src/components/ui/EmptyState.tsx`
- Fichiers a modifier :
  - `src/app/dashboard/affaires/page.tsx` — utiliser `EmptyState` quand 0 resultats
  - `src/app/dashboard/orders/page.tsx` — idem
- Reutiliser :
  - Classes CSS `animate-fade-in`, `dashboard-card` existantes
- Dependances : UX2-005

---

## UX2-024 — Guide de demarrage rapide (Onboarding Tour)

**Priorite:** P2 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que nouveau chiffreur en mode Simplifie, je veux un tour guide au premier
> lancement qui m'explique les 3-4 zones principales de l'interface, afin de devenir
> operationnel rapidement sans avoir besoin de formation.

### Criteres d'acceptation

- [ ] Au premier login en mode Simplifie, un overlay avec 4 etapes :
  1. "Vos affaires" — highlight la sidebar, explique la navigation
  2. "Nouvelle affaire" — highlight le bouton creation, explique le flux
  3. "Importez votre DPGF" — highlight la zone de drop (si visible)
  4. "Vos parametres" — highlight le switch mode et le profil
- [ ] Chaque etape highlight une zone de l'ecran avec un tooltip explicatif
      (fond sombre sauf la zone highlightee)
- [ ] Boutons "Passer" et "Suivant" a chaque etape, "Terminer" a la derniere
- [ ] L'onboarding est persiste en localStorage (cle `hex-onboarding-completed`)
      et ne s'affiche qu'une fois
- [ ] Accessible a nouveau via un lien "Aide > Reprendre le tour" dans le
      menu profil ou la sidebar
- [ ] En mode Expert, l'onboarding ne se declenche pas automatiquement
      (l'utilisateur sait deja naviguer)
- [ ] La persistence locale suit un schema versionne
      (`{ version, completedAt }`) pour migrations futures (`client-localstorage-schema`)

### Notes techniques

- Fichiers a creer :
  - `src/components/onboarding/OnboardingTour.tsx` — composant principal
    avec overlay + tooltip positionne
  - `src/hooks/useOnboarding.ts` — logique d'etapes, persistence, detection
    premier lancement
- Fichiers a modifier :
  - `src/app/dashboard/layout.tsx` — monter le composant `OnboardingTour`
- Reutiliser :
  - `useUiMode()` pour la detection du mode
  - Pattern localStorage deja utilise dans l'app
- Contraintes Next.js :
  - Le layout dashboard reste Server Component; le tour est monte dans une
    frontiere Client Component dediee
- Dependances : UX2-003 (la sidebar doit etre restructuree d'abord)

---

## UX2-025 — Amelioration responsive de l'editeur sur tablette

**Priorite:** P2 | **Effort:** M | **Couches:** `[Front]`

### User Story

> En tant que chiffreur sur le terrain, je veux pouvoir consulter et faire des
> modifications mineures sur mon chiffrage depuis une tablette, afin de ne pas
> dependre uniquement de mon poste fixe au bureau.

### Criteres d'acceptation

- [ ] Les colonnes du tableau s'adaptent a la largeur tablette (768px-1024px) :
      designation prend toute la largeur disponible, colonnes numeriques restent
      a taille fixe minimale
- [ ] Le scroll horizontal est fluide avec un indicateur visuel de scroll
      (ombre a droite quand des colonnes sont cachees vers la droite)
- [ ] Le drawer settings s'ouvre en full-screen sur tablette/mobile
      (deja partiellement le cas)
- [ ] Les boutons de la toolbar sont accessibles sans scroll horizontal :
      Row 2 passe en menu overflow sur tablette
- [ ] Le drag & drop fonctionne au touch (dnd-kit supporte deja le touch,
      verifier les breakpoints)
- [ ] La taille minimale des cellules editables est de 44x44px (cible touch)
- [ ] Les listeners scroll/touch utilises pour indicateurs visuels sont passifs
      et centralises (`client-passive-event-listeners`, `client-event-listeners`)

### Notes techniques

- Fichiers a modifier :
  - `src/app/globals.css` — media queries pour tablette (768-1024px)
  - `src/app/dashboard/estimates/[versionId]/edit/page.tsx` — toolbar overflow
  - `src/components/estimates/EstimateEditorTable.tsx` — tailles cellules
- Reutiliser :
  - Classes CSS responsive existantes
  - dnd-kit supporte deja le touch nativement
- Dependances : UX2-015

---

## UX2-026 — Notifications toast avec queue

**Priorite:** P2 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant que chiffreur, je veux voir des notifications toast coherentes pour toutes
> les actions (sauvegarde reussie, export genere, erreur), afin d'avoir un feedback
> visuel constant et non intrusif.

### Criteres d'acceptation

- [ ] Systeme de toast global avec queue (max 3 toasts visibles simultanement,
      les suivants attendent que les precedents disparaissent)
- [ ] 4 types : `success` (vert), `error` (rouge), `warning` (orange), `info` (bleu)
- [ ] Auto-dismiss apres 4 secondes (configurable par toast), dismiss manuel par clic
      ou bouton X
- [ ] Position : en bas a droite, au-dessus du contenu, z-index eleve
- [ ] Animation d'entree : slide-in depuis la droite
- [ ] Animation de sortie : fade-out + slide-down
- [ ] API simple : `toast.success("Sauvegarde reussie")`, `toast.error("Erreur...")`
- [ ] Le provider toast est monte dans une frontiere client sans transformer
      `layout.tsx` en Client Component
- [ ] Les callbacks de queue utilisent des `setState` fonctionnels pour stabilite
      sous rafales de toasts (`rerender-functional-setstate`)
- [ ] Couverture Vitest sur la logique de queue + Playwright sur affichage/dismiss UX

### Notes techniques

- Fichiers a modifier :
  - `src/components/ui/Toast.tsx` — enrichir si necessaire
- Fichiers a creer :
  - `src/components/ui/ToastProvider.tsx` — provider avec queue + render
  - `src/hooks/useToast.ts` — hook pour declencher des toasts depuis n'importe
    quel composant
- Fichiers a modifier :
  - `src/app/dashboard/layout.tsx` — monter le `ToastProvider` via wrapper client
- Dependances : Aucune

---

## UX2-027 — Skeletons de chargement coherents

**Priorite:** P2 | **Effort:** S | **Couches:** `[Front]`

### User Story

> En tant qu'utilisateur, je veux voir des squelettes de chargement qui reprennent la
> structure de la page cible, afin que le chargement paraisse plus rapide et que je
> sache a quoi m'attendre.

### Criteres d'acceptation

- [ ] Composant `Skeleton` generique avec variantes : `text`, `circle`, `rect`, `card`
- [ ] Skeleton specifique pour la liste des affaires (header + 5 cartes grises pulsantes)
- [ ] Skeleton specifique pour le hub affaire (sections resume + timeline + DPGF)
- [ ] Skeleton specifique pour l'editeur (toolbar + 10 lignes de tableau)
- [ ] Les skeletons de route sont exposes via les conventions App Router
      `loading.tsx` (pas uniquement des spinners/conditions client)
- [ ] Les skeletons remplacent les spinners generiques existants
- [ ] Animation pulsante (`animate-pulse`) coherente avec Tailwind
- [ ] Couverture Playwright: verification visuelle des etats loading sur routes cles

### Notes techniques

- Fichiers a creer :
  - `src/components/ui/Skeleton.tsx` — composant de base
  - `src/components/affaires/AffaireListSkeleton.tsx`
  - `src/components/affaires/AffaireHubSkeleton.tsx`
- Fichiers a modifier / creer (routes) :
  - `src/app/dashboard/affaires/loading.tsx`
  - `src/app/dashboard/affaires/[projectId]/loading.tsx`
  - `src/app/dashboard/estimates/[versionId]/edit/loading.tsx` (si segment isole)
- Reutiliser :
  - Classes Tailwind `animate-pulse`, `bg-slate-700/50`
- Dependances : Aucune
