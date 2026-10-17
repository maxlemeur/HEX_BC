# Moteur v3 pur — piste A, moteur TypeScript (sous-lot 2.4)

Statut : **implémenté, vérifié en local** (17/10/2026). Les tests d'exigence ont été écrits rouges
(commit `de2c86db`, `test(lot2-2.4)`, sur `lot2/2.4-moteur-v3-pur`, base `e30560f4` = `main` + 2.1) ;
le commit `feat(lot2-2.4)` les fait passer sans en modifier une assertion (voir
[Implémentation](#implémentation-et-vérification-17102026)). Source : [conception du lot 2](../audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md),
§0, §2, D1, D4 à D9, D12, D13, D18, §4, §5, §6.1 (M3), §6.2, §6.5, §7, §8.1, §10.1 et §14 « 2.4 ».
Là où ce document résume la conception, la conception fait foi.

Périmètre de cette piste : `src/lib/estimates/engine-v3/*`, la branche v3 de la façade
`src/lib/estimates/engine/compute.ts` et ce document. Hors piste (autres pistes du sous-lot) :
référentiel d'unités (`src/lib/units/*`), migration M3, jumeau SQL, `scripts/engine-v3/*`
(parité, lots OPTIMA). Code **inerte** : aucun écran, aucun écrivain, aucune v3 ne peut être
créée ; `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` restent à zéro
ligne de diff.

## Contrat défini avant l'implémentation

Calcul (conception §4, D13), en décimal exact (BigInt, jamais de flottant sur un montant) :

| Étape | Règle |
|---|---|
| Ligne `priced` | FO_u = P × k_fo ; MO_u = maj × h × t × k_mo, ou maj × (h_at × t_at × k_at + h_ch × t_ch × k_ch) avec la ventilation ; PU = ⌈FO_u × c_FO + MO_u × c_MO⌋ (un seul arrondi) ; B = ⌈Q × PU⌋ ; FO/MO bruts = répartition exacte de B selon (FO_u × c_FO, MO_u × c_MO) ; atelier/chantier bruts = répartition de la MO brute ; D = ⌈Q × (FO_u + MO_u)⌋ ; h_mo* = arrondi(Q × h/u, 3) |
| Ligne non chiffrée | `included`, `for_memory`, `not_priced`, `out_of_scope`, `not_applicable` : 0 partout, PU nul, saisies conservées, avertissement `ESTIMATE_V3_LINE_NOT_PRICED` |
| Pied | G = Σ B ; R = min(M, G) ou min(⌈G × bp / 10 000⌋, G) ; A = (G − R) mod s en mode `down` ; N = G − R − A ; réduction de ligne = répartition de R + A selon les B ; nets FO/MO et atelier/chantier par répartition |
| TVA | par taux r : base_r = Σ nets, T_r = ⌈base_r × r / 10 000⌋ (0 en autoliquidation) ; TVA de ligne = répartition de T_r selon les nets du groupe |
| Totaux | `total_ttc = N + Σ T_r`, `rounding_adjustment = 0`, coefficient réalisé = N / Σ D à 6 décimales (« 1.000000 » si N = Σ D = 0, nul si seul Σ D = 0) |
| Erreurs | `ESTIMATE_V3_INPUT_INVALID` (SQLSTATE 22023) ; `ESTIMATE_AMOUNT_OVERFLOW` (22003) au-delà de 2 147 483 647 c, jamais d'écrêtage |
| Répartition | plus grand reste en entiers ; ex aequo par clé croissante (uuid en minuscules ; `fo` < `mo`, `atelier` < `chantier`) ; W = 0 : parts égales, reste par clé |

API publique attendue (`@/lib/estimates/engine-v3`) : `computeEstimateV3Breakdown`,
`computeEstimateV3Canonical` (adaptateur JSON canonique pour la parité TS/SQL),
`projectEstimateV3Snapshot` (colonnes et contexte §6.5), `readStoredEstimateV3` (relecture d'une
v3 figée), `computeEstimateV3NetMarginBp`, `allocateExact` (`engine-v3/allocate`), erreur
`EstimateV3Error` (`code`, `sqlstate`). Façade : `computeVersionBreakdown({ calcEngineVersion: 3,
v3 })` renvoie le résultat v3 (son propre type, jamais un `EstimateBreakdown` v2) ; 1 et 2
inchangés.

## Défaillances observables et preuves

| Id | Défaillance | Preuve |
|---|---|---|
| F-V3-01 | PU arrondi deux fois, calculé en flottant ou à partir du total : un centime d'écart sur un demi-centime | `oracle.test.ts` (O1–O7 aux deux jeux de coefficients) ; `requirements.test.ts` T-PU, A-05, T-HALF3 |
| F-V3-02 | Heures lues comme un total de ligne : la MO ne suit pas la quantité | T-HMO, T-HMO-Q, T-Q0 ; heures dérivées (O1 : 39,820 h) |
| F-V3-03 | Brut ≠ ⌈Q × PU⌋, ou PU qui dépend de Q | `properties.test.ts` (500 devis, recalcul BigInt indépendant, requantification) |
| F-V3-04 | Répartition inexacte (Σ ≠ montant), dépendante de l'ordre d'entrée, ex aequo non déterministes, unité donnée à un poids nul | `allocate.test.ts` (10 000 tirages, permutation, W = 0, départage) ; S5 `[5, 1, 2, 23, 0, 69, 1]` |
| F-V3-05 | Remise : intentions mélangées, taux dérivé d'un montant, remise non plafonnée | EU01, EU01-b, EUHIST (`discount_bp` reste 1 000), CAP (« demandé / appliqué »), refus de l'intention double |
| F-V3-06 | Arrondi commercial hors base de TVA, ou ajustement après le TTC | S4, T-TAXSNAP, R1-ARR (`rounding_adjustment_cents = 0`) |
| F-V3-07 | TVA ligne à ligne au lieu de par taux sur la base nette | S5 (1 325 525 et non 1 325 527), T-TVA-ARR (20 c et non 21), A-06 (ΔTVA 40 c), T-TVA1, autoliquidation |
| F-V3-08 | Écrêtage silencieux d'un montant hors entier PostgreSQL | T-CAP (`ESTIMATE_AMOUNT_OVERFLOW`, 22003) |
| F-V3-09 | Palier ou non-monotonie : un coût plus élevé donne un PU ou un HT plus bas | T-MONO ; propriété de monotonie |
| F-V3-10 | Ligne non chiffrée comptée dans un total | T-STAT ; propriété : retirer les lignes non chiffrées ne change aucun total |
| F-V3-11 | Marque nette fausse : 0 au lieu d'indéterminé, coefficient réalisé faux | T-MARG (marque 0 %, sous 15 %) ; coefficient « 1.000000 » / nul |
| F-V3-12 | Entrée invalide lue comme 0, tronquée ou arrondie (décimales en trop, NaN, infini, négatif, exposant, 0,1 + 0,2) | 18 refus nommés `ESTIMATE_V3_INPUT_INVALID` ; lecture par la chaîne la plus courte (`String(n)`) |
| F-V3-13 | Façade : v3 routée vers le moteur v2, résultat v3 converti en `EstimateBreakdown`, ou v1/v2 modifiés | `engine/compute.test.ts` (branche v3, v1/v2 identiques octet pour octet, appel non adapté refusé) |
| F-V3-14 | Forme JSON canonique divergente du jumeau SQL (clés, ordre, échelles, sections) | `requirements.test.ts`, adaptateur canonique |
| F-V3-15 | Relecture d'une v3 figée incohérente acceptée (Σ nets ≠ HT, ajustement non nul) | `requirements.test.ts`, lecteur figé (`ESTIMATE_V3_STORED_INCOHERENT`) |
| F-V3-16 | Projection : contexte §6.5 mal formé, intention de remise réécrite | EU01 (contexte exact du §6.5), EUHIST |

## Pourquoi ces tests sont en isolation

`AGENTS.md` exige un E2E d'abord et n'admet l'isolation que pour une défaillance qu'un E2E ne
peut pas reproduire. Ici, aucun E2E ne le peut : en 2.4 le moteur v3 est **inerte** (aucune
version 3 ne peut être créée, aucun écran ni écrivain ne l'appelle ; conception §14 « 2.4 » :
« aucun parcours nouveau »). Les défaillances visées sont précisément les exceptions admises :

- montants au demi-centime près, tolérance 0 c (§5.5) : un centime d'écart sur une ligne d'un
  devis de 69 000 € ne se voit pas à l'écran et ne s'établit que par un attendu exact ;
- 10 000 tirages de répartition et 500 devis aléatoires : erreurs d'intégrité (Σ, ordre,
  départage) qui n'apparaissent que sur des volumes impossibles à parcourir en E2E ;
- cas limites d'analyse des entrées (décimales en trop, valeurs non finies, exposants) ;
- contrat JSON partagé avec le jumeau SQL (parité TS/SQL), vérifié ensuite par le harnais de la
  piste SQL.

Les parcours E2E v3 arrivent avec les écrivains (2.5) et l'éditeur (2.6).

## Interprétations (à valider par la piste SQL et l'intégration)

1. **Négatifs refusés** : D13 ne définit le demi supérieur que pour des valeurs positives ;
   toute entrée négative est refusée (`ESTIMATE_V3_INPUT_INVALID`). Point ouvert : ristournes ou
   lignes de moins-value négatives (hors lot 2).
2. **Valeurs nulles** : quantité, PR, heures par unité et taux horaires nuls valent 0 ;
   `k_fo`, `k_mo`, `k_mo_atelier`, `k_mo_chantier` et `h_mo_majoration` nuls valent 1 (comme la
   v2). `tax_rate_bp` et `pricing_status` sont obligatoires sur toute ligne.
3. **Déclenchement de la ventilation** : `labor_split_enabled` et, comme
   `hasActiveLaborSplitPayload`, une charge active, transposée aux colonnes v3 : h_at/u > 0,
   h_ch/u > 0, taux atelier ou chantier non nul (la présence d'un rôle devient la présence de son
   taux dans l'entrée), `k_mo_atelier` ou `k_mo_chantier` ≠ 1.
4. **Heures dérivées** : chaque `h_mo*` vient de sa colonne par unité ; nulle si la colonne par
   unité est nulle. Ligne non chiffrée : quantité effective 0 (donc « 0.000 »). Une heure dérivée
   au-delà de `numeric(12,3)` lève `ESTIMATE_AMOUNT_OVERFLOW` (22003, comme PostgreSQL).
5. **Échelles d'entrée** (schéma vivant) : quantité, `k_fo`, `k_mo*` en 3 décimales ;
   `h_mo_majoration` et heures par unité en 4 ; coefficients de vente en 4, dans ]0 ; 10] ;
   centimes, taux horaires, `tax_rate_bp` (0 à 10 000), `discount_bp` (0 à 10 000) et pas
   d'arrondi (≥ 1) entiers. Les nombres JS sont lus par `String(n)` ; une notation à exposant est
   refusée. Une chaîne décimale est aussi acceptée.
6. **Récapitulatif de TVA** : une ligne par taux distinct des lignes chiffrées (base 0 comprise),
   par taux croissant ; les lignes non chiffrées n'y figurent pas.
7. **Sorties** : seules les lignes `line` figurent dans la sortie, dans l'ordre d'entrée ; les
   sections ne portent aucun montant et sont ignorées. Identifiants : uuid obligatoire, mis en
   minuscules, unique.
8. **Contexte §6.5** : nombres JSON comme dans l'exemple de la conception (le JSON canonique de
   parité garde, lui, des chaînes à échelle fixe) ; `labor_roles` est passé par l'appelant (2.5).
9. **Marque nette** (T-MARG) : `computeEstimateV3NetMarginBp` = ⌈(N − Σ D) × 10 000 / N⌋, nulle si
   N = 0 ; la règle `min_margin` elle-même reste en 2.5.
10. **T-MARG** : la conception ne fixe pas la ligne ; on prend Q 4, PR 10 000 c, 0,5 h/u à
    4 000 c/h, c 1,25 / 1,25, remise 20 %.
11. **T-STAT** : le libellé « Hors lot » relève du référentiel des statuts et du document (2.7) ;
    la piste A vérifie la contribution nulle et l'avertissement.
12. **Façade** : `computeVersionBreakdown` garde sa signature v1/v2 ; une surcharge
    `{ calcEngineVersion: 3, v3 }` renvoie `EstimateV3Breakdown`. Un appel v3 de forme v1/v2 (sans
    `v3`) lève toujours `EstimateEngineUnavailableError` (appelant non adapté, échec fermé) : seul
    le titre et le transtypage du test 2.1 changent, pas son assertion.

## Preuve rouge

Commande, sur `e30560f4` plus les seuls fichiers de test (17/10/2026, Windows, Node 24) :
`npx vitest run --project=node src/lib/estimates/engine-v3 src/lib/estimates/engine`.

```text
 FAIL  |node| src/lib/estimates/engine/compute.test.ts
Error: Cannot find package '@/lib/estimates/engine-v3' imported from …/engine/compute.test.ts
 FAIL  |node| src/lib/estimates/engine-v3/allocate.test.ts
Error: Cannot find package '@/lib/estimates/engine-v3/allocate' imported from …/engine-v3/allocate.test.ts
 FAIL  |node| src/lib/estimates/engine-v3/oracle.test.ts
Error: Cannot find package '@/lib/estimates/engine-v3' imported from …/engine-v3/oracle.test.ts
 FAIL  |node| src/lib/estimates/engine-v3/properties.test.ts
Error: Cannot find package '@/lib/estimates/engine-v3' imported from …/engine-v3/properties.test.ts
 FAIL  |node| src/lib/estimates/engine-v3/requirements.test.ts
Error: Cannot find package '@/lib/estimates/engine-v3' imported from …/engine-v3/requirements.test.ts
 Test Files  5 failed | 2 passed (7)
      Tests  19 passed (19)
```

Les deux fichiers verts sont déjà livrés et retenus par le filtre : `engine/capabilities.test.ts` (2.1)
et `engine-frozen-corpus.test.ts` (2.0, corpus figé v1/v2). Les cinq fichiers de 2.4 échouent parce
que le moteur v3 n'existe pas.

## Implémentation et vérification (17/10/2026)

Modules (`src/lib/estimates/engine-v3/`, lignes non vides, plafond 1 200) : `decimal.ts` (107),
`allocate.ts` (66), `input.ts` (177), `line.ts` (139), `discount.ts` (30), `tax.ts` (40),
`breakdown.ts` (192), `canonical.ts` (61), `projection.ts` (133), `stored.ts` (200), `errors.ts`
(54), `types.ts` (139), `index.ts` (31) ; `oracle.fixtures.ts` (230). Façade
`engine/compute.ts` (51). Aucun import de `estimate-calculations.ts` ni d'`estimate-allocation.ts`
dans `engine-v3/` ; `bankersRound` et `allocateProRata` ne sont pas utilisés.

API publique (`@/lib/estimates/engine-v3`) :

| Export | Signature |
|---|---|
| `computeEstimateV3Breakdown` | `(input: EstimateV3Input) => EstimateV3Breakdown` |
| `computeEstimateV3Canonical` | `(input: unknown) => EstimateV3CanonicalOutput` (objet ou texte JSON) |
| `projectEstimateV3Snapshot` | `(breakdown, { laborRoles? }) => { items, version, context }` (colonnes figées et contexte §6.5) |
| `readStoredEstimateV3` | `({ version, items }) => StoredEstimateV3View` (aucun recalcul) |
| `computeEstimateV3NetMarginBp` | `({ total_ht_cents, cost_subtotal_cents }) => number \| null` |
| `allocateExact` | `(amount: bigint, entries: { key: string; weight: bigint }[]) => bigint[]` |
| `EstimateV3Error` | `code` ∈ `ESTIMATE_V3_INPUT_INVALID` (22023), `ESTIMATE_AMOUNT_OVERFLOW` (22003), `ESTIMATE_V3_STORED_INCOHERENT` ; `sqlstate`, `field` |
| Façade | `computeVersionBreakdown({ calcEngineVersion: 3, v3 })` → `EstimateV3Breakdown` ; `{ calcEngineVersion: 1 \| 2, … }` → `EstimateBreakdown` inchangé |

Écarts et précisions d'implémentation :

- Une ligne non chiffrée n'est pas calculée (ni PU ni contrôle de dépassement sur ses saisies) :
  elle ne contribue à rien. Le jumeau SQL doit faire de même pour que les erreurs coïncident.
- Avertissement `ESTIMATE_V3_LABOR_RATE_MISSING` si une ligne chiffrée porte des heures sans taux
  (le taux nul vaut 0, comme en v2) ; hors sortie canonique.
- Les invariants du §4 sont revérifiés à la fin de chaque calcul ; une violation lève
  `ESTIMATE_V3_ENGINE_INVARIANT_BROKEN` (défaut du moteur, jamais un résultat).
- Le PU publié d'une ligne non chiffrée est nul, ses colonnes `snapshot_gross_*` valent 0.

Commandes et résultats (Windows, Node 24.19.0, worktree `miaouffrage-l2-24`) :

| Commande | Résultat |
|---|---|
| `npx vitest run --project=node src/lib/estimates/engine-v3 src/lib/estimates/engine` | 7 fichiers, 101 tests verts (10 000 tirages : 225 ms ; 500 devis : 198 ms) |
| `npx vitest run --project=node src/test/engine-version-lint.test.ts` | 13 tests verts |
| `npm run typecheck` | sortie 0 |
| `npx eslint src/lib/estimates/engine-v3 src/lib/estimates/engine --max-warnings=0` | sortie 0 |
| `npm run check:architecture` | « Architecture budgets passed (1115 modules, 0 allowed runtime cycles) » |
| `git diff --stat e30560f4 -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` | vide |
| Contre-épreuve : remise en taux tronquée au lieu du demi supérieur (mutation temporaire) | `properties.test.ts` rouge (« R per intent », devis 14) ; restauré, vert |
| Mesure ponctuelle (script hors dépôt, `tsx`) | v3 1 000 lignes : p50 2,6 ms, p95 4,3 ms (≤ 50 ms) ; 3 000 lignes : v3 p50 9,7 ms contre v2 23,7 ms (≤ 2 ×) |

Hors de cette piste et non prouvé ici : parité TS/SQL sur 10 000 lignes et 300 devis (harnais
`scripts/engine-v3/parity.ts`, piste SQL), lots OPTIMA complets du §5.4
(`scripts/engine-v3/optima-lot-check.ts`), normaliseur d'unités (40 vecteurs), suites pgTAP de M3,
suite Vitest complète et E2E (CI de la PR).
