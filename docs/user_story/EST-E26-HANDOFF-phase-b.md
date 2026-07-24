> ⚠️ **DOCUMENT HISTORIQUE — la phase B est livrée.** Conservé pour la trace du
> raisonnement ; son état de dépôt (« 30 commits d'avance, non poussés ») et ses
> numéros de ligne sont périmés. Pour reprendre le chantier, lire
> `EST-E26-HANDOFF-phase-c.md` puis la spec `EST-E26-reconciliation-totaux.md`.

# EST-E26 — Handoff Phase B (T6 · réconciliation des totaux)

Document de reprise pour la session qui exécutera la **Phase B**. Il ne contient
pas la spec : il dit **où elle est** et **dans quel état on part**.

---

## 1. Où se trouve la spec de la Phase B

Tout est dans **`docs/user_story/EST-E26-reconciliation-totaux.md`** :

| Ce qu'il te faut | Section | Lignes |
|---|---|---|
| **Les 3 étapes de la Phase B** (durcissement du contrat) | §3 → « Phase B » | **161-180** (étapes 4, 5, 6) |
| **Le contrat cible** vers lequel ces étapes tendent | §2.1 « Fonction unique » | 59-104 |
| Convention d'arrondi (⚠️ Phase C, pas B) | §2.5 | 136-139 |
| Diagnostic (cause racine : deux moteurs parallèles) | §1 | 47-56 |
| Risques de régression | §4 | 260-274 |
| Tests à écrire — dont **T5** (`isLaborSplitEnabled`) et **T6** (`marginTiers`) qui valident précisément la Phase B | §5 | 275-345 |
| Contrainte de déploiement bloquante | en-tête « ⚠️ » | 29-35 |

L'inventaire vérifié des **40 divergences** (56 agents, adversarial) est résumé
dans la description du **ticket T6** de la todo de session, et matérialisé par le
filet golden : `src/lib/estimate-calculations.golden.test.ts`.

---

## 2. État de départ (déjà livré, ne pas refaire)

- Branche : **`main`**, 30 commits d'avance sur `origin/main`, **non poussés**. `tsc` = 0.
- **Phase A complète** (non destructive) :
  - `0574539` — filet golden (36 tests, comportement ACTUEL figé, valeurs fausses comprises).
  - `c70267e` — colonne `estimate_versions.calc_engine_version` (`add column if not exists … default 1` ; métadonnée pure PG11+, aucun trigger, audit/`updated_at` intacts).
  - `7362338` — `src/lib/estimates/calc-context.ts` (`loadEstimateCalcContext`), volontairement sans import entrant.
  - `cc65a91` — la spec (EST-E26) versée dans le repo.

---

## 3. Portée exacte de la Phase B (étapes 4-6)

But : **faire du compilateur l'auditeur**. On rend obligatoires les paramètres
aujourd'hui optionnels ; `tsc` liste alors chaque site d'appel divergent, qu'on
corrige un par un. Aucune nouvelle fonction moteur ici (ça, c'est Phase C).

- **Étape 4 🔴 — Unifier la détection du payload split.** Supprimer les
  `isLaborSplitEnabled(item)` locaux de `export-stream.ts:136`,
  `dpgf-export.ts:206`, `bdc-export.ts:155` (ils testent `h_mo_atelier !== null`,
  la canonique teste `> 0`). Diverge déjà : une ligne à 1 300,00 € rendue à 0.
- **Étape 5 🔴 — Rendre `isLaborSplitEnabled` obligatoire et non ambigu.**
  Retirer les trois sémantiques (`?? hasSplitPayload` l.197, `&& hasActive…` l.738,
  `= false` l.836/1183) au profit d'un booléen requis unique.
- **Étape 6 🔴 — Rendre `marginTiers` et `marginMode` obligatoires** (fin du
  repli implicite `getMarginTiers()` codé en dur, §2.1).

Ces 3 étapes changent des comportements visibles (marquées 🔴).

---

## 4. À savoir AVANT de commencer (pièges vérifiés)

1. **Les golden vont ÉCHOUER — c'est le but.** Le filet fige le comportement
   *actuel, faux*. Chaque correction de Phase B fera diverger un snapshot :
   **mettre à jour chaque snapshot intentionnellement**, en vérifiant que la
   nouvelle valeur va vers la réconciliation (lignes = sections = pied), jamais
   par `--update` aveugle.
2. **Couverture réelle 2/6.** Seuls le moteur et le document (via
   `prepareEstimateDocumentData`) sont couverts en pur. Éditeur, pages RSC, XLSX
   et PDF portent un bloc `COUVERTURE PARTIELLE` : les changements Phase B sur ces
   surfaces **échappent au filet** → prévoir vérification intégration / manuelle.
3. **`bankersRound` vs `Math.round` n'est pas encore figé.** Sans conséquence en
   Phase B, mais **à couvrir par un golden avant** l'unification d'arrondi de
   §2.5 (Phase C), sinon le ±1 c est invisible.
4. **La migration `calc_engine_version` est un FICHIER non appliqué** à aucune
   base. `resolveCalcEngineVersion` la lit. L'appliquer (côté Supabase, hors
   session non interactive et sous réserve d'autorisation) fait partie du rollout
   (Phase F), pas de la Phase B.
5. **Validation : `node` ET `jsdom`.** `--project=node` saute `src/hooks/**` :
   valider en node seul n'exécute jamais les fixtures des hooks touchées.

---

## 5. Première action recommandée

Point d'entrée à moindre risque = **Étape 5**, la plus révélatrice :

1. Dans `src/lib/estimate-calculations.ts`, retirer le `?` de
   `isLaborSplitEnabled` sur les signatures d'entrée (`computeEstimateTotals`,
   `computeAllSectionTotals`, `computeEstimateLineSaleSplit`, `normalizeDraftItems`).
2. Lancer `npx tsc --noEmit` : la liste d'erreurs = l'inventaire des appelants à
   corriger, fourni par le compilateur.
3. Corriger chaque appelant pour passer le flag réel (via `loadEstimateCalcContext`
   côté serveur ; côté éditeur, remplacer le `const isLaborSplitEnabled = false`
   codé en dur de `useEstimateEditorState.impl.tsx:290`).
4. Constater les golden qui basculent, les revoir un par un, mettre à jour.

---

## 6. Commandes de validation (à chaque étape)

```bash
npx tsc --noEmit
npx eslint <fichiers-touchés> --max-warnings=0
npx vitest run --project=node --project=jsdom src/lib/estimate-calculations.golden.test.ts src/lib/estimate-calculations.test.ts
```

Puis, avant de committer : `git status --short` (rien de non voulu), et rester sur
`main`, un commit testé par étape, sans push.

---

## 7. Deux résiduels indépendants (hors Phase B, mais notés)

- **Écrêtage int32 par ligne** non remonté (seul le sous-total l'est, cf. `6cba58d`) :
  le breakdown par ligne de Phase C l'exposera naturellement.
- **Persistance auto-contradictoire de l'éditeur** (`useEstimateEditorState.impl.tsx:1309-1316` :
  `global_coefficient=1` + `discount_steps=[]` alors que `total_ht_cents` est calculé
  avec le coefficient) — corrigeable **hors** épic.
