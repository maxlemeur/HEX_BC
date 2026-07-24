# EST-E26 — Handoff Phase C → suite (T6 · réconciliation des totaux)

Document de reprise **pour une autre machine**. Il dit précisément **où on en
est**, **ce qui reste**, et **comment ne pas se tromper**. La spec complète est
`docs/user_story/EST-E26-reconciliation-totaux.md` (référencée par n° de ligne
ci-dessous) ; le handoff Phase B est `EST-E26-HANDOFF-phase-b.md`.

Généré le 2026-07-24.

---

## 0. Reprise en 30 secondes

```bash
git fetch origin && git checkout main && git pull --ff-only
npm run typecheck && npm run lint && npm test   # doit être vert : 0 / 0 / 0 échec
```

- **Branche de travail : `main`.**
- ⚠️ **`3c529ee` n'est plus la tête.** Ce document a été écrit à 17:03 ; ont
  atterri depuis les étapes 11 et 12 (§2.1 b/c) puis cinq correctifs de revue
  (§2.1 d). Se fier à `git log`, pas au SHA cité ici.
- La suite complète (`vitest`) doit désormais être **entièrement verte** : les
  2 rouges décrits en §1 sont corrigés, et `.github/workflows/quality-gate.yml`
  les empêche de revenir.
- Les 3 branches `t6/phase-a-*`, `t6/phase-b-*`, `t6/phase-c-moteur-unifie` sont
  **entièrement mergées dans main** — on peut les ignorer / les supprimer, elles
  n'ont aucun commit d'avance.
- Arbre propre. Les anciens fichiers de test parasites (`zz_*.test.ts`,
  `adv-*.scratch.test.ts`) ont été **supprimés** — la suite est de nouveau saine.

---

## 1. Ce qui est LIVRÉ et mergé sur main (ne pas refaire)

Ordre chronologique (du plus ancien au plus récent) :

| Commit | Étape | Contenu |
|---|---|---|
| `0574539` | A-1 | Filet golden `estimate-calculations.golden.test.ts` (comportement ACTUEL figé, valeurs fausses comprises). |
| `c70267e` | A-2 | Colonne `estimate_versions.calc_engine_version` (migration `20260724090000`, `add column … not null default 1`, PG11+ sans trigger) + helper `resolveCalcEngineVersion` (`src/lib/estimates/calc-engine-version.ts`). |
| `7362338` | A-3 | `src/lib/estimates/calc-context.ts` (`loadEstimateCalcContext`), sans import entrant. |
| `6853d6f` | B-4 | Détection du split MO des exports unifiée sur `hasActiveLaborSplitPayload`. |
| `ee5b242` | B-5 | `isLaborSplitEnabled` **obligatoire** + sémantique unique `&& hasActiveLaborSplitPayload`. |
| `c898976` | B-6 | `marginMode`/`marginTiers` **obligatoires** (fin du repli `?? getMarginTiers()`). Nouveau `src/lib/estimates/margin-tiers-loader.ts` (extrait de `server.ts`, évite le cycle server↔pdf-generator). |
| `b99e5b8` | C-7 | `allocateProRata` — allocation au plus grand reste, Σ parts === amount au centime. |
| `f4b977b` | C-§2.5 | Golden figeant l'arrondi `Math.round` vs `bankersRound` (Fixture I). |
| `8092b29` | C-8 | `computeEstimateBreakdown` — **fonction d'autorité** (invariant Σ lignes = sections = pied), **gatée par `calcEngineVersion`** (v1 délègue au chemin historique → additif, aucun golden ne bascule). |
| `966db09` | C-9 | `computeAllSectionTotals` / `computeSectionTotals` → **wrappers gatés** (leurs `*Input` gagnent `marginMode`/`marginTiers`/`globalCoefficient`/`discountMode`/`discountStepsBp` + `calcEngineVersion` **obligatoires** ; v2 dérive du breakdown, v1 = corps historique inchangé, pas de récursion). |
| `3c529ee` | C-10 | Dédup de la remise stockée des exports (`resolveStoredDiscountCents` → `computeStoredDiscountCents`). |

Tests de réconciliation T1–T8 + gates : `src/lib/estimate-calculations.reconciliation.test.ts`.

**État des suites au 2026-07-24 (sur main) :**

```
node  : 1 failed | 279 passed | 1 skipped   (281 fichiers)
jsdom : 1 failed | 179 passed               (180 fichiers)
tsc   : 0
```

> ⚠️ **CORRECTION (2026-07-24, après revue) — cette section était fausse sur un
> point qui coûtait cher.** Les 2 rouges avaient été qualifiés de « PRÉ-EXISTANTS
> et hors T6, à ne PAS confondre avec une régression ». Ce n'était vrai que pour
> **un** des deux :
>
> - `estimate-editor-supplier-comparison-regressions.test.ts` — **bien
>   pré-existant** : la chaîne « Comparer fournisseurs » avait migré vers le menu
>   contextuel de ligne lors de la décomposition de la table (REF-002), le garde
>   pointait toujours `EstimateEditorTable.tsx`. Vérifié : la chaîne était déjà
>   absente de ce fichier au commit de base de la plage d'audit.
> - `useEstimateEditorBulkController.test.ts` — **RÉGRESSION RÉELLE, introduite
>   par `e6d4ed2`**, le premier commit de la plage d'audit. Il signalait
>   exactement la fermeture du chemin d'écriture d'EST-031 (colonnes de MO
>   éclatée passées en `z.never()` et propagation retirée des payloads). Il a été
>   requalifié « pré-existant » dans trois messages de commit successifs, ce qui
>   a laissé la régression vivre 41 commits.
>
> Les deux sont corrigés. Le test du bulk controller est repassé au vert **sans
> modification de son attendu** — c'est ce qui confirme qu'il détectait un vrai
> défaut. Voir les commits `fix(estimates): rouvrir le chemin d'ecriture de la MO
> eclatee (EST-031)` et `ci: ajouter le garde typecheck / lint / tests unitaires`.
>
> **Leçon à retenir pour la suite du chantier** : aucun job CI n'exécutait
> `vitest`, `tsc` ni `eslint` — seuls Playwright (qui exige des secrets) et le
> backup tournaient. C'est ce trou qui a permis à un test rouge de devenir du
> bruit de fond. Le job `.github/workflows/quality-gate.yml` le comble ; ne pas
> reprendre l'habitude de qualifier un rouge de « pré-existant » sans vérifier son
> antériorité au commit de base (`git show <base>:<fichier>`).

---

## 2. Ce qui RESTE

### 2.1 Fin de la Phase C (2 items)

**(a) Gater `computeReadOnlyTotals` — 🟢 non destructif, à faire en premier.**
- Aujourd'hui `computeReadOnlyTotals` (`src/lib/estimate-calculations.ts:1730`)
  n'a **pas** de paramètre `calcEngineVersion` : c'est le seul des wrappers de
  l'étape 9 resté non gaté (différé volontairement — il lit des **valeurs
  stockées** `line_total_ht_cents` / `total_*_cents`, concern distinct des
  wrappers qui recalculent).
- Même patron que l'étape 9 : ajouter `calcEngineVersion` **obligatoire** à
  l'input ; `v1` = corps historique **strictement inchangé** ; `v2` dérive de
  `computeEstimateBreakdown`. Aucun golden ne doit basculer (tous les appelants
  passent `calcEngineVersion: 1` tant que la Phase F n'a pas basculé).
- Corollaire : `tsc` listera les appelants de `computeReadOnlyTotals` à mettre à
  jour (leur passer `calcEngineVersion: 1`).

**(b) ~~Étape 11 — Supprimer le contournement affaires~~ — ✅ LIVRÉE.**
> Ce document a été rédigé à 17:03 ; l'étape 11 a été livrée à 19:21 par
> `refactor(affaires): analyse de marge sur computeEstimateBreakdown [T6]`.
> La sémantique d'affichage retenue **diverge volontairement de la spec** :
> « Vente HT » reste NETTE (= total du devis) et la marge reste la marge nette
> réelle, au lieu du 65 % → 50 % annoncé — `global_coefficient` étant un vrai
> markup payé par le client. Coefficient et remise sont désormais exposés et
> affichés à part pour cesser d'être lus comme de la marge. Lire le message de
> commit avant de toucher à cet écran.

**(c) ~~Étape 12 — Document dérivé du breakdown~~ — ✅ LIVRÉE** à 19:29 par
`refactor(estimates): document dérivé de computeEstimateBreakdown [T6]`
(`prepareEstimateDocumentData` reçoit `breakdown` + `calcEngineVersion`, le
rebasage sur `line_total_ht_cents` reste un shim v1 explicitement gaté). La
phase D commence donc à l'étape 13.

**(d) Correctifs de revue livrés après ce document — à ne pas refaire.**
Cinq commits issus d'une revue adversariale des 41 commits du 23-24/07 :

| Commit | Objet |
|---|---|
| `fix(estimates): ne plus invalider les sceaux de tout le parc [T6]` | `b74a0c8` invalidait le sceau de **tous** les devis scellés : la migration 029 backfille `k_mo_*` à 1.0 partout, donc le spread `!= null` injectait la clé sur chaque item. Renvoi email bloqué, aucune réparation possible (`seal_hash` immuable). |
| `fix(estimates): rouvrir le chemin d'ecriture de la MO eclatee (EST-031) [T6]` | `e6d4ed2` (`z.never()` + propagation retirée) combiné à `ee5b242` (activation du vrai flag) rendait EST-031 non fonctionnel : création de ligne en 400, éditions perdues. |
| `fix(estimates): aligner l'assiette de la remise sur le flag split [T6]` | `computeInitialDiscountCents` gardait `isLaborSplitEnabled: false` en dur : assiette split OFF, sous-total split ON, total faux **persisté**. |
| `fix(estimates): exiger le role ecrivain sur patch/duplicate…` | `patchEstimateVersion` et `duplicateEstimateVersion` restaient ouverts aux rôles non écrivains ; l'erreur Postgres brute partait au client. |
| `ci: ajouter le garde typecheck / lint / tests unitaires` | Comble le trou de CI décrit en §1. |

### 2.2 Phases D / E / F (spec §3, lignes 203-257)

| Phase | Étapes | Nature |
|---|---|---|
| **D — surfaces de rendu** | ~~12 document partagé~~ ✅ · 13 pied dérivé 🔴 · 14 dédup 3 pages + PDF 🟢 · 15 éditeur 🔴 · 16 sauvegarde cohérente 🔴 | Le plus gros bloc. C'est là que « lignes brutes vs sections nettes » et le pied injecté disparaissent. |
| **E — exports** | 17 XLSX 🔴 · 18 BDC 🔴 · 19 DPGF 🔴 · 20 export éditeur 🟢 | ⚠️ renommer des colonnes BDC/DPGF casse les macros/ré-imports clients : garder l'ancien intitulé une version (spec §4). |
| **F — persistance + bascule** | 21 recalcul serveur autoritaire 🔴 · 22 invalidation cache PDF 🟢 · 23 **bascule contrôlée** 🔴 | **C'est ici qu'on branche enfin la bascule `calc_engine_version` v1→v2** et qu'on applique la migration en base. |

---

## 3. La contrainte de déploiement — LIRE avant de merger quoi que ce soit

Unifier le moteur change **rétroactivement** les totaux de devis déjà
**envoyés / acceptés / scellés** — donc des montants contractuels et des sceaux
d'intégrité (spec §« Contrainte BLOQUANTE », lignes 29-35).

- Le garde-fou `estimate_versions.calc_engine_version` **existe en base** (colonne
  + helper), mais **n'est PAS encore branché** sur la bascule : tout `v2` est
  aujourd'hui explicitement demandé par le code de test, jamais par un devis réel.
- ⚠️ **Attention nouvelle depuis la Phase B** : les étapes 5-6 ont câblé le VRAI
  flag `EST_031_LABOR_SPLIT` et le barème tenant dans les chemins d'**écriture**
  serveur (`recalculateEstimateVersionTotals`, `insertAssemblyIntoVersion`). Ces
  chemins écrivent déjà des `total_ht_cents` **stockés** → toute exécution serveur
  qui recalcule une version peut désormais bouger un total stocké.
- **Règle** : rien des phases C-11 / D / E / F ne se déploie sans la bascule
  progressive de l'étape 23 : brouillons → nouvelles versions → opt-in des `sent`
  **non signées** → **jamais** les `accepted` / scellées. Un test de
  non-écriture sur version scellée est attendu (spec T14,
  `workflow-write-security-regressions.test.ts`).

---

## 4. Pièges vérifiés (ne pas se faire avoir)

1. **Deux projets vitest.** `--project=node` **exclut** `src/hooks/**` et
   `src/components/**`. Valider en node seul ne teste jamais les fixtures des
   hooks/composants → **toujours lancer aussi `--project=jsdom`.**
2. **Les golden figent des valeurs FAUSSES.** Toute étape qui corrige une
   divergence fera basculer un snapshot : le mettre à jour **intentionnellement**,
   en vérifiant qu'il va vers la réconciliation (lignes = sections = pied), avec
   un commentaire pointant la divergence corrigée. **Jamais `-u` en aveugle.**
3. **Couverture réelle 2/6.** Seuls le moteur et le document (via
   `prepareEstimateDocumentData`) sont couverts en pur. Éditeur, pages RSC, XLSX,
   PDF portent un bloc `COUVERTURE PARTIELLE` → les changements des phases D/E
   **échappent au filet**, prévoir vérif intégration.
4. **La migration `calc_engine_version` est un FICHIER non appliqué** à la base
   distante. `resolveCalcEngineVersion` la lit ; l'appliquer côté Supabase relève
   du rollout (Phase F), pas d'ici.
5. **2 rouges pré-existants** (cf. §1) : ne pas les prendre pour des régressions,
   vérifier l'antériorité par `git stash` avant d'accuser son propre travail.

---

## 5. Commandes de validation (à chaque étape)

```bash
npx tsc -p tsconfig.json --noEmit
npx eslint <fichiers-touchés> --max-warnings=0
npx vitest run --project=node --project=jsdom \
  src/lib/estimate-calculations.golden.test.ts \
  src/lib/estimate-calculations.reconciliation.test.ts \
  src/lib/estimate-calculations.test.ts
```

Avant de committer : `git status --short` (rien de non voulu), rester sur `main`,
**un commit testé par étape**, sujet en Conventional Commits avec `[T6]`, trailer
`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## 6. Résiduels indépendants (hors épic, notés pour mémoire)

- **Écrêtage int32 par ligne** non remonté (seul le sous-total l'est, cf.
  `6cba58d`) : le breakdown par ligne l'exposera naturellement.
- **Persistance auto-contradictoire de l'éditeur**
  (`useEstimateEditorState.impl.tsx:1309-1316` : `global_coefficient=1` +
  `discount_steps=[]` alors que `total_ht_cents` est calculé avec le coefficient)
  — l'étape 16 (Phase D) la corrige, mais elle est aussi traitable à part.
