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
