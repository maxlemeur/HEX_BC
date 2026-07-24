# Handoff — backlog d'audit (hors T6)

Reprise **sur une autre machine** du chantier issu de l'audit produit (dogfooding
+ UX/UI par persona du monde du chiffrage). Ce document capture le **reste à
faire hors épic T6** — ces tickets ne vivaient que dans une todo de session et
seraient perdus sinon.

- **Épic T6 (réconciliation des totaux)** : traité à part, ne PAS le redécrire ici.
  → `docs/user_story/EST-E26-HANDOFF-phase-c.md` (état + reste C/D/E/F + contrainte
  de déploiement) et la spec `docs/user_story/EST-E26-reconciliation-totaux.md`.

Généré le 2026-07-24.

---

## 0. Reprise en 30 secondes

```bash
git fetch origin && git checkout main && git pull --ff-only
npx tsc -p tsconfig.json --noEmit    # attendu : 0
```

- Branche : **`main`**. ⚠️ Ce document date du 2026-07-24 17:53 : `main` a avancé depuis (étapes T6 11/12, cinq correctifs de revue, gate `computeReadOnlyTotals`). Se fier à `git log`, pas à cette ligne.
- **25 correctifs d'audit livrés** sur main (voir `git log`, exclure `[T6]`) +
  Phase A/B/C(7-10) de T6.
- Le rapport d'audit navigable (artefact) : les 27 bugs vérifiés + 73 constats
  UX/UI par persona → `https://claude.ai/code/artifact/91124126-27a6-4450-ac6d-b9b7745b0403`.

---

## 1. Reste à faire — hors T6

Ordre indicatif de priorité (impact décroissant / effort croissant).

### 1.1 T1b — Héritage TVA/devise/arrondi + pricing template — MOYEN
La **marge** est déjà corrigée (`12550bc`). Reste : quand on crée une **nouvelle
version d'une affaire existante**, précharger TVA / devise / arrondi de la
dernière version (aujourd'hui le wizard force 20 % / EUR).
- Fichiers : `src/components/estimates/estimate-creation-wizard/submitEstimateCreation.ts`,
  `src/components/estimates/hooks/useEstimateCreationResources.ts`,
  `.../estimate-creation-wizard/shared.ts`, `src/lib/estimates/client.ts` (`createEstimate`).
- Approche : **préchargement** (le wizard appelle déjà
  `/api/affaires/[projectId]/dpgf-source` au montage → étendre `getAffaireLinkedDpgfSource`
  pour renvoyer aussi le pricing de la dernière version, ou ajouter un petit read).
  ⚠️ **Ne PAS** partir sur un « blanc = hériter » : `NumberInput` a `emptyValue=0`,
  un champ vidé renverrait 0 % TVA (pire que le bug).
- Sous-partie M7 : `instantiateEstimateFromTemplate` ignore marge/TVA/devise/arrondi
  saisis à l'étape Paramètres — les lui passer.

### 1.2 UX-D — Portail client (CGV / PDF / contact / parité) — bloquant confiance
- `src/app/portal/[token]/page.tsx` ne transmet ni `terms`/`exclusions`, ni `layout`,
  ni contact émetteur à `EstimateDocument` → le client **accepte des CGV qu'il ne
  peut pas lire** (case obligatoire dans `AcceptEstimateModal`), et le portail peut
  diverger du PDF reçu par email.
- Ajouter : affichage des CGV avant la case ; bouton **Télécharger le PDF** ;
  coordonnées émetteur sur `expired/page.tsx` et `not-found.tsx` ; `print:hidden`
  sur les boutons d'action.

### 1.3 UX-E — Éditeur : le langage métier du chiffreur — bloquant/majeur
- **Sous-détail de prix par ligne** : aucune colonne déboursé sec / coût de revient
  ni marge/PV par ligne (le fondement du chiffrage). `LineRow.tsx` montre `pu_ht_cents`
  (vente, lecture seule) et `line_total_ht_cents`.
- `grandTotals` (`EstimateEditorTable.tsx:1967-1981`) ne somme que les enfants racine
  de type `section` → une ligne de niveau racine est **exclue du pied**.
- Création de ligne au clavier (Ctrl+Entrée), navigation **bornée** (le wrap `mod()`
  de `useSpreadsheetNavigation.ts` désoriente), colonnes Désignation + PU/Total **figées**.

### 1.4 UX-A reste — accents FR internes — mécanique, gros volume
Le **client-facing est fait** (`5503cd7` portail/document, `9de6a46` chaînes cassées).
Reste l'interne : éditeur (`EstimateEditorBody/Table`, `SectionRow`, `LineRow`,
`estimates/new/page.tsx`), affaires (`AffairesPageClient`, `AffaireHub`,
`EstimateEventsTimeline`), takeoff, achats (`suppliers`, `SupplierComparisonPanel`,
`orders`). Idéalement + une **règle lint** anti-régression pour geler le gain.

### 1.5 UX-F — Constats UX restants (métré / direction / achats / pilotage)
- **Métré** : aucun visualiseur de plan dans `EvidencePanel` (attente n°1 du métreur).
- **Pilotage** : aucune date d'envoi/échéance (`AffairesDenseTable`/`CardList`/hub
  n'affichent que `updatedAt`) → impossible de piloter les relances.
- **Direction** : `SealIntegrityBadge` absent du cockpit et de la file d'approbation ;
  tri de la file d'approbation **mort** (`ApprovalQueuePage` `onDirectionToggle` no-op) ;
  **forçage de gating sans motif** (`EstimateSendGatingDialog`) ; `MarginTiersManager`
  sans garde-fous ni aperçu de marge.
- **Achats** : la comparaison fournisseur n'affiche **aucun écart chiffré** (€ / %) ;
  carte de stats « Vieillissant (30-90j) » manquante.
- **Dette** : `EstimateDashboard.tsx` mort (route `/estimates/dashboard` redirige vers
  `/analytics`) ; enum `review_laurent` (nom de dev figé dans une contrainte CHECK +
  contrat + OpenAPI).

### 1.6 T16 — Parsing 3 décimales — PLAUSIBLE, **à CADRER avant de coder**
`clipboard.ts:307` (`normalizeSingleSeparatorNumber`) et `money.ts:63`
(`parseEuroInputToNumber`) interprètent « 2,500 » / « 2.500 » comme séparateur de
**milliers** (×1000). Ambigu par nature (2,500 = 2,5 ou 2500 ?) : c'est une **décision
produit** (quantités BTP en tonnes/m³ à 3 décimales vs prix). Corriger sans cadrage
risque de casser d'autres cas → **ne pas bâcler**.

### 1.7 T18 — PU×Qté ≠ Total au centime — design → probablement absorbé par T6
`puHtCents` est arrondi indépendamment (`estimate-calculations.ts:216`). Le
**breakdown** de T6 expose `puNetHtCents` cohérent : **traiter dans T6** plutôt qu'à
part.

---

## 2. Sous-tickets & suites (issus de correctifs déjà livrés)

- **T3 (a)** — Le badge « Meilleur prix » (`buildSuggestedCatalogueAlternatives`,
  `server.ts:~1168`) classe encore **sans conversion de devise**. Depuis `5d21030`,
  `currency` est portée par le candidat → restreindre le classement aux candidats de
  la devise du devis (passer `estimateCurrency`).
- **T3 (b)** — Conversion **réelle par taux** : `currency-rates.ts` n'a **pas** de
  helper `convertCents` (devise pivot, taux manquants, affichage taux/date) → chantier
  dédié.
- **T2 option-C (a) — ⚠️ AVANT DÉPLOIEMENT** : le garde-fou `91b9906` rend
  **non insérables** les ouvrages contenant un composant `labor` sans rôle. Si de tels
  ouvrages existent en base, **migrer** ces composants vers un rôle portant leur taux
  d'abord, sinon des chiffreurs buteront sur le blocage.
- **T2 option-C (b)** — Fermer le geste dans `AssemblyEditorDialog` : quand l'utilisateur
  tape un taux horaire, proposer de créer/sélectionner un **rôle** à ce taux.
- **T4 résiduel** + **bug persistance éditeur** (chercher le motif `global_coefficient: discountMode === "cascade" ? globalCoefficient : 1` dans `useEstimateEditorState.impl.tsx` — vérifié le 24/07 : toujours présent, sur DEUX sites ; les lignes 1309-1316 citées à l'origine ont bougé)
  → déjà notés dans `EST-E26-HANDOFF-phase-c.md` §6 (l'étape 16 de T6 corrige le second).

---

## 3. Livré sur main (rappel, ne pas refaire)

25 correctifs d'audit + T6 A/B/C(7-10). Les hashes hors-T6 :
`git log --oneline --grep='\[T6\]' --invert-grep e6d4ed2^..HEAD`. Notamment, par thème :
argent/sécurité (`12550bc` marge, `e10b045` gating, `a4d87c5` rôle écrivain,
`b74a0c8` sceau MO — ⚠️ ce commit invalidait en réalité le sceau de TOUT le parc, corrigé depuis (voir handoff Phase C §2.1 d), `5d21030`/`30a8b85` devise fournisseur, `91b9906`+`26332ba`
assemblages, `6cba58d` int32) · fiabilité (`ec13f18` qté décimale, `8a685cf` filtre
prix, `6c5b5cc` reconcile, `1d7ae68` BDC, `c211dbb` diff, `e905d6d` DPGF,
`b12b277` takeoff) · UX (`5503cd7`/`9de6a46` accents client, `3d5aaab` confirm
suppression, `9259f03`/`ce09a53`/`12d77a8` accessibilité clavier).

---

## 4. À savoir (pièges & bruit)

1. ~~**2 tests rouges PRÉ-EXISTANTS, hors périmètre**~~ — **CORRIGÉ, et le constat
   était faux pour l'un des deux.** `useEstimateEditorBulkController.test.ts` n'était
   pas pré-existant : il est devenu rouge avec `e6d4ed2` et signalait une vraie
   régression (fermeture du chemin d'écriture d'EST-031). Requalifié « pré-existant »
   trois fois de suite, il a laissé le défaut vivre 41 commits. Détail et leçon dans
   `EST-E26-HANDOFF-phase-c.md` §1.
   **La suite doit désormais être ENTIÈREMENT verte** (`npm test`), et
   `.github/workflows/quality-gate.yml` (typecheck + lint + tests) l'impose sur chaque
   PR et push. Un rouge = une régression, sans exception : vérifier l'antériorité par
   `git show <base>:<fichier>` avant de qualifier quoi que ce soit de pré-existant.
2. **Deux projets vitest** : `--project=node` **exclut** `src/hooks/**` et
   `src/components/**`. Toujours valider aussi `--project=jsdom`.
3. **Fichiers untracked à NE PAS committer** : `.codex-security-work/`, `design-qa.md`,
   `option-3-*.png`, `.claude/launch.json` (artefacts locaux / autres outils).
4. Rester sur `main`, un commit testé par ticket, Conventional Commits, trailer
   `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`, **sans push** sauf demande.
